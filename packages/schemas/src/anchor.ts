import { z } from "zod";
import {
  anchorTypeSchema,
  priceTypeSchema,
  resolvedResearchModeSchema,
  researchModeSchema
} from "./enums.js";
import {
  ANCHOR_REQUIREMENTS,
  SALES_ANCHOR_WEIGHTS,
  SIMILARITY_BANDS
} from "./thresholds.js";
import {
  candidateEvidenceSchema,
  candidatePriceObservationSchema,
  candidateSimilaritySchema,
  candidateStatusSchema,
  similarityBandSchema
} from "./comparable.js";
import {
  marketOfferAttributionSchema,
  priceEvidenceBandSchema,
  priceEvidenceSchema
} from "./price.js";
import { priceUnitScopeSchema } from "./source.js";

/**
 * 高价值锚点引擎（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §55 Build Anchors / §56 进度 UI）。
 *
 * Phase 7 只解决一个问题：**这个产品到底有没有资格进入 Benchmark Mode。**
 *
 * 三条不可动摇的规则：
 * 1. 可靠锚点必须有证据：候选相似度 ≥ 70 **且** 价格证据分 ≥ 75，缺一不可（§16.1 / §17）；
 * 2. 没有达标锚点时必须进入 CATEGORY_CREATOR，不得硬凑竞品、降阈值或编造对标（§17 / §62-10）；
 * 3. 来源没写明产品身份的价格（SOURCE_UNATTRIBUTED）不参与锚点判断，避免「只有规格没有身份」的压线价格冒充可靠锚点。
 */

export const ANCHOR_TYPE_LABELS: Record<z.infer<typeof anchorTypeSchema>, string> = {
  HIGHEST_VALUE: "最高价值锚点（Highest Value Anchor）",
  SIMILARITY_HIGH_VALUE: "高相似度锚点（Similarity High Value Anchor）",
  SALES_ANCHOR: "强成交锚点（Sales Anchor）"
};

export const RESOLVED_MODE_LABELS: Record<z.infer<typeof resolvedResearchModeSchema>, string> = {
  BENCHMARK: "高价值对标模式（Benchmark Mode）",
  CATEGORY_CREATOR: "自建高端标准模式（Category Creator Mode）"
};

export const ANCHOR_LIMITS = {
  /** 单产品锚点上限：三种类型各自可存多条，但总量受控，避免一次重建写入失控 */
  maxPerProduct: 60,
  /** 每种锚点最多保留多少条 */
  maxPerType: 10,
  defaultPageSize: 20,
  maxPageSize: 100
} as const;

/** §16.2「价格处于前 20%」的百分位门槛。 */
export const SIMILARITY_ANCHOR_PRICE_PERCENTILE = 80;

export const ANCHOR_TYPE_META = [
  {
    type: "HIGHEST_VALUE" as const,
    label: ANCHOR_TYPE_LABELS.HIGHEST_VALUE,
    requirement: `相似度 ≥ ${ANCHOR_REQUIREMENTS.minSimilarity} 且价格证据分 ≥ ${ANCHOR_REQUIREMENTS.minPriceEvidence}`,
    sort: "成交价优先，其次可靠挂牌价"
  },
  {
    type: "SIMILARITY_HIGH_VALUE" as const,
    label: ANCHOR_TYPE_LABELS.SIMILARITY_HIGH_VALUE,
    requirement: `相似度优先，同时价格处于同产品锚点价格带前 ${100 - SIMILARITY_ANCHOR_PRICE_PERCENTILE}%`,
    sort: "相似度优先"
  },
  {
    type: "SALES_ANCHOR" as const,
    label: ANCHOR_TYPE_LABELS.SALES_ANCHOR,
    requirement: `相似度不低于 ${SIMILARITY_BANDS.REJECT}（不把拒绝档当锚点），六项加权得分排序`,
    sort: "Sales Anchor Score 从高到低"
  }
] as const;

export const salesAnchorComponents = [
  "similarity",
  "price_level",
  "market_recognition",
  "story_value",
  "concept_relevance",
  "evidence"
] as const;
export const salesAnchorComponentSchema = z.enum(salesAnchorComponents);
export type SalesAnchorComponent = z.infer<typeof salesAnchorComponentSchema>;

export const SALES_ANCHOR_COMPONENT_LABELS: Record<SalesAnchorComponent, string> = {
  similarity: "相似度",
  price_level: "价格水平",
  market_recognition: "市场认知",
  story_value: "故事价值",
  concept_relevance: "概念相关性",
  evidence: "证据强度"
};

/** 六项权重以「百分点」形式暴露（35 = 0.30），前端直接展示，避免两处口径不一致。 */
export const SALES_ANCHOR_COMPONENT_WEIGHTS: Record<SalesAnchorComponent, number> = {
  similarity: SALES_ANCHOR_WEIGHTS.similarity * 100,
  price_level: SALES_ANCHOR_WEIGHTS.priceLevel * 100,
  market_recognition: SALES_ANCHOR_WEIGHTS.marketRecognition * 100,
  story_value: SALES_ANCHOR_WEIGHTS.storyValue * 100,
  concept_relevance: SALES_ANCHOR_WEIGHTS.conceptRelevance * 100,
  evidence: SALES_ANCHOR_WEIGHTS.evidence * 100
};

export const salesAnchorComponentScoreSchema = z
  .object({
    component: salesAnchorComponentSchema,
    label: z.string(),
    weight: z.number().positive().max(100),
    score: z.number().min(0).max(100),
    /** weight × score / 100，保留两位小数 */
    contribution: z.number().min(0).max(100),
    note: z.string()
  })
  .strict();
export type SalesAnchorComponentScore = z.infer<typeof salesAnchorComponentScoreSchema>;

export const salesAnchorScoreSchema = z
  .object({
    total: z.number().min(0).max(100),
    items: z.array(salesAnchorComponentScoreSchema),
    formula: z.string()
  })
  .strict();
export type SalesAnchorScore = z.infer<typeof salesAnchorScoreSchema>;

export interface SalesAnchorInput {
  similarity: number;
  price_level: number;
  market_recognition: number;
  story_value: number;
  concept_relevance: number;
  evidence: number;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * §16.3 Sales Anchor Score：
 *
 * ```text
 * Similarity * 0.30 + PriceLevel * 0.25 + MarketRecognition * 0.15
 * + StoryValue * 0.15 + ConceptRelevance * 0.10 + Evidence * 0.05
 * ```
 *
 * 六项输入均为 0–100 分；函数只负责加权，不负责解释各分项怎么得到——
 * 分项来源由 API 层按可审计规则计算，并写进每一项的 note 里。
 */
export function scoreSalesAnchor(input: SalesAnchorInput): SalesAnchorScore {
  const items: SalesAnchorComponentScore[] = salesAnchorComponents.map((component) => {
    const score = clampScore(input[component]);
    const weight = SALES_ANCHOR_COMPONENT_WEIGHTS[component];
    return salesAnchorComponentScoreSchema.parse({
      component,
      label: SALES_ANCHOR_COMPONENT_LABELS[component],
      weight,
      score,
      contribution: round2((weight * score) / 100),
      note: SALES_ANCHOR_COMPONENT_NOTES[component]
    });
  });
  const total = round2(items.reduce((sum, item) => sum + item.contribution, 0));
  return salesAnchorScoreSchema.parse({
    total,
    items,
    formula:
      "Similarity × 0.30 + PriceLevel × 0.25 + MarketRecognition × 0.15 + StoryValue × 0.15 + ConceptRelevance × 0.10 + Evidence × 0.05"
  });
}

const SALES_ANCHOR_COMPONENT_NOTES: Record<SalesAnchorComponent, string> = {
  similarity: "取候选 §13 十维相似度总分；价格不参与这一项。",
  price_level: "取该候选可靠价格在同产品可比价格带中的百分位；没有可靠价格时为 0 分。",
  market_recognition: "按候选被多少个来源提到、保留多少条证据、是否人工确认为对标综合计算。",
  story_value: "按候选是否具备命名、山头、原料、风格、工艺五类可讲的结构信息计算。",
  concept_relevance: "按 §13 的 concept（命名体系 / 产品概念）与 tea_category（茶类）维度命中度计算。",
  evidence: "以可靠价格证据分为主、候选来源证据为辅；没有证据时不给高分。"
};

/* ------------------------------------------------------------ 锚点快照 */

export const anchorCandidateSnapshotSchema = z
  .object({
    candidate_id: z.string().uuid(),
    name: z.string(),
    brand_name: z.string().nullable(),
    year: z.number().int().nullable(),
    tea_type: z.string().nullable(),
    mountain: z.string().nullable(),
    weight_g: z.number().int().nullable(),
    spec_notes: z.string().nullable(),
    identity_key: z.string(),
    similarity_total: z.number().int().min(0).max(100),
    similarity_band: similarityBandSchema,
    similarity: candidateSimilaritySchema.nullable(),
    status: candidateStatusSchema,
    merged_sources: z.number().int().nonnegative(),
    evidence: z.array(candidateEvidenceSchema),
    observed_prices: z.array(candidatePriceObservationSchema),
    notes: z.string().nullable()
  })
  .strict();
export type AnchorCandidateSnapshot = z.infer<typeof anchorCandidateSnapshotSchema>;

export const anchorOfferBasisSchema = z.enum(["price_per_kg", "price_357g", "value", "none"]);
export type AnchorOfferBasis = z.infer<typeof anchorOfferBasisSchema>;

export const anchorOfferSnapshotSchema = z
  .object({
    offer_id: z.string().uuid(),
    candidate_id: z.string().uuid().nullable(),
    subject_name: z.string().nullable(),
    subject_brand: z.string().nullable(),
    subject_year: z.number().int().nullable(),
    subject_spec: z.string().nullable(),
    value: z.number().positive(),
    currency: z.string(),
    price_type: priceTypeSchema,
    unit_scope: priceUnitScopeSchema.nullable(),
    weight_g: z.number().int().positive().nullable(),
    price_per_kg: z.number().positive().nullable(),
    price_357g: z.number().positive().nullable(),
    evidence_score: z.number().int().min(0).max(100),
    evidence_band: priceEvidenceBandSchema,
    evidence: priceEvidenceSchema,
    attribution: marketOfferAttributionSchema,
    quote: z.string(),
    quote_traceable: z.boolean(),
    source_id: z.string().uuid().nullable(),
    url: z.string().nullable(),
    domain: z.string().nullable(),
    observed_at: z.string().nullable(),
    published_at: z.string().nullable(),
    /** 锚点排序使用的可比口径：1kg 等价 → 357g 等价 → 原始金额 */
    comparable_value: z.number().positive(),
    comparable_basis: anchorOfferBasisSchema
  })
  .strict();
export type AnchorOfferSnapshot = z.infer<typeof anchorOfferSnapshotSchema>;

export const anchorSnapshotSchema = z
  .object({
    candidate: anchorCandidateSnapshotSchema,
    market_offer: anchorOfferSnapshotSchema.nullable(),
    /** 该候选可靠价格在同产品可比价格带中的百分位；没有可靠价格时为 null */
    price_percentile: z.number().int().min(0).max(100).nullable(),
    reliable_price_count: z.number().int().nonnegative(),
    evidence_note: z.string()
  })
  .strict();
export type AnchorSnapshot = z.infer<typeof anchorSnapshotSchema>;

/* ------------------------------------------------------------ API 对象 */

export const anchorSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    anchor_type: anchorTypeSchema,
    candidate_id: z.string().uuid().nullable(),
    candidate_name: z.string().nullable().optional(),
    market_offer_id: z.string().uuid().nullable(),
    similarity_score: z.number().int().min(0).max(100),
    price_evidence_score: z.number().int().min(0).max(100),
    price_percentile: z.number().int().min(0).max(100).nullable(),
    sales_anchor_score: z.number().min(0).max(100).nullable(),
    sales_anchor: salesAnchorScoreSchema.nullable(),
    rank: z.number().int().positive(),
    is_primary: z.boolean(),
    is_manual: z.boolean(),
    rationale: z.string(),
    selected_by: z.string().uuid().nullable(),
    selected_at: z.string().nullable(),
    snapshot: anchorSnapshotSchema,
    created_at: z.string(),
    updated_at: z.string()
  })
  .strict();
export type AnchorView = z.infer<typeof anchorSchema>;

export const anchorListQuerySchema = z
  .object({
    product_id: z.string().uuid().optional(),
    anchor_type: anchorTypeSchema.optional(),
    is_primary: z.stringbool().optional(),
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(ANCHOR_LIMITS.maxPageSize).optional(),
    sort: z
      .enum([
        "rank",
        "-rank",
        "similarity",
        "-similarity",
        "price_evidence",
        "-price_evidence",
        "sales",
        "-sales",
        "created_at",
        "-created_at"
      ])
      .optional()
  })
  .strict();
export type AnchorListQuery = z.infer<typeof anchorListQuerySchema>;

export const anchorBuildRequestSchema = z
  .object({
    /** 是否重算已有锚点（默认 true）。人工锚点默认保留，重算不会把人工判断抹掉 */
    recompute: z.boolean().optional(),
    /** 是否保留人工锚点（默认 true） */
    keep_manual: z.boolean().optional(),
    /** 每种锚点最多保留多少条；不传用 ANCHOR_LIMITS.maxPerType */
    max_per_type: z.coerce.number().int().positive().max(ANCHOR_LIMITS.maxPerType).optional()
  })
  .strict();
export type AnchorBuildRequest = z.infer<typeof anchorBuildRequestSchema>;

export const anchorUpdateSchema = z
  .object({
    /** 人工把某条锚点设为主要锚点；同一产品同一时间只保留一条 is_primary */
    is_primary: z.boolean().optional(),
    rationale: z.string().trim().max(2000).optional()
  })
  .strict();
export type AnchorUpdateInput = z.infer<typeof anchorUpdateSchema>;

export const anchorBuildStatsSchema = z
  .object({
    candidates_considered: z.number().int().nonnegative(),
    reliable_price_candidates: z.number().int().nonnegative(),
    attributed_price_offers: z.number().int().nonnegative(),
    unattributed_price_offers: z.number().int().nonnegative(),
    highest_value: z.number().int().nonnegative(),
    similarity_high_value: z.number().int().nonnegative(),
    sales_anchor: z.number().int().nonnegative()
  })
  .strict();
export type AnchorBuildStats = z.infer<typeof anchorBuildStatsSchema>;

export const anchorRebuildResultSchema = z
  .object({
    total: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    kept_manual: z.number().int().nonnegative(),
    mode: resolvedResearchModeSchema,
    resolved_by: z.enum(["AUTO_ANCHOR", "MANUAL_PREFERENCE", "NO_RELIABLE_ANCHOR"]),
    reason: z.string(),
    primary_anchor_id: z.string().uuid().nullable(),
    anchor_types: z.record(anchorTypeSchema, z.number().int().nonnegative()),
    stats: anchorBuildStatsSchema,
    anchors: z.array(anchorSchema),
    spec_ref: z.literal("§16 / §17 / §55 / §56")
  })
  .strict();
export type AnchorRebuildResult = z.infer<typeof anchorRebuildResultSchema>;

export const anchorResolveSourceSchema = z.enum([
  "AUTO_ANCHOR",
  "MANUAL_PREFERENCE",
  "NO_RELIABLE_ANCHOR"
]);
export type AnchorResolveSource = z.infer<typeof anchorResolveSourceSchema>;

export const benchmarkModeSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    /** 产品录入时的偏好：AUTO / BENCHMARK / CATEGORY_CREATOR */
    preference: researchModeSchema,
    mode: resolvedResearchModeSchema,
    resolved_by: anchorResolveSourceSchema,
    reason: z.string(),
    highest_value_count: z.number().int().nonnegative(),
    similarity_high_value_count: z.number().int().nonnegative(),
    sales_anchor_count: z.number().int().nonnegative(),
    primary_anchor_id: z.string().uuid().nullable(),
    primary_anchor: anchorSchema.nullable(),
    anchors: z.array(anchorSchema),
    spec_ref: z.literal("§16 / §17 / §55 / §56")
  })
  .strict();
export type BenchmarkModeView = z.infer<typeof benchmarkModeSchema>;

/** 供 API 自检与前端展示：§16 / §17 的阈值、权重与红线只从这里读取。 */
export const ANCHOR_CONTRACT = {
  spec_ref: "§16 / §17",
  types: ANCHOR_TYPE_META,
  requirements: {
    min_similarity: ANCHOR_REQUIREMENTS.minSimilarity,
    min_price_evidence: ANCHOR_REQUIREMENTS.minPriceEvidence
  },
  similarity_high_value_top_percent: 100 - SIMILARITY_ANCHOR_PRICE_PERCENTILE,
  price_percentile_threshold: SIMILARITY_ANCHOR_PRICE_PERCENTILE,
  sales_anchor_weights: SALES_ANCHOR_COMPONENT_WEIGHTS,
  sales_anchor_formula:
    "Similarity × 0.30 + PriceLevel × 0.25 + MarketRecognition × 0.15 + StoryValue × 0.15 + ConceptRelevance × 0.10 + Evidence × 0.05",
  excludes_source_unattributed: true,
  no_fake_benchmark: true,
  price_in_similarity: false,
  rules: [
    "可靠锚点必须同时满足 Similarity ≥ 70 且 PriceEvidence ≥ 75（§16.1 / §17）",
    "没有达标锚点必须进入 CATEGORY_CREATOR，不得硬凑竞品、降低阈值或编造对标（§17 / §62-10）",
    "来源未写明产品身份的价格不参与锚点判断（不参与跨来源印证）",
    "Highest Value Anchor 排序：成交价优先，其次可靠挂牌价（§16.1）",
    "Similarity High Value Anchor：相似度优先，同时价格处于前 20%（§16.2）",
    "Sales Anchor 六项加权合计 100（§16.3）"
  ]
} as const;
