import type { SearchProvider, SearchRequest, SearchResult } from "./types.js";
import { safeDomain } from "./mock.js";
import { decodeHtmlEntities, stripHtmlTags } from "./html.js";

/**
 * 免 Key 的网页检索 Provider（规格 §12 搜索 Adapter / §62-1 不许用模型记忆替代搜索）。
 *
 * 客户追加需求（2026-09-26）：「卖点一定要根据我提供的产品名，尽可能去全网搜索高价值的对标产品」。
 * 当时环境里 `SEARCH_PROVIDER=mock` 且 `TAVILY_API_KEY` 为空，等于一条结果都拿不到，所以补上这条
 * **不需要第三方账号**的真实检索通道：直接读 Bing 的搜索结果页（中文站点 `cn.bing.com`）。
 *
 * 三条工程纪律：
 * 1. 只做检索，不做判断：拿回来的 title / url / snippet 原样返回，出处（域名）与链接一起带出去；
 * 2. 绝不让模型「凭记忆」补结果：解析不到就是 0 条，由调用方如实告诉用户，不编造来源（§62-1）；
 * 3. 搜索只是增强项：带超时、可失败，失败由调用方降级，不许拖死主链路（出稿本身要 1–2 分钟）。
 *
 * 2026-09-26 实测结论（**不要在不知情的情况下把默认通道切回 Bing**）：同一台机器上，
 * `Invoke-WebRequest` 抓 Bing 结果页是正常的，但 Node `fetch` 拿到的结果页会把中文查询拆成
 * 首字（查「大益7542普洱茶价格」返回「大_百度百科」、查「冰岛古树熟茶」返回冰岛旅游攻略）。
 * 也就是说这条通道在本机 Node 侧**返回的结果与查询词不相关**，属于静默降级，
 * 比「0 条结果」更危险（会让人以为对标出来了）。默认通道改为 360（见 `so360.ts`），
 * Bing 保留为可选通道，仅供结构解析单测与切换排查使用。
 */

export interface BingProviderConfig {
  /** 默认 https://www.bing.com（国内可用；如需国内站点可传 https://cn.bing.com） */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 站点语言，默认 zh-CN（产品名多为中文，中文结果更贴） */
  locale?: string;
  /** 单次检索超时（毫秒）；超时即视为本次没有检索结果 */
  timeoutMs?: number;
}

/** 解析工具已抽到 `html.ts`（与 360 通道共用）；这里继续导出，保持既有引用不变。 */
export { decodeHtmlEntities, stripHtmlTags };

/**
 * Bing 有时把真实地址包在 `https://www.bing.com/ck/a?...&u=a1<base64url>` 里；
 * 能解出来就用真实地址，解不出来（或本来就是真实地址）原样返回。
 */
export function unwrapBingUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (!/(^|\.)bing\.com$/i.test(parsed.hostname)) {
    return rawUrl;
  }
  const wrapped = parsed.searchParams.get("u");
  if (!wrapped || !wrapped.startsWith("a1")) {
    return rawUrl;
  }
  const base64 = wrapped.slice(2).replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  try {
    const decoded = Buffer.from(base64 + padding, "base64").toString("utf8");
    return /^https?:\/\//i.test(decoded) ? decoded : rawUrl;
  } catch {
    return rawUrl;
  }
}

const RESULT_START = '<li class="b_algo"';
const LINK_PATTERN = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;
const CAPTION_PATTERN = /<div class="b_caption"[\s\S]{0,400}?<p[^>]*>([\s\S]*?)<\/p>/i;
const PARAGRAPH_PATTERN = /<p[^>]*>([\s\S]*?)<\/p>/i;

/**
 * 解析 Bing 结果页（纯函数，便于单测覆盖「页面结构变了会怎样」）。
 *
 * 结构对不上时返回已解析到的部分或空数组——**绝不猜**：宁可这一轮没有对标参考，
 * 也不能给出一批没人能点开的假来源。
 */
export function parseBingResults(html: string, limit: number): SearchResult[] {
  if (!html || limit <= 0) {
    return [];
  }
  const chunks = html.split(RESULT_START).slice(1);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (results.length >= limit) {
      break;
    }
    const link = LINK_PATTERN.exec(chunk);
    if (!link) {
      continue;
    }
    const url = unwrapBingUrl(decodeHtmlEntities(link[1] ?? "").trim());
    const title = stripHtmlTags(link[2] ?? "");
    if (!/^https?:\/\//i.test(url) || !title || seen.has(url)) {
      continue;
    }
    const caption = CAPTION_PATTERN.exec(chunk) ?? PARAGRAPH_PATTERN.exec(chunk);
    seen.add(url);
    results.push({
      title,
      url,
      snippet: stripHtmlTags(caption?.[1] ?? ""),
      sourceDomain: safeDomain(url)
    });
  }

  return results;
}

export class BingSearchProvider implements SearchProvider {
  readonly name = "bing";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly locale: string;
  private readonly timeoutMs: number;

  constructor(config: BingProviderConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://www.bing.com").replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.locale = config.locale ?? "zh-CN";
    this.timeoutMs = config.timeoutMs ?? 15000;
  }

  async search(input: SearchRequest): Promise<SearchResult[]> {
    const query = input.query.trim();
    if (!query) {
      return [];
    }
    const limit = Math.min(Math.max(input.maxResults ?? 10, 1), 20);
    const url =
      `${this.baseUrl}/search?q=${encodeURIComponent(query)}` +
      `&setlang=${encodeURIComponent(this.locale)}&mkt=${encodeURIComponent(this.locale)}&count=${limit}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`网页检索失败：${response.status}`);
      }
      return parseBingResults(await response.text(), limit);
    } finally {
      clearTimeout(timer);
    }
  }
}
