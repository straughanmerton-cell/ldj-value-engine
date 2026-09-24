import { z } from "zod";
import { promptKeySchema, type FactStatus } from "./enums.js";
import { SENSORY_FIELDS } from "./product-fields.js";

/**
 * 产品价值 DNA（规格 §9）。
 *
 * 设计红线（对应规格 §58-1/2/3/5 与 §62）：
 * 1. DNA 只承载「产品录入字段 / 事实清单 / 品饮档案 / 研发参考里已经存在的内容」；
 * 2. 允许把已有事实抽象成 architecture_signals（例如「浓强」→「强骨架」），但必须标记为 DERIVED 并记录来源字段；
 * 3. 任何输入里没有的硬事实（树龄、山头、年份、获奖、大师、配方比例）不得出现，包括模型「补充」的；
 * 4. AI 补充的条目必须能在源文本中逐字回溯，否则被丢弃并记入 warnings。
 */

/** 11 个 DNA 维度，顺序与规格 §9 完全一致。 */
export const VALUE_DNA_DIMENSIONS = [
  "identity",
  "category",
  "origin",
  "material",
  "process",
  "flavor",
  "taste",
  "positioning",
  "collection",
  "naming_concepts",
  "architecture_signals"
] as const;

export type ValueDnaDimension = (typeof VALUE_DNA_DIMENSIONS)[number];

const dnaItemSchema = z.string().trim().min(1).max(120);
const dnaArraySchema = z.array(dnaItemSchema).max(60);

export const valueDnaSchema = z
  .object({
    identity: dnaArraySchema.default([]),
    category: dnaArraySchema.default([]),
    origin: dnaArraySchema.default([]),
    material: dnaArraySchema.default([]),
    process: dnaArraySchema.default([]),
    flavor: dnaArraySchema.default([]),
    taste: dnaArraySchema.default([]),
    positioning: dnaArraySchema.default([]),
    collection: dnaArraySchema.default([]),
    naming_concepts: dnaArraySchema.default([]),
    architecture_signals: dnaArraySchema.default([])
  })
  .strict();

export type ValueDna = z.infer<typeof valueDnaSchema>;

/** AI 只允许输出 dna 对象本身，多余字段一律拒绝（防止模型夹带事实结论）。 */
export const valueDnaAiOutputSchema = z.object({ dna: valueDnaSchema }).strict();

export function emptyValueDna(): ValueDna {
  return valueDnaSchema.parse({});
}

/** DNA 条目的来源类型：原始事实 / 由事实推导 / AI 补充（可回溯）。 */
export const valueDnaEvidenceKinds = ["FACT", "DERIVED", "AI_TRACEABLE"] as const;
export const valueDnaEvidenceKindSchema = z.enum(valueDnaEvidenceKinds);
export type ValueDnaEvidenceKind = z.infer<typeof valueDnaEvidenceKindSchema>;

export const valueDnaProvenanceEntrySchema = z
  .object({
    value: z.string().trim().min(1).max(200),
    kind: valueDnaEvidenceKindSchema,
    /** 来源字段路径（如 product.entry_taste）或事实键（如 fact:tree_age） */
    source: z.string().trim().min(1).max(200),
    fact_id: z.string().uuid().nullable().default(null),
    fact_status: z.string().nullable().default(null)
  })
  .strict();

export type ValueDnaProvenanceEntry = z.infer<typeof valueDnaProvenanceEntrySchema>;

export const valueDnaGenerators = ["RULE_BASED", "AI_ASSISTED"] as const;
export const valueDnaGeneratorSchema = z.enum(valueDnaGenerators);
export type ValueDnaGenerator = z.infer<typeof valueDnaGeneratorSchema>;

/**
 * DNA 元数据：与 §9 的 11 维度数组分开存储，
 * 保证产品端读到的 value_dna 永远是基线定义的干净结构。
 */
export const valueDnaMetaSchema = z
  .object({
    generator: valueDnaGeneratorSchema,
    prompt_key: promptKeySchema.nullable().default(null),
    prompt_version: z.number().int().positive().nullable().default(null),
    provider: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
    generated_at: z.string(),
    version: z.number().int().nonnegative().default(0),
    /** 生成时对应的产品版本号与上游记录数量，用于判断 DNA 是否已过期。 */
    product_version: z.number().int().nonnegative().default(0),
    fact_count: z.number().int().nonnegative().default(0),
    tasting_count: z.number().int().nonnegative().default(0),
    rnd_count: z.number().int().nonnegative().default(0),
    source_fact_ids: z.array(z.string().uuid()).default([]),
    provenance: z.record(z.string(), z.array(valueDnaProvenanceEntrySchema)).default({}),
    missing_dimensions: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([])
  })
  .strict();

export type ValueDnaMeta = z.infer<typeof valueDnaMetaSchema>;

export interface ValueDnaFactInput {
  id?: string | null;
  fact_key: string;
  fact_value: string;
  fact_group?: string | null;
  fact_status: FactStatus;
}

export interface ValueDnaRndInput {
  id?: string | null;
  reference_product_name?: string | null;
  reference_type?: string | null;
  description?: string | null;
  verification_status?: string | null;
}

export interface ValueDnaInput {
  /** snake_case 产品快照（可直接使用 API 的 product 序列化结果） */
  product: Record<string, unknown>;
  facts?: readonly ValueDnaFactInput[];
  tastingProfiles?: readonly Record<string, unknown>[];
  rndReferences?: readonly ValueDnaRndInput[];
}

export interface ValueDnaBuildResult {
  dna: ValueDna;
  provenance: Record<string, ValueDnaProvenanceEntry[]>;
  missingDimensions: ValueDnaDimension[];
  warnings: string[];
  sourceFactIds: string[];
}

// ---------------------------------------------------------------------------
// 字段目录（与 §10 一致，复用 FACT_KEY_CATALOG 的键名）
// ---------------------------------------------------------------------------

const CATEGORY_KEYS = ["tea_type", "tea_subtype"] as const;
const ORIGIN_KEYS = ["origin_province", "origin_city", "origin_region", "mountain", "village"] as const;
const MATERIAL_KEYS = [
  "raw_material",
  "tree_type",
  "tree_age",
  "season",
  "harvest_standard",
  "grade",
  "blend_description",
  "material_notes"
] as const;
const CRAFT_KEYS = [
  "kill_green_method",
  "rolling_method",
  "drying_method",
  "pressing_method",
  "fermentation_degree",
  "fermentation_method",
  "storage",
  "processing_notes"
] as const;
const AROMA_KEYS = ["dry_leaf_aroma", "hot_cup_aroma", "liquor_aroma", "cold_cup_aroma"] as const;
const TASTE_KEYS = SENSORY_FIELDS.map((field) => field.key).filter(
  (key): key is Exclude<(typeof SENSORY_FIELDS)[number]["key"], (typeof AROMA_KEYS)[number]> =>
    !(AROMA_KEYS as readonly string[]).includes(key)
);

/**
 * 这些感官字段的值天生是「修饰语」（如 回甘=快），单看「快」没有信息量，
 * 因此补上字段标签组成「回甘快」。自由文本（长度 > 3 或已含标签）原样保留。
 */
const COMPOSE_PREFIX_KEYS = new Set<string>([
  "huigan",
  "salivation",
  "cha_qi",
  "bitterness",
  "astringency",
  "sweetness",
  "thickness",
  "viscosity",
  "water_texture",
  "finish",
  "endurance",
  "leaf_bottom"
]);

const SENSORY_LABEL_BY_KEY = new Map<string, string>(SENSORY_FIELDS.map((field) => [field.key, field.label]));

function composeSensoryValue(key: string, value: string): string {
  const label = SENSORY_LABEL_BY_KEY.get(key);
  if (!label || !COMPOSE_PREFIX_KEYS.has(key) || value.includes(label) || value.length > 3) {
    return value;
  }
  return `${label}${value}`;
}

/** 名称前缀（品牌）不参与身份词：龙德记六星孔雀 → 六星 / 孔雀。 */
const BRAND_PREFIX_PATTERN = /^[\u4e00-\u9fa5]{1,3}(记|號|号|牌|堂)(?=[\u4e00-\u9fa5])/;

function stripBrandPrefix(name: string): string {
  return name.replace(BRAND_PREFIX_PATTERN, "");
}

/** 身份词表：只用于「从产品名称里切出已有词」，不会凭词表补出产品没有的身份。 */
const STAR_TOKEN_PATTERN = /[一二三四五六七八九十]{1,2}星|\d{1,2}星/g;
const TOTEM_TOKENS = [
  "孔雀",
  "凤凰",
  "麒麟",
  "青龙",
  "白虎",
  "玄武",
  "龙",
  "凤",
  "鹤",
  "鹿",
  "狮",
  "虎",
  "象",
  "鹰",
  "龟",
  "马",
  "牛",
  "羊",
  "猴",
  "蛇",
  "兔",
  "鼠",
  "鸡",
  "狗",
  "猪"
] as const;
const ZODIAC_TOKENS = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"] as const;
const CONCEPT_KEYWORDS: readonly { readonly match: RegExp; readonly concept: string }[] = [
  { match: /纪念|周年/, concept: "纪念概念" },
  { match: /生肖/, concept: "生肖概念" },
  { match: /山|寨|村/, concept: "产区命名" },
  { match: /号|號/, concept: "编号命名" }
];

const IDENTITY_TOKEN_SPLIT = /[\s,，、·・\-—_/|()（）【】[\]「」《》:：]+/;

// ---------------------------------------------------------------------------
// 推导规则（全部标记 DERIVED，并记录来源字段）
// ---------------------------------------------------------------------------

interface DerivedRule {
  readonly dimension: ValueDnaDimension;
  readonly match: RegExp;
  readonly signals: readonly string[];
}

/** 感官 → 结构信号（规格 §9 示例：浓强 → 强骨架 / 前段冲击；回甘快 → 后段回甜） */
const ARCHITECTURE_SIGNAL_RULES: readonly DerivedRule[] = [
  { dimension: "taste", match: /浓/, signals: ["强骨架", "前段冲击"] },
  { dimension: "taste", match: /强/, signals: ["强骨架"] },
  { dimension: "taste", match: /回甘.*快|快.*回甘/, signals: ["后段回甜"] },
  { dimension: "taste", match: /持久|绵长|悠长/, signals: ["后段回甜"] },
  { dimension: "taste", match: /茶气.*(明显|强)|(明显|强).*茶气/, signals: ["茶气驱动"] },
  { dimension: "taste", match: /厚|饱满|稠/, signals: ["厚感支撑"] },
  { dimension: "flavor", match: /烟/, signals: ["烟香辨识"] },
  { dimension: "flavor", match: /兰|花|蜜/, signals: ["香气辨识度"] },
  { dimension: "material", match: /古树|大树|乔木/, signals: ["原料稀缺信号"] },
  { dimension: "origin", match: /./, signals: ["产区身份明确"] }
];

// ---------------------------------------------------------------------------
// 构建
// ---------------------------------------------------------------------------

interface BuilderState {
  dna: Record<ValueDnaDimension, string[]>;
  provenance: Record<string, ValueDnaProvenanceEntry[]>;
  warnings: string[];
  sourceFactIds: string[];
}

function createState(): BuilderState {
  const dna = {} as Record<ValueDnaDimension, string[]>;
  for (const dimension of VALUE_DNA_DIMENSIONS) {
    dna[dimension] = [];
  }
  return { dna, provenance: {}, warnings: [], sourceFactIds: [] };
}

function cleanText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\s+/g, " ");
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function pushEntry(
  state: BuilderState,
  dimension: ValueDnaDimension,
  value: string,
  entry: Omit<ValueDnaProvenanceEntry, "value">
): void {
  const list = state.dna[dimension];
  if (list.includes(value)) {
    return;
  }
  list.push(value);
  const bucket = state.provenance[dimension] ?? [];
  bucket.push({ value, ...entry });
  state.provenance[dimension] = bucket;
}

function pushProductField(
  state: BuilderState,
  dimension: ValueDnaDimension,
  product: Record<string, unknown>,
  key: string
): void {
  const value = cleanText(product[key]);
  if (!value) {
    return;
  }
  pushEntry(state, dimension, value, { kind: "FACT", source: `product.${key}`, fact_id: null, fact_status: null });
}

function collectIdentityTokens(name: string): string[] {
  const tokens: string[] = [];
  const stars = name.match(STAR_TOKEN_PATTERN) ?? [];
  tokens.push(...stars);
  for (const totem of TOTEM_TOKENS) {
    if (name.includes(totem)) {
      tokens.push(totem);
    }
  }
  for (const raw of name.split(IDENTITY_TOKEN_SPLIT)) {
    const token = raw.trim();
    if (token.length < 2) {
      continue;
    }
    // 已被星号 / 图腾词捕获的整段名称不再作为独立身份词重复出现。
    const duplicated = tokens.some((captured) => token.includes(captured));
    if (duplicated) {
      continue;
    }
    // 纯年份或纯数字不作为身份词。
    if (/^\d{3,4}$/.test(token)) {
      continue;
    }
    tokens.push(token);
  }
  return tokens;
}

/**
 * 规则引擎：把已录入的产品字段、事实、品饮档案、研发参考整理成 §9 的 11 个维度。
 * 不访问网络、不调用模型，因此可以在测试里逐条断言「没有输入就没有输出」。
 */
export function buildValueDnaFromProduct(input: ValueDnaInput): ValueDnaBuildResult {
  const state = createState();
  const product = input.product ?? {};

  const productName = cleanText(product["product_name"]) ?? cleanText(product["productName"]);
  const seriesName = cleanText(product["series_name"]) ?? cleanText(product["seriesName"]);

  const identitySourceRaw = seriesName ?? productName;
  const identitySource = identitySourceRaw ? stripBrandPrefix(identitySourceRaw) : null;
  if (identitySource) {
    const sourceKey = seriesName ? "product.series_name" : "product.product_name";
    for (const token of collectIdentityTokens(identitySource)) {
      pushEntry(state, "identity", token, { kind: "FACT", source: sourceKey, fact_id: null, fact_status: null });
    }
    if (seriesName && productName && productName !== seriesName) {
      for (const token of collectIdentityTokens(stripBrandPrefix(productName))) {
        pushEntry(state, "identity", token, { kind: "FACT", source: "product.product_name", fact_id: null, fact_status: null });
      }
    }
    for (const star of (identitySource.match(STAR_TOKEN_PATTERN) ?? [])) {
      pushEntry(state, "naming_concepts", "星级", {
        kind: "DERIVED",
        source: `derived:star_token(${star})`,
        fact_id: null,
        fact_status: null
      });
    }
    const totems = TOTEM_TOKENS.filter((token) => identitySource.includes(token));
    if (totems.length > 0) {
      pushEntry(state, "naming_concepts", "图腾命名", {
        kind: "DERIVED",
        source: `derived:totem(${totems.join("/")})`,
        fact_id: null,
        fact_status: null
      });
    }
    if (ZODIAC_TOKENS.some((token) => identitySource.includes(`${token}年`)) || /生肖/.test(identitySource)) {
      pushEntry(state, "naming_concepts", "生肖概念", {
        kind: "DERIVED",
        source: "derived:zodiac",
        fact_id: null,
        fact_status: null
      });
    }
    for (const rule of CONCEPT_KEYWORDS) {
      if (rule.match.test(identitySource)) {
        pushEntry(state, "naming_concepts", rule.concept, {
          kind: "DERIVED",
          source: `derived:concept(${rule.match.source})`,
          fact_id: null,
          fact_status: null
        });
      }
    }
  }

  for (const key of CATEGORY_KEYS) {
    pushProductField(state, "category", product, key);
  }
  for (const key of ORIGIN_KEYS) {
    pushProductField(state, "origin", product, key);
  }
  for (const key of MATERIAL_KEYS) {
    pushProductField(state, "material", product, key);
  }
  for (const key of CRAFT_KEYS) {
    pushProductField(state, "process", product, key);
  }
  for (const key of AROMA_KEYS) {
    pushProductField(state, "flavor", product, key);
  }
  for (const key of TASTE_KEYS) {
    const value = cleanText(product[key]);
    if (!value) {
      continue;
    }
    pushEntry(state, "taste", composeSensoryValue(key, value), {
      kind: "FACT",
      source: `product.${key}`,
      fact_id: null,
      fact_status: null
    });
  }

  // ---- 事实清单（§11）：事实键决定维度，状态原样带进 provenance ----
  const unconfirmed: string[] = [];
  for (const fact of input.facts ?? []) {
    const value = cleanText(fact.fact_value);
    if (!value) {
      continue;
    }
    if (fact.id) {
      state.sourceFactIds.push(fact.id);
    }
    if (fact.fact_status === "UNCONFIRMED") {
      unconfirmed.push(fact.fact_key);
    }
    const dimension = dimensionForFactKey(fact.fact_key, fact.fact_group);
    if (!dimension) {
      continue;
    }
    pushEntry(state, dimension, value, {
      kind: "FACT",
      source: `fact:${fact.fact_key}`,
      fact_id: fact.id ?? null,
      fact_status: fact.fact_status
    });
  }

  // ---- 品饮档案（§10.4）：品饮事实按感官维度并入 ----
  for (const profile of input.tastingProfiles ?? []) {
    const profileId = cleanText(profile["id"]) ?? "unknown";
    const profileStatus = cleanText(profile["fact_status"]) ?? "TASTING_RECORD";
    for (const field of SENSORY_FIELDS) {
      const value = cleanText(profile[field.key]);
      if (!value) {
        continue;
      }
      const dimension: ValueDnaDimension = (AROMA_KEYS as readonly string[]).includes(field.key)
        ? "flavor"
        : "taste";
      const dnaValue = dimension === "taste" ? composeSensoryValue(field.key, value) : value;
      pushEntry(state, dimension, dnaValue, {
        kind: "FACT",
        source: `tasting_profile:${profileId}.${field.key}`,
        fact_id: null,
        fact_status: profileStatus
      });
    }
  }

  // ---- 定位 / 收藏：仅由已录入的研发与定价字段推导 ----
  const benchmarkMode = cleanText(product["benchmark_mode_preference"]);
  if (benchmarkMode && benchmarkMode !== "AUTO") {
    pushEntry(state, "positioning", `对标模式：${benchmarkMode}`, {
      kind: "DERIVED",
      source: "derived:product.benchmark_mode_preference",
      fact_id: null,
      fact_status: null
    });
  }
  if (product["has_explicit_benchmark"] === true || cleanText(product["has_explicit_benchmark"]) === "true") {
    pushEntry(state, "positioning", "明确对标产品已登记", {
      kind: "DERIVED",
      source: "derived:product.has_explicit_benchmark",
      fact_id: null,
      fact_status: null
    });
  }
  if (product["r_and_d_reference_enabled"] === true || (input.rndReferences?.length ?? 0) > 0) {
    pushEntry(state, "positioning", "研发关系已登记", {
      kind: "DERIVED",
      source: "derived:product.r_and_d_reference_enabled",
      fact_id: null,
      fact_status: null
    });
  }
  if (product["rnd_evidence_available"] === true) {
    pushEntry(state, "positioning", "研发证据可用", {
      kind: "DERIVED",
      source: "derived:product.rnd_evidence_available",
      fact_id: null,
      fact_status: null
    });
  }
  const copyIntensity = Number(product["copy_intensity_default"]);
  if (Number.isFinite(copyIntensity) && copyIntensity >= 5) {
    pushEntry(state, "positioning", "王者级表达定位", {
      kind: "DERIVED",
      source: "derived:product.copy_intensity_default",
      fact_id: null,
      fact_status: null
    });
  }
  if (cleanText(product["suggested_retail_price"])) {
    pushEntry(state, "positioning", "价格带已知", {
      kind: "DERIVED",
      source: "derived:product.suggested_retail_price",
      fact_id: null,
      fact_status: null
    });
  }
  const storage = cleanText(product["storage"]);
  if (storage) {
    pushEntry(state, "collection", `仓储条件：${storage}`, {
      kind: "FACT",
      source: "product.storage",
      fact_id: null,
      fact_status: null
    });
  }
  const teaType = cleanText(product["tea_type"]) ?? "";
  const materialText = [cleanText(product["raw_material"]), cleanText(product["tree_type"]), cleanText(product["tree_age"])]
    .filter(Boolean)
    .join(" ");
  if (teaType.includes("生茶") && /古树|大树|乔木/.test(materialText)) {
    pushEntry(state, "collection", "具备长期陈化基础", {
      kind: "DERIVED",
      source: "derived:product.tea_type+material",
      fact_id: null,
      fact_status: null
    });
  }

  // ---- 结构信号：从已有感官 / 原料 / 产区文本推导，逐条带来源 ----
  for (const rule of ARCHITECTURE_SIGNAL_RULES) {
    const values = state.dna[rule.dimension];
    if (values.length === 0) {
      continue;
    }
    const matchedSource = state.provenance[rule.dimension]?.find((entry) => rule.match.test(entry.value));
    if (!matchedSource) {
      continue;
    }
    for (const signal of rule.signals) {
      pushEntry(state, "architecture_signals", signal, {
        kind: "DERIVED",
        source: `derived:${matchedSource.source}`,
        fact_id: matchedSource.fact_id,
        fact_status: matchedSource.fact_status
      });
    }
  }

  for (const reference of input.rndReferences ?? []) {
    const name = cleanText(reference.reference_product_name);
    if (!name) {
      continue;
    }
    pushEntry(state, "positioning", `对标记录：${name}`, {
      kind: "FACT",
      source: `rnd_reference:${reference.id ?? "unknown"}`,
      fact_id: null,
      fact_status: reference.verification_status ?? null
    });
  }

  if (unconfirmed.length > 0) {
    state.warnings.push(`存在未确认事实（UNCONFIRMED）：${[...new Set(unconfirmed)].join("、")}，下游话术不得当作已确认事实使用`);
  }

  const missingDimensions = VALUE_DNA_DIMENSIONS.filter((dimension) => state.dna[dimension].length === 0);

  return {
    dna: valueDnaSchema.parse(state.dna),
    provenance: state.provenance,
    missingDimensions: [...missingDimensions],
    warnings: state.warnings,
    sourceFactIds: [...new Set(state.sourceFactIds)]
  };
}

function dimensionForFactKey(factKey: string, factGroup?: string | null): ValueDnaDimension | null {
  if ((CATEGORY_KEYS as readonly string[]).includes(factKey)) {
    return "category";
  }
  if ((ORIGIN_KEYS as readonly string[]).includes(factKey)) {
    return "origin";
  }
  if ((MATERIAL_KEYS as readonly string[]).includes(factKey)) {
    return "material";
  }
  if ((CRAFT_KEYS as readonly string[]).includes(factKey)) {
    return "process";
  }
  if ((AROMA_KEYS as readonly string[]).includes(factKey)) {
    return "flavor";
  }
  if ((TASTE_KEYS as readonly string[]).includes(factKey)) {
    return "taste";
  }
  if (factKey === "product_name" || factKey === "series_name") {
    return "identity";
  }
  switch (factGroup) {
    case "MATERIAL":
      return "material";
    case "CRAFT":
      return "process";
    case "SENSORY":
      return "taste";
    default:
      return null;
  }
}

/**
 * AI 补充值的可回溯过滤（规格 §62-8：不虚构硬事实）。
 * 只有能在源文本里逐字（忽略空白与常见标点）找到的条目才会被接受。
 */
export function filterValueDnaTraceability(
  candidate: ValueDna,
  corpusText: string
): { dna: ValueDna; rejected: { dimension: ValueDnaDimension; value: string }[] } {
  const corpus = normalizeForMatch(corpusText);
  const accepted = {} as Record<ValueDnaDimension, string[]>;
  const rejected: { dimension: ValueDnaDimension; value: string }[] = [];
  for (const dimension of VALUE_DNA_DIMENSIONS) {
    const kept: string[] = [];
    for (const value of candidate[dimension]) {
      if (corpus.includes(normalizeForMatch(value))) {
        kept.push(value);
      } else {
        rejected.push({ dimension, value });
      }
    }
    accepted[dimension] = kept;
  }
  return { dna: valueDnaSchema.parse(accepted), rejected };
}

function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s,，、·・\-—_/|()（）【】[\]「」《》:：；;。.!！?？"'“”‘’]/g, "");
}

export function mergeValueDna(base: ValueDna, extra: ValueDna): ValueDna {
  const merged = {} as Record<ValueDnaDimension, string[]>;
  for (const dimension of VALUE_DNA_DIMENSIONS) {
    merged[dimension] = [...base[dimension]];
    for (const value of extra[dimension]) {
      if (!merged[dimension].includes(value)) {
        merged[dimension].push(value);
      }
    }
  }
  return valueDnaSchema.parse(merged);
}

/** 把 DNA 及其来源事实折叠成一段纯文本，供「可回溯过滤」与下游 prompt 使用。 */
export function valueDnaToCorpus(input: ValueDnaInput): string {
  const parts: string[] = [];
  for (const value of Object.values(input.product ?? {})) {
    const text = cleanText(value);
    if (text) {
      parts.push(text);
    }
  }
  for (const fact of input.facts ?? []) {
    parts.push(fact.fact_key, fact.fact_value);
  }
  for (const profile of input.tastingProfiles ?? []) {
    for (const value of Object.values(profile)) {
      const text = cleanText(value);
      if (text) {
        parts.push(text);
      }
    }
  }
  for (const reference of input.rndReferences ?? []) {
    for (const value of Object.values(reference)) {
      const text = cleanText(value);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * DNA 是否已过期：生成时记录的产品版本号与上游记录数量任一变化，
 * 说明产品字段 / 事实 / 品饮 / 研发参考已经更新，DNA 需要重新生成。
 */
export function isValueDnaStale(
  meta: ValueDnaMeta,
  current: {
    product_version: number;
    fact_count: number;
    tasting_count: number;
    rnd_count: number;
  }
): boolean {
  return (
    meta.product_version !== current.product_version ||
    meta.fact_count !== current.fact_count ||
    meta.tasting_count !== current.tasting_count ||
    meta.rnd_count !== current.rnd_count
  );
}

/**
 * Value DNA 生成请求（规格 §9）。
 * 默认只跑规则引擎；`use_ai: true` 时才调用 AI 做可回溯的补充（来源不足的内容会被丢弃）。
 */
export const valueDnaGenerateRequestSchema = z
  .object({
    use_ai: z.boolean().optional()
  })
  .strict();
export type ValueDnaGenerateRequest = z.infer<typeof valueDnaGenerateRequestSchema>;

/**
 * Agent 1 事实归一试跑请求（规格 §39）。
 * 该接口只返回候选与丢弃记录，不写任何业务数据（事实必须人工确认后才入库）。
 */
export const factNormalizeRequestSchema = z
  .object({
    use_ai: z.boolean().optional()
  })
  .strict();
export type FactNormalizeRequest = z.infer<typeof factNormalizeRequestSchema>;
