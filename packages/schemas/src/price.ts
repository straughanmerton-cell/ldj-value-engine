import { z } from "zod";
import { priceTypeSchema, type PriceType } from "./enums.js";
import { priceUnitScopeSchema, type PriceUnitScope, type SourceKind } from "./source.js";
import { PRICE_EVIDENCE_BANDS, PRICE_EVIDENCE_WEIGHTS } from "./thresholds.js";

/**
 * 市场价格系统（规格 §14 市场价格系统 / §15 Price Evidence Score / §16.1 锚点价格条件）。
 *
 * 四条不可动摇的规则：
 * 1. **挂牌 ≠ 成交**：`price_type` 一律按来源原文判定，挂牌价不得参与「成交价」比较；
 * 2. **整件 ≠ 单饼**：单位必须显式记录，整件稀缺溢价不得线性拆分成精确单饼价值；
 * 3. **历史/口述 ≠ 当前**：老行情与社区口述价只能作为参考，不当作当前价格；
 * 4. **没有写 = 不计算**：缺少规格重量时不做任何 357g / 1kg 等价换算，也不推断补全。
 */

export const priceEvidenceBands = ["STRONG", "USABLE", "WEAK"] as const;
export const priceEvidenceBandSchema = z.enum(priceEvidenceBands);
export type PriceEvidenceBand = z.infer<typeof priceEvidenceBandSchema>;

export const PRICE_EVIDENCE_BAND_LABELS: Record<PriceEvidenceBand, string> = {
  STRONG: `强证据（≥ ${PRICE_EVIDENCE_BANDS.USABLE}）`,
  USABLE: `可用但谨慎（${PRICE_EVIDENCE_BANDS.WEAK}–${PRICE_EVIDENCE_BANDS.USABLE - 1}）`,
  WEAK: `弱证据（< ${PRICE_EVIDENCE_BANDS.WEAK}）`
};

/** §15 分档：>=75 强证据；60–74 可用但谨慎；<60 弱。 */
export function priceEvidenceBandForScore(score: number): PriceEvidenceBand {
  if (score >= PRICE_EVIDENCE_BANDS.USABLE) {
    return "STRONG";
  }
  if (score >= PRICE_EVIDENCE_BANDS.WEAK) {
    return "USABLE";
  }
  return "WEAK";
}

export const priceEvidenceComponents = [
  "nature_clarity",
  "source_credibility",
  "product_identity",
  "freshness",
  "cross_source"
] as const;
export type PriceEvidenceComponent = (typeof priceEvidenceComponents)[number];

export const PRICE_EVIDENCE_COMPONENT_LABELS: Record<PriceEvidenceComponent, string> = {
  nature_clarity: "成交/挂牌性质明确",
  source_credibility: "来源可信度",
  product_identity: "产品身份确定",
  freshness: "时间新鲜度",
  cross_source: "多来源印证"
};

export const PRICE_EVIDENCE_COMPONENT_WEIGHTS: Record<PriceEvidenceComponent, number> = {
  nature_clarity: PRICE_EVIDENCE_WEIGHTS.natureClarity,
  source_credibility: PRICE_EVIDENCE_WEIGHTS.sourceCredibility,
  product_identity: PRICE_EVIDENCE_WEIGHTS.productIdentity,
  freshness: PRICE_EVIDENCE_WEIGHTS.freshness,
  cross_source: PRICE_EVIDENCE_WEIGHTS.crossSource
};

export const priceEvidenceItemSchema = z
  .object({
    component: z.enum(priceEvidenceComponents),
    label: z.string(),
    weight: z.number().int().nonnegative(),
    score: z.number().min(0),
    note: z.string()
  })
  .strict();
export type PriceEvidenceItem = z.infer<typeof priceEvidenceItemSchema>;

export const priceEvidenceSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    band: priceEvidenceBandSchema,
    items: z.array(priceEvidenceItemSchema),
    notes: z.array(z.string())
  })
  .strict();
export type PriceEvidence = z.infer<typeof priceEvidenceSchema>;

/** 每条价格的来源侧输入。缺失项一律传 null，绝不推断。 */
export interface PriceEvidenceInput {
  price_type: PriceType;
  unit_scope: PriceUnitScope | null;
  identity: {
    name?: string | null;
    brand_name?: string | null;
    year?: number | null;
    weight_g?: number | null;
    spec_notes?: string | null;
  };
  source_kind: SourceKind | null;
  domain?: string | null;
  observed_at?: string | null;
  published_at?: string | null;
  /** 同一价格（身份 + 类型 + 单位 + 数值区间）被多少个不同来源写到 */
  source_count?: number;
  /** 引文是否能在来源正文中逐字回溯；人工登记且无正文时为 false */
  quote_traceable?: boolean;
}

const NATURE_SCORES: Record<PriceType, number> = {
  VERIFIED_TRANSACTION: 25,
  AUCTION_HAMMER: 24,
  OFFICIAL_RETAIL: 22,
  LISTING: 18,
  HISTORICAL_REFERENCE: 12,
  UNKNOWN: 0
};

const SOURCE_SCORES: Record<SourceKind, number> = {
  PRODUCT_PAGE: 25,
  AUCTION_PAGE: 24,
  PRICE_PAGE: 22,
  MARKETPLACE: 18,
  ARTICLE: 15,
  SEARCH_RESULT: 12,
  OTHER: 8,
  FORUM: 6,
  SOCIAL: 6
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysBetween(from: Date, to: Date): number {
  return Math.abs(to.getTime() - from.getTime()) / 86_400_000;
}

/**
 * §15 Price Evidence Score：五项加权求和（合计 100）。
 * 每一项都给出中文理由，前端与审核人员据此判断「这条价格能不能用」。
 */
export function scorePriceEvidence(input: PriceEvidenceInput): PriceEvidence {
  const items: PriceEvidenceItem[] = [];
  const notes: string[] = [];

  // 1) 成交/挂牌性质明确（25）
  const natureBase = NATURE_SCORES[input.price_type];
  const unitUnknown = input.unit_scope === null || input.unit_scope === "UNKNOWN";
  let natureScore = natureBase;
  const natureNotes: string[] = [];
  if (input.price_type === "UNKNOWN") {
    natureNotes.push("来源没有写明成交 / 挂牌 / 拍卖性质，本条不计入成交价比较");
  } else {
    natureNotes.push(`按原文判定为 ${input.price_type}，据此给分`);
  }
  if (unitUnknown) {
    natureScore = Math.max(0, natureScore - 8);
    natureNotes.push("未写明单饼 / 整件，价格性质不完整（§14）");
  }
  if (input.quote_traceable === false) {
    natureScore = Math.max(0, natureScore - 6);
    natureNotes.push("引文无法在来源正文中逐字回溯，按最保守给分");
  }
  items.push({
    component: "nature_clarity",
    label: PRICE_EVIDENCE_COMPONENT_LABELS.nature_clarity,
    weight: PRICE_EVIDENCE_COMPONENT_WEIGHTS.nature_clarity,
    score: round1(natureScore),
    note: natureNotes.join("；")
  });

  // 2) 来源可信度（25）
  const sourceScore = input.source_kind ? SOURCE_SCORES[input.source_kind] : 8;
  items.push({
    component: "source_credibility",
    label: PRICE_EVIDENCE_COMPONENT_LABELS.source_credibility,
    weight: PRICE_EVIDENCE_COMPONENT_WEIGHTS.source_credibility,
    score: sourceScore,
    note: input.source_kind
      ? `来源类型 ${input.source_kind}${input.domain ? ` · ${input.domain}` : ""}`
      : "来源类型未分类，按最低档给分"
  });

  // 3) 产品身份确定（20）：名称 / 品牌 / 年份 / 规格逐项累加
  const identity = input.identity;
  const hasName = Boolean(identity.name && identity.name.trim().length > 0);
  let identityScore = hasName ? 8 : 0;
  const identityParts: string[] = [];
  if (hasName) {
    identityParts.push("产品名");
  }
  if (identity.brand_name) {
    identityScore += 4;
    identityParts.push("品牌");
  }
  if (identity.year !== null && identity.year !== undefined) {
    identityScore += 4;
    identityParts.push("年份");
  }
  if (
    (identity.weight_g !== null && identity.weight_g !== undefined) ||
    (identity.spec_notes !== null && identity.spec_notes !== undefined)
  ) {
    identityScore += 4;
    identityParts.push("规格");
  }
  items.push({
    component: "product_identity",
    label: PRICE_EVIDENCE_COMPONENT_LABELS.product_identity,
    weight: PRICE_EVIDENCE_COMPONENT_WEIGHTS.product_identity,
    score: round1(identityScore),
    note:
      identityParts.length > 0
        ? `已确定：${identityParts.join(" / ")}${identityParts.length < 4 ? "；缺少的字段不猜" : ""}`
        : "没有产品身份，未写出的一律不加分"
  });

  // 4) 时间新鲜度（15）：没有时间 = 4 分（未知 ≠ 新鲜）
  const reference = new Date();
  const dated = parseDate(input.observed_at) ?? parseDate(input.published_at);
  let freshnessScore = 4;
  let freshnessNote = "来源没有写明时间，按 4 分处理（未知 ≠ 新鲜）";
  if (dated) {
    const age = daysBetween(dated, reference);
    if (dated.getTime() > reference.getTime() + 86_400_000) {
      freshnessScore = 4;
      freshnessNote = "来源时间在未来，按未知处理";
    } else if (age <= 180) {
      freshnessScore = 15;
      freshnessNote = `近半年内（约 ${Math.round(age)} 天）`;
    } else if (age <= 365) {
      freshnessScore = 12;
      freshnessNote = `一年内（约 ${Math.round(age)} 天）`;
    } else if (age <= 730) {
      freshnessScore = 9;
      freshnessNote = `两年前（约 ${Math.round(age)} 天）`;
    } else if (age <= 1095) {
      freshnessScore = 6;
      freshnessNote = `三年前（约 ${Math.round(age)} 天）`;
    } else {
      freshnessScore = 3;
      freshnessNote = `三年以上（约 ${Math.round(age)} 天）`;
    }
  }
  items.push({
    component: "freshness",
    label: PRICE_EVIDENCE_COMPONENT_LABELS.freshness,
    weight: PRICE_EVIDENCE_COMPONENT_WEIGHTS.freshness,
    score: freshnessScore,
    note: freshnessNote
  });

  // 5) 多来源印证（15）：只数不同来源，同一页面的重复登记不算
  const sourceCount = Math.max(1, Math.round(input.source_count ?? 1));
  const crossScore = sourceCount >= 4 ? 15 : sourceCount === 3 ? 13 : sourceCount === 2 ? 10 : 6;
  items.push({
    component: "cross_source",
    label: PRICE_EVIDENCE_COMPONENT_LABELS.cross_source,
    weight: PRICE_EVIDENCE_COMPONENT_WEIGHTS.cross_source,
    score: crossScore,
    note:
      sourceCount >= 2
        ? `${sourceCount} 个不同来源写到同一组价格`
        : "只有 1 个来源，按最低档给分（同一页面的重复登记不算多个来源）"
  });

  const total = Math.min(100, Math.max(0, Math.round(items.reduce((sum, item) => sum + item.score, 0))));
  if (input.price_type === "HISTORICAL_REFERENCE") {
    notes.push("历史参考价不能当作当前价格（§62-4），只能用于时间叙事");
  }
  if (input.price_type === "LISTING") {
    notes.push("挂牌价 ≠ 成交价（§62-2）：可作价格带参考，不得表述为成交");
  }
  if (input.unit_scope === "CASE") {
    notes.push("整件价 ≠ 单饼价（§62-3）：不输出 357g 单饼等价");
  }

  return priceEvidenceSchema.parse({
    score: total,
    band: priceEvidenceBandForScore(total),
    items,
    notes
  });
}

/* ------------------------------------------------------------------ 价格归一 */

export const priceNormalizationSchema = z
  .object({
    /** 该价格对应的总克重；缺少规格重量时为 null（不做任何换算） */
    unit_grams: z.number().positive().nullable(),
    price_per_kg: z.number().positive().nullable(),
    price_357g: z.number().positive().nullable(),
    /** 整件价是否允许折算单饼价；整件稀缺溢价不允许线性拆分（§14 / §62-3） */
    piece_equivalent_allowed: z.boolean(),
    notes: z.array(z.string())
  })
  .strict();
export type PriceNormalization = z.infer<typeof priceNormalizationSchema>;

export interface PriceNormalizationInput {
  value: number;
  unit_scope: PriceUnitScope | null;
  /** 来源写明的规格重量：单饼重量或整件总重 */
  weight_g?: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * §14「统一可计算 357g 等价 / 1kg 等价」：
 * - 只有写明规格重量（或按 kg 计价）才计算，缺失一律 null；
 * - 整件价可以算 1kg 等价，但**不**输出 357g 单饼等价（整件稀缺溢价不可线性拆分）。
 */
export function normalizePriceEquivalents(input: PriceNormalizationInput): PriceNormalization {
  const notes: string[] = [];
  const scope = input.unit_scope;
  const weight = input.weight_g ?? null;

  let unitGrams: number | null = null;
  if (scope === "KG") {
    unitGrams = 1000;
  } else if (scope === "PIECE" || scope === "BUNDLE" || scope === "CASE") {
    unitGrams = weight !== null && weight > 0 ? weight : null;
  }

  if (scope === null || scope === "UNKNOWN") {
    notes.push("未写明单饼 / 整件，不做任何等价换算（§14 / §62-3）");
  } else if (unitGrams === null) {
    notes.push("来源没有写明规格重量，无法计算 357g / 1kg 等价（没有写 = 不计算）");
  }

  const pieceEquivalentAllowed = scope !== "CASE";
  const pricePerKg = unitGrams === null ? null : round2((input.value * 1000) / unitGrams);
  const price357 = unitGrams === null || !pieceEquivalentAllowed ? null : round2((input.value * 357) / unitGrams);

  if (scope === "CASE" && unitGrams !== null) {
    notes.push("已计算 1kg 等价；整件稀缺溢价不得拆分为精确单饼价值，故不输出 357g 等价（§14 / §62-3）");
  }

  return priceNormalizationSchema.parse({
    unit_grams: unitGrams,
    price_per_kg: pricePerKg,
    price_357g: price357,
    piece_equivalent_allowed: pieceEquivalentAllowed,
    notes
  });
}

/* -------------------------------------------------------------- 异常值检测 */

export const priceOutlierSchema = z
  .object({
    id: z.string(),
    is_outlier: z.boolean(),
    group_key: z.string(),
    sample_size: z.number().int().nonnegative(),
    median: z.number().nullable(),
    reason: z.string().nullable()
  })
  .strict();
export type PriceOutlier = z.infer<typeof priceOutlierSchema>;

export interface PriceOutlierInput {
  id: string;
  value: number;
  price_type: PriceType;
  unit_scope: PriceUnitScope | null;
  currency?: string | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? 0;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** 异常值分组键：类型 + 单位 + 币种 + 单饼重量。挂牌与成交、整件与单饼永不混在一组。 */
export function priceOutlierGroupKey(input: {
  price_type: PriceType;
  unit_scope: PriceUnitScope | null;
  currency?: string | null;
  weight_g?: number | null;
}): string {
  const scope = input.unit_scope ?? "UNKNOWN";
  const currency = (input.currency ?? "CNY").toUpperCase();
  const weight = scope === "PIECE" || scope === "CASE" || scope === "BUNDLE" ? String(input.weight_g ?? "") : "";
  return [input.price_type, scope, currency, weight].join("|");
}

/**
 * 价格异常值检测（§14 / §55 Outlier Detection）。
 *
 * - 只在**同类型 + 同单位 + 同币种 + 同规格**组内比较，挂牌与成交、整件与单饼绝不混算；
 * - 样本少于 4 条时不判定异常（样本不足时宁可不下结论）；
 * - 用中位数 + MAD 的稳健判据，阈值下限为 35% 中位数，避免整组同价时误判；
 * - 异常值只标记，不删除：保留原始证据供人工判断（§62-15）。
 */
export function detectPriceOutliers(
  observations: readonly PriceOutlierInput[],
  weights: Readonly<Record<string, number | null | undefined>> = {}
): PriceOutlier[] {
  const groups = new Map<string, PriceOutlierInput[]>();
  const keysByIndex: string[] = [];
  observations.forEach((observation, index) => {
    const key = priceOutlierGroupKey({
      price_type: observation.price_type,
      unit_scope: observation.unit_scope,
      currency: observation.currency ?? null,
      weight_g: weights[observation.id] ?? null
    });
    keysByIndex[index] = key;
    const list = groups.get(key);
    if (list) {
      list.push(observation);
    } else {
      groups.set(key, [observation]);
    }
  });

  const result: PriceOutlier[] = [];
  observations.forEach((observation, index) => {
    const key = keysByIndex[index] ?? "";
    const group = groups.get(key) ?? [];
    if (group.length < 4) {
      result.push({
        id: observation.id,
        is_outlier: false,
        group_key: key,
        sample_size: group.length,
        median: null,
        reason:
          group.length <= 1
            ? "同组样本不足（1 条），不做异常值判断"
            : `同组样本不足（${group.length} 条，少于 4 条），不做异常值判断`
      });
      return;
    }
    const values = group.map((item) => item.value);
    const medianValue = median(values);
    const deviations = values.map((value) => Math.abs(value - medianValue));
    const mad = median(deviations);
    const threshold = Math.max(mad * 3, medianValue * 0.35);
    const deviation = Math.abs(observation.value - medianValue);
    const isOutlier = deviation > threshold;
    result.push({
      id: observation.id,
      is_outlier: isOutlier,
      group_key: key,
      sample_size: group.length,
      median: round2(medianValue),
      reason: isOutlier
        ? `偏离同组中位数 ${round2(medianValue)}（组内 ${group.length} 条，中位差 ${round2(deviation)} 超过阈值 ${round2(threshold)}）`
        : null
    });
  });
  return result.map((item) => priceOutlierSchema.parse(item));
}

/* ------------------------------------------------------------- 数据表结构 */

export const marketOfferAttributions = [
  "MANUAL",
  "CANDIDATE",
  "SOURCE_IDENTIFIED",
  "SOURCE_UNATTRIBUTED"
] as const;
export const marketOfferAttributionSchema = z.enum(marketOfferAttributions);
export type MarketOfferAttribution = z.infer<typeof marketOfferAttributionSchema>;

export const MARKET_OFFER_ATTRIBUTION_LABELS: Record<MarketOfferAttribution, string> = {
  MANUAL: "人工登记",
  CANDIDATE: "已挂到对标候选",
  /** 来源写明了产品身份，但候选项里还没有对应条目：身份可信，只是尚未并入候选池 */
  SOURCE_IDENTIFIED: "来源写明产品身份（未匹配候选）",
  /** 来源通篇没写清是哪个产品：不与其他来源互相印证（§62-2 / §62-7） */
  SOURCE_UNATTRIBUTED: "来源未写明产品身份（不参与跨来源印证）"
};

export const MARKET_OFFER_LIMITS = {
  maxPerProduct: 800,
  defaultPageSize: 20,
  maxPageSize: 100,
  /** 超过该年龄（天）的价格在界面上必须提示「可能已过期」 */
  staleAfterDays: 365,
  /** 异常值检测的最小样本量 */
  minOutlierSample: 4
} as const;

export const marketOfferSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    candidate_id: z.string().uuid().nullable(),
    candidate_name: z.string().nullable().optional(),
    source_id: z.string().uuid().nullable(),
    source_kind: z.string().nullable(),
    domain: z.string().nullable(),
    url: z.string().nullable(),
    subject_name: z.string().nullable(),
    subject_brand: z.string().nullable(),
    subject_year: z.number().int().nullable(),
    subject_spec: z.string().nullable(),
    identity_key: z.string().nullable(),
    price_type: priceTypeSchema,
    unit_scope: priceUnitScopeSchema.nullable(),
    value: z.number().positive(),
    currency: z.string(),
    /** 来源写明的规格重量（单饼重量或整件总重）；没写就是 null，不做任何推断 */
    weight_g: z.number().int().positive().nullable(),
    unit_grams: z.number().positive().nullable(),
    pieces_per_case: z.number().int().positive().nullable(),
    price_per_kg: z.number().positive().nullable(),
    price_357g: z.number().positive().nullable(),
    piece_equivalent_allowed: z.boolean(),
    evidence_score: z.number().int().min(0).max(100),
    evidence_band: priceEvidenceBandSchema,
    evidence: priceEvidenceSchema,
    attribution: marketOfferAttributionSchema,
    /** 引文能否在来源正文里逐字回溯；人工登记且没有来源正文时为 false */
    quote_traceable: z.boolean(),
    quote: z.string(),
    note: z.string().nullable(),
    manual_note: z.string().nullable(),
    observed_at: z.string().nullable(),
    published_at: z.string().nullable(),
    is_outlier: z.boolean(),
    outlier_reason: z.string().nullable(),
    outlier_median: z.number().nullable(),
    outlier_sample_size: z.number().int().nonnegative().nullable(),
    outlier_group_key: z.string().nullable(),
    is_excluded: z.boolean(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string(),
    updated_at: z.string()
  })
  .strict();
export type MarketOfferView = z.infer<typeof marketOfferSchema>;

export const marketOfferCreateSchema = z
  .object({
    value: z.coerce.number().positive().max(100_000_000),
    price_type: priceTypeSchema,
    unit_scope: priceUnitScopeSchema.optional(),
    currency: z.string().trim().min(1).max(10).optional(),
    /** 来源写明的规格重量：单饼重量或整件总重；没写就不要传 */
    weight_g: z.coerce.number().positive().max(100_000).nullable().optional(),
    pieces_per_case: z.coerce.number().int().positive().max(10_000).nullable().optional(),
    subject_name: z.string().trim().min(1).max(200),
    subject_brand: z.string().trim().max(200).nullable().optional(),
    subject_year: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    subject_spec: z.string().trim().max(200).nullable().optional(),
    candidate_id: z.string().uuid().nullable().optional(),
    source_id: z.string().uuid().nullable().optional(),
    /** 价格必须带原文引文；人工登记也要写清出处原话 */
    quote: z.string().trim().min(1).max(600),
    observed_at: z.string().trim().max(60).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type MarketOfferCreateInput = z.infer<typeof marketOfferCreateSchema>;

/**
 * 人工修正只允许「补规格 / 改单位 / 加备注」。
 * 价格数值、类型与引文一律不可改——改了就等于篡改证据（§62-2·3·4）。
 */
export const marketOfferUpdateSchema = z
  .object({
    unit_scope: priceUnitScopeSchema.optional(),
    weight_g: z.coerce.number().positive().max(100_000).nullable().optional(),
    pieces_per_case: z.coerce.number().int().positive().max(10_000).nullable().optional(),
    manual_note: z.string().trim().max(2000).nullable().optional(),
    is_excluded: z.boolean().optional()
  })
  .strict();
export type MarketOfferUpdateInput = z.infer<typeof marketOfferUpdateSchema>;

export const marketOfferListQuerySchema = z
  .object({
    product_id: z.string().uuid().optional(),
    candidate_id: z.string().uuid().optional(),
    price_type: priceTypeSchema.optional(),
    unit_scope: priceUnitScopeSchema.optional(),
    evidence_band: priceEvidenceBandSchema.optional(),
    attribution: marketOfferAttributionSchema.optional(),
    /**
     * 查询串是字符串：这里必须用 stringbool。
     * `z.coerce.boolean()` 会把 `"false"` 也变成 true，导致「只看异常值」这类筛选失效。
     */
    is_outlier: z.stringbool().optional(),
    include_excluded: z.stringbool().optional(),
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(MARKET_OFFER_LIMITS.maxPageSize).optional(),
    sort: z.enum(["value", "-value", "evidence", "-evidence", "created_at", "-created_at"]).optional()
  })
  .strict();
export type MarketOfferListQuery = z.infer<typeof marketOfferListQuerySchema>;

export const marketOfferRebuildRequestSchema = z
  .object({
    /** 是否重算已存在价格条目的证据分（默认 true） */
    recompute: z.boolean().optional(),
    /** 是否保留人工修正过的单位 / 规格与排除标记（默认 true） */
    keep_manual: z.boolean().optional()
  })
  .strict();
export type MarketOfferRebuildRequest = z.infer<typeof marketOfferRebuildRequestSchema>;

export const priceTypeBucketSchema = z
  .object({
    price_type: priceTypeSchema,
    unit_scope: priceUnitScopeSchema.nullable(),
    count: z.number().int().nonnegative(),
    median_value: z.number().nullable(),
    median_price_per_kg: z.number().nullable(),
    median_price_357g: z.number().nullable(),
    strong_count: z.number().int().nonnegative(),
    outlier_count: z.number().int().nonnegative()
  })
  .strict();
export type PriceTypeBucket = z.infer<typeof priceTypeBucketSchema>;

export const priceSummarySchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    total_offers: z.number().int().nonnegative(),
    counted_offers: z.number().int().nonnegative(),
    strong_offers: z.number().int().nonnegative(),
    usable_offers: z.number().int().nonnegative(),
    weak_offers: z.number().int().nonnegative(),
    outlier_count: z.number().int().nonnegative(),
    excluded_count: z.number().int().nonnegative(),
    unattributed_count: z.number().int().nonnegative(),
    transaction_count: z.number().int().nonnegative(),
    listing_count: z.number().int().nonnegative(),
    /** 可靠价格锚点候选：证据 >= 75（§16.1 的价格侧条件），不含异常值 */
    reliable_count: z.number().int().nonnegative(),
    buckets: z.array(priceTypeBucketSchema),
    price_level: z
      .object({
        basis: z.string(),
        currency: z.string(),
        sample_size: z.number().int().nonnegative(),
        median_price_per_kg: z.number().nullable(),
        median_price_357g: z.number().nullable()
      })
      .strict(),
    notes: z.array(z.string()),
    spec_ref: z.string()
  })
  .strict();
export type PriceSummary = z.infer<typeof priceSummarySchema>;

/** 供 API 自检：§14 / §15 的权重、分档与四条红线。 */
export const PRICE_CONTRACT = {
  spec_ref: "§14 / §15 / §16.1",
  price_types: ["OFFICIAL_RETAIL", "LISTING", "VERIFIED_TRANSACTION", "AUCTION_HAMMER", "HISTORICAL_REFERENCE", "UNKNOWN"],
  evidence_components: priceEvidenceComponents.map((component) => ({
    component,
    label: PRICE_EVIDENCE_COMPONENT_LABELS[component],
    weight: PRICE_EVIDENCE_COMPONENT_WEIGHTS[component]
  })),
  evidence_weight_total: priceEvidenceComponents.reduce(
    (total, component) => total + PRICE_EVIDENCE_COMPONENT_WEIGHTS[component],
    0
  ),
  evidence_bands: PRICE_EVIDENCE_BAND_LABELS,
  outlier_min_sample: MARKET_OFFER_LIMITS.minOutlierSample,
  equivalences: ["price_per_kg", "price_357g"],
  case_piece_equivalent_allowed: false,
  price_in_similarity: false,
  rules: [
    "挂牌价 ≠ 成交价",
    "整件价 ≠ 单饼价（整件溢价不线性拆分）",
    "历史 / 口述价格 ≠ 当前价格",
    "没有写 = 不计算等价、不推断补全",
    "价格不参与相似度（§13）"
  ]
} as const;
