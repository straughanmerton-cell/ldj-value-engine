import { z } from "zod";
import { resolvedResearchModeSchema } from "./enums.js";
import { VALUE_DNA_DIMENSIONS, type ValueDna } from "./value-dna.js";

/**
 * 自建高端标准模式 Category Creator Mode（规格 §4.2 / §17 / §29 / §24）。
 *
 * §17 规定：没有候选同时满足 Similarity ≥ 70 与 PriceEvidence ≥ 75 时，系统必须进入
 * `mode = CATEGORY_CREATOR`，并且**不得**硬凑竞品、降低阈值或编造对标。
 * §4.2 进一步规定：此时绝对不能让文案变弱，必须从自身事实出发：
 *
 * ```text
 * 没有完全相同产品 → 从自身事实建立产品结构 → 形成风格标准 → 形成配方哲学 → 形成高端身份
 * ```
 *
 * 因此本模块只做一件事：**把「没有对标」翻译成一套可审核的自建标准**，包含
 * 1. 自建产品标准（六个标准轴：骨架 / 底气 / 身份 / 第一口 / 后半程 / 工艺）；
 * 2. 风格身份证（这款茶自己给自己定的风格定义）；
 * 3. 价值逻辑（FACT → INTERPRETATION → VALUE → SALES_LINE 四段链条，§24 三层标记）。
 *
 * 三条不可动摇的规则：
 * 1. 标准只能引用**已录入事实**：缺失一律 UNKNOWN，禁止补全（§11 / §62-7 / §62-13）；
 * 2. 没有对标不等于没有价值：达标轴不足时给「缺口清单」，不写弱化版文案，也不编结构（§4.2 / §17）；
 * 3. 产品结构叙事（Phase 10）、配方哲学（Phase 11）、王者话术（Phase 12）不由本阶段代劳，
 *    进度上必须显式标注为未交付，不得用简化版冒充（§60）。
 */

export const categoryCreatorTriggers = ["NO_RELIABLE_ANCHOR", "USER_OPT_OUT"] as const;
export const categoryCreatorTriggerSchema = z.enum(categoryCreatorTriggers);
export type CategoryCreatorTrigger = z.infer<typeof categoryCreatorTriggerSchema>;

/** §4.2 的两个触发条件：没有可靠锚点（强制），或用户明确选择不使用对标。 */
export const CATEGORY_CREATOR_TRIGGER_META = [
  {
    trigger: "NO_RELIABLE_ANCHOR" as const,
    label: "没有可靠锚点（强制进入）",
    condition: "没有任何候选同时满足 Similarity ≥ 70 且 PriceEvidence ≥ 75",
    spec_ref: "§4.2 / §17"
  },
  {
    trigger: "USER_OPT_OUT" as const,
    label: "用户选择不使用对标",
    condition: "产品负责人显式选择「不使用对标」，即使存在达标锚点也走自建标准",
    spec_ref: "§4.2 / §33"
  }
] as const;

export const CATEGORY_CREATOR_LIMITS = {
  /** 单产品保留的历史自建标准版本上限，超过后需人工归档（所有版本必须保留，故只限制单产品活跃版本数） */
  maxProfilesPerProduct: 20,
  defaultPageSize: 20,
  maxPageSize: 100,
  /** 至少有这么多标准轴拿到事实支撑，才允许把自建标准写进成交表达（§4.2「不能让文案变弱」） */
  minSupportedAxes: 2
} as const;

/* ------------------------------------------------------------ 标准轴 */

export const categoryStandardAxes = [
  "FRAME",
  "DEPTH",
  "IDENTITY",
  "FIRST_IMPRESSION",
  "FINISH",
  "CRAFT"
] as const;
export const categoryStandardAxisSchema = z.enum(categoryStandardAxes);
export type CategoryStandardAxis = z.infer<typeof categoryStandardAxisSchema>;

/** 轴名取自 §4.2 / §5 的统一口径：骨架 / 底气 / 身份 / 第一口 / 后半程 / 工艺。 */
export const CATEGORY_STANDARD_AXIS_LABELS: Record<CategoryStandardAxis, string> = {
  FRAME: "骨架（产区 / 山头）",
  DEPTH: "底气（原料）",
  IDENTITY: "身份（辨识度）",
  FIRST_IMPRESSION: "第一口（汤感）",
  FINISH: "后半程（回甘 / 生津）",
  CRAFT: "工艺控制"
};

export const categoryAxisStatuses = ["SUPPORTED", "PARTIAL", "UNKNOWN"] as const;
export const categoryAxisStatusSchema = z.enum(categoryAxisStatuses);
export type CategoryAxisStatus = z.infer<typeof categoryAxisStatusSchema>;

export const CATEGORY_AXIS_STATUS_LABELS: Record<CategoryAxisStatus, string> = {
  SUPPORTED: "有事实支撑",
  PARTIAL: "只有单点事实",
  UNKNOWN: "未录入（不得书写）"
};

export const categoryReadinesses = ["READY", "PARTIAL", "INSUFFICIENT"] as const;
export const categoryReadinessSchema = z.enum(categoryReadinesses);
export type CategoryReadiness = z.infer<typeof categoryReadinessSchema>;

export const CATEGORY_READINESS_LABELS: Record<CategoryReadiness, string> = {
  READY: "标准成立（可以进入成交表达）",
  PARTIAL: "标准部分成立（先补事实再放大）",
  INSUFFICIENT: "事实不足（不得输出成交表达）"
};

export const categoryStandardItemSchema = z
  .object({
    axis: categoryStandardAxisSchema,
    label: z.string(),
    /** 这一轴「必须成立什么」——标准本身，不是对产品的额外断言 */
    requirement: z.string(),
    why_it_matters: z.string(),
    status: categoryAxisStatusSchema,
    /** 支撑这一轴的事实字段路径（product.* / dna.*），可逐条回查 */
    evidence_refs: z.array(z.string()),
    /** 已录入事实的原样摘要；没有事实时明写「未录入」 */
    evidence_summary: z.string(),
    /** 前台标准表达；UNKNOWN 轴必须为 null（宁可少讲，不得编） */
    statement: z.string().nullable(),
    /** 缺口说明：这一轴缺什么事实才能写 */
    gap: z.string().nullable(),
    layer: z.literal("INTERPRETATION")
  })
  .strict();
export type CategoryStandardItem = z.infer<typeof categoryStandardItemSchema>;

export const categoryStandardSchema = z
  .object({
    items: z.array(categoryStandardItemSchema),
    supported_count: z.number().int().nonnegative(),
    partial_count: z.number().int().nonnegative(),
    unknown_count: z.number().int().nonnegative(),
    /** 自建标准的一句话总结（INTERPRETATION） */
    summary: z.string()
  })
  .strict();
export type CategoryStandard = z.infer<typeof categoryStandardSchema>;

/* ------------------------------------------------------ 风格身份证 */

export const categoryStyleIdentitySchema = z
  .object({
    identity_name: z.string(),
    /** 在哪个品类里、按什么标准立自己的位置（不点名竞品） */
    category_positioning: z.string(),
    first_impression: z.string().nullable(),
    mid_palate: z.string().nullable(),
    finish: z.string().nullable(),
    /** 最不能丢的那一项：决定这款茶是不是它自己 */
    signature_trait: z.string().nullable(),
    /** 结构层面的差异（不比较具体竞品、不引出未录入事实） */
    differentiators: z.array(z.string()),
    /** §19 TIME_DEPENDENT 的表达位（Phase 9 Value Codes 交付后填充） */
    time_story: z.string().nullable(),
    /** 明确不声称什么——把红线写在产品身份证上，而不是写在备注里 */
    not_claiming: z.array(z.string())
  })
  .strict();
export type CategoryStyleIdentity = z.infer<typeof categoryStyleIdentitySchema>;

/* -------------------------------------------------------- 价值逻辑 */

export const valueLogicStages = ["FACT", "INTERPRETATION", "VALUE", "SALES_LINE"] as const;
export const valueLogicStageSchema = z.enum(valueLogicStages);
export type ValueLogicStage = z.infer<typeof valueLogicStageSchema>;

export const VALUE_LOGIC_STAGE_LABELS: Record<ValueLogicStage, string> = {
  FACT: "事实（FACT）",
  INTERPRETATION: "解释（INTERPRETATION）",
  VALUE: "价值（VALUE）",
  SALES_LINE: "成交表达（RHETORIC）"
};

export const valueLogicItemSchema = z
  .object({
    stage: valueLogicStageSchema,
    label: z.string(),
    /** §24 三层标记：事实 / 解释 / 修辞必须逐段标死 */
    layer: z.enum(["FACT", "INTERPRETATION", "RHETORIC"]),
    text: z.string(),
    source_refs: z.array(z.string())
  })
  .strict();
export type ValueLogicItem = z.infer<typeof valueLogicItemSchema>;

export const valueLogicSchema = z
  .object({
    items: z.array(valueLogicItemSchema),
    /** §4.2 的核心口径：没有现成对标 ≠ 没有价值可讲 */
    mode_switch_note: z.string(),
    /** 是否已具备可用的成交表达（事实不足时为 false，且不输出 SALES_LINE） */
    sales_line_ready: z.boolean()
  })
  .strict();
export type ValueLogic = z.infer<typeof valueLogicSchema>;

/* ---------------------------------------------------------- 下游交接 */

export const categoryDownstreamItemSchema = z
  .object({
    phase: z.number().int().positive(),
    deliverable: z.string(),
    spec_ref: z.string(),
    /** 本阶段只登记「谁负责」，状态固定 PENDING，不得显示为已完成 */
    status: z.literal("PENDING")
  })
  .strict();
export type CategoryDownstreamItem = z.infer<typeof categoryDownstreamItemSchema>;

/**
 * 下游交接：已交付阶段不再登记（§60）。
 * Phase 10 产品结构与 Phase 11 配方哲学已交付，本阶段不再用占位条目冒充交接；
 * 交接关系仍写在合同的 `rules` 里（「产品结构、配方哲学与王者话术分别由 Phase 10 / 11 / 12 交付」）。
 */
export const CATEGORY_CREATOR_DOWNSTREAM: readonly CategoryDownstreamItem[] = [];

/* ------------------------------------------------------------ API 对象 */

export const categoryCreatorProfileSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    version: z.number().int().positive(),
    trigger: categoryCreatorTriggerSchema,
    /** 生成时的模式判定结论：正常情况下是 CATEGORY_CREATOR（用户选择不使用对标时可能为 BENCHMARK） */
    mode_at_generation: resolvedResearchModeSchema,
    readiness: categoryReadinessSchema,
    supported_axes: z.number().int().nonnegative(),
    total_axes: z.number().int().positive(),
    standard: categoryStandardSchema,
    style_identity: categoryStyleIdentitySchema,
    value_logic: valueLogicSchema,
    /** 明确列出「还缺什么事实」——缺口清单是这套标准的组成部分，不是错误信息 */
    evidence_gaps: z.array(z.string()),
    fact_refs: z.array(z.string()),
    value_dna_refs: z.array(z.string()),
    downstream: z.array(categoryDownstreamItemSchema),
    is_confirmed: z.boolean(),
    confirmed_by: z.string().uuid().nullable(),
    confirmed_at: z.string().nullable(),
    notes: z.string().nullable(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    spec_ref: z.literal("§4.2 / §17 / §29")
  })
  .strict();
export type CategoryCreatorProfileView = z.infer<typeof categoryCreatorProfileSchema>;

export const categoryCreatorVersionSummarySchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    trigger: categoryCreatorTriggerSchema,
    readiness: categoryReadinessSchema,
    supported_axes: z.number().int().nonnegative(),
    total_axes: z.number().int().positive(),
    is_confirmed: z.boolean(),
    created_at: z.string()
  })
  .strict();
export type CategoryCreatorVersionSummary = z.infer<typeof categoryCreatorVersionSummarySchema>;

export const categoryCreatorOverviewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    /** 产品当前的模式偏好与判定结论（直接复用 §17 的判定，不重复实现） */
    preference: z.enum(["AUTO", "BENCHMARK", "CATEGORY_CREATOR"]),
    mode: resolvedResearchModeSchema,
    resolved_by: z.enum(["AUTO_ANCHOR", "MANUAL_PREFERENCE", "NO_RELIABLE_ANCHOR"]),
    mode_reason: z.string(),
    /** 当前是否还能生成新版自建标准，以及不能生成的原因 */
    can_generate: z.boolean(),
    block_reason: z.string().nullable(),
    /** 生成时应使用的触发条件（用户选择不使用对标时由调用方覆盖） */
    suggested_trigger: categoryCreatorTriggerSchema,
    profile: categoryCreatorProfileSchema.nullable(),
    versions: z.array(categoryCreatorVersionSummarySchema),
    spec_ref: z.literal("§4.2 / §17 / §29")
  })
  .strict();
export type CategoryCreatorOverview = z.infer<typeof categoryCreatorOverviewSchema>;

export const categoryCreatorGenerateSchema = z
  .object({
    /** 不传时：有可靠锚点上下文按 USER_OPT_OUT，无锚点按 NO_RELIABLE_ANCHOR */
    trigger: categoryCreatorTriggerSchema.optional(),
    notes: z.string().trim().max(2000).optional()
  })
  .strict();
export type CategoryCreatorGenerateInput = z.infer<typeof categoryCreatorGenerateSchema>;

export const categoryCreatorUpdateSchema = z
  .object({
    /** 人工确认这份标准（确认后仍保留全部版本，可继续生成新版本） */
    is_confirmed: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type CategoryCreatorUpdateInput = z.infer<typeof categoryCreatorUpdateSchema>;

export const categoryCreatorListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(CATEGORY_CREATOR_LIMITS.maxPageSize).optional()
  })
  .strict();
export type CategoryCreatorListQuery = z.infer<typeof categoryCreatorListQuerySchema>;

/** 供 API 自检与前端展示：§4.2 / §17 的触发条件、标准轴与红线只从这里读取。 */
export const CATEGORY_CREATOR_CONTRACT = {
  spec_ref: "§4.2 / §17 / §29",
  triggers: CATEGORY_CREATOR_TRIGGER_META,
  axes: categoryStandardAxes.map((axis) => ({
    axis,
    label: CATEGORY_STANDARD_AXIS_LABELS[axis]
  })),
  min_supported_axes: CATEGORY_CREATOR_LIMITS.minSupportedAxes,
  layers: ["FACT", "INTERPRETATION", "RHETORIC"],
  not_weak_copy: true,
  no_fake_benchmark: true,
  unknown_is_written_as_unknown: true,
  downstream_phases: CATEGORY_CREATOR_DOWNSTREAM,
  rules: [
    "没有可靠锚点或用户明确不使用对标时，必须进入 Category Creator Mode（§4.2 / §17）",
    "不得硬凑竞品、不得下调阈值、不得编造对标（§17 / §62-10）",
    "没有对标不等于文案变弱：必须输出自建标准、风格身份证与价值逻辑（§4.2 / §17）",
    "标准只能引用已录入事实：缺失一律 UNKNOWN，禁止补全（§11 / §62-7）",
    "前台表达必须区分 FACT / INTERPRETATION / RHETORIC（§24）",
    "产品结构、配方哲学与王者话术分别由 Phase 10 / 11 / 12 交付，本阶段只登记交接，不得用简化版代替（§60）"
  ]
} as const;

/* ------------------------------------------------------------ 纯函数构建器 */

export interface CategoryFactHit {
  /** 事实来源字段路径，例如 product.mountain / dna.identity */
  ref: string;
  value: string;
}

export interface CategoryStandardProductInput {
  product_name: string;
  series_name: string | null;
  year: number;
  tea_type: string;
  tea_subtype: string | null;
  origin_province: string | null;
  origin_city: string | null;
  origin_region: string | null;
  mountain: string | null;
  village: string | null;
  raw_material: string | null;
  tree_type: string | null;
  tree_age: string | null;
  season: string | null;
  grade: string | null;
  blend_description: string | null;
  kill_green_method: string | null;
  rolling_method: string | null;
  drying_method: string | null;
  pressing_method: string | null;
  processing_notes: string | null;
  dry_leaf_aroma: string | null;
  hot_cup_aroma: string | null;
  entry_taste: string | null;
  bitterness: string | null;
  astringency: string | null;
  sweetness: string | null;
  huigan: string | null;
  salivation: string | null;
  cha_qi: string | null;
  thickness: string | null;
  early_stage: string | null;
  middle_stage: string | null;
  late_stage: string | null;
  endurance: string | null;
}

export interface CategoryStandardInput {
  product: CategoryStandardProductInput;
  /** Value DNA（§9）；未生成时传 null，缺口清单会列出「价值DNA未生成」 */
  value_dna: ValueDna | null;
  trigger: CategoryCreatorTrigger;
}

export interface CategoryCreatorDraft {
  readiness: CategoryReadiness;
  supported_axes: number;
  total_axes: number;
  standard: CategoryStandard;
  style_identity: CategoryStyleIdentity;
  value_logic: ValueLogic;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
}

function factHit(ref: string, value: string | null): CategoryFactHit | null {
  const trimmed = value?.trim();
  return trimmed ? { ref, value: trimmed } : null;
}

function collect(hits: Array<CategoryFactHit | null>): CategoryFactHit[] {
  return hits.filter((hit): hit is CategoryFactHit => hit !== null);
}

function dnaHits(dna: ValueDna | null, dimension: keyof ValueDna, limit = 5): CategoryFactHit[] {
  if (!dna) {
    return [];
  }
  return dna[dimension]
    .slice(0, limit)
    .map((value) => factHit(`dna.${String(dimension)}`, value))
    .filter((hit): hit is CategoryFactHit => hit !== null);
}

/** 11 个维度全空的 DNA 视同「尚未生成」：不给证据，也不给它撑起任何标准轴。 */
function usableValueDna(value_dna: ValueDna | null): ValueDna | null {
  if (!value_dna) {
    return null;
  }
  const hasContent = VALUE_DNA_DIMENSIONS.some((dimension) => (value_dna[dimension]?.length ?? 0) > 0);
  return hasContent ? value_dna : null;
}

function formatHits(hits: readonly CategoryFactHit[]): string {
  return hits.map((hit) => hit.value).join(" / ");
}

function evidenceSummary(hits: readonly CategoryFactHit[]): string {
  if (hits.length === 0) {
    return "未录入相关事实";
  }
  return `已录入事实：${hits.map((hit) => `${hit.ref}=${hit.value}`).join("；")}`;
}

interface AxisDefinition {
  axis: CategoryStandardAxis;
  requirement: string;
  why_it_matters: string;
  gap: string;
  statement: (hits: readonly CategoryFactHit[]) => string;
}

/**
 * 六个标准轴的定义。statement 只做两件事：引用已录入事实 + 说明这一轴在设计上为什么不能缺。
 * 任何一句都不允许出现未录入的树龄 / 年份 / 获奖 / 大师 / 研发关系 / 配方比例（§62-7）。
 */
const AXIS_DEFINITIONS: readonly AxisDefinition[] = [
  {
    axis: "FRAME",
    requirement: "产区骨架必须明确到可核查的产区、山头或村寨",
    why_it_matters: "没有这层骨架，浓强只会被当成重口味，不会被当成风格",
    gap: "缺产区 / 山头 / 村寨事实：无法建立骨架轴，先补 §10.1 产区字段",
    statement: (hits) =>
      `骨架必须立得住：${formatHits(hits)}。${AXIS_WHY.FRAME}`
  },
  {
    axis: "DEPTH",
    requirement: "原料底气必须说得清楚：原料类型、树型、季节或等级",
    why_it_matters: "原料层说不清，高端定位就只能靠包装撑着",
    gap: "缺原料 / 树型 / 树龄 / 季节 / 等级事实：无法建立底气轴，先补 §10.2 原料字段",
    statement: (hits) => `底气必须说得清楚：${formatHits(hits)}。${AXIS_WHY.DEPTH}`
  },
  {
    axis: "IDENTITY",
    requirement: "辨识度必须一入口就能被记住（香气 / 命名体系 / 系列身份）",
    why_it_matters: "记不住的风格，最后只能靠价格解释",
    gap: "缺香气与命名体系事实：无法建立身份轴，先补 §10.1 / §10.4 或生成 §9 Value DNA",
    statement: (hits) => `辨识度必须一入口就记住：${formatHits(hits)}。${AXIS_WHY.IDENTITY}`
  },
  {
    axis: "FIRST_IMPRESSION",
    requirement: "第一口必须有存在感：入口滋味与汤感厚度",
    why_it_matters: "入口平淡，后面讲什么都没人听",
    gap: "缺入口滋味 / 汤感事实：无法建立第一口轴，先补 §10.4 感官字段",
    statement: (hits) => `第一口必须有存在感：${formatHits(hits)}。${AXIS_WHY.FIRST_IMPRESSION}`
  },
  {
    axis: "FINISH",
    requirement: "后半程必须接得住：回甘、生津与耐泡度",
    why_it_matters: "前半程再猛，回甘生津跟不上就撑不长",
    gap: "缺回甘 / 生津 / 茶气 / 耐泡事实：无法建立后半程轴，先补 §10.4 感官字段",
    statement: (hits) => `后半程必须接得住：${formatHits(hits)}。${AXIS_WHY.FINISH}`
  },
  {
    axis: "CRAFT",
    requirement: "工艺必须可控：杀青 / 揉捻 / 干燥 / 压制有明确做法",
    why_it_matters: "工艺不可控，前面的原料与产区都白给",
    gap: "缺工艺事实：无法建立工艺轴，先补 §10.3 工艺字段",
    statement: (hits) => `工艺必须可控：${formatHits(hits)}。${AXIS_WHY.CRAFT}`
  }
];

/** 每轴「缺了会怎样」的统一口径（与 §4.2 / §5 的一致表述）。 */
const AXIS_WHY: Record<CategoryStandardAxis, string> = {
  FRAME: "少这一层，产品就只是「有味道」，不是「有结构」。",
  DEPTH: "少这一层，高端定位就只能靠包装撑着。",
  IDENTITY: "少这一层，风格只能靠价格解释。",
  FIRST_IMPRESSION: "少这一层，后面讲什么都没人听。",
  FINISH: "少这一层，前半程再猛也撑不长。",
  CRAFT: "少这一层，原料与产区都白给。"
};

function axisHits(input: CategoryStandardInput): Record<CategoryStandardAxis, CategoryFactHit[]> {
  const { product, value_dna } = input;
  return {
    FRAME: collect([
      factHit("product.mountain", product.mountain),
      factHit("product.village", product.village),
      factHit("product.origin_region", product.origin_region),
      factHit("product.origin_city", product.origin_city),
      factHit("product.origin_province", product.origin_province),
      ...dnaHits(value_dna, "origin", 3)
    ]),
    DEPTH: collect([
      factHit("product.raw_material", product.raw_material),
      factHit("product.tree_type", product.tree_type),
      factHit("product.tree_age", product.tree_age),
      factHit("product.season", product.season),
      factHit("product.grade", product.grade),
      factHit("product.blend_description", product.blend_description),
      ...dnaHits(value_dna, "material", 3)
    ]),
    IDENTITY: collect([
      factHit("product.series_name", product.series_name),
      factHit("product.dry_leaf_aroma", product.dry_leaf_aroma),
      factHit("product.hot_cup_aroma", product.hot_cup_aroma),
      ...dnaHits(value_dna, "identity", 3),
      ...dnaHits(value_dna, "naming_concepts", 3)
    ]),
    FIRST_IMPRESSION: collect([
      factHit("product.entry_taste", product.entry_taste),
      factHit("product.thickness", product.thickness),
      factHit("product.bitterness", product.bitterness),
      factHit("product.astringency", product.astringency),
      factHit("product.sweetness", product.sweetness),
      ...dnaHits(value_dna, "taste", 3),
      ...dnaHits(value_dna, "flavor", 3)
    ]),
    FINISH: collect([
      factHit("product.huigan", product.huigan),
      factHit("product.salivation", product.salivation),
      factHit("product.cha_qi", product.cha_qi),
      factHit("product.middle_stage", product.middle_stage),
      factHit("product.late_stage", product.late_stage),
      factHit("product.endurance", product.endurance)
    ]),
    CRAFT: collect([
      factHit("product.kill_green_method", product.kill_green_method),
      factHit("product.rolling_method", product.rolling_method),
      factHit("product.drying_method", product.drying_method),
      factHit("product.pressing_method", product.pressing_method),
      factHit("product.processing_notes", product.processing_notes),
      ...dnaHits(value_dna, "process", 3)
    ])
  };
}

function statusOf(hits: readonly CategoryFactHit[]): CategoryAxisStatus {
  if (hits.length >= 2) {
    return "SUPPORTED";
  }
  return hits.length === 1 ? "PARTIAL" : "UNKNOWN";
}

function readinessOf(supported: number, partial: number): CategoryReadiness {
  if (supported >= 4) {
    return "READY";
  }
  if (supported + partial >= CATEGORY_CREATOR_LIMITS.minSupportedAxes) {
    return "PARTIAL";
  }
  return "INSUFFICIENT";
}

/**
 * 从已录入事实构建自建标准（§4.2 / §17 / §29）。
 *
 * 纯函数：不读数据库、不调用 AI、不做任何推断性补全。
 * 事实不足时输出的是「缺口清单 + 未成立的轴」，而不是弱化版文案。
 */
export function buildCategoryCreatorDraft(input: CategoryStandardInput): CategoryCreatorDraft {
  // 空白 Value DNA（11 个维度全空）在事实层面等同「尚未生成」，缺口清单必须照实提示。
  const source: CategoryStandardInput = { ...input, value_dna: usableValueDna(input.value_dna) };
  const hitsByAxis = axisHits(source);
  const items: CategoryStandardItem[] = AXIS_DEFINITIONS.map((definition) => {
    const hits = hitsByAxis[definition.axis];
    const status = statusOf(hits);
    return categoryStandardItemSchema.parse({
      axis: definition.axis,
      label: CATEGORY_STANDARD_AXIS_LABELS[definition.axis],
      requirement: definition.requirement,
      why_it_matters: definition.why_it_matters,
      status,
      evidence_refs: hits.map((hit) => hit.ref),
      evidence_summary: evidenceSummary(hits),
      statement: status === "UNKNOWN" ? null : definition.statement(hits),
      gap: status === "UNKNOWN" ? definition.gap : status === "PARTIAL" ? `单点事实：${definition.gap}` : null,
      layer: "INTERPRETATION"
    });
  });

  const supported = items.filter((item) => item.status === "SUPPORTED");
  const partial = items.filter((item) => item.status === "PARTIAL");
  const unknown = items.filter((item) => item.status === "UNKNOWN");
  const readiness = readinessOf(supported.length, partial.length);

  const standard = categoryStandardSchema.parse({
    items,
    supported_count: supported.length,
    partial_count: partial.length,
    unknown_count: unknown.length,
    summary:
      readiness === "INSUFFICIENT"
        ? `自建标准尚未成立：六个标准轴里只有 ${supported.length + partial.length} 个拿到事实，先补事实再谈标准（§4.2 / §17）。`
        : `自建标准：${items.map((item) => item.label.split("（")[0]).join("、")} 六个位置各自负责一件事，少一个环节都撑不起这款茶的定位。`
  });

  const evidenceGaps = [
    ...unknown.map((item) => item.gap ?? `${item.label}缺少事实支撑`),
    ...partial.map((item) => `${item.label}只有单点事实，建议补齐到可交叉印证的粒度`)
  ];
  if (!source.value_dna) {
    evidenceGaps.push("尚未生成价值 DNA（§9）：身份轴与价值逻辑的证据面会偏窄");
  }

  const value_dna_refs = source.value_dna
    ? VALUE_DNA_DIMENSIONS.filter((dimension) => (source.value_dna?.[dimension]?.length ?? 0) > 0).map(
        (dimension) => `dna.${dimension}`
      )
    : [];
  const fact_refs = [...new Set(items.flatMap((item) => item.evidence_refs))];

  return {
    readiness,
    supported_axes: supported.length,
    total_axes: items.length,
    standard,
    style_identity: buildStyleIdentity(source, items, supported, readiness),
    value_logic: buildValueLogic(source, items, supported, readiness),
    evidence_gaps: evidenceGaps,
    fact_refs,
    value_dna_refs
  };
}

function buildStyleIdentity(
  input: CategoryStandardInput,
  items: readonly CategoryStandardItem[],
  supported: readonly CategoryStandardItem[],
  readiness: CategoryReadiness
): CategoryStyleIdentity {
  const { product } = input;
  const frame = items.find((item) => item.axis === "FRAME");
  const identity = items.find((item) => item.axis === "IDENTITY");
  const first = items.find((item) => item.axis === "FIRST_IMPRESSION");
  const finish = items.find((item) => item.axis === "FINISH");

  const frameLabel = product.mountain ?? product.origin_region ?? product.origin_city ?? product.origin_province;
  const identityLabel = product.dry_leaf_aroma ?? product.series_name ?? product.tea_subtype ?? product.tea_type;
  const identityName =
    frameLabel && identityLabel
      ? `${frameLabel}·${identityLabel}标准`
      : `${product.product_name} 自建标准`;

  const differentiators: string[] = [];
  if (frame?.status !== "UNKNOWN") {
    differentiators.push("把产区骨架当结构讲，而不是当产地卖点堆在前面");
  }
  if (identity?.status !== "UNKNOWN") {
    differentiators.push("把香气 / 命名当身份讲，而不是当香气描述");
  }
  if (first?.status !== "UNKNOWN") {
    differentiators.push("把第一口的汤感当入场门槛讲，而不是当口感形容词");
  }
  if (finish?.status !== "UNKNOWN") {
    differentiators.push("把回甘生津当后半程耐力讲，而不是当结束语");
  }

  return categoryStyleIdentitySchema.parse({
    identity_name: identityName,
    category_positioning: `在「${product.tea_type}${product.tea_subtype ? ` / ${product.tea_subtype}` : ""}」里不照抄现成模板，而是按自己的结构立标准：${supported.map((item) => item.label.split("（")[0]).join("、") || "结构待补"}。`,
    first_impression:
      readiness === "INSUFFICIENT" || !first || first.status === "UNKNOWN"
        ? null
        : first.statement,
    mid_palate:
      readiness === "INSUFFICIENT" || !frame || frame.status === "UNKNOWN" ? null : frame.statement,
    finish:
      readiness === "INSUFFICIENT" || !finish || finish.status === "UNKNOWN" ? null : finish.statement,
    signature_trait:
      supported.length === 0 ? null : `最不能丢的是${supported.map((item) => item.label.split("（")[0]).join("与")}——丢任意一项，这款茶就不再是它自己。`,
    differentiators,
    // §19 的 TIME_DEPENDENT 表达属于 Phase 9 Value Codes；本阶段只留位置，不给说法。
    time_story: null,
    not_claiming: [
      "不声称与任何具体老茶、竞品同源、复刻或再现（§25 / §62-5）",
      "不声称未录入的树龄、山头、年份、获奖与大师参与（§62-7）",
      "不因为没有对标就降低表达强度：没有对标说明的是不能照抄，不是不能讲（§4.2 / §17）"
    ]
  });
}

function buildValueLogic(
  input: CategoryStandardInput,
  items: readonly CategoryStandardItem[],
  supported: readonly CategoryStandardItem[],
  readiness: CategoryReadiness
): ValueLogic {
  const { product } = input;
  const factLines = items
    .filter((item) => item.evidence_refs.length > 0)
    .map((item) => `${item.label.split("（")[0]}：${item.evidence_summary.replace(/^已录入事实：/, "")}`);

  const logicItems: ValueLogicItem[] = [
    valueLogicItemSchema.parse({
      stage: "FACT",
      label: VALUE_LOGIC_STAGE_LABELS.FACT,
      layer: "FACT",
      text:
        factLines.length > 0
          ? `${product.product_name}（${product.year} 年·${product.tea_type}）已录入事实：${factLines.join("；")}。`
          : `${product.product_name}（${product.year} 年·${product.tea_type}）目前没有可用于自建标准的事实记录。`,
      source_refs: [...new Set(items.flatMap((item) => item.evidence_refs))]
    }),
    valueLogicItemSchema.parse({
      stage: "INTERPRETATION",
      label: VALUE_LOGIC_STAGE_LABELS.INTERPRETATION,
      layer: "INTERPRETATION",
      text:
        supported.length > 0
          ? `这些事实不是并列的卖点，而是各有分工：${supported
              .map((item) => item.label.split("（")[0])
              .join("、")}分别解决不同问题，缺一个环节，产品结构就不完整。`
          : "事实不足以说明结构分工：不推断、不补齐，先补事实再建立标准。",
      source_refs: supported.flatMap((item) => item.evidence_refs)
    }),
    valueLogicItemSchema.parse({
      stage: "VALUE",
      label: VALUE_LOGIC_STAGE_LABELS.VALUE,
      layer: "INTERPRETATION",
      text:
        readiness === "INSUFFICIENT"
          ? "高价值产品的价值来自结构完整度；当前结构证据不足，因此不给出价值结论。"
          : "高价值产品的价值来自结构完整度：位置都有人负责，不谈价格也能说清它为什么贵得起。",
      source_refs: ["§4.2", "§17"]
    }),
    valueLogicItemSchema.parse({
      stage: "SALES_LINE",
      label: VALUE_LOGIC_STAGE_LABELS.SALES_LINE,
      layer: "RHETORIC",
      text: salesLine(product, items, supported),
      source_refs: supported.flatMap((item) => item.evidence_refs)
    })
  ];

  const salesLineReady = readiness !== "INSUFFICIENT" && supported.length >= CATEGORY_CREATOR_LIMITS.minSupportedAxes;
  return valueLogicSchema.parse({
    items: salesLineReady ? logicItems : logicItems.filter((item) => item.stage !== "SALES_LINE"),
    mode_switch_note:
      "没有现成对标 ≠ 没有价值可讲：找不到完全相同的产品，说明这款茶不能拿普通模板去理解（§4.2）。",
    sales_line_ready: salesLineReady
  });
}

/** §29 口径的成交表达：只用「必须成立的标准」+ 已录入事实构造，不新增任何事实断言。 */
function salesLine(
  product: CategoryStandardProductInput,
  items: readonly CategoryStandardItem[],
  supported: readonly CategoryStandardItem[]
): string {
  const musts = supported.map((item) => {
    const short = item.label.split("（")[0];
    const firstValue = item.evidence_refs.length > 0 ? item.evidence_summary.replace(/^已录入事实：/, "").split("；")[0] : null;
    const value = firstValue ? firstValue.replace(/^[^=]+=/, "") : "";
    return value ? `${short}必须站得住（${value}）` : `${short}必须站得住`;
  });
  const missing = items
    .filter((item) => item.status === "UNKNOWN")
    .map((item) => item.label.split("（")[0]);
  return [
    `市面上找不到完全一样的对标，反而说明这款茶不能用普通模板去理解。${product.product_name}先定的是标准，不是故事：`,
    musts.join("，"),
    missing.length > 0 ? `（${missing.join("、")}尚未补齐事实，这一轮不当成交点用。）` : "",
    `先把这些位置摆正，再谈它值多少钱。`
  ]
    .filter(Boolean)
    .join("");
}

/** 模式判定的三种来源（与锚点引擎 `resolved_by` 同一口径）。 */
export const categoryCreatorResolveSources = ["AUTO_ANCHOR", "MANUAL_PREFERENCE", "NO_RELIABLE_ANCHOR"] as const;
export type CategoryCreatorResolveSource = (typeof categoryCreatorResolveSources)[number];

/**
 * 生成触发条件的推断（§4.2）：
 * - 模式被强制判定为自建标准（`NO_RELIABLE_ANCHOR`）→ 无锚点强制触发；
 * - 其余情况（自动锚点仍在，或产品负责人指定进入自建标准）→ 用户主动选择不使用对标。
 */
export function inferCategoryTrigger(resolvedBy: CategoryCreatorResolveSource): CategoryCreatorTrigger {
  return resolvedBy === "NO_RELIABLE_ANCHOR" ? "NO_RELIABLE_ANCHOR" : "USER_OPT_OUT";
}
