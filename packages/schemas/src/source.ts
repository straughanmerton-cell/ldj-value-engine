import { z } from "zod";
import { priceTypes, type PriceType } from "./enums.js";
import { normalizeTraceabilityText } from "./fact-normalizer.js";

/**
 * 证据来源（规格 §11 事实状态 / §41 网页事实抽取 / §54 sources 表 / §62-3·4）。
 *
 * 三类来源必须分开处理，任何自动化流程都不得跨类换算：
 * - 挂牌（LISTING）≠ 成交（VERIFIED_TRANSACTION）；
 * - 整件价 ≠ 单饼价（单位必须显式记录）；
 * - 历史/口述价格 ≠ 当前价格。
 */

export const sourceKinds = [
  "SEARCH_RESULT",
  "PRODUCT_PAGE",
  "PRICE_PAGE",
  "MARKETPLACE",
  "AUCTION_PAGE",
  "ARTICLE",
  "FORUM",
  "SOCIAL",
  "OTHER"
] as const;
export const sourceKindSchema = z.enum(sourceKinds);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const sourceFetchStatuses = ["PENDING", "FETCHED", "FAILED", "SKIPPED"] as const;
export const sourceFetchStatusSchema = z.enum(sourceFetchStatuses);
export type SourceFetchStatus = z.infer<typeof sourceFetchStatusSchema>;

export const sourceExtractionStatuses = ["NOT_EXTRACTED", "EXTRACTED", "PARTIAL", "FAILED"] as const;
export const sourceExtractionStatusSchema = z.enum(sourceExtractionStatuses);
export type SourceExtractionStatus = z.infer<typeof sourceExtractionStatusSchema>;

export const priceUnitScopes = ["PIECE", "CASE", "KG", "BUNDLE", "UNKNOWN"] as const;
export const priceUnitScopeSchema = z.enum(priceUnitScopes);
export type PriceUnitScope = z.infer<typeof priceUnitScopeSchema>;

export const sourceKindLabels: Record<SourceKind, string> = {
  SEARCH_RESULT: "搜索结果",
  PRODUCT_PAGE: "产品页",
  PRICE_PAGE: "价格页",
  MARKETPLACE: "交易平台",
  AUCTION_PAGE: "拍卖页",
  ARTICLE: "行业文章",
  FORUM: "论坛",
  SOCIAL: "社交媒体",
  OTHER: "其他"
};

export const priceTypeLabels: Record<PriceType, string> = {
  OFFICIAL_RETAIL: "官方零售价",
  LISTING: "挂牌/报价",
  VERIFIED_TRANSACTION: "已验证成交价",
  AUCTION_HAMMER: "拍卖落槌价",
  HISTORICAL_REFERENCE: "历史参考价",
  UNKNOWN: "类型未知"
};

/** 抓取限制：超时、体积与单产品来源上限，防止流水线被单页拖死。 */
export const SOURCE_LIMITS = {
  fetchTimeoutMs: 15_000,
  maxFetchBytes: 2_000_000,
  maxTextLength: 60_000,
  maxSourcesPerProduct: 400,
  defaultMaxResultsPerQuery: 6,
  defaultMaxQueriesPerRun: 18
} as const;

export function sourceDomainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "spm",
  "from",
  "share_token",
  "fbclid",
  "gclid"
];

/** 规范化 URL：去锚点、去跟踪参数、去末尾斜杠，用于同源去重。 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    url.hash = "";
    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

/** 域名/标题 → 来源类型。宁可判成 OTHER，也不要把论坛口述价当成成交价来源。 */
export function classifySourceKind(url: string, title?: string | null): SourceKind {
  const domain = sourceDomainOf(url);
  const haystack = `${domain} ${title ?? ""}`;
  if (/(zhaoonline|artron|polyauction|chengpai|auction)/i.test(haystack) || /拍卖/.test(haystack)) {
    return "AUCTION_PAGE";
  }
  if (/(taobao|tmall|jd\.com|pinduoduo|1688|xiaohongshu|douyin|kuaishou|shop)/i.test(haystack)) {
    return "MARKETPLACE";
  }
  if (/(tieba|zhihu|forum|bbs|douban|weibo|t\.me|facebook|twitter|x\.com)/i.test(haystack)) {
    return "SOCIAL";
  }
  if (/(tea|chachi|puer|pu-er|baike|sina|sohu|163\.com|qq\.com|article|news)/i.test(haystack) || /行情|价格|市场/.test(haystack)) {
    return "ARTICLE";
  }
  return "OTHER";
}

export interface PriceTypeInference {
  price_type: PriceType;
  reason: string;
  /** AI 或来源标注过但被规则纠正时记录原值，便于审计 */
  corrected_from: PriceType | null;
  unit_scope: PriceUnitScope;
}

const CASE_PATTERN = /整件|一件|每件|件价|箱|整箱/;
const PIECE_PATTERN = /单饼|一饼|每饼|饼价|单片|片价|克价|元\s*\/\s*(饼|片|个|块|沱|砖|提)/;
const KG_PATTERN = /公斤|每公斤|\/kg|千克/;

export function detectUnitScope(quote: string): PriceUnitScope {
  if (CASE_PATTERN.test(quote)) {
    return "CASE";
  }
  if (KG_PATTERN.test(quote)) {
    return "KG";
  }
  if (PIECE_PATTERN.test(quote)) {
    return "PIECE";
  }
  if (/提|扎/.test(quote)) {
    return "BUNDLE";
  }
  return "UNKNOWN";
}

const CLAUSE_DELIMITERS = ["\n", "。", "！", "？", "；", ";", "，", ",", "、", "：", ":", "|"] as const;

/** 数字的千分位/空格变体（12,000 / 12 000 都能命中 12000）。 */
function digitPattern(digits: string): string {
  return digits
    .split("")
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[,\\s]?");
}

/**
 * 在一个引文里定位「这个价格数值自己」出现的位置。
 * 支持两种写法：480000 与 48 万元。
 */
function findPriceSpan(quote: string, value: number): { index: number; end: number } | null {
  const plain = Number.isInteger(value) ? String(value) : String(value);
  const candidates: RegExp[] = [new RegExp(digitPattern(plain))];
  if (Number.isInteger(value) && value % 10_000 === 0) {
    candidates.push(new RegExp(`${digitPattern(String(value / 10_000))}\\s*万`));
  }
  if (Number.isInteger(value) && value % 1_000 === 0 && value >= 1_000) {
    candidates.push(new RegExp(`${digitPattern(String(value / 1_000))}\\s*千`));
  }
  for (const pattern of candidates) {
    const match = pattern.exec(quote);
    if (match && match[0].length > 0) {
      return { index: match.index, end: match.index + match[0].length };
    }
  }
  return null;
}

/**
 * 取出「这条价格所在的那个分句」（规格 §62-3）。
 *
 * 同一条引文里经常同时出现单饼价与整件价（如「挂牌价 12000 元/饼，整件价 48 万元」），
 * 整条引文的单位判定会被相邻价格带偏：12000 元/饼 会被同句的「整件」判成整件价而整条丢弃。
 * 因此单位判定必须只看该价格自己所在的分句；找不到数值时退回整条引文（保守）。
 */
export function priceLocalScopeText(quote: string, value: number): string {
  const span = findPriceSpan(quote, value);
  if (!span) {
    return quote;
  }
  let start = 0;
  let end = quote.length;
  for (const delimiter of CLAUSE_DELIMITERS) {
    const left = quote.lastIndexOf(delimiter, Math.max(0, span.index - 1));
    if (left >= start) {
      start = left + delimiter.length;
    }
    const right = quote.indexOf(delimiter, span.end);
    if (right !== -1 && right < end) {
      end = right;
    }
  }
  const clause = quote.slice(start, end).trim();
  return clause.length > 0 ? clause : quote;
}

/** 价格单位以「该价格所在分句」为准；分句里没有任何单位线索时退回整条引文的判定。 */
export function resolvePriceUnitScope(quote: string, value: number, fallback: PriceUnitScope): PriceUnitScope {
  const local = detectUnitScope(priceLocalScopeText(quote, value));
  return local === "UNKNOWN" ? fallback : local;
}

/**
 * 从引文判定价格类型（§62-2/3/4）。
 * 判定永远以网页原文为准；AI 给出的类型只能作为 hint，冲突时以本函数结果为准。
 */
export function inferPriceTypeFromQuote(
  quote: string,
  sourceKind: SourceKind,
  claimed?: PriceType
): PriceTypeInference {
  const unitScope = detectUnitScope(quote);
  const oralSource = sourceKind === "SOCIAL" || sourceKind === "FORUM";
  let priceType: PriceType = "UNKNOWN";
  let reason: string;

  if (/拍卖|落槌|拍出|上拍/.test(quote)) {
    priceType = "AUCTION_HAMMER";
    reason = "原文出现拍卖/落槌表述";
  } else if (/成交|交割|已售出|成交记录/.test(quote)) {
    if (oralSource) {
      priceType = "UNKNOWN";
      reason = "口述/社区来源的成交说法不能作为已验证成交价（§41）";
    } else {
      priceType = "VERIFIED_TRANSACTION";
      reason = "原文出现成交表述且来源不是口述社区";
    }
  } else if (/挂牌|标价|报价|挂价|在售|售价|售\s*\d/.test(quote)) {
    priceType = "LISTING";
    reason = "原文为挂牌/报价，不能当作成交价（§62-3）";
  } else if (/官方指导价|官方零售|建议零售|零售价/.test(quote)) {
    priceType = "OFFICIAL_RETAIL";
    reason = "原文为官方/建议零售价";
  } else if (/行情|历史|往年|去年|参考价|曾经|当年/.test(quote)) {
    priceType = "HISTORICAL_REFERENCE";
    reason = "原文为历史或参考行情，不能当作当前价（§62-4）";
  } else {
    reason = "原文没有明确的成交/挂牌/拍卖表述，类型暂定未知";
  }

  return {
    price_type: priceType,
    reason,
    corrected_from: claimed && claimed !== priceType ? claimed : null,
    unit_scope: unitScope
  };
}

/** 引文是否能在来源正文中逐字（忽略空白与标点）回溯。 */
export function quoteIsTraceable(quote: string, sourceText: string): boolean {
  const normalizedQuote = normalizeTraceabilityText(quote);
  if (normalizedQuote.length === 0) {
    return false;
  }
  return normalizeTraceabilityText(sourceText).includes(normalizedQuote);
}

export const createSourceSchema = z
  .object({
    url: z.string().trim().url("来源必须是合法 URL").max(2000),
    title: z.string().trim().max(300).optional(),
    snippet: z.string().trim().max(2000).optional(),
    source_kind: sourceKindSchema.optional(),
    published_at: z.string().trim().max(60).optional(),
    note: z.string().trim().max(2000).optional()
  })
  .strict();
export type CreateSourceInput = z.infer<typeof createSourceSchema>;

export const sourceListQuerySchema = z
  .object({
    keyword: z.string().trim().max(200).optional(),
    source_kind: sourceKindSchema.optional(),
    fetch_status: sourceFetchStatusSchema.optional(),
    extraction_status: sourceExtractionStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional()
  })
  .strict();
export type SourceListQuery = z.infer<typeof sourceListQuerySchema>;

/** 单条来源抓取请求（规格 §41：只有显式发起才抓，避免误抓一堆页面）。 */
export const sourceFetchRequestSchema = z
  .object({
    /** 已抓取过时是否重新抓取（默认 false，直接复用上次正文） */
    force: z.boolean().optional()
  })
  .strict();
export type SourceFetchRequest = z.infer<typeof sourceFetchRequestSchema>;

/** 单条来源的 Agent 3 抽取请求（规格 §41 / §62-13）。 */
export const sourceExtractRequestSchema = z
  .object({
    /** 是否允许调用 AI 抽取；Mock Provider 下自动退化为规则抽取 */
    use_ai: z.boolean().optional(),
    /** 已有抽取记录时是否重跑（默认 false，保留历史版本 §62-15） */
    force: z.boolean().optional()
  })
  .strict();
export type SourceExtractRequest = z.infer<typeof sourceExtractRequestSchema>;

/** 供 API 自检：§62-2/3/4 的三条价格红线与来源分类均已锁定。 */
export const SOURCE_CONTRACT = {
  spec_ref: "§11 / §41 / §62-2·3·4",
  kinds: sourceKinds,
  price_types: priceTypes,
  unit_scopes: priceUnitScopes,
  rules: [
    "挂牌价 ≠ 成交价",
    "整件价 ≠ 单饼价",
    "历史/口述价格 ≠ 当前价格",
    "没有写 = null（不得推断补全）"
  ]
} as const;
