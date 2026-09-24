import { SOURCE_LIMITS } from "@ldj/schemas";
import { AppError } from "@ldj/shared";

/**
 * Crawler（规格 §41 / §55 的 SOURCE_FETCH 阶段）。
 *
 * 只做一件事：把一个 URL 变成可回溯的纯文本。
 * - 只允许 http/https，禁止内网地址（防止 SSRF）；
 * - 超时 15s、单页最多 2MB、文本最多 60000 字（超过部分截断并标记）；
 * - 不执行任何脚本、不解析 PDF/图片，拿不到正文就如实返回失败原因。
 */

export interface CrawlResult {
  url: string;
  finalUrl: string;
  ok: boolean;
  httpStatus: number | null;
  contentType: string | null;
  title: string | null;
  text: string;
  charCount: number;
  truncated: boolean;
  error: string | null;
}

export interface CrawlerOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxTextLength?: number;
  /** 测试时可放开内网限制（默认 false） */
  allowPrivateHosts?: boolean;
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /^metadata\./i
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function stripHtml(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1] ?? "").trim() || null : null;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return { title, text: normalizeText(decodeEntities(text)) };
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

export class CrawlerService {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxTextLength: number;
  private readonly allowPrivateHosts: boolean;

  constructor(options: CrawlerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? SOURCE_LIMITS.fetchTimeoutMs;
    this.maxBytes = options.maxBytes ?? SOURCE_LIMITS.maxFetchBytes;
    this.maxTextLength = options.maxTextLength ?? SOURCE_LIMITS.maxTextLength;
    this.allowPrivateHosts = options.allowPrivateHosts ?? false;
  }

  /** 校验 URL 是否可以抓取；不可抓取时抛 VALIDATION_ERROR（不静默跳过）。 */
  assertFetchable(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw AppError.validation("来源 URL 不合法");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw AppError.validation("只允许抓取 http / https 来源");
    }
    if (!this.allowPrivateHosts && isPrivateHost(url.hostname)) {
      throw AppError.validation("禁止抓取内网或本地地址", { host: url.hostname });
    }
    return url;
  }

  async fetch(rawUrl: string): Promise<CrawlResult> {
    const url = this.assertFetchable(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          // 明确标识自己，避免被当成浏览器或爬虫规避策略
          "user-agent": "LDJ-ValueEngine/0.1 (+research; contact=admin@longdeji.local)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
        }
      });
      const contentType = response.headers.get("content-type");
      const { text: raw, truncated } = await readLimitedText(response, this.maxBytes);
      const looksHtml = /html|xml/i.test(contentType ?? "") || /<html|<body|<div/i.test(raw.slice(0, 500));
      const parsed = looksHtml ? stripHtml(raw) : { title: null, text: normalizeText(raw) };
      const text = parsed.text.slice(0, this.maxTextLength);
      return {
        url: rawUrl,
        finalUrl: response.url || url.toString(),
        ok: response.ok,
        httpStatus: response.status,
        contentType,
        title: parsed.title,
        text,
        charCount: text.length,
        truncated: truncated || parsed.text.length > text.length,
        error: response.ok ? null : `HTTP ${response.status}`
      };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        url: rawUrl,
        finalUrl: url.toString(),
        ok: false,
        httpStatus: null,
        contentType: null,
        title: null,
        text: "",
        charCount: 0,
        truncated: false,
        error: aborted
          ? `抓取超时（>${Math.round(this.timeoutMs / 1000)}s）`
          : error instanceof Error
            ? error.message
            : String(error)
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readLimitedText(
  response: Response,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (received >= maxBytes) {
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }
  text += decoder.decode();
  return { text, truncated };
}
