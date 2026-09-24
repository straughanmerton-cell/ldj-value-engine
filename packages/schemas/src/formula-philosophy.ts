import { z } from "zod";
import {
  categoryDownstreamItemSchema,
  type CategoryDownstreamItem,
  type CategoryStandardProductInput
} from "./category-creator.js";
import { resolvedResearchModeSchema } from "./enums.js";
import { formulaPhilosophySchema, type FormulaPhilosophy } from "./product.js";
import { VALUE_DNA_DIMENSIONS, type ValueDna, type ValueDnaDimension } from "./value-dna.js";

/**
 * 配方哲学（规格 §6 Formula Philosophy / §46 Agent 8 配方哲学文案师）。
 *
 * 这一层回答一个问题：**这款茶为什么这么设计？**
 *
 * §6.1 的输入是已经确认的「原料 / 拼配关系 / 感官表现 / 工艺目标」，因此
 * 即使用户完全没给配方比例，也必须能输出「配方哲学」；但 §6.1 同时划了一条红线：
 *
 * - 已知配方事实（有证据，例如拼配描述里逐字写着「布朗山 60% / 易武 40%」）可以使用；
 * - 未知比例绝对不能自动编（不能出现「70% 班章 + 30% 易武」这种凭空比例）。
 *
 * 加上 §46 的另一条红线（没有某个原料，绝对不能新增原料）与本阶段的设计取舍
 * （纯规则引擎，不接 AI），这套类型把「不能编」变成结构上不可违反：
 *
 * 1. 五个分量字段与顺序由 §6.3 固定（backbone / aroma / sweetness / body / finish），
 *    分别落到 `backbone_component` / `aroma_component` / `sweetness_component` /
 *    `body_component` / `finish_component` 上；
 * 2. 分量正文只允许引用**本产品已录入字段**（product.*）与 Value DNA（dna.*）：
 *    取不到值就是取不到（§6.1 / §46 / §62-7）；
 * 3. 没有具体比例时，正文、叙事与成交层解释一律不得出现比例字样；
 *    连「已录入事实里自带比例字样」的字段（例如拼配描述写着 60%）都不允许被抄进正文——
 *    否则会出现「嘴上说不编比例、正文却抄着比例」这种最危险的假合规（§6.1）；
 * 4. 事实不足的分量留空并写缺口，绝不用形容词补圆；同一句话里也不能多出一个原料（§46）。
 */

/** §6.3 固定的五个分量，顺序即展示顺序，不得增删或重排。 */
export const formulaComponentKeys = ["backbone", "aroma", "sweetness", "body", "finish"] as const;
export const formulaComponentKeySchema = z.enum(formulaComponentKeys);
export type FormulaComponentKey = z.infer<typeof formulaComponentKeySchema>;

export const FORMULA_COMPONENT_COUNT = formulaComponentKeys.length;

export const FORMULA_PHILOSOPHY_LIMITS = {
  /** 单产品保留的历史配方哲学版本上限（所有版本必须保留，§62-15） */
  maxVersionsPerProduct: 20,
  /** 成立「配方哲学」至少要有几个分量写实：不足就是「还没形成设计逻辑」，不得硬写（§6.2） */
  minWrittenComponentsForStrategy: 2,
  /** 同一分量最多引用多少条 Value DNA，避免单分量被 DNA 刷满 */
  maxDnaRefsPerComponent: 3,
  /** 确认过的比例最多几项，防止拿超长配比表当事实（§6.1） */
  maxRatioEntries: 20,
  defaultPageSize: 20,
  maxPageSize: 100
} as const;

/** 分量只有两种状态：写实 / 事实不足留空。没有「弱化版」这一档。 */
export const formulaComponentStatuses = ["WRITTEN", "GAP"] as const;
export const formulaComponentStatusSchema = z.enum(formulaComponentStatuses);
export type FormulaComponentStatus = z.infer<typeof formulaComponentStatusSchema>;

export const FORMULA_COMPONENT_STATUS_LABELS: Record<FormulaComponentStatus, string> = {
  WRITTEN: "已写实",
  GAP: "事实不足（留空）"
};

export const FORMULA_COMPONENT_STATUS_TONES: Record<
  FormulaComponentStatus,
  "ok" | "danger"
> = {
  WRITTEN: "ok",
  GAP: "danger"
};

/**
 * §46 Agent 8 的五项输出与 §6.3 存储字段的映射（两处口径不完全一致，这里是唯一的桥）。
 *
 * §46 要求输出 `formula_strategy / ingredient_roles / taste_roles / design_goal / sales_explanation`，
 * §6.3 要求存储 `formula_strategy / backbone_component / … / design_goal / known_ratio`。
 * 桥接方式是：`ingredient_roles` 与 `taste_roles` 由五个分量字段推导（不新增任何字段口径），
 * `sales_explanation` 属于 §24 的 RHETORIC 层，单独成字段但不参与事实断言。
 */
export const FORMULA_PHILOSOPHY_AGENT8_OUTPUTS = [
  {
    key: "formula_strategy",
    layer: "INTERPRETATION" as const,
    meaning: "这款茶到底是怎么设计的：不是把原料混起来，而是让每一类原料承担自己的任务",
    storage: "formula_strategy",
    spec_ref: "§6.2 / §46"
  },
  {
    key: "ingredient_roles",
    layer: "INTERPRETATION" as const,
    meaning: "每个原料 / 山头 / 用料在这一层承担什么任务（没有录入的原料不得新增）",
    storage: "backbone_component / aroma_component / sweetness_component / body_component / finish_component",
    spec_ref: "§6.3 / §46"
  },
  {
    key: "taste_roles",
    layer: "INTERPRETATION" as const,
    meaning: "每个感官表现（香气 / 回甘 / 汤感 / 收口）落在哪一层",
    storage: "backbone_component / aroma_component / sweetness_component / body_component / finish_component",
    spec_ref: "§6.3 / §46"
  },
  {
    key: "design_goal",
    layer: "INTERPRETATION" as const,
    meaning: "先定骨架、再定香气、再定回甘，再让每一部分围绕同一个风格目标服务",
    storage: "design_goal",
    spec_ref: "§6.2"
  },
  {
    key: "sales_explanation",
    layer: "RHETORIC" as const,
    meaning: "成交层解释：价值不在原料表，而在设计逻辑（不得携带任何新事实）",
    storage: "sales_explanation",
    spec_ref: "§24 / §46"
  }
] as const;

export interface FormulaComponentMeta {
  key: FormulaComponentKey;
  label: string;
  short_label: string;
  /** §6.3 / §35.4 的存储字段名（JSONB 数组） */
  storage_field: string;
  /** 这个分量到底在说什么 */
  definition: string;
  /** 写实这个分量至少要有哪些已录入事实 */
  requirement: string;
  /** 这个分量主要喂给 §46 的哪一项输出 */
  agent8_output: string;
  /** 允许引用的字段路径白名单（product.* / dna.*），按优先顺序排列 */
  evidence_refs: readonly string[];
  spec_ref: string;
}

export const FORMULA_COMPONENT_META: readonly FormulaComponentMeta[] = [
  {
    key: "backbone",
    label: "骨架分量 Backbone Component",
    short_label: "骨架",
    storage_field: "backbone_component",
    definition: "承重层：产地与用料决定这款茶的汤感结构下限，后面的表现都建立在它上面",
    requirement: "山头 / 产区 / 用料 / 拼配描述（至少录入一项）",
    agent8_output: "ingredient_roles",
    evidence_refs: [
      "product.mountain",
      "product.raw_material",
      "product.origin_region",
      "product.origin_city",
      "product.origin_province",
      "product.village",
      "product.grade",
      "product.blend_description",
      "product.tree_type",
      "product.season",
      "dna.origin",
      "dna.material"
    ],
    spec_ref: "§6.2 / §6.3"
  },
  {
    key: "aroma",
    label: "香气分量 Aroma Component",
    short_label: "香气",
    storage_field: "aroma_component",
    definition: "香气身份：干茶、汤香与杯底香里最有辨识度的那一层，负责「还没喝就知道是谁」",
    requirement: "干茶香气 / 汤香 / 杯底香（至少录入一项）",
    agent8_output: "taste_roles",
    evidence_refs: [
      "product.dry_leaf_aroma",
      "product.liquor_aroma",
      "product.hot_cup_aroma",
      "dna.flavor"
    ],
    spec_ref: "§6.2 / §6.3"
  },
  {
    key: "sweetness",
    label: "回甘分量 Sweetness Component",
    short_label: "回甘",
    storage_field: "sweetness_component",
    definition: "回甘与生津：甜不是入口那一下，而是喝完以后还在，这一层负责「余味说话」",
    requirement: "回甘 / 生津 / 甜度（至少录入一项）",
    agent8_output: "taste_roles",
    evidence_refs: [
      "product.huigan",
      "product.salivation",
      "product.sweetness",
      "dna.taste"
    ],
    spec_ref: "§6.2 / §6.3"
  },
  {
    key: "body",
    label: "汤感分量 Body Component",
    short_label: "汤感",
    storage_field: "body_component",
    definition: "汤感承担层：入口的厚度与浓度、中段不散，是后半程还能继续发力的前提",
    requirement: "厚度 / 粘稠度 / 水路 / 中段表现（至少录入一项）",
    agent8_output: "taste_roles",
    evidence_refs: [
      "product.thickness",
      "product.viscosity",
      "product.water_texture",
      "product.middle_stage",
      "product.raw_material",
      "dna.taste",
      "dna.architecture_signals"
    ],
    spec_ref: "§6.2 / §6.3"
  },
  {
    key: "finish",
    label: "收口分量 Finish Component",
    short_label: "收口",
    storage_field: "finish_component",
    definition: "收口层：中后段到尾水能不能立住，决定一泡茶有没有完整的收尾",
    requirement: "尾韵 / 后段 / 耐泡度 / 收口（至少录入一项）",
    agent8_output: "taste_roles",
    evidence_refs: [
      "product.finish",
      "product.late_stage",
      "product.endurance",
      "product.middle_stage",
      "dna.taste",
      "dna.architecture_signals"
    ],
    spec_ref: "§6.2 / §6.3"
  }
];

export const FORMULA_COMPONENT_META_BY_KEY = Object.fromEntries(
  FORMULA_COMPONENT_META.map((meta) => [meta.key, meta] as const)
) as Record<FormulaComponentKey, FormulaComponentMeta>;

export const FORMULA_COMPONENT_LABELS = Object.fromEntries(
  FORMULA_COMPONENT_META.map((meta) => [meta.key, meta.label] as const)
) as Record<FormulaComponentKey, string>;

export const FORMULA_COMPONENT_SHORT_LABELS = Object.fromEntries(
  FORMULA_COMPONENT_META.map((meta) => [meta.key, meta.short_label] as const)
) as Record<FormulaComponentKey, string>;

/** §57 验收口径：配方哲学必须能回答「没有比例时，能不能写出设计逻辑」。 */
export const FORMULA_PHILOSOPHY_ACCEPTANCE_QUESTION =
  "配方哲学必须能回答：没有具体配方比例时，不编比例且仍然写得出「设计逻辑」（§6.1 / §57）";

/* ---------------------------------------------------------- 下游交接 */

/**
 * 下游交接：已交付阶段不再登记（§60）。
 * 成交话术（Phase 12）与事实审核（Phase 14）均已交付，本清单为空；
 * 「本阶段只交付设计逻辑、不代写成交文案」仍写在合同的 `rules` 里。
 */
export const FORMULA_PHILOSOPHY_DOWNSTREAM: readonly CategoryDownstreamItem[] = [];

/** 供 API 自检与前端展示：五个分量、§46 五项输出与红线只从这里读取。 */
export const FORMULA_PHILOSOPHY_CONTRACT = {
  spec_ref: "§6 / §46",
  component_count: FORMULA_COMPONENT_COUNT,
  components: FORMULA_COMPONENT_META.map((meta) => ({
    key: meta.key,
    label: meta.label,
    short_label: meta.short_label,
    storage_field: meta.storage_field,
    definition: meta.definition,
    requirement: meta.requirement,
    agent8_output: meta.agent8_output,
    evidence_refs: meta.evidence_refs,
    spec_ref: meta.spec_ref
  })),
  agent8_outputs: FORMULA_PHILOSOPHY_AGENT8_OUTPUTS,
  acceptance: {
    spec_ref: "§57",
    question: FORMULA_PHILOSOPHY_ACCEPTANCE_QUESTION,
    min_written_components: FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy
  },
  limits: FORMULA_PHILOSOPHY_LIMITS,
  /** §6.1：没有确切比例绝对不创造比例，正文里也不得抄进比例字样 */
  no_fabricated_ratio: true,
  /** §46：没有某个原料绝对不新增原料 */
  no_new_ingredient: true,
  /** §6.2：没有比例时仍然要写出「先定骨架、再定香气、再定回甘」的设计逻辑 */
  design_logic_without_ratio: true,
  /** §11 / §62-7：事实不足的分量留空并写缺口，不用形容词补圆 */
  gap_stays_empty: true,
  /** §62-5：证据只引用本产品已录入字段与 Value DNA */
  evidence_only_from_own_product: true,
  /** §24 / §62-8：允许极强修辞，但修辞只说「各部分承担什么任务」，不能造事实 */
  rhetoric_allowed_for_roles_only: true,
  /** §6.2：允许「高级、强势、有设计感」的成交层表达，但它不得携带新事实 */
  sales_tone_allowed: true,
  downstream_phases: FORMULA_PHILOSOPHY_DOWNSTREAM,
  rules: [
    "五个分量与顺序由 §6.3 固定（backbone / aroma / sweetness / body / finish），不得增删或重排",
    "§6.1：没有确切配方比例时，绝对不创造比例；已录入事实里自带的百分比也不得抄进正文",
    "§46：没有某个原料时，绝对不新增原料；分量正文只能引用本产品已录入字段与 Value DNA",
    "§6.2：没有比例时仍然要输出「不是把料混起来，而是让每一类原料承担自己的任务」这一层设计逻辑",
    "事实不足的分量留空并写缺口，不得用形容词补圆（§11 / §62-7）",
    "已知比例（有证据）可以使用，但必须写明来源与逐字证据，不与未知比例混用（§6.1）",
    "允许极强修辞，但修辞只能描述「各部分承担什么任务」，不能造事实（§24 / §62-8）",
    "配方哲学是成交话术（Phase 12）的输入，本阶段只交付设计逻辑，不代写成交文案（§60）"
  ]
} as const;

/* ------------------------------------------------------------ API 对象 */

export const formulaComponentViewSchema = z
  .object({
    key: formulaComponentKeySchema,
    label: z.string(),
    short_label: z.string(),
    storage_field: z.string(),
    definition: z.string(),
    requirement: z.string(),
    agent8_output: z.string(),
    /** §6.3 的 JSONB 数组：一条正文对应一条已录入事实 */
    texts: z.array(z.string()),
    status: formulaComponentStatusSchema,
    /** §24 分层：分量是 INTERPRETATION；成交层解释另见 sales_explanation（RHETORIC） */
    layer: z.literal("INTERPRETATION"),
    /** 这几条正文引用了哪些字段（product.* / dna.*），可逐条回查 */
    evidence_refs: z.array(z.string()),
    /** 引用的已录入事实原文（ref=value），用于前端逐条对照 */
    citations: z.array(z.string()),
    /** 缺口说明；status=WRITTEN 时为 null */
    gap: z.string().nullable(),
    spec_ref: z.string()
  })
  .strict()
  .refine((component) => (component.status === "WRITTEN") === component.texts.length > 0, {
    message: "WRITTEN 分量必须有正文，GAP 分量必须留空（§11 / §62-7）",
    path: ["texts"]
  })
  .refine((component) => (component.status === "WRITTEN") === (component.gap === null), {
    message: "只有 GAP 分量携带缺口说明",
    path: ["gap"]
  });
export type FormulaComponentView = z.infer<typeof formulaComponentViewSchema>;

export const formulaComponentCountsSchema = z
  .object({
    written: z.number().int().nonnegative(),
    gap: z.number().int().nonnegative()
  })
  .strict();
export type FormulaComponentCounts = z.infer<typeof formulaComponentCountsSchema>;

/** §46 ingredient_roles：每条都能逐字回查到本产品已录入的原料 / 山头 / 用料。 */
export const formulaIngredientRoleSchema = z
  .object({
    ingredient: z.string(),
    role: z.string(),
    component: formulaComponentKeySchema,
    evidence_ref: z.string(),
    spec_ref: z.literal("§46")
  })
  .strict();
export type FormulaIngredientRole = z.infer<typeof formulaIngredientRoleSchema>;

/** §46 taste_roles：每条都能逐字回查到本产品已录入的感官表现。 */
export const formulaTasteRoleSchema = z
  .object({
    taste: z.string(),
    role: z.string(),
    component: formulaComponentKeySchema,
    evidence_ref: z.string(),
    spec_ref: z.literal("§46")
  })
  .strict();
export type FormulaTasteRole = z.infer<typeof formulaTasteRoleSchema>;

/**
 * 比例口径（§6.1 / §35.4）。
 *
 * `known_ratio=false` 时 `ratio_data` 必须为 null —— 这是「不得自动编比例」的机械保证；
 * `known_ratio=true` 时必须同时给出逐字证据与来源，避免「拿记忆里的配比当真事实」。
 */
export const formulaRatioSchema = z
  .object({
    known_ratio: z.boolean(),
    ratio_data: z.record(z.string(), z.string()).nullable(),
    /** 逐字证据：product.blend_description=布朗山 60%，易武 40% */
    ratio_evidence: z.array(z.string()),
    /** REQUEST / BLEND_DESCRIPTION；未确认比例时为 null */
    ratio_source: z.string().nullable(),
    spec_ref: z.literal("§6.1")
  })
  .strict()
  .refine((ratio) => ratio.known_ratio || ratio.ratio_data === null, {
    message: "known_ratio=false 时不得填写具体配方比例（§6.1）",
    path: ["ratio_data"]
  })
  .refine((ratio) => !ratio.known_ratio || ratio.ratio_evidence.length > 0, {
    message: "确认比例必须给出逐字证据，否则等同于编造（§6.1）",
    path: ["ratio_evidence"]
  })
  .refine((ratio) => !ratio.known_ratio || ratio.ratio_source !== null, {
    message: "确认比例必须写明来源（REQUEST / BLEND_DESCRIPTION）",
    path: ["ratio_source"]
  });
export type FormulaRatio = z.infer<typeof formulaRatioSchema>;

export const formulaPhilosophyAcceptanceSchema = z
  .object({
    spec_ref: z.literal("§57"),
    question: z.string(),
    /** 设计逻辑（formula_strategy）是否成稿 */
    design_logic_ready: z.boolean(),
    /** 没有比例时正文里是否干净：true 表示一个比例字样都没有 */
    no_fabricated_ratio: z.boolean(),
    written_components: z.number().int().nonnegative(),
    required_min_components: z.number().int().positive(),
    /** 五个分量是否全部写实（§6.3 覆盖度，不参与 §57 通过判定） */
    coverage_passed: z.boolean(),
    passed: z.boolean()
  })
  .strict();
export type FormulaPhilosophyAcceptance = z.infer<typeof formulaPhilosophyAcceptanceSchema>;

export const formulaPhilosophyRecordSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    version: z.number().int().positive(),
    /** 生成当时的模式（§17，复用锚点引擎口径，仅作上下文，不作为产品事实） */
    preference: z.string(),
    mode: z.string(),
    resolved_by: z.string(),
    mode_reason: z.string(),
    /** 五个分量（§6.3 固定顺序） */
    components: z.array(formulaComponentViewSchema).length(FORMULA_COMPONENT_COUNT),
    /** §35.4 的存储形状：五个数组 + formula_strategy + design_goal + known_ratio 的扁平快照 */
    formula: formulaPhilosophySchema,
    /** §46 formula_strategy（设计逻辑正文）；不足 2 个写实分量时为 "" */
    formula_strategy: z.string(),
    /** §46 ingredient_roles：原料 / 山头 / 用料的角色分工 */
    ingredient_roles: z.array(formulaIngredientRoleSchema),
    /** §46 taste_roles：感官表现落在哪一层 */
    taste_roles: z.array(formulaTasteRoleSchema),
    /** §6.2 design_goal：先定骨架、再定香气、再定回甘的次序 */
    design_goal: z.string(),
    /** §46 sales_explanation（RHETORIC 层，不得携带新事实） */
    sales_explanation: z.string(),
    ratio: formulaRatioSchema,
    component_counts: formulaComponentCountsSchema,
    acceptance: formulaPhilosophyAcceptanceSchema,
    /** §57：没有比例时也能写到设计逻辑，这一位为 true */
    design_logic_ready: z.boolean(),
    /** Phase 10 产品结构上下文（只读引用，不当作本产品事实） */
    architecture_version: z.number().int().positive().nullable(),
    architecture_acceptance_passed: z.boolean().nullable(),
    evidence_gaps: z.array(z.string()),
    evidence_refs: z.array(z.string()),
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
    spec_ref: z.literal("§6 / §46")
  })
  .strict()
  .refine((record) => record.design_logic_ready === (record.formula_strategy.trim().length > 0), {
    message: "design_logic_ready 必须与 design_goal / formula_strategy 同口径（§6.2 / §57）",
    path: ["design_logic_ready"]
  })
  .refine((record) => (record.formula_strategy.trim().length > 0) === (record.design_goal.trim().length > 0), {
    message: "formula_strategy 与 design_goal 同成立：没有设计逻辑就不给设计目标（§6.2）",
    path: ["design_goal"]
  });
export type FormulaPhilosophyRecordView = z.infer<typeof formulaPhilosophyRecordSchema>;

export const formulaPhilosophyVersionSummarySchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    written_components: z.number().int().nonnegative(),
    texts_total: z.number().int().nonnegative(),
    known_ratio: z.boolean(),
    design_logic_ready: z.boolean(),
    acceptance_passed: z.boolean(),
    is_confirmed: z.boolean(),
    created_at: z.string()
  })
  .strict();
export type FormulaPhilosophyVersionSummary = z.infer<typeof formulaPhilosophyVersionSummarySchema>;

export const formulaPhilosophyArchitectureRefSchema = z
  .object({
    version: z.number().int().positive(),
    written_roles: z.number().int().nonnegative(),
    acceptance_passed: z.boolean()
  })
  .strict();
export type FormulaPhilosophyArchitectureRef = z.infer<typeof formulaPhilosophyArchitectureRefSchema>;

export const formulaPhilosophyOverviewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    preference: z.string(),
    mode: z.string(),
    resolved_by: z.string(),
    mode_reason: z.string(),
    can_generate: z.boolean(),
    block_reason: z.string().nullable(),
    record: formulaPhilosophyRecordSchema.nullable(),
    versions: z.array(formulaPhilosophyVersionSummarySchema),
    /** 还没写实的分量（用于「配方哲学」页排产） */
    missing_components: z.array(formulaComponentKeySchema),
    /** Phase 10 产品结构：配方哲学的输入，未生成时提示先跑产品结构 */
    architecture: formulaPhilosophyArchitectureRefSchema.nullable(),
    spec_ref: z.literal("§6 / §46")
  })
  .strict();
export type FormulaPhilosophyOverview = z.infer<typeof formulaPhilosophyOverviewSchema>;

/** 「配方哲学」跨产品列表行：只做检索与排产，不改写任何产品事实。 */
export const formulaPhilosophyMatrixRowSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    year: z.number().int(),
    tea_type: z.string(),
    mountain: z.string().nullable(),
    mode: z.string(),
    preference: z.string(),
    record_id: z.string().uuid().nullable(),
    version: z.number().int().positive().nullable(),
    is_confirmed: z.boolean(),
    written_components: z.number().int().nonnegative(),
    gap_components: z.number().int().nonnegative(),
    texts_total: z.number().int().nonnegative(),
    known_ratio: z.boolean(),
    design_logic_ready: z.boolean(),
    acceptance_passed: z.boolean(),
    /** 设计逻辑正文（未生成时为 null） */
    formula_strategy: z.string().nullable(),
    generated_at: z.string().nullable(),
    spec_ref: z.literal("§6 / §46")
  })
  .strict();
export type FormulaPhilosophyMatrixRow = z.infer<typeof formulaPhilosophyMatrixRowSchema>;

export const formulaPhilosophyGenerateSchema = z
  .object({
    notes: z.string().trim().max(2000).optional(),
    /**
     * 已确认的比例（可选）。只有每个原料都能在本产品已录入字段里逐字查到才接受，
     * 否则服务层直接 400：宁可没有比例，也不能编一个（§6.1 / §46）。
     */
    ratio_data: z.record(z.string(), z.union([z.string(), z.number()])).nullable().optional()
  })
  .strict();
export type FormulaPhilosophyGenerateInput = z.infer<typeof formulaPhilosophyGenerateSchema>;

export const formulaPhilosophyUpdateSchema = z
  .object({
    is_confirmed: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type FormulaPhilosophyUpdateInput = z.infer<typeof formulaPhilosophyUpdateSchema>;

export const formulaPhilosophySortSchema = z.enum([
  "-updated_at",
  "updated_at",
  "product_name",
  "-product_name",
  "-written_components",
  "-gap_components"
]);
export type FormulaPhilosophySort = z.infer<typeof formulaPhilosophySortSchema>;

export const formulaPhilosophyListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(FORMULA_PHILOSOPHY_LIMITS.maxPageSize).optional(),
    product_id: z.string().uuid().optional(),
    component: formulaComponentKeySchema.optional(),
    /**
     * 只看已确认比例 / 只看没有比例。
     *
     * 查询串是字符串：这里必须用 `stringbool`。
     * `z.coerce.boolean()` 会把 `"false"` 也变成 true，导致前端「只看未确认比例」直接返回相反的一批产品
     * （与 Phase 6 价格列表同一处理，见 `packages/schemas/src/price.ts`）。
     */
    known_ratio: z.stringbool().optional(),
    /** 只看还没生成配方哲学的产品 */
    missing: z.stringbool().optional(),
    /**
     * §17 已解析模式：与 `AnchorsService.resolveMode` 同口径（同一组阈值常量），
     * 用于跨产品「最近要优先讲哪些茶」的排产式检索，不参与任何打分。
     */
    mode: resolvedResearchModeSchema.optional(),
    q: z.string().trim().max(200).optional(),
    sort: formulaPhilosophySortSchema.optional()
  })
  .strict();
export type FormulaPhilosophyListQuery = z.infer<typeof formulaPhilosophyListQuerySchema>;

/* ------------------------------------------------------------ 纯函数构建器 */

/**
 * 产品侧输入：字段口径与产品结构（§5 / §45）一致，
 * 这样配方哲学与产品结构引用的是同一份已录入事实，不会出现两套事实。
 */
export interface FormulaPhilosophyProductInput extends CategoryStandardProductInput {
  brand_name: string | null;
  liquor_aroma: string | null;
  viscosity: string | null;
  water_texture: string | null;
  finish: string | null;
  harvest_standard: string | null;
  fermentation_degree: string | null;
  fermentation_method: string | null;
  storage: string | null;
}

export interface FormulaPhilosophyFactHit {
  /** 事实来源字段路径，例如 product.mountain / dna.origin */
  ref: string;
  value: string;
}

export interface FormulaPhilosophyRatioInput {
  known_ratio: boolean;
  ratio_data: Record<string, string> | null;
  ratio_source: "REQUEST" | "BLEND_DESCRIPTION" | null;
  ratio_evidence: string[];
}

export interface FormulaPhilosophyBuildInput {
  product: FormulaPhilosophyProductInput;
  /** §9 Value DNA；未生成时传 null（11 维全空同样视同未生成） */
  value_dna: ValueDna | null;
  /** §6.1 比例口径：由 `resolveFormulaRatio()` 判定，本层不再自行编比例 */
  ratio: FormulaPhilosophyRatioInput;
  /** Phase 10 产品结构：只作上下文与缺口提示，不作为本产品事实 */
  architecture?: FormulaPhilosophyArchitectureRef | null;
}

export interface FormulaPhilosophyDraft {
  components: FormulaComponentView[];
  formula: FormulaPhilosophy;
  formula_strategy: string;
  ingredient_roles: FormulaIngredientRole[];
  taste_roles: FormulaTasteRole[];
  design_goal: string;
  sales_explanation: string;
  ratio: FormulaRatio;
  component_counts: FormulaComponentCounts;
  acceptance: FormulaPhilosophyAcceptance;
  design_logic_ready: boolean;
  evidence_gaps: string[];
  evidence_refs: string[];
  fact_refs: string[];
  value_dna_refs: string[];
}

/**
 * 只认「本产品已录入字段」这张白名单：没在这里列出的字段路径一律取不到值，
 * 因此不可能把对标产品、模型记忆或补写内容当成配方事实（§6.1 / §46 / §62-5）。
 */
const FORMULA_FACT_FIELDS: Record<string, keyof FormulaPhilosophyProductInput> = {
  "product.product_name": "product_name",
  "product.series_name": "series_name",
  "product.tea_type": "tea_type",
  "product.tea_subtype": "tea_subtype",
  "product.origin_province": "origin_province",
  "product.origin_city": "origin_city",
  "product.origin_region": "origin_region",
  "product.mountain": "mountain",
  "product.village": "village",
  "product.raw_material": "raw_material",
  "product.tree_type": "tree_type",
  "product.tree_age": "tree_age",
  "product.season": "season",
  "product.grade": "grade",
  "product.blend_description": "blend_description",
  "product.kill_green_method": "kill_green_method",
  "product.rolling_method": "rolling_method",
  "product.drying_method": "drying_method",
  "product.pressing_method": "pressing_method",
  "product.processing_notes": "processing_notes",
  "product.dry_leaf_aroma": "dry_leaf_aroma",
  "product.hot_cup_aroma": "hot_cup_aroma",
  "product.liquor_aroma": "liquor_aroma",
  "product.entry_taste": "entry_taste",
  "product.bitterness": "bitterness",
  "product.astringency": "astringency",
  "product.sweetness": "sweetness",
  "product.huigan": "huigan",
  "product.salivation": "salivation",
  "product.cha_qi": "cha_qi",
  "product.thickness": "thickness",
  "product.early_stage": "early_stage",
  "product.middle_stage": "middle_stage",
  "product.late_stage": "late_stage",
  "product.endurance": "endurance",
  "product.finish": "finish",
  "product.viscosity": "viscosity",
  "product.water_texture": "water_texture",
  "product.harvest_standard": "harvest_standard",
  "product.fermentation_degree": "fermentation_degree",
  "product.fermentation_method": "fermentation_method",
  "product.storage": "storage",
  "product.brand_name": "brand_name"
};

/**
 * 「原料类」字段：只有这些字段里的词才算原料 / 山头 / 用料（§10.2 原料 / §6.1 已知配方事实）。
 * 比例里的每一个名字都必须能在这里逐字查到，否则就是新增原料（§46 红线）。
 */
export const FORMULA_INGREDIENT_FIELDS: readonly string[] = [
  "product.mountain",
  "product.village",
  "product.origin_region",
  "product.origin_city",
  "product.origin_province",
  "product.raw_material",
  "product.tree_type",
  "product.tree_age",
  "product.season",
  "product.grade",
  "product.blend_description",
  "product.harvest_standard",
  "dna.origin",
  "dna.material"
];

const FORMULA_INGREDIENT_FIELD_SET = new Set(FORMULA_INGREDIENT_FIELDS);

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 按字段路径回查本产品已录入事实；取不到就是没录，绝不补全。 */
export function formulaPhilosophyFactValue(
  product: FormulaPhilosophyProductInput,
  ref: string
): string | null {
  const field = FORMULA_FACT_FIELDS[ref];
  return field ? trimToNull(product[field]) : null;
}

/** Value DNA 只在通过 §9 schema 且至少一维有内容时参与配方哲学（与产品结构同一口径）。 */
function usableValueDna(value_dna: ValueDna | null): ValueDna | null {
  if (!value_dna) {
    return null;
  }
  const hasContent = VALUE_DNA_DIMENSIONS.some((dimension) => (value_dna[dimension]?.length ?? 0) > 0);
  return hasContent ? value_dna : null;
}

/**
 * 一段文字里是否出现比例字样（§6.1）。
 *
 * 覆盖三种写法：`60%` / `百分之六十` / `占比`。
 * 没有具体比例时，生成的正文里只要出现任何一个，都算「编了比例」。
 */
export function containsRatioExpression(text: string): boolean {
  if (!text) {
    return false;
  }
  if (/\d+(?:\.\d+)?\s*%/.test(text)) {
    return true;
  }
  if (/百分之\s*[0-9０-９一二三四五六七八九十百]/.test(text)) {
    return true;
  }
  return text.includes("占比");
}

/** §6.3 扁平快照 → 某个分量的正文数组；读取与生成共用同一张映射。 */
export function formulaComponentTextsOf(
  formula: FormulaPhilosophy,
  key: FormulaComponentKey
): string[] {
  switch (key) {
    case "backbone":
      return formula.backbone_component;
    case "aroma":
      return formula.aroma_component;
    case "sweetness":
      return formula.sweetness_component;
    case "body":
      return formula.body_component;
    case "finish":
      return formula.finish_component;
  }
}

/** 一版配方哲学里所有正文（分量 + 设计逻辑 + 成交层解释）是否夹带了比例字样。 */
export function formulaPhilosophyTextsContainRatio(
  formula: FormulaPhilosophy,
  extraTexts: readonly string[] = []
): boolean {
  const texts = [
    ...formulaComponentKeys.flatMap((key) => formulaComponentTextsOf(formula, key)),
    formula.formula_strategy,
    formula.design_goal,
    ...extraTexts
  ];
  return texts.some((text) => containsRatioExpression(text));
}

/**
 * 确认比例的证据校验（§6.1 / §46）：
 * 每个原料名都必须能在「原料类」已录入字段里**逐字**查到，查不到就是新增原料，直接拒绝。
 */
export function validateRatioEvidence(
  product: FormulaPhilosophyProductInput,
  ratioData: Record<string, string | number>
): { problems: string[]; evidence: string[] } {
  const problems: string[] = [];
  const evidence: string[] = [];
  const entries = Object.entries(ratioData).filter(
    ([name, value]) => name.trim().length > 0 && String(value).trim().length > 0
  );
  if (entries.length === 0) {
    problems.push("比例里没有任何有效条目：要么给出完整配比，要么不填（§6.1）");
    return { problems, evidence };
  }
  if (entries.length > FORMULA_PHILOSOPHY_LIMITS.maxRatioEntries) {
    problems.push(
      `比例条目最多 ${FORMULA_PHILOSOPHY_LIMITS.maxRatioEntries} 项，当前 ${entries.length} 项（§6.1）`
    );
  }
  for (const [name, value] of entries) {
    const trimmedName = name.trim();
    const ref = FORMULA_INGREDIENT_FIELDS.find((candidate) => {
      const fact = formulaPhilosophyFactValue(product, candidate);
      return fact !== null && fact.includes(trimmedName);
    });
    if (!ref) {
      problems.push(
        `比例里的「${trimmedName}」在本产品已录入的原料 / 山头 / 用料里逐字查不到：不得新增原料（§6.1 / §46）`
      );
      continue;
    }
    evidence.push(`${ref}=${formulaPhilosophyFactValue(product, ref) ?? ""}`);
    if (!String(value).trim()) {
      problems.push(`比例里的「${trimmedName}」没有给出数值（§6.1）`);
    }
  }
  return { problems: [...new Set(problems)], evidence: [...new Set(evidence)] };
}

function normalizeRatioValue(value: string | number): string {
  const raw = String(value).trim();
  if (!raw) {
    return "";
  }
  if (raw.includes("%") || raw.includes("百分之") || raw.includes("份")) {
    return raw;
  }
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return `${numeric}%`;
  }
  return raw;
}

/** 拼配描述里的名字在前写法：`布朗山 60%` */
const RATIO_NAME_FIRST = /([^\s，,、；;：:+＋和与/（）()0-9０-９]+?)\s*(\d+(?:\.\d+)?)\s*%/g;
/** 拼配描述里的百分比在前写法：`60% 的易武` */
const RATIO_PERCENT_FIRST = /(\d+(?:\.\d+)?)\s*%\s*(?:的)?\s*([^\s，,、；;：:+＋和与/（）()0-9０-９]+)/g;

/**
 * 从已录入的拼配描述里识别**已经写明**的比例（§6.1 已知配方事实）。
 *
 * 只有「至少两个原料 + 每个原料都能在原料类字段里逐字查到」才算一条可用比例；
 * 出现一个 60% 但没有第二项时不算配比，走「未知比例」分支（不编）。
 */
export function extractRatioFromBlendDescription(
  product: FormulaPhilosophyProductInput
): { ratio_data: Record<string, string>; ratio_evidence: string[]; ref: string } | null {
  for (const ref of ["product.blend_description", "product.raw_material"]) {
    const description = formulaPhilosophyFactValue(product, ref);
    if (!description) {
      continue;
    }
    const entries: [string, string][] = [];
    for (const match of description.matchAll(RATIO_NAME_FIRST)) {
      const name = match[1]?.trim();
      const value = match[2]?.trim();
      if (name && value) {
        entries.push([name, `${value}%`]);
      }
    }
    for (const match of description.matchAll(RATIO_PERCENT_FIRST)) {
      const value = match[1]?.trim();
      const name = match[2]?.trim();
      if (name && value && !entries.some(([existing]) => existing === name)) {
        entries.push([name, `${value}%`]);
      }
    }
    const usable = entries.filter(([name]) =>
      FORMULA_INGREDIENT_FIELDS.some((candidate) => {
        if (candidate === ref) {
          return true;
        }
        const fact = formulaPhilosophyFactValue(product, candidate);
        return fact !== null && fact.includes(name);
      })
    );
    if (usable.length < 2) {
      continue;
    }
    return {
      ratio_data: Object.fromEntries(
        usable.slice(0, FORMULA_PHILOSOPHY_LIMITS.maxRatioEntries)
      ),
      ratio_evidence: [`${ref}=${description}`],
      ref
    };
  }
  return null;
}

export interface FormulaRatioResolution {
  ratio: FormulaPhilosophyRatioInput;
  /** 非空表示请求里的比例不可用（服务层直接 400：宁可没有比例，也不能编） */
  problems: string[];
}

/**
 * §6.1 的比例口径判定，生成与接口校验共用一个入口。
 *
 * 优先级：人工登记的 `ratio_data`（必须有逐字证据）> 拼配描述里已写明的配比 > 未确认比例。
 * 无论走哪条分支，**都不会自己造一个比例**：没有就是没有，正文里也不出现比例字样。
 */
export function resolveFormulaRatio(
  product: FormulaPhilosophyProductInput,
  requested?: Record<string, string | number> | null
): FormulaRatioResolution {
  const entries = Object.entries(requested ?? {}).filter(
    ([name, value]) => name.trim().length > 0 && String(value).trim().length > 0
  );

  if (entries.length > 0) {
    const { problems, evidence } = validateRatioEvidence(product, requested ?? {});
    if (problems.length > 0) {
      return {
        ratio: { known_ratio: false, ratio_data: null, ratio_source: null, ratio_evidence: [] },
        problems
      };
    }
    return {
      ratio: {
        known_ratio: true,
        ratio_data: Object.fromEntries(
          entries.map(([name, value]) => [name.trim(), normalizeRatioValue(value)])
        ),
        ratio_source: "REQUEST",
        ratio_evidence: evidence
      },
      problems: []
    };
  }

  const detected = extractRatioFromBlendDescription(product);
  if (detected) {
    return {
      ratio: {
        known_ratio: true,
        ratio_data: detected.ratio_data,
        ratio_source: "BLEND_DESCRIPTION",
        ratio_evidence: detected.ratio_evidence
      },
      problems: []
    };
  }

  return {
    ratio: { known_ratio: false, ratio_data: null, ratio_source: null, ratio_evidence: [] },
    problems: []
  };
}

/**
 * 分量取事实：只从白名单字段与 Value DNA 取值。
 *
 * `known_ratio=false` 时**额外丢掉带比例字样的已录入事实**（含 DNA）：
 * 否则「拼配描述写着 60%」会被原样抄进正文，变成「嘴上说不编比例、正文里全是比例」（§6.1）。
 */
function componentHits(
  product: FormulaPhilosophyProductInput,
  dna: ValueDna | null,
  meta: FormulaComponentMeta,
  knownRatio: boolean
): FormulaPhilosophyFactHit[] {
  const hits: FormulaPhilosophyFactHit[] = [];
  let dnaHits = 0;
  const push = (ref: string, value: string): void => {
    if (!knownRatio && containsRatioExpression(value)) {
      return;
    }
    hits.push({ ref, value });
  };
  for (const ref of meta.evidence_refs) {
    if (ref.startsWith("dna.")) {
      const dimension = ref.slice(4);
      if (!(VALUE_DNA_DIMENSIONS as readonly string[]).includes(dimension)) {
        continue;
      }
      const values = dna?.[dimension as ValueDnaDimension] ?? [];
      for (const value of values) {
        // 上限按「分量」而不是「单个维度」计：否则一个分量挂两个维度就能被 DNA 刷满。
        if (dnaHits >= FORMULA_PHILOSOPHY_LIMITS.maxDnaRefsPerComponent) {
          break;
        }
        const trimmed = value.trim();
        if (trimmed) {
          push(ref, trimmed);
          dnaHits += 1;
        }
      }
      continue;
    }
    const value = formulaPhilosophyFactValue(product, ref);
    if (value) {
      push(ref, value);
    }
  }
  return hits;
}

/** 每个分量最多两条正文：一条主任务，一条补充，避免分量被同一层事实刷满。 */
const MAX_TEXTS_PER_COMPONENT = 2;

function componentSentence(key: FormulaComponentKey, value: string): string {
  switch (key) {
    case "backbone":
      return `骨架由 ${value} 定下来：先把这一层立住，香气、汤感与回甘才有地方挂。`;
    case "aroma":
      return `${value} 是这一层的香气身份：还没下水，判断就已经开始。`;
    case "sweetness":
      return `回甘与生津由 ${value} 撑起来：甜不是靠说的，是喝完以后还在。`;
    case "body":
      return `${value} 负责汤感：入口的厚度与浓度是它给的，中段不散也是它的事。`;
    case "finish":
      return `收口由 ${value} 负责：中后段到尾水能不能立住，靠的是这一段事实，而不是一句形容词。`;
  }
}

/** 事实不足时写什么：缺口必须指回具体字段，供研究员补齐，绝不留一句「待补充」。 */
export function formulaPhilosophyGapReason(meta: FormulaComponentMeta): string {
  return `未录入相关事实，先补：${meta.requirement}（字段 ${meta.evidence_refs
    .filter((ref) => !ref.startsWith("dna."))
    .join(" / ")}，§6.3 / §46）`;
}

/**
 * 缺口清单（§6.1 / §6.2 / §57）：**生成侧与回看侧共用同一个口径**。
 *
 * 顺序固定为：GAP 分量 → 写实不足 → 未确认比例 → 拼配描述里的比例字样 → 产品结构 → Value DNA；
 * 这样「刚生成时看到的缺口」和「回看这一版时的缺口」逐条一致，不会因为两处各写一遍而漂移。
 */
export function formulaPhilosophyEvidenceGaps(params: {
  formula: FormulaPhilosophy;
  product: FormulaPhilosophyProductInput;
  dna: ValueDna | null;
  architecture?: FormulaPhilosophyArchitectureRef | null;
}): string[] {
  const { formula, product, dna, architecture } = params;
  const summary = formulaPhilosophySummary(formula);
  const gaps = summary.gap_component_keys.map((key) => {
    const meta = FORMULA_COMPONENT_META_BY_KEY[key];
    return `${meta.short_label}：${formulaPhilosophyGapReason(meta)}`;
  });
  if (summary.written_components < FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy) {
    gaps.push(
      `写实的分量只有 ${summary.written_components} 个，不足 ${
        FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy
      } 个：先补齐${FORMULA_COMPONENT_META.map((meta) => meta.short_label).join(" / ")}里的事实，再谈「这款茶是怎么设计的」（§6.2 / §57）`
    );
  }
  if (!summary.known_ratio) {
    gaps.push(
      "未确认配方比例（§6.1）：本版正文与设计逻辑一律不出现比例；比例只能来自已录入事实或人工登记，绝不自动编"
    );
    const blendDescription = formulaPhilosophyFactValue(product, "product.blend_description");
    if (blendDescription && containsRatioExpression(blendDescription)) {
      gaps.push(
        "拼配描述里出现了比例字样，但不足以构成完整配比：已按「未知比例」处理，正文不引用它；要使用比例请登记完整的 `ratio_data`（§6.1）"
      );
    }
  }
  if (!architecture) {
    gaps.push(
      "尚未生成产品结构（§5 / §45）：配方哲学的骨架与汤感通常来自产品结构，建议先在「产品结构」里生成一版"
    );
  } else if (!architecture.acceptance_passed) {
    gaps.push(
      `产品结构第 ${architecture.version} 版的 §57 验收尚未通过：配方哲学可以照常生成，但下游成交话术仍会标记结构缺口`
    );
  }
  if (!dna) {
    gaps.push("尚未生成价值 DNA（§9）：香气与滋味只能从录入字段直接取，覆盖面会偏窄");
  }
  return gaps;
}

interface ComponentDraft {
  texts: string[];
  hits: FormulaPhilosophyFactHit[];
  gap: string | null;
}

function buildComponentDraft(
  meta: FormulaComponentMeta,
  product: FormulaPhilosophyProductInput,
  dna: ValueDna | null,
  knownRatio: boolean
): ComponentDraft {
  const hits = componentHits(product, dna, meta, knownRatio);
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (texts.length >= MAX_TEXTS_PER_COMPONENT) {
      break;
    }
    if (seen.has(hit.value)) {
      continue;
    }
    seen.add(hit.value);
    texts.push(componentSentence(meta.key, hit.value));
  }
  if (texts.length === 0) {
    return { texts: [], hits: [], gap: formulaPhilosophyGapReason(meta) };
  }
  return { texts, hits, gap: null };
}

/** 只认「逐字写进正文」的事实才算引用，避免出现假引用（§6.1 / §46）。 */
function usedHits(draft: ComponentDraft): FormulaPhilosophyFactHit[] {
  if (draft.texts.length === 0) {
    return [];
  }
  const joined = draft.texts.join("\n");
  const used: FormulaPhilosophyFactHit[] = [];
  const seen = new Set<string>();
  let dnaHits = 0;
  for (const hit of draft.hits) {
    if (!joined.includes(hit.value)) {
      continue;
    }
    const citation = `${hit.ref}=${hit.value}`;
    if (seen.has(citation)) {
      continue;
    }
    if (hit.ref.startsWith("dna.")) {
      if (dnaHits >= FORMULA_PHILOSOPHY_LIMITS.maxDnaRefsPerComponent) {
        continue;
      }
      dnaHits += 1;
    }
    seen.add(citation);
    used.push(hit);
  }
  return used;
}

function toComponentView(
  meta: FormulaComponentMeta,
  draft: ComponentDraft
): FormulaComponentView {
  const cited = usedHits(draft);
  return formulaComponentViewSchema.parse({
    key: meta.key,
    label: meta.label,
    short_label: meta.short_label,
    storage_field: meta.storage_field,
    definition: meta.definition,
    requirement: meta.requirement,
    agent8_output: meta.agent8_output,
    texts: draft.texts,
    status: draft.texts.length > 0 ? "WRITTEN" : "GAP",
    layer: "INTERPRETATION",
    evidence_refs: [...new Set(cited.map((hit) => hit.ref))],
    citations: cited.map((hit) => `${hit.ref}=${hit.value}`),
    gap: draft.gap,
    spec_ref: meta.spec_ref
  });
}

/**
 * §46 的 ingredient_roles / taste_roles：由分量引用反推，因此不会多出一个原料。
 *
 * 每条都带 `evidence_ref`，前端可以逐条点回本产品已录入字段（§6.1 / §62-5）。
 */
export function formulaPhilosophyRoles(
  component: FormulaComponentKey,
  citations: readonly string[]
): { ingredient_roles: FormulaIngredientRole[]; taste_roles: FormulaTasteRole[] } {
  const meta = FORMULA_COMPONENT_META_BY_KEY[component];
  const ingredient_roles: FormulaIngredientRole[] = [];
  const taste_roles: FormulaTasteRole[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const index = citation.indexOf("=");
    if (index < 0) {
      continue;
    }
    const ref = citation.slice(0, index);
    const value = citation.slice(index + 1);
    if (!value || seen.has(`${ref}=${value}`)) {
      continue;
    }
    seen.add(`${ref}=${value}`);
    if (FORMULA_INGREDIENT_FIELD_SET.has(ref)) {
      ingredient_roles.push({
        ingredient: value,
        role: `${value}在这一层承担${meta.short_label}的任务`,
        component,
        evidence_ref: ref,
        spec_ref: "§46"
      });
      continue;
    }
    taste_roles.push({
      taste: value,
      role: `${value}是${meta.short_label}这一层的表现`,
      component,
      evidence_ref: ref,
      spec_ref: "§46"
    });
  }
  return { ingredient_roles, taste_roles };
}

function joinPhrases(entries: readonly { short_label: string; value: string }[]): string {
  return entries.map((entry) => `${entry.value} 承担 ${entry.short_label}`).join("；");
}

function ratioSourceLabel(source: string | null): string {
  switch (source) {
    case "REQUEST":
      return "产品负责人登记";
    case "BLEND_DESCRIPTION":
      return "已录入的拼配描述";
    default:
      return "已录入事实";
  }
}

function ratioText(ratioData: Record<string, string>): string {
  return Object.entries(ratioData)
    .map(([name, value]) => `${name} ${value}`)
    .join("、");
}

/**
 * 从已录入事实 + Value DNA 推导配方哲学（§6 Formula Philosophy / §46 Agent 8）。
 *
 * 纯函数：不读数据库、不调用 AI、不做任何推断性补全。
 * 没有具体比例时输出的是「设计逻辑 + 缺口清单」，而不是一个编出来的配比；
 * 五个分量只引用本产品已录入字段，因此不可能凭空出现原料或比例（§6.1 / §46）。
 */
export function buildFormulaPhilosophy(input: FormulaPhilosophyBuildInput): FormulaPhilosophyDraft {
  const dna = usableValueDna(input.value_dna);
  const knownRatio = input.ratio.known_ratio;

  const drafts = FORMULA_COMPONENT_META.map((meta) => ({
    meta,
    draft: buildComponentDraft(meta, input.product, dna, knownRatio)
  }));
  const components = drafts.map((item) => toComponentView(item.meta, item.draft));
  const written = drafts.filter((item) => item.draft.texts.length > 0);

  const roleEntries = written.map((item) => ({
    short_label: item.meta.short_label,
    value: usedHits(item.draft)[0]?.value ?? item.draft.texts[0] ?? ""
  }));
  const ingredient_roles: FormulaIngredientRole[] = [];
  const taste_roles: FormulaTasteRole[] = [];
  for (const component of components) {
    const roles = formulaPhilosophyRoles(component.key, component.citations);
    ingredient_roles.push(...roles.ingredient_roles);
    taste_roles.push(...roles.taste_roles);
  }

  const designLogicReady = written.length >= FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy;
  const phrases = joinPhrases(roleEntries);
  const formulaStrategy = designLogicReady
    ? `${
        knownRatio && input.ratio.ratio_data
          ? `已确认的配方比例是 ${ratioText(input.ratio.ratio_data)}（来源：${ratioSourceLabel(
              input.ratio.ratio_source
            )}）。`
          : ""
      }真正高级的拼配，不是把几种料混在一起，而是让每一类原料承担自己的任务：${phrases}。这款茶不是靠堆原料成立的，而是靠分工。`
    : "";
  const designGoal = designLogicReady
    ? `这款茶的产品逻辑是先定骨架、再定香气、再定回甘，再让每一部分围绕同一个风格目标服务。当前的次序是：${formulaComponentKeys
        .map((key) => FORMULA_COMPONENT_SHORT_LABELS[key])
        .join(" → ")}；这一版里已经写实的是：${written
        .map((item) => item.meta.short_label)
        .join("、")}。`
    : "";
  const salesExplanation = designLogicReady
    ? `这款茶的价值不在原料表，而在设计逻辑：${phrases}。同样的料，换一种拼法就只是一堆原料；这一版每一部分都有自己的任务，所以它站在更高的位置上。`
    : "";

  const formula = formulaPhilosophySchema.parse({
    formula_strategy: formulaStrategy,
    backbone_component: components.find((component) => component.key === "backbone")?.texts ?? [],
    aroma_component: components.find((component) => component.key === "aroma")?.texts ?? [],
    sweetness_component: components.find((component) => component.key === "sweetness")?.texts ?? [],
    body_component: components.find((component) => component.key === "body")?.texts ?? [],
    finish_component: components.find((component) => component.key === "finish")?.texts ?? [],
    design_goal: designGoal,
    known_ratio: knownRatio,
    ratio_data: knownRatio ? input.ratio.ratio_data : null
  });

  const ratio = formulaRatioSchema.parse({
    known_ratio: knownRatio,
    ratio_data: knownRatio ? input.ratio.ratio_data : null,
    ratio_evidence: knownRatio ? input.ratio.ratio_evidence : [],
    ratio_source: knownRatio ? input.ratio.ratio_source : null,
    spec_ref: "§6.1"
  });

  const summary = formulaPhilosophySummary(formula);
  const acceptance = formulaPhilosophyAcceptance(formula, [salesExplanation]);
  const componentCounts = formulaComponentCountsSchema.parse({
    written: summary.written_components,
    gap: FORMULA_COMPONENT_COUNT - summary.written_components
  });

  const evidenceGaps = formulaPhilosophyEvidenceGaps({
    formula,
    product: input.product,
    dna,
    architecture: input.architecture
  });

  const evidenceRefs = [...new Set(components.flatMap((component) => component.evidence_refs))];

  return {
    components,
    formula,
    formula_strategy: formulaStrategy,
    ingredient_roles,
    taste_roles,
    design_goal: designGoal,
    sales_explanation: salesExplanation,
    ratio,
    component_counts: componentCounts,
    acceptance,
    design_logic_ready: designLogicReady,
    evidence_gaps: evidenceGaps,
    evidence_refs: evidenceRefs,
    fact_refs: evidenceRefs.filter((ref) => ref.startsWith("product.")),
    value_dna_refs: evidenceRefs.filter((ref) => ref.startsWith("dna."))
  };
}

/**
 * 从 §6.3 扁平快照得出「写实了几个分量 / 哪些分量仍是 GAP / 设计逻辑是否成稿」。
 *
 * 生成、读取既有版本、以及下游的价值叙事（Phase 9 的配方哲学故事）都走这一个口径，
 * 避免两处各写一份判定导致「配方哲学说齐了、故事说缺」这种漂移（§6.2 / §57）。
 */
export function formulaPhilosophySummary(formula: FormulaPhilosophy): {
  written_components: number;
  written_component_keys: FormulaComponentKey[];
  gap_component_keys: FormulaComponentKey[];
  gap_component_labels: string[];
  texts_total: number;
  design_logic_ready: boolean;
  known_ratio: boolean;
  ratio_data: Record<string, string> | null;
  strategy: string;
} {
  const writtenKeys: FormulaComponentKey[] = [];
  const gapKeys: FormulaComponentKey[] = [];
  let textsTotal = 0;
  for (const key of formulaComponentKeys) {
    const texts = formulaComponentTextsOf(formula, key).filter((text) => text.trim().length > 0);
    textsTotal += texts.length;
    if (texts.length > 0) {
      writtenKeys.push(key);
    } else {
      gapKeys.push(key);
    }
  }
  return {
    written_components: writtenKeys.length,
    written_component_keys: writtenKeys,
    gap_component_keys: gapKeys,
    gap_component_labels: gapKeys.map((key) => FORMULA_COMPONENT_SHORT_LABELS[key]),
    texts_total: textsTotal,
    design_logic_ready: formula.formula_strategy.trim().length > 0,
    known_ratio: formula.known_ratio,
    ratio_data: formula.known_ratio && formula.ratio_data
      ? Object.fromEntries(Object.entries(formula.ratio_data).map(([name, value]) => [name, String(value)]))
      : null,
    strategy: formula.formula_strategy
  };
}

/**
 * §57 验收：配方哲学必须能回答「没有比例时，不编比例且仍然写得出设计逻辑」。
 *
 * 三个机械条件缺一不可：
 * 1. 设计逻辑成稿（至少两个分量写实，能说清谁承担什么任务）；
 * 2. 没有确认比例时，正文里一个比例字样都没有（自己写的不算，抄进来的也不算）；
 * 3. 分量覆盖度单独记账（`coverage_passed`），不作为 §57 通过条件。
 */
export function formulaPhilosophyAcceptance(
  formula: FormulaPhilosophy,
  extraTexts: readonly string[] = []
): FormulaPhilosophyAcceptance {
  const summary = formulaPhilosophySummary(formula);
  const designLogicReady =
    summary.written_components >= FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy &&
    summary.design_logic_ready;
  const noFabricatedRatio = formula.known_ratio
    ? true
    : !formulaPhilosophyTextsContainRatio(formula, extraTexts);
  const coveragePassed = summary.written_components === FORMULA_COMPONENT_COUNT;
  return formulaPhilosophyAcceptanceSchema.parse({
    spec_ref: "§57",
    question: FORMULA_PHILOSOPHY_ACCEPTANCE_QUESTION,
    design_logic_ready: designLogicReady,
    no_fabricated_ratio: noFabricatedRatio,
    written_components: summary.written_components,
    required_min_components: FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy,
    coverage_passed: coveragePassed,
    passed: designLogicReady && noFabricatedRatio
  });
}

/**
 * 读取既有版本时用的逐条回查：把分量正文与本产品已录入字段做逐字比对，
 * 结果只可能来自已录入事实，因此既不会漂移也不会造事实（§6.1 / §46）。
 *
 * 默认 `known_ratio=false`：回查比生成更保守——除非这一版明确确认过比例，
 * 否则带比例字样的事实（含 DNA）一律不算引用，避免「回查把比例捡回来」。
 */
export function formulaPhilosophyCitations(
  product: FormulaPhilosophyProductInput,
  dna: ValueDna | null,
  meta: FormulaComponentMeta,
  texts: readonly string[],
  options: { refs?: readonly string[]; known_ratio?: boolean } = {}
): string[] {
  const joined = texts.join("\n").trim();
  if (!joined) {
    return [];
  }
  const refs = options.refs ?? meta.evidence_refs;
  const knownRatio = options.known_ratio ?? false;
  const citations: string[] = [];
  let dnaCitations = 0;
  const push = (ref: string, value: string): void => {
    if (!knownRatio && containsRatioExpression(value)) {
      return;
    }
    citations.push(`${ref}=${value}`);
  };
  for (const ref of refs) {
    if (ref.startsWith("dna.")) {
      const dimension = ref.slice(4);
      if (!(VALUE_DNA_DIMENSIONS as readonly string[]).includes(dimension)) {
        continue;
      }
      const values = dna?.[dimension as ValueDnaDimension] ?? [];
      for (const value of values) {
        // 与生成侧同一口径：上限按分量计，避免「回查比生成更宽」导致两边漂移。
        if (dnaCitations >= FORMULA_PHILOSOPHY_LIMITS.maxDnaRefsPerComponent) {
          break;
        }
        const trimmed = value.trim();
        if (trimmed && joined.includes(trimmed)) {
          push(ref, trimmed);
          dnaCitations += 1;
        }
      }
      continue;
    }
    const value = formulaPhilosophyFactValue(product, ref);
    if (value && joined.includes(value)) {
      push(ref, value);
    }
  }
  return citations;
}
