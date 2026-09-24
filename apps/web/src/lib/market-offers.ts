import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api.js";

/**
 * Phase 6 价格引擎共享类型与文案映射（规格 §14 市场价格系统 / §15 Price Evidence Score / §16.1 锚点价格条件）。
 *
 * 与候选池同理：产品详情、AI价值研究工作台与市场价格中心展示的是同一批后端对象，
 * 标签与语义必须完全一致，不允许各页面各写一份中文映射。
 * 价格类型 / 单位标签与金额格式直接复用 lib/research.ts，避免出现两套口径。
 *
 * 三条必须在界面上显式表达的规则：
 * 1. 挂牌 ≠ 成交——价格类型按来源原文判定，汇总里分开计数；
 * 2. 整件 ≠ 单饼——整件价只算 1kg 等价，绝不输出 357g 单饼等价；
 * 3. 没有写 = 不计算——缺规格重量时不换算、不倒算、不推断补全。
 */

export type PriceEvidenceBand = "STRONG" | "USABLE" | "WEAK";
export type MarketOfferAttribution =
  | "MANUAL"
  | "CANDIDATE"
  | "SOURCE_IDENTIFIED"
  | "SOURCE_UNATTRIBUTED";
export type MarketOfferSort = "value" | "-value" | "evidence" | "-evidence" | "created_at" | "-created_at";

/** 兜底文案：分档区间（<60 / 60–74 / ≥75）以后端合同返回的文案为唯一准，避免与后端漂移。 */
export const PRICE_EVIDENCE_BAND_LABELS: Record<PriceEvidenceBand, string> = {
  STRONG: "强证据（≥ 75）",
  USABLE: "可用但谨慎（60–74）",
  WEAK: "弱证据（< 60）"
};

export const PRICE_EVIDENCE_BAND_TONES: Record<PriceEvidenceBand, "ok" | "info" | "warn"> = {
  STRONG: "ok",
  USABLE: "info",
  WEAK: "warn"
};

export const PRICE_EVIDENCE_BAND_ORDER: PriceEvidenceBand[] = ["STRONG", "USABLE", "WEAK"];

export const MARKET_OFFER_ATTRIBUTION_LABELS: Record<MarketOfferAttribution, string> = {
  MANUAL: "人工登记",
  CANDIDATE: "已挂到对标候选",
  SOURCE_IDENTIFIED: "来源写明产品身份（未匹配候选）",
  SOURCE_UNATTRIBUTED: "来源未写明产品身份（不参与跨来源印证）"
};

export const MARKET_OFFER_ATTRIBUTION_TONES: Record<MarketOfferAttribution, "ok" | "info" | "warn" | "neutral"> = {
  MANUAL: "info",
  CANDIDATE: "ok",
  SOURCE_IDENTIFIED: "neutral",
  SOURCE_UNATTRIBUTED: "warn"
};

export const MARKET_OFFER_SORT_LABELS: Record<MarketOfferSort, string> = {
  "-value": "金额从高到低",
  value: "金额从低到高",
  "-evidence": "证据分从高到低",
  evidence: "证据分从低到高",
  "-created_at": "最近登记优先",
  created_at: "最早登记优先"
};

/** 五项证据分兜底标签与权重（§15）；展示优先取后端合同返回值。 */
export const PRICE_EVIDENCE_COMPONENT_LABELS: Record<string, string> = {
  nature_clarity: "成交/挂牌性质明确",
  source_credibility: "来源可信度",
  product_identity: "产品身份确定",
  freshness: "时间新鲜度",
  cross_source: "多来源印证"
};

/** 价格水平基准（后端 BASIS_PRIORITY 的中文解释）。 */
export const PRICE_BASIS_LABELS: Record<string, string> = {
  VERIFIED_TRANSACTION: "已验证成交价",
  AUCTION_HAMMER: "拍卖落槌价",
  OFFICIAL_RETAIL: "官方零售价",
  LISTING: "挂牌/报价",
  HISTORICAL_REFERENCE: "历史参考价",
  NONE: "暂无可用基准"
};

/* ------------------------------------------------------------ 后端对象 */

export interface PriceEvidenceItem {
  component: string;
  label: string;
  weight: number;
  score: number;
  note: string;
}

export interface PriceEvidence {
  score: number;
  band: PriceEvidenceBand;
  items: PriceEvidenceItem[];
  notes: string[];
}

export interface MarketOfferView {
  id: string;
  product_id: string;
  product_name?: string | null;
  candidate_id: string | null;
  candidate_name?: string | null;
  source_id: string | null;
  source_kind: string | null;
  domain: string | null;
  url: string | null;
  subject_name: string | null;
  subject_brand: string | null;
  subject_year: number | null;
  subject_spec: string | null;
  identity_key: string | null;
  price_type: string;
  unit_scope: string | null;
  value: number;
  currency: string;
  weight_g: number | null;
  unit_grams: number | null;
  pieces_per_case: number | null;
  price_per_kg: number | null;
  price_357g: number | null;
  piece_equivalent_allowed: boolean;
  evidence_score: number;
  evidence_band: PriceEvidenceBand;
  evidence: PriceEvidence;
  attribution: MarketOfferAttribution;
  quote_traceable: boolean;
  quote: string;
  note: string | null;
  manual_note: string | null;
  observed_at: string | null;
  published_at: string | null;
  is_outlier: boolean;
  outlier_reason: string | null;
  outlier_median: number | null;
  outlier_sample_size: number | null;
  outlier_group_key: string | null;
  is_excluded: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarketOfferListResponse {
  items: MarketOfferView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PriceTypeBucket {
  price_type: string;
  unit_scope: string | null;
  count: number;
  median_value: number | null;
  median_price_per_kg: number | null;
  median_price_357g: number | null;
  strong_count: number;
  outlier_count: number;
}

export interface PriceSummary {
  product_id: string;
  product_name?: string | null;
  total_offers: number;
  counted_offers: number;
  strong_offers: number;
  usable_offers: number;
  weak_offers: number;
  outlier_count: number;
  excluded_count: number;
  unattributed_count: number;
  transaction_count: number;
  listing_count: number;
  /** 可靠价格锚点候选：证据 ≥ 75（§16.1）且非异常值 */
  reliable_count: number;
  buckets: PriceTypeBucket[];
  price_level: {
    basis: string;
    currency: string;
    sample_size: number;
    median_price_per_kg: number | null;
    median_price_357g: number | null;
  };
  notes: string[];
  spec_ref: string;
}

export interface MarketOfferRebuildStats {
  sources_considered: number;
  prices_considered: number;
  drafts: number;
  merged_multi_source: number;
  unattributed: number;
  skipped_limit: number;
}

export interface MarketOfferRebuildResult {
  total: number;
  created: number;
  updated: number;
  kept_manual: number;
  outliers: number;
  outlier_groups: number;
  band_counts: Record<PriceEvidenceBand, number>;
  reached_limit: boolean;
  stats: MarketOfferRebuildStats;
  summary: PriceSummary;
  spec_ref: string;
}

export interface PriceContract {
  spec_ref: string;
  price_types: string[];
  evidence_components: { component: string; label: string; weight: number }[];
  evidence_weight_total: number;
  evidence_bands: Record<PriceEvidenceBand, string>;
  outlier_min_sample: number;
  equivalences: string[];
  case_piece_equivalent_allowed: boolean;
  /** 必须为 false：价格不参与相似度（§13 / §62-4） */
  price_in_similarity: boolean;
  rules: string[];
}

export interface PriceEngineInfo {
  spec_ref: string;
  price_in_similarity: boolean;
  case_piece_equivalent_allowed: boolean;
  /** 可靠价格锚点的最低证据分（= §16.1 的 75） */
  min_reliable_evidence: number;
  limits: {
    maxPerProduct: number;
    defaultPageSize: number;
    maxPageSize: number;
    staleAfterDays: number;
    minOutlierSample: number;
  };
  basis_priority: string[];
  requires_weight_for_equivalence: boolean;
  note: string;
}

export interface PriceContractResponse {
  contract: PriceContract;
  engine: PriceEngineInfo;
  attribution_labels: Record<MarketOfferAttribution, string>;
}

/* ------------------------------------------------------------ 展示辅助 */

export function formatEvidenceScore(score: number): string {
  return `${score} / 100`;
}

/** 规格描述：只展示来源真的写了的字段，缺失就留空，不推断整件 / 单饼关系。 */
export function formatOfferSpec(offer: MarketOfferView): string {
  const parts: string[] = [];
  if (offer.subject_brand) {
    parts.push(offer.subject_brand);
  }
  if (offer.subject_name) {
    parts.push(offer.subject_name);
  }
  if (offer.subject_year !== null) {
    parts.push(`${offer.subject_year} 年`);
  }
  if (offer.weight_g !== null) {
    parts.push(`${offer.weight_g}g`);
  }
  if (offer.subject_spec) {
    parts.push(offer.subject_spec);
  }
  return parts.length > 0 ? parts.join(" · ") : "来源未写明产品身份";
}

/** 等价价格文案：整件价不输出 357g 等价，缺规格重量时两者都不输出。 */
export function formatEquivalents(offer: MarketOfferView, formatValue: (value: number, currency?: string | null) => string): string[] {
  const parts: string[] = [];
  if (offer.price_per_kg !== null) {
    parts.push(`1kg 等价 ${formatValue(offer.price_per_kg, offer.currency)}`);
  }
  if (offer.price_357g !== null) {
    parts.push(`357g 等价 ${formatValue(offer.price_357g, offer.currency)}`);
  }
  if (parts.length === 0) {
    parts.push(offer.piece_equivalent_allowed ? "缺规格重量：不计算等价（没有写 = 不计算）" : "整件价：只算 1kg 等价，不折算单饼价");
  }
  return parts;
}

export function priceStatusLabel(offer: MarketOfferView): string {
  if (offer.is_excluded) {
    return "已人工排除（不进汇总）";
  }
  if (offer.is_outlier) {
    return "异常值（只标记，不删除）";
  }
  return "正常";
}

/**
 * §14 合同自检：前端据此展示五项权重、三档分档与四条红线。
 * 后端不可用时退回本地兜底文案，但「价格不参与相似度」这类硬约束只读合同里的值。
 */
export function usePriceContract(token: string | null): {
  contract: PriceContract | null;
  engine: PriceEngineInfo | null;
  attributionLabels: Record<MarketOfferAttribution, string>;
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<PriceContract | null>(null);
  const [engine, setEngine] = useState<PriceEngineInfo | null>(null);
  const [attributionLabels, setAttributionLabels] = useState<Record<MarketOfferAttribution, string>>(
    MARKET_OFFER_ATTRIBUTION_LABELS
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<PriceContractResponse>("/api/prices/contract", { token });
      setContract(result.contract);
      setEngine(result.engine);
      if (result.attribution_labels) {
        setAttributionLabels(result.attribution_labels);
      }
      setError(null);
    } catch {
      setError("读取 §14 价格合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, attributionLabels, loading, error };
}
