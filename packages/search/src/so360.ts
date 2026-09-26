import type { SearchProvider, SearchRequest, SearchResult } from "./types.js";
import { safeDomain } from "./mock.js";
import { decodeHtmlEntities, stripHtmlTags } from "./html.js";

/**
 * 免 Key 的网页检索 Provider（规格 §12 搜索 Adapter / §62-1 不许用模型记忆替代搜索）。
 *
 * 客户追加需求（2026-09-26）：「卖点一定要根据我提供的产品名，尽可能去全网搜索高价值的对标产品」。
 * 环境里 `TAVILY_API_KEY` 为空，需要一条**不需要第三方账号**的真实检索通道。
 *
 * 2026-09-26 本机 Node `fetch` 实测（UA 伪装 + `accept-language: zh-CN`）：
 * - Bing：**静默降级**——返回的结果与查询词不相关（查「冰岛古树熟茶 价格」返回冰岛旅游攻略），
 *   属于比「0 条结果」更危险的情况，故不作默认；
 * - 搜狗：相关度好，但第 3 次连续请求就出验证码页（`SourceVerifyCode`），不可用；
 * - 百度：200 但结果块是 JS 渲染，静态 HTML 里解析不到；
 * - **360（`www.so.com/s?q=`）：相关度好且实测可连续 8 次调用无验证码** ← 采用。
 *
 * 三条工程纪律：
 * 1. 只做检索，不做判断：title / url / snippet 原样返回，出处（域名）与链接一起带出去；
 * 2. 绝不让模型「凭记忆」补结果：解析不到就是 0 条，由调用方如实告诉用户，不编造来源（§62-1）；
 * 3. 搜索只是增强项：带超时、可失败，失败由调用方降级，不许拖死主链路。
 *
 * ⚠️ 抓取式通道依赖第三方页面结构，无 SLA；页面改版会导致解析到 0 条（会如实降级，
 * 不会伪造结果）。拿到 Tavily / Serper 之类的 Key 后可一键切回结构化检索。
 */

export interface So360ProviderConfig {
  /** 默认 https://www.so.com */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** 单次检索超时（毫秒）；超时即视为本次没有检索结果 */
  timeoutMs?: number;
  /** 命中兜底页（无结果标记）时的额外重试次数，默认 2（共最多 3 次请求） */
  retries?: number;
  /** 两次尝试之间的等待（毫秒），默认 400 */
  retryDelayMs?: number;
}

/** 结果块起点；360 用 `<li class="res-list ">` 这类带尾空格的写法，故不加闭合引号。 */
const RESULT_START = '<li class="res-list';
/**
 * 结果页里只要有这个标记，就说明拿到了真结果页；
 * 没有它 = 360 返回了一张 3KB 的兜底页（实测同一 IP 上真实结果页与兜底页会交替出现，
 * 同一查询连发会时好时坏）→ 重试一次往往就能拿到真结果，不能直接当成「没有对标」。
 */
const RESULT_MARKER = "res-list";
/** 标题块：`res-title`（普通结果）与 `g-title`（富媒体结果）。`class="title"` 是站内 onebox，丢掉。 */
const TITLE_BLOCK_PATTERN = /<h3\s+class="(?:res-title|g-title)[^"]*"[\s\S]{0,600}?<a\s([^>]*)>([\s\S]*?)<\/a>/i;
const DATA_MDURL_PATTERN = /data-mdurl="([^"]+)"/i;
const HREF_PATTERN = /href="([^"]+)"/i;
const DESC_PATTERN = /<p class="res-desc"[^>]*>([\s\S]*?)<\/p>/i;
/** 富媒体结果（商品卡 / 资讯卡 / 问答卡）没有 `p.res-desc`，摘要写在 `span.res-list-summary` 里。 */
const SUMMARY_PATTERN = /<span class="res-list-summary"[^>]*>([\s\S]*?)<\/span>/i;

/**
 * 站内聚合页（地图 / 图片 / 视频 / 相关搜索）不是「全网对标来源」，必须丢掉，
 * 否则会把「360地图查到的杂货店」当成对标品牌喂给模型。
 */
const AGGREGATOR_HOSTS = [
  /^(www\.)?so\.com$/i,
  /^image\.so\.com$/i,
  /^ai\.so\.com$/i,
  /^tv\.360kan\.com$/i,
  /^www\.360kan\.com$/i,
  /^map\.360\.cn$/i,
  /^map\.so\.com$/i
];

function isAggregatorHost(hostname: string): boolean {
  return AGGREGATOR_HOSTS.some((pattern) => pattern.test(hostname));
}

/**
 * 解析 360 结果页（纯函数，便于单测覆盖「页面结构变了会怎样」）。
 *
 * 结果块里能拿到两个地址：`href` 是 360 的跳转链接（`www.so.com/link?m=...`，点开也能到，
 * 但中间多一跳），`data-mdurl` 才是真实地址，优先取后者。
 * 两者都拿不到、或拿到的是站内聚合页时**直接丢弃该条**——宁可少给几条，
 * 也不能给出一批没人能点开、或压根不是对标的假来源。
 */
export function parseSo360Results(html: string, limit: number): SearchResult[] {
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
    const block = TITLE_BLOCK_PATTERN.exec(chunk);
    if (!block) {
      continue;
    }
    const attrs = block[1] ?? "";
    const title = stripHtmlTags(block[2] ?? "");
    const rawUrl = decodeHtmlEntities(DATA_MDURL_PATTERN.exec(attrs)?.[1] ?? HREF_PATTERN.exec(attrs)?.[1] ?? "").trim();
    if (!title || !/^https?:\/\//i.test(rawUrl)) {
      continue;
    }

    let hostname: string;
    try {
      hostname = new URL(rawUrl).hostname;
    } catch {
      continue;
    }
    if (isAggregatorHost(hostname)) {
      continue;
    }
    const url = rawUrl;
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    results.push({
      title,
      url,
      snippet: stripHtmlTags(DESC_PATTERN.exec(chunk)?.[1] ?? SUMMARY_PATTERN.exec(chunk)?.[1] ?? ""),
      sourceDomain: safeDomain(url)
    });
  }

  return results;
}

export class So360SearchProvider implements SearchProvider {
  readonly name = "so360";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(config: So360ProviderConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "https://www.so.com").replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.retries = Math.max(config.retries ?? 2, 0);
    this.retryDelayMs = Math.max(config.retryDelayMs ?? 400, 0);
  }

  async search(input: SearchRequest): Promise<SearchResult[]> {
    const query = input.query.trim();
    if (!query) {
      return [];
    }
    const limit = Math.min(Math.max(input.maxResults ?? 10, 1), 20);
    const url = `${this.baseUrl}/s?q=${encodeURIComponent(query)}&pn=1`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      for (let attempt = 0; ; attempt += 1) {
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`网页检索失败：${response.status}`);
        }
        const html = await response.text();
        const results = parseSo360Results(html, limit);
        // 拿到结果、或重试用完：如实返回（0 条就是 0 条，交由调用方降级，不臆造来源）
        if (results.length > 0 || attempt >= this.retries) {
          return results;
        }
        // 有结果标记却解析不出内容 = 360 改了页面结构，再试也没用，直接如实返回 0 条；
        // 没有结果标记才是那张兜底页，值得再试一次。
        if (html.includes(RESULT_MARKER)) {
          return results;
        }
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
