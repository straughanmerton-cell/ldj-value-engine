import { z } from "zod";
import { priceTypeSchema } from "./enums.js";
import { priceUnitScopeSchema } from "./source.js";
import { SIMILARITY_BANDS, SIMILARITY_WEIGHTS } from "./thresholds.js";

/**
 * 可比性评分与候选池（规格 §13 可比性评分 / §36·§54 comparable_candidates / §42 Agent 4）。
 *
 * 三条不可动摇的规则：
 * 1. **价格不参与相似度**：相似度只由茶类、概念、山头、原料、香气、滋味、定位、工艺、规格、年代十个维度决定；
 * 2. **未知不等于相似**：任一侧缺少某维度信息时该维度按 0 分计算，并记入 unknown_dimensions，绝不猜测补齐；
 * 3. **候选只存证据**：候选上的价格只能作为「来源原话」保留下来给 Phase 6 的价格引擎用，不参与任何打分。
 */

/** §13 的十个评分维度（顺序与规格表格一致） */
export const similarityDimensions = [
  "tea_category",
  "concept",
  "origin",
  "material",
  "aroma",
  "taste",
  "positioning",
  "craft",
  "specification",
  "era"
] as const;
export const similarityDimensionSchema = z.enum(similarityDimensions);
export type SimilarityDimension = z.infer<typeof similarityDimensionSchema>;

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

/**
 * 维度权重只有一处定义：直接映射 §13 的 `SIMILARITY_WEIGHTS`，
 * 防止后续实现偷偷改权重或把价格塞进某一维。
 */
export const SIMILARITY_DIMENSION_WEIGHTS: Record<SimilarityDimension, number> = {
  tea_category: SIMILARITY_WEIGHTS.teaCategory,
  concept: SIMILARITY_WEIGHTS.concept,
  origin: SIMILARITY_WEIGHTS.origin,
  material: SIMILARITY_WEIGHTS.material,
  aroma: SIMILARITY_WEIGHTS.aroma,
  taste: SIMILARITY_WEIGHTS.taste,
  positioning: SIMILARITY_WEIGHTS.positioning,
  craft: SIMILARITY_WEIGHTS.craft,
  specification: SIMILARITY_WEIGHTS.specification,
  era: SIMILARITY_WEIGHTS.era
};

/** §13 分档：<55 拒绝 / 55–69 外围参考 / 70–84 有效对标 / 85–100 核心对标 */
export const similarityBands = [
  "REJECT",
  "PERIPHERAL_REFERENCE",
  "VALID_COMPARABLE",
  "CORE_COMPARABLE"
] as const;
export const similarityBandSchema = z.enum(similarityBands);
export type SimilarityBand = z.infer<typeof similarityBandSchema>;

export const SIMILARITY_BAND_LABELS: Record<SimilarityBand, string> = {
  REJECT: `拒绝（< ${SIMILARITY_BANDS.REJECT}）`,
  PERIPHERAL_REFERENCE: `外围参考（${SIMILARITY_BANDS.REJECT}–${SIMILARITY_BANDS.PERIPHERAL - 1}）`,
  VALID_COMPARABLE: `有效对标（${SIMILARITY_BANDS.PERIPHERAL}–${SIMILARITY_BANDS.VALID_COMPARABLE - 1}）`,
  CORE_COMPARABLE: `核心对标（${SIMILARITY_BANDS.VALID_COMPARABLE}–100）`
};

export function similarityBandForScore(score: number): SimilarityBand {
  if (score >= SIMILARITY_BANDS.VALID_COMPARABLE) {
    return "CORE_COMPARABLE";
  }
  if (score >= SIMILARITY_BANDS.PERIPHERAL) {
    return "VALID_COMPARABLE";
  }
  if (score >= SIMILARITY_BANDS.REJECT) {
    return "PERIPHERAL_REFERENCE";
  }
  return "REJECT";
}

/** §16.1 锚点门槛引用的相似度阈值（Phase 7 使用，此处集中暴露防止两处定义不一致） */
export const SIMILARITY_MIN_FOR_ANCHOR = SIMILARITY_BANDS.PERIPHERAL;

export const candidateStatuses = ["PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"] as const;
export const candidateStatusSchema = z.enum(candidateStatuses);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  PENDING_REVIEW: "待评审",
  APPROVED: "已确认对标",
  REJECTED: "已拒绝",
  ARCHIVED: "已归档"
};

export const CANDIDATE_LIMITS = {
  /** 单产品候选上限，防止一次研究写入失控 */
  maxCandidatesPerProduct: 400,
  defaultPageSize: 20,
  maxPageSize: 100,
  /** 单个候选最多保留多少条来源原话，避免证据字段无限膨胀 */
  maxEvidencePerCandidate: 24,
  /** 低于该分数的候选默认不进入候选池（§13：<55 直接拒绝） */
  minScoreToStore: SIMILARITY_BANDS.REJECT
} as const;

/**
 * 相似度输入面（facet）：只包含可由录入字段 / 事实 / 抽取值得到的结构化信息。
 * 刻意不包含任何价格字段——类型层面就不给「价格参与相似度」留入口。
 */
export const similarityOriginSchema = z
  .object({
    province: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    region: z.string().trim().max(120).nullable().optional(),
    mountain: z.string().trim().max(200).nullable().optional(),
    village: z.string().trim().max(200).nullable().optional()
  })
  .strict();
export type SimilarityOrigin = z.infer<typeof similarityOriginSchema>;

export const similarityFacetSchema = z
  .object({
    /** 茶类原文，例如「普洱生茶」 */
    tea_type: z.string().trim().max(80).nullable().optional(),
    tea_subtype: z.string().trim().max(80).nullable().optional(),
    /** 概念 / 命名体系关键词 */
    naming: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    origin: similarityOriginSchema.default({}),
    material: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    aroma: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    taste: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    positioning: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    craft: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    weight_g: z.number().positive().max(100_000).nullable().optional(),
    pieces_per_box: z.number().int().positive().max(10_000).nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional()
  })
  .strict();
export type SimilarityFacet = z.infer<typeof similarityFacetSchema>;

export const similarityDimensionScoreSchema = z
  .object({
    dimension: similarityDimensionSchema,
    label: z.string(),
    weight: z.number().int().nonnegative(),
    /** 0–1 的命中度 */
    ratio: z.number().min(0).max(1),
    /** weight × ratio，四舍五入到 0.1 */
    score: z.number().min(0),
    matched: z.boolean(),
    /** 中文说明：命中了什么、为什么是 0 分 */
    note: z.string()
  })
  .strict();
export type SimilarityDimensionScore = z.infer<typeof similarityDimensionScoreSchema>;

export const candidateSimilaritySchema = z
  .object({
    total: z.number().int().min(0).max(100),
    band: similarityBandSchema,
    dimensions: z.array(similarityDimensionScoreSchema),
    matched_dimensions: z.array(similarityDimensionSchema),
    /** 至少一侧缺少该维度信息的维度：缺失部分按 0 分计、绝不猜测补齐（另一侧有更浅层级时按可用层级打折） */
    unknown_dimensions: z.array(similarityDimensionSchema),
    warnings: z.array(z.string())
  })
  .strict();
export type CandidateSimilarity = z.infer<typeof candidateSimilaritySchema>;

export const candidateEvidenceKinds = ["EXTRACTED_FACT", "PRICE_QUOTE", "MANUAL"] as const;
export const candidateEvidenceKindSchema = z.enum(candidateEvidenceKinds);
export type CandidateEvidenceKind = z.infer<typeof candidateEvidenceKindSchema>;

export const candidateEvidenceSchema = z
  .object({
    kind: candidateEvidenceKindSchema,
    field: z.string().trim().max(120),
    /** 网页上明确写出的取值；没有写就留空（不推断） */
    value: z.string().trim().max(2000).nullable().optional(),
    quote: z.string().trim().min(1).max(600),
    source_id: z.string().uuid().nullable().optional(),
    url: z.string().trim().max(2000).nullable().optional(),
    domain: z.string().trim().max(255).nullable().optional()
  })
  .strict();
export type CandidateEvidence = z.infer<typeof candidateEvidenceSchema>;

/** 候选上的价格只能是原话证据：不会进入相似度计算（§62-4）。 */
export const candidatePriceObservationSchema = z
  .object({
    value: z.number().positive().max(100_000_000).nullable(),
    currency: z.string().trim().max(10).nullable().optional(),
    price_type: priceTypeSchema,
    unit_scope: priceUnitScopeSchema.nullable().optional(),
    quote: z.string().trim().min(1).max(600),
    source_id: z.string().uuid().nullable().optional(),
    url: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type CandidatePriceObservation = z.infer<typeof candidatePriceObservationSchema>;

export const comparableCandidateSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    /** 目标产品名，便于高价值茶数据库跨产品展示 */
    product_name: z.string().nullable().optional(),
    name: z.string(),
    brand_name: z.string().nullable(),
    year: z.number().int().nullable(),
    tea_type: z.string().nullable(),
    mountain: z.string().nullable(),
    weight_g: z.number().nullable(),
    spec_notes: z.string().nullable(),
    identity_key: z.string(),
    similarity_total: z.number().int(),
    similarity_band: similarityBandSchema,
    similarity: candidateSimilaritySchema,
    status: candidateStatusSchema,
    review_note: z.string().nullable(),
    reviewed_by: z.string().uuid().nullable(),
    reviewed_at: z.string().nullable(),
    source_ids: z.array(z.string()),
    evidence: z.array(candidateEvidenceSchema),
    observed_prices: z.array(candidatePriceObservationSchema),
    /** 同一条候选被多少来源提到（去重合并次数） */
    merged_sources: z.number().int().nonnegative(),
    notes: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string()
  })
  .strict();
export type ComparableCandidateView = z.infer<typeof comparableCandidateSchema>;

export const candidateListQuerySchema = z
  .object({
    product_id: z.string().uuid().optional(),
    band: similarityBandSchema.optional(),
    status: candidateStatusSchema.optional(),
    q: z.string().trim().max(200).optional(),
    min_score: z.coerce.number().int().min(0).max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(CANDIDATE_LIMITS.maxPageSize).optional(),
    sort: z.enum(["score", "-score", "created_at", "-created_at"]).optional()
  })
  .strict();
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;

export const candidateCreateSchema = z
  .object({
    name: z.string().trim().min(1, "候选名称必填").max(200),
    brand_name: z.string().trim().max(200).nullable().optional(),
    year: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    tea_type: z.string().trim().max(80).nullable().optional(),
    mountain: z.string().trim().max(200).nullable().optional(),
    origin_region: z.string().trim().max(200).nullable().optional(),
    raw_material: z.string().trim().max(400).nullable().optional(),
    weight_g: z.coerce.number().positive().max(100_000).nullable().optional(),
    spec_notes: z.string().trim().max(400).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    /** 手工补充的相似度面：只允许覆盖具名维度，不接受价格 */
    facet: similarityFacetSchema.partial().optional(),
    /** 手工登记时附带的原话证据（必须来自真实来源） */
    evidence: z.array(candidateEvidenceSchema).max(CANDIDATE_LIMITS.maxEvidencePerCandidate).optional()
  })
  .strict();
export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;

export const candidateReviewSchema = z
  .object({
    status: candidateStatusSchema,
    review_note: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type CandidateReviewInput = z.infer<typeof candidateReviewSchema>;

export const candidateBuildRequestSchema = z
  .object({
    /** 是否允许 AI 辅助评审（默认仅在配置真实 Provider 时开启） */
    use_ai: z.boolean().optional(),
    /** 低于该分数的候选仍会入库但标记为 REJECT，便于审计；设为 55 时等价于 §13 拒绝线 */
    min_score: z.coerce.number().int().min(0).max(100).optional(),
    /** 重新计算已有候选的相似度（产品字段变化后使用） */
    recompute: z.boolean().optional(),
    /** 是否把人工已确认的候选保留为 APPROVED（不因重算而退回待评审） */
    keep_reviewed: z.boolean().optional()
  })
  .strict();
export type CandidateBuildRequest = z.infer<typeof candidateBuildRequestSchema>;

/** 归一化：全角转半角、去空白与常见标点、统一小写，仅用于比较，不用于展示。 */
export function normalizeComparableText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[·・。，,、；;：:!！?？"'“”‘’()（）\[\]【】<>《》\-_/\\|+*]+/g, "");
}

/**
 * 候选去重键：品牌 + 名称 + 年份 + 规格。
 * 同一款茶被多个来源提到时合并成一条候选，绝不因为来源多就多算一条证据厚度（§62-5）。
 */
export function candidateIdentityKey(input: {
  name: string;
  brand_name?: string | null;
  year?: number | null;
  weight_g?: number | null;
  spec_notes?: string | null;
}): string {
  const parts = [
    normalizeComparableText(input.brand_name ?? ""),
    normalizeComparableText(input.name),
    input.year === null || input.year === undefined ? "" : String(input.year),
    input.weight_g === null || input.weight_g === undefined ? "" : String(Math.round(input.weight_g)),
    normalizeComparableText(input.spec_notes ?? "")
  ];
  return parts.join("|");
}

/** 供 API 自检：确认 §13 的十个维度、权重与分档都已登记，且价格不在其中。 */
export const COMPARABLE_CONTRACT = {
  spec_ref: "§13 / §36 / §42",
  price_in_similarity: false,
  dimensions: similarityDimensions.map((dimension) => ({
    dimension,
    label: SIMILARITY_DIMENSION_LABELS[dimension],
    weight: SIMILARITY_DIMENSION_WEIGHTS[dimension]
  })),
  weight_total: similarityDimensions.reduce(
    (total, dimension) => total + SIMILARITY_DIMENSION_WEIGHTS[dimension],
    0
  ),
  bands: SIMILARITY_BAND_LABELS,
  statuses: CANDIDATE_STATUS_LABELS
} as const;
