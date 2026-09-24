/**
 * Phase 4 研究域共享类型与文案映射（规格 §12 / §40 / §41 / §55 / §56）。
 *
 * 抽到 lib 的原因是：产品详情「AI研究」Tab、AI价值研究工作台、高价值茶数据库、
 * 证据中心四个入口展示的是同一批后端对象，标签与状态语义必须完全一致，
 * 不允许各页面各写一份中文映射。
 */

export interface ProductOption {
  id: string;
  product_name: string;
  year: number;
  tea_type: string;
  mountain: string | null;
  benchmark_mode_preference: string;
  copy_intensity_default: number;
}

export interface ProductListResponse {
  items: ProductOption[];
  total: number;
}

/* ------------------------------------------------------------ 研究流水线 */

export type StageState = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface StageProgress {
  stage: string;
  status: StageState;
  label: string;
  phase: number;
  /** 是否属于「已交付 Phase」：未交付阶段只登记，不代表已完成。 */
  implemented: boolean;
  started_at: string | null | undefined;
  finished_at: string | null | undefined;
  message: string | null | undefined;
  detail: Record<string, unknown> | null | undefined;
}

export interface ResearchJob {
  id: string;
  product_id: string;
  status: string;
  current_stage: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  summary: Record<string, unknown> | null;
  progress: StageProgress[];
  progress_summary: {
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    pending: number;
    current_stage: string | null;
    percent: number;
  };
  implemented_phases: number[];
  mode_notes: { BENCHMARK: string; CATEGORY_CREATOR: string };
  spec_ref: string;
}

export interface ResearchRunResponse extends ResearchJob {
  stages_run: string[];
  sources_created: number;
  sources_fetched: number;
  extractions: number;
  /** Phase 5 起：本轮候选池归并结果（价格不参与相似度） */
  candidates_created: number;
  candidates_updated: number;
  candidates_total: number;
  candidates_below_min_score: number;
  candidate_band_counts: Record<string, number>;
  /** Phase 6 起：本轮价格证据与异常值结果 */
  price_offers_total: number;
  price_offers_created: number;
  price_offers_updated: number;
  price_offers_kept_manual: number;
  price_evidence_band_counts: Record<string, number>;
  price_outliers: number;
  price_reliable: number;
  price_level: string;
  /** Phase 7 起：本轮锚点构建与模式判定结果 */
  anchor_mode: string;
  anchor_count: number;
  anchor_types: Record<string, number>;
}

export interface ResearchProgressResponse {
  job: ResearchJob | null;
  progress: StageProgress[];
  latest: boolean;
}

export const STAGE_STATE_LABELS: Record<StageState, string> = {
  PENDING: "待执行",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  SKIPPED: "已跳过"
};

export const STAGE_STATE_TONES: Record<StageState, "ok" | "warn" | "danger" | "info" | "neutral"> = {
  PENDING: "neutral",
  RUNNING: "info",
  SUCCEEDED: "ok",
  FAILED: "danger",
  SKIPPED: "warn"
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  PENDING: "待执行",
  RUNNING: "执行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  WAITING_APPROVAL: "待审批"
};

/* ------------------------------------------------------------ 搜索策略 */

export interface SearchPlanResponse {
  product_id: string;
  stored: boolean;
  plan: Record<string, string[]>;
  generator: string;
  dna_version: number | null;
  prompt_version: number | null;
  provider: string | null;
  model: string | null;
  dropped: { query_type: string; query: string; reason: string; details: string[] }[];
  warnings: string[];
  query_count: number;
  queries: { query_type: string; query: string }[];
  counts_by_type: Record<string, number>;
  stale: boolean;
  generated_at: string | null;
  spec_ref: string;
}

/** 规格 §12 的 9 类查询（顺序与 Agent 2 契约一致）。 */
export const QUERY_TYPE_LABELS: Record<string, string> = {
  exact_queries: "精确名称查询",
  concept_queries: "概念词查询",
  origin_queries: "产区查询",
  flavor_queries: "香气查询",
  taste_queries: "滋味查询",
  positioning_queries: "定位查询",
  price_queries: "价格查询",
  auction_queries: "拍卖查询",
  transaction_queries: "成交查询"
};

export const GENERATOR_LABELS: Record<string, string> = {
  RULE_BASED: "规则引擎",
  AI_ASSISTED: "AI 辅助"
};

/* ------------------------------------------------------------ 来源与证据 */

export interface SourceRow {
  id: string;
  product_id: string;
  url: string;
  canonical_url: string;
  domain: string;
  title: string | null;
  snippet: string | null;
  source_kind: string;
  published_at: string | null;
  note: string | null;
  query: string | null;
  query_type: string | null;
  stage: string | null;
  fetch_status: "PENDING" | "FETCHED" | "FAILED" | "SKIPPED";
  http_status: number | null;
  fetch_error: string | null;
  content_chars: number | null;
  has_content: boolean;
  content_preview: string | null;
  extraction_status: "NOT_EXTRACTED" | "EXTRACTED" | "PARTIAL" | "FAILED";
  extracted_at: string | null;
  price_count: number;
  fact_count: number;
  created_at: string;
  updated_at: string;
}

export interface SourceDetail extends SourceRow {
  content_text: string | null;
}

export interface ExtractedPrice {
  value: number;
  currency?: string | null;
  quote: string;
  price_type: string;
  unit_scope?: string | null;
  weight_g?: number | null;
  observed_at?: string | null;
  note?: string | null;
}

export interface ExtractedFact {
  field: string;
  value: string;
  quote: string;
}

export interface ExtractionOutput {
  product_name?: string | null;
  brand_name?: string | null;
  year?: number | null;
  tea_type?: string | null;
  origin_region?: string | null;
  mountain?: string | null;
  village?: string | null;
  weight_g?: number | null;
  spec_notes?: string | null;
  storage?: string | null;
  prices: ExtractedPrice[];
  facts: ExtractedFact[];
  null_reason?: string | null;
}

export interface SourceExtraction {
  id: string;
  source_id: string;
  product_id: string;
  has_content: boolean;
  extraction: ExtractionOutput;
  dropped: { field: string; value: string; reason: string; details: string[] }[];
  warnings: string[];
  price_count: number;
  price_type_counts: Record<string, number>;
  prompt_key: string;
  prompt_version: number | null;
  provider: string | null;
  model: string | null;
  created_at: string;
}

export interface SourceListResponse {
  items: SourceRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const FETCH_STATUS_LABELS: Record<string, string> = {
  PENDING: "待抓取",
  FETCHED: "已抓取",
  FAILED: "抓取失败",
  SKIPPED: "已跳过"
};

export const FETCH_STATUS_TONES: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  PENDING: "warn",
  FETCHED: "ok",
  FAILED: "danger",
  SKIPPED: "neutral"
};

export const EXTRACTION_STATUS_LABELS: Record<string, string> = {
  NOT_EXTRACTED: "未抽取",
  EXTRACTED: "已抽取",
  PARTIAL: "部分可用",
  FAILED: "抽取失败"
};

export const EXTRACTION_STATUS_TONES: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  NOT_EXTRACTED: "neutral",
  EXTRACTED: "ok",
  PARTIAL: "warn",
  FAILED: "danger"
};

export const PRICE_TYPE_LABELS: Record<string, string> = {
  OFFICIAL_RETAIL: "官方零售价",
  LISTING: "挂牌/报价",
  VERIFIED_TRANSACTION: "已验证成交价",
  AUCTION_HAMMER: "拍卖落槌价",
  HISTORICAL_REFERENCE: "历史参考价",
  UNKNOWN: "类型未知"
};

export const PRICE_TYPE_TONES: Record<string, "ok" | "warn" | "info" | "neutral"> = {
  OFFICIAL_RETAIL: "info",
  LISTING: "warn",
  VERIFIED_TRANSACTION: "ok",
  AUCTION_HAMMER: "ok",
  HISTORICAL_REFERENCE: "neutral",
  UNKNOWN: "neutral"
};

export const UNIT_SCOPE_LABELS: Record<string, string> = {
  PIECE: "单饼/单件",
  CASE: "整件",
  KG: "按公斤",
  BUNDLE: "按提/按捆",
  UNKNOWN: "单位未写明"
};

/** 抽取丢弃原因（规格 §41 / §62-2·3·4）的中文解释。 */
export const DROP_REASON_LABELS: Record<string, string> = {
  NOT_ON_PAGE: "网页正文中无法回溯",
  FORBIDDEN_FABRICATION: "禁止虚构的硬事实",
  PRICE_TYPE_CORRECTED: "价格类型按原文重新判定",
  UNIT_MISMATCH: "整件价不得换算为单饼价",
  ORAL_PRICE_DOWNGRADED: "口述价格不得当成交价"
};

export function formatPrice(value: number, currency?: string | null): string {
  const unit = currency && currency !== "CNY" ? currency : "¥";
  return `${unit}${value.toLocaleString("zh-CN")}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("zh-CN");
}
