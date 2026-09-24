import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api.js";

/**
 * Phase 5 候选池与可比性评分共享类型与文案映射（规格 §13 / §36 / §42 Agent 4）。
 *
 * 与研究域同理：产品详情「AI研究」Tab、AI价值研究工作台、高价值茶数据库三处展示的是
 * 同一批后端对象，标签与状态语义必须完全一致，不允许各页面各写一份中文映射。
 *
 * 两条必须在界面上显式表达的规则：
 * 1. 价格不参与相似度——观察价只是来源原话，用于 Phase 6 价格引擎；
 * 2. 未知不等于相似——缺信息的维度按 0 分并列入 unknown_dimensions，界面绝不补猜。
 */

export type SimilarityBand = "REJECT" | "PERIPHERAL_REFERENCE" | "VALID_COMPARABLE" | "CORE_COMPARABLE";
export type CandidateStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "ARCHIVED";
export type CandidateSort = "score" | "-score" | "created_at" | "-created_at";
export type SimilarityDimension =
  | "tea_category"
  | "concept"
  | "origin"
  | "material"
  | "aroma"
  | "taste"
  | "positioning"
  | "craft"
  | "specification"
  | "era";

export const SIMILARITY_BAND_ORDER: SimilarityBand[] = [
  "CORE_COMPARABLE",
  "VALID_COMPARABLE",
  "PERIPHERAL_REFERENCE",
  "REJECT"
];

/**
 * 兜底文案：分档区间（<55 / 55–69 / 70–84 / 85–100）以后端
 * `GET /api/candidates/contract` 返回的文案为唯一准，避免前端写死阈值后与后端漂移。
 */
export const SIMILARITY_BAND_LABELS: Record<SimilarityBand, string> = {
  CORE_COMPARABLE: "核心对标",
  VALID_COMPARABLE: "有效对标",
  PERIPHERAL_REFERENCE: "外围参考",
  REJECT: "拒绝"
};

export const SIMILARITY_BAND_TONES: Record<SimilarityBand, "ok" | "info" | "warn" | "danger"> = {
  CORE_COMPARABLE: "ok",
  VALID_COMPARABLE: "info",
  PERIPHERAL_REFERENCE: "warn",
  REJECT: "danger"
};

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  PENDING_REVIEW: "待评审",
  APPROVED: "已确认对标",
  REJECTED: "已拒绝",
  ARCHIVED: "已归档"
};

export const CANDIDATE_STATUS_TONES: Record<CandidateStatus, "ok" | "warn" | "danger" | "neutral"> = {
  PENDING_REVIEW: "warn",
  APPROVED: "ok",
  REJECTED: "danger",
  ARCHIVED: "neutral"
};

export const CANDIDATE_SORT_LABELS: Record<CandidateSort, string> = {
  "-score": "相似度从高到低",
  score: "相似度从低到高",
  "-created_at": "最近登记优先",
  created_at: "最早登记优先"
};

/** 维度顺序兜底（与后端 §13 表格顺序一致）；标签优先取合同返回值。 */
export const SIMILARITY_DIMENSION_LABELS: Record<SimilarityDimension, string> = {
  tea_category: "茶类（生熟一致）",
  concept: "产品概念 / 命名体系",
  origin: "茶区 / 山头",
  material: "原料",
  aroma: "香气风格",
  taste: "滋味骨架",
  positioning: "市场定位",
  craft: "工艺",
  specification: "规格形态",
  era: "年代关系"
};

export const CANDIDATE_EVIDENCE_KIND_LABELS: Record<string, string> = {
  EXTRACTED_FACT: "网页事实",
  PRICE_QUOTE: "价格原话",
  MANUAL: "人工登记"
};

/* ------------------------------------------------------------ 后端对象 */

export interface SimilarityDimensionScore {
  dimension: SimilarityDimension;
  label: string;
  weight: number;
  ratio: number;
  score: number;
  matched: boolean;
  note: string;
}

export interface CandidateSimilarity {
  total: number;
  band: SimilarityBand;
  dimensions: SimilarityDimensionScore[];
  matched_dimensions: SimilarityDimension[];
  unknown_dimensions: SimilarityDimension[];
  warnings: string[];
}

export interface CandidateEvidence {
  kind: string;
  field: string;
  value?: string | null;
  quote: string;
  source_id?: string | null;
  url?: string | null;
  domain?: string | null;
}

export interface CandidatePriceObservation {
  value: number | null;
  currency?: string | null;
  price_type: string;
  unit_scope?: string | null;
  quote: string;
  source_id?: string | null;
  url?: string | null;
}

export interface CandidateRow {
  id: string;
  product_id: string;
  product_name?: string | null;
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
  similarity: CandidateSimilarity;
  status: CandidateStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  source_ids: string[];
  evidence: CandidateEvidence[];
  observed_prices: CandidatePriceObservation[];
  merged_sources: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CandidateListResponse {
  items: CandidateRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CandidateRebuildResult {
  total: number;
  created: number;
  updated: number;
  kept_reviewed: number;
  below_min_score: number;
  reached_limit: boolean;
  band_counts: Record<SimilarityBand, number>;
  min_score: number;
  stats: {
    extracted_sources: number;
    drafts: number;
    skipped_no_name: number;
    merged_sources: number;
    [key: string]: unknown;
  };
  spec_ref: string;
}

export interface CandidatesContract {
  comparable: {
    spec_ref: string;
    /** 必须为 false：价格不参与相似度（§62-4） */
    price_in_similarity: boolean;
    dimensions: { dimension: SimilarityDimension; label: string; weight: number }[];
    weight_total: number;
    bands: Record<SimilarityBand, string>;
    statuses: Record<CandidateStatus, string>;
  };
  pool: {
    spec_ref: string;
    price_in_similarity: boolean;
    identity_key_fields: string[];
    limits: { maxCandidatesPerProduct: number; defaultPageSize: number; maxPageSize: number; minScoreToStore: number };
    similarity_source: string;
  };
  engine: { spec_ref: string; price_in_similarity: boolean; dimensions: unknown[]; weight_total: number };
  status_labels: Record<CandidateStatus, string>;
}

/* ------------------------------------------------------------ 展示辅助 */

export function formatSimilarityScore(score: number): string {
  return `${score} / 100`;
}

export function candidateDisplayName(row: CandidateRow): string {
  return row.brand_name ? `${row.brand_name} ${row.name}` : row.name;
}

/** 候选的规格描述：只展示已登记字段，缺失就留空，不推断整件/单饼关系。 */
export function formatCandidateSpec(row: CandidateRow): string {
  const parts: string[] = [];
  if (row.year !== null) {
    parts.push(`${row.year} 年`);
  }
  if (row.tea_type) {
    parts.push(row.tea_type);
  }
  if (row.mountain) {
    parts.push(row.mountain);
  }
  if (row.weight_g !== null) {
    parts.push(`${row.weight_g}g`);
  }
  if (row.spec_notes) {
    parts.push(row.spec_notes);
  }
  return parts.length > 0 ? parts.join(" · ") : "规格未登记";
}

export function dimensionLabel(
  dimension: SimilarityDimension,
  contractDimensionMap?: Map<SimilarityDimension, { label: string; weight: number }>
): string {
  return contractDimensionMap?.get(dimension)?.label ?? SIMILARITY_DIMENSION_LABELS[dimension];
}

/** 合同里的十维定义转成查表结构，供明细面板与权重说明共用。 */
export function contractDimensionMap(
  contract: CandidatesContract | null
): Map<SimilarityDimension, { label: string; weight: number }> {
  const map = new Map<SimilarityDimension, { label: string; weight: number }>();
  for (const item of contract?.comparable.dimensions ?? []) {
    map.set(item.dimension, { label: item.label, weight: item.weight });
  }
  return map;
}

/**
 * §13 合同自检：前端据此展示十维权重与分档文案。
 * 后端不可用时退回本地兜底文案，但「价格不参与」这类硬约束只在合同里读，不在前端猜测。
 */
export function useCandidatesContract(token: string | null): {
  contract: CandidatesContract | null;
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<CandidatesContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<CandidatesContract>("/api/candidates/contract", { token });
      setContract(result);
      setError(null);
    } catch {
      setError("读取 §13 相似度合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, loading, error };
}
