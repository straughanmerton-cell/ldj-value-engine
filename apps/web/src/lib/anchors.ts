import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api.js";
import type { CandidateSimilarity, CandidateStatus, SimilarityBand } from "./candidates.js";

/**
 * Phase 7 锚点引擎共享类型与文案映射（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §55 / §56）。
 *
 * 与候选池、价格引擎同理：产品详情「高价值锚点」Tab 与后端返回的是同一批对象，
 * 标签与阈值必须来自 `GET /api/anchors/contract`，前端不写死 70 / 75，避免界面与引擎漂移。
 *
 * 三条必须在界面上显式表达的规则：
 * 1. 可靠锚点必须同时满足相似度 ≥ 70 与价格证据分 ≥ 75，缺一不可（§16.1 / §17）；
 * 2. 没有达标候选时必须进入 Category Creator Mode，不得硬凑竞品、降阈值或编造对标（§17 / §62-10）；
 * 3. 来源未写明产品身份的价格（SOURCE_UNATTRIBUTED）不参与锚点判断。
 */

export type AnchorType = "HIGHEST_VALUE" | "SIMILARITY_HIGH_VALUE" | "SALES_ANCHOR";
export type ResolvedMode = "BENCHMARK" | "CATEGORY_CREATOR";
export type AnchorResolveSource = "AUTO_ANCHOR" | "MANUAL_PREFERENCE" | "NO_RELIABLE_ANCHOR";
export type AnchorOfferBasis = "price_per_kg" | "price_357g" | "value" | "none";
export type AnchorSort =
  | "rank"
  | "-rank"
  | "similarity"
  | "-similarity"
  | "price_evidence"
  | "-price_evidence"
  | "sales"
  | "-sales"
  | "created_at"
  | "-created_at";

export const ANCHOR_TYPE_ORDER: AnchorType[] = ["HIGHEST_VALUE", "SIMILARITY_HIGH_VALUE", "SALES_ANCHOR"];

/** 兜底文案：以后端 `GET /api/anchors/contract` 返回的 type_labels 为唯一准。 */
export const ANCHOR_TYPE_LABELS: Record<AnchorType, string> = {
  HIGHEST_VALUE: "最高价值锚点（Highest Value Anchor）",
  SIMILARITY_HIGH_VALUE: "高相似度锚点（Similarity High Value Anchor）",
  SALES_ANCHOR: "强成交锚点（Sales Anchor）"
};

export const ANCHOR_TYPE_SHORT_LABELS: Record<AnchorType, string> = {
  HIGHEST_VALUE: "最高价值锚点",
  SIMILARITY_HIGH_VALUE: "高相似度锚点",
  SALES_ANCHOR: "强成交锚点"
};

export const ANCHOR_TYPE_TONES: Record<AnchorType, "ok" | "info" | "warn"> = {
  HIGHEST_VALUE: "ok",
  SIMILARITY_HIGH_VALUE: "info",
  SALES_ANCHOR: "warn"
};

export const ANCHOR_TYPE_HINTS: Record<AnchorType, string> = {
  HIGHEST_VALUE: "相似度 ≥ 门槛且价格证据分达标：可作最高价值锚点（§16.1）",
  SIMILARITY_HIGH_VALUE: "相似度优先，同时价格处于同产品可靠价格带前 20%（§16.2）",
  SALES_ANCHOR: "六项加权得分：相似度 / 价格水平 / 市场认知 / 故事价值 / 概念相关性 / 证据（§16.3）"
};

export const RESOLVED_MODE_LABELS: Record<ResolvedMode, string> = {
  BENCHMARK: "高价值对标模式（Benchmark Mode）",
  CATEGORY_CREATOR: "自建高端标准模式（Category Creator Mode）"
};

export const RESOLVED_MODE_TONES: Record<ResolvedMode, "ok" | "warn"> = {
  BENCHMARK: "ok",
  CATEGORY_CREATOR: "warn"
};

export const ANCHOR_RESOLVE_SOURCE_LABELS: Record<AnchorResolveSource, string> = {
  AUTO_ANCHOR: "按锚点自动判定",
  MANUAL_PREFERENCE: "按产品负责人的模式偏好",
  NO_RELIABLE_ANCHOR: "无达标候选强制切换"
};

export const ANCHOR_RESOLVE_SOURCE_TONES: Record<AnchorResolveSource, "ok" | "info" | "warn"> = {
  AUTO_ANCHOR: "ok",
  MANUAL_PREFERENCE: "info",
  NO_RELIABLE_ANCHOR: "warn"
};

/** 六项分项兜底标签与权重；展示优先取后端合同 / 锚点自身返回值。 */
export const SALES_ANCHOR_COMPONENT_LABELS: Record<string, string> = {
  similarity: "相似度",
  price_level: "价格水平",
  market_recognition: "市场认知",
  story_value: "故事价值",
  concept_relevance: "概念相关性",
  evidence: "证据强度"
};

export const ANCHOR_OFFER_BASIS_LABELS: Record<AnchorOfferBasis, string> = {
  price_per_kg: "1kg 等价",
  price_357g: "357g 等价",
  value: "原始金额",
  none: "无可比口径"
};

/* ------------------------------------------------------------ 后端对象 */

export interface SalesAnchorComponentScore {
  component: string;
  label: string;
  weight: number;
  score: number;
  contribution: number;
  note: string;
}

export interface SalesAnchorScore {
  total: number;
  items: SalesAnchorComponentScore[];
  formula: string;
}

export interface AnchorSnapshotCandidate {
  candidate_id: string;
  name: string;
  brand_name: string | null;
  year: number | null;
  tea_type: string | null;
  mountain: string | null;
  weight_g: number | null;
  spec_notes: string | null;
  identity_key: string;
  similarity_total: number;
  similarity_band: SimilarityBand;
  similarity: CandidateSimilarity | null;
  status: CandidateStatus;
  merged_sources: number;
  evidence: { kind: string; field: string; value?: string | null; quote: string; url?: string | null; domain?: string | null }[];
  observed_prices: { value: number | null; currency?: string | null; price_type: string; quote: string }[];
  notes: string | null;
}

export interface AnchorSnapshotOffer {
  offer_id: string;
  subject_name: string | null;
  subject_brand: string | null;
  subject_year: number | null;
  subject_spec: string | null;
  value: number;
  currency: string;
  price_type: string;
  unit_scope: string | null;
  weight_g: number | null;
  price_per_kg: number | null;
  price_357g: number | null;
  evidence_score: number;
  evidence_band: string;
  attribution: string;
  quote: string;
  quote_traceable: boolean;
  url: string | null;
  domain: string | null;
  observed_at: string | null;
  published_at: string | null;
  comparable_value: number;
  comparable_basis: AnchorOfferBasis;
}

export interface AnchorSnapshot {
  candidate: AnchorSnapshotCandidate;
  market_offer: AnchorSnapshotOffer | null;
  price_percentile: number | null;
  reliable_price_count: number;
  evidence_note: string;
}

export interface AnchorView {
  id: string;
  product_id: string;
  product_name?: string | null;
  anchor_type: AnchorType;
  candidate_id: string | null;
  candidate_name?: string | null;
  market_offer_id: string | null;
  similarity_score: number;
  price_evidence_score: number;
  price_percentile: number | null;
  sales_anchor_score: number | null;
  sales_anchor: SalesAnchorScore | null;
  rank: number;
  is_primary: boolean;
  is_manual: boolean;
  rationale: string;
  selected_by: string | null;
  selected_at: string | null;
  snapshot: AnchorSnapshot;
  created_at: string;
  updated_at: string;
}

export interface AnchorListResponse {
  items: AnchorView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface BenchmarkModeView {
  product_id: string;
  product_name?: string | null;
  preference: "AUTO" | "BENCHMARK" | "CATEGORY_CREATOR";
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  reason: string;
  highest_value_count: number;
  similarity_high_value_count: number;
  sales_anchor_count: number;
  primary_anchor_id: string | null;
  primary_anchor: AnchorView | null;
  anchors: AnchorView[];
  spec_ref: string;
}

export interface AnchorBuildStats {
  candidates_considered: number;
  reliable_price_candidates: number;
  attributed_price_offers: number;
  unattributed_price_offers: number;
  highest_value: number;
  similarity_high_value: number;
  sales_anchor: number;
}

export interface AnchorRebuildResult {
  total: number;
  created: number;
  removed: number;
  kept_manual: number;
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  reason: string;
  primary_anchor_id: string | null;
  anchor_types: Record<AnchorType, number>;
  stats: AnchorBuildStats;
  anchors: AnchorView[];
  spec_ref: string;
}

export interface AnchorContract {
  spec_ref: string;
  types: { type: AnchorType; label: string; requirement: string; sort: string }[];
  requirements: { min_similarity: number; min_price_evidence: number };
  similarity_high_value_top_percent: number;
  price_percentile_threshold: number;
  sales_anchor_weights: Record<string, number>;
  sales_anchor_formula: string;
  /** 必须为 true：来源未写明产品身份的价格不参与锚点判断 */
  excludes_source_unattributed: boolean;
  /** 必须为 true：没有达标候选不硬凑竞品 */
  no_fake_benchmark: boolean;
  /** 必须为 false：价格不参与相似度（§13 / §62-4） */
  price_in_similarity: boolean;
  rules: string[];
}

export interface AnchorEngineInfo {
  spec_ref: string;
  min_similarity: number;
  min_price_evidence: number;
  price_percentile_threshold: number;
  price_in_similarity: boolean;
  excludes_source_unattributed: boolean;
  no_fake_benchmark: boolean;
  limits: { maxPerProduct: number; maxPerType: number; defaultPageSize: number; maxPageSize: number };
  note: string;
}

export interface AnchorContractResponse {
  contract: AnchorContract;
  engine: AnchorEngineInfo;
  type_labels: Record<AnchorType, string>;
  mode_labels: Record<ResolvedMode, string>;
}

/* ------------------------------------------------------------ 展示辅助 */

export function anchorTypeLabel(
  type: AnchorType,
  typeLabels?: Partial<Record<AnchorType, string>> | null
): string {
  return typeLabels?.[type] ?? ANCHOR_TYPE_LABELS[type];
}

export function anchorDisplayName(anchor: AnchorView): string {
  const candidate = anchor.snapshot.candidate;
  const base = anchor.candidate_name ?? candidate.name;
  return candidate.brand_name ? `${candidate.brand_name} ${base}` : base;
}

/** 锚定那一刻冻结下来的候选规格：只展示当时真的登记了的字段。 */
export function anchorCandidateSpec(anchor: AnchorView): string {
  const candidate = anchor.snapshot.candidate;
  const parts: string[] = [];
  if (candidate.year !== null) {
    parts.push(`${candidate.year} 年`);
  }
  if (candidate.tea_type) {
    parts.push(candidate.tea_type);
  }
  if (candidate.mountain) {
    parts.push(candidate.mountain);
  }
  if (candidate.weight_g !== null) {
    parts.push(`${candidate.weight_g}g`);
  }
  if (candidate.spec_notes) {
    parts.push(candidate.spec_notes);
  }
  return parts.length > 0 ? parts.join(" · ") : "规格未登记";
}

/** 价格百分位文案：没有可靠价格时明写「无」，不留空白让人猜。 */
export function formatPricePercentile(percentile: number | null): string {
  if (percentile === null) {
    return "无可靠价格";
  }
  return `前 ${Math.max(1, 100 - percentile)}%（百分位 ${percentile}）`;
}

/**
 * §16 / §17 合同自检：前端据此展示三种锚点门槛、70 / 75 双线与「不硬凑竞品」红线。
 * 阈值永远读合同，不在页面上写死。
 */
export function useAnchorContract(token: string | null): {
  contract: AnchorContract | null;
  engine: AnchorEngineInfo | null;
  typeLabels: Record<AnchorType, string>;
  modeLabels: Record<ResolvedMode, string>;
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<AnchorContract | null>(null);
  const [engine, setEngine] = useState<AnchorEngineInfo | null>(null);
  const [typeLabels, setTypeLabels] = useState<Record<AnchorType, string>>(ANCHOR_TYPE_LABELS);
  const [modeLabels, setModeLabels] = useState<Record<ResolvedMode, string>>(RESOLVED_MODE_LABELS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<AnchorContractResponse>("/api/anchors/contract", { token });
      setContract(result.contract);
      setEngine(result.engine);
      if (result.type_labels) {
        setTypeLabels(result.type_labels);
      }
      if (result.mode_labels) {
        setModeLabels(result.mode_labels);
      }
      setError(null);
    } catch {
      setError("读取 §16 锚点合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, typeLabels, modeLabels, loading, error };
}
