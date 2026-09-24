import { z } from "zod";
import {
  categoryDownstreamItemSchema,
  type CategoryDownstreamItem,
  type CategoryStandardProductInput
} from "./category-creator.js";
import { resolvedResearchModeSchema } from "./enums.js";
import { productArchitectureSchema, type ProductArchitecture } from "./product.js";
import { VALUE_DNA_DIMENSIONS, type ValueDna, type ValueDnaDimension } from "./value-dna.js";

/**
 * 产品结构叙事（规格 §5 Product Architecture Mode / §45 Agent 7 产品结构设计师）。
 *
 * 这一层回答一个问题：**这款茶不是把几个卖点堆在一起，而是每一部分各自在干什么。**
 *
 * §5 要求把普通参数解释成「设计」：输入「布朗山 / 大树春料 / 烟香 / 浓强 / 回甘快 / 生津强」，
 * 输出不能只是「采用布朗山大树春料，烟香明显」，而必须是九个角色各自承担任务的完整结构
 * （骨架 / 身份 / 香气 / 底气 / 第一口 / 中段 / 后半程 / 记忆点 / 价值位）。
 *
 * 四条铁律直接写进类型与校验：
 * 1. 九个角色与顺序由 §5 固定（backbone / identity / aroma_role / body_role / front_stage_role /
 *    middle_stage_role / finish_role / memory_point / value_role），不得增删或重排；
 * 2. §45 明确规定「不允许增加任何原料或配方事实」——角色文案只能引用**本产品已录入字段**
 *    （product.* / dna.*），引用不到的字段就是取不到值（§45 / §62-6 / §62-7）；
 * 3. 事实不足的角色留空并写缺口，不得用形容词补圆；`value_role` 至少要有 3 个写实的角色才成立（§11）；
 * 4. 允许极强修辞，但修辞只能说「结构怎么分工」，不能造事实：不虚构研发关系 / 配方比例 /
 *    树龄山头年份 / 获奖大师（§24 / §62-6 / §62-8）。
 */

/** §5 固定的九个角色，顺序即展示顺序与 §45 的提问顺序，不得重排。 */
export const productArchitectureRoleKeys = [
  "backbone",
  "identity",
  "aroma_role",
  "body_role",
  "front_stage_role",
  "middle_stage_role",
  "finish_role",
  "memory_point",
  "value_role"
] as const;
export const productArchitectureRoleKeySchema = z.enum(productArchitectureRoleKeys);
export type ProductArchitectureRoleKey = z.infer<typeof productArchitectureRoleKeySchema>;

export const PRODUCT_ARCHITECTURE_ROLE_COUNT = productArchitectureRoleKeys.length;

export const PRODUCT_ARCHITECTURE_LIMITS = {
  /** 单产品保留的历史产品结构版本上限（所有版本必须保留，这里只限制活跃版本数） */
  maxVersionsPerProduct: 20,
  /** value_role 成立所需的最少写实角色数：不足就是「还没形成结构」，不得硬写。 */
  minWrittenRolesForValueRole: 3,
  /** 同一角色最多引用多少条 Value DNA 条目，避免单角色被 DNA 刷满 */
  maxDnaRefsPerRole: 3,
  defaultPageSize: 20,
  maxPageSize: 100
} as const;

/** 角色状态只有两种：写实 / 缺事实留空。没有「弱化版」这一档。 */
export const productArchitectureRoleStatuses = ["WRITTEN", "GAP"] as const;
export const productArchitectureRoleStatusSchema = z.enum(productArchitectureRoleStatuses);
export type ProductArchitectureRoleStatus = z.infer<typeof productArchitectureRoleStatusSchema>;

export const PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS: Record<ProductArchitectureRoleStatus, string> = {
  WRITTEN: "已写实",
  GAP: "事实不足（留空）"
};

export const PRODUCT_ARCHITECTURE_ROLE_STATUS_TONES: Record<
  ProductArchitectureRoleStatus,
  "ok" | "danger"
> = {
  WRITTEN: "ok",
  GAP: "danger"
};

/**
 * §45 Agent 7 的 8 个问题与九个角色的映射（第 6 问「尾韵」是 finish_role 的延伸）。
 * identity 与 body_role 来自 §5 与 §30 的写法（「孔雀给它身份，大树春料给它底气」）。
 */
export const PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS = [
  { order: 1, question: "什么负责骨架？", role: "backbone" as const, spec_ref: "§45" },
  { order: 2, question: "什么负责香气身份？", role: "aroma_role" as const, spec_ref: "§45" },
  { order: 3, question: "什么负责第一口冲击？", role: "front_stage_role" as const, spec_ref: "§45" },
  { order: 4, question: "什么负责中段厚度？", role: "middle_stage_role" as const, spec_ref: "§45" },
  { order: 5, question: "什么负责回甘？", role: "finish_role" as const, spec_ref: "§45" },
  {
    order: 6,
    question: "什么负责尾韵？",
    role: "finish_role" as const,
    spec_ref: "§45",
    note: "尾韵是 finish_role 的延伸，不单独设字段"
  },
  { order: 7, question: "什么是最强记忆点？", role: "memory_point" as const, spec_ref: "§45" },
  {
    order: 8,
    question: "为什么这些部分组合起来不像普通茶？",
    role: "value_role" as const,
    spec_ref: "§45"
  }
] as const;

export interface ProductArchitectureRoleMeta {
  key: ProductArchitectureRoleKey;
  label: string;
  short_label: string;
  /** §45 的提问口径（identity / body_role 取自 §5 / §30 的写法） */
  question: string;
  /** 这个角色在结构里到底在说什么 */
  definition: string;
  /** 写实这个角色至少要有哪些已录入事实 */
  requirement: string;
  /** 允许引用的字段路径白名单（product.* / dna.*），按优先顺序排列 */
  evidence_refs: readonly string[];
  /** §57 验收是否必须回答（谁负责骨架／香气／汤感／回甘／记忆点） */
  acceptance_required: boolean;
  spec_ref: string;
}

export const PRODUCT_ARCHITECTURE_ROLE_META: readonly ProductArchitectureRoleMeta[] = [
  {
    key: "backbone",
    label: "骨架 Backbone",
    short_label: "骨架",
    question: "什么负责骨架？",
    definition: "整款茶的承重层：产地与用料决定汤感结构的下限，后面的表现都建立在它上面",
    requirement: "山头 / 产区 / 用料（至少录入一项）",
    evidence_refs: [
      "product.mountain",
      "product.origin_region",
      "product.origin_city",
      "product.origin_province",
      "product.village",
      "product.raw_material",
      "product.grade",
      "dna.origin",
      "dna.material"
    ],
    acceptance_required: true,
    spec_ref: "§5 / §45"
  },
  {
    key: "identity",
    label: "身份 Identity",
    short_label: "身份",
    question: "它凭什么被记住（身份与坐标）？",
    definition: "身份坐标：系列 / 产品名与茶类风格先说清「它是谁」，不靠形容词证明",
    requirement: "产品名 + 茶类（系列名可选但更强）",
    evidence_refs: [
      "product.series_name",
      "product.product_name",
      "product.tea_subtype",
      "product.tea_type",
      "product.brand_name",
      "dna.identity",
      "dna.positioning"
    ],
    acceptance_required: false,
    spec_ref: "§5 / §30"
  },
  {
    key: "aroma_role",
    label: "香气角色 Aroma Role",
    short_label: "香气",
    question: "什么负责香气身份？",
    definition: "香气身份：干茶、汤香与杯底香里最有辨识度的那一层",
    requirement: "干茶香气 / 汤香 / 杯底香（至少录入一项）",
    evidence_refs: [
      "product.dry_leaf_aroma",
      "product.liquor_aroma",
      "product.hot_cup_aroma",
      "dna.flavor"
    ],
    acceptance_required: true,
    spec_ref: "§45"
  },
  {
    key: "body_role",
    label: "底气 Body Role",
    short_label: "底气",
    question: "什么负责底气？",
    definition: "底气：原料等级、树型树龄、季节与汤感厚度共同撑起的浓度与稳定度",
    requirement: "原料 / 树型 / 树龄 / 季节 / 厚度（至少录入一项）",
    evidence_refs: [
      "product.raw_material",
      "product.tree_type",
      "product.tree_age",
      "product.season",
      "product.harvest_standard",
      "product.thickness",
      "product.viscosity",
      "dna.material",
      "dna.taste"
    ],
    acceptance_required: false,
    spec_ref: "§5 / §30"
  },
  {
    key: "front_stage_role",
    label: "第一口冲击 Front Stage",
    short_label: "第一口",
    question: "什么负责第一口冲击？",
    definition: "入口段落：浓强度与刺激感在入口就直接立住，不需要铺垫",
    requirement: "入口滋味 / 苦 / 涩 / 厚度（至少录入一项）",
    evidence_refs: [
      "product.entry_taste",
      "product.bitterness",
      "product.astringency",
      "product.thickness",
      "dna.taste",
      "dna.architecture_signals"
    ],
    acceptance_required: false,
    spec_ref: "§5 / §45"
  },
  {
    key: "middle_stage_role",
    label: "中段厚度 Middle Stage",
    short_label: "中段",
    question: "什么负责中段厚度？",
    definition: "中段段落：汤感不散、浓度不掉，是后半程还能继续发力的前提",
    requirement: "中段表现 / 厚度 / 粘稠度 / 水路（至少录入一项）",
    evidence_refs: [
      "product.middle_stage",
      "product.thickness",
      "product.viscosity",
      "product.water_texture",
      "dna.taste",
      "dna.architecture_signals"
    ],
    acceptance_required: true,
    spec_ref: "§45"
  },
  {
    key: "finish_role",
    label: "后半程 Finish Role",
    short_label: "后半程",
    question: "什么负责回甘？（尾韵是它的延伸）",
    definition: "后半程：回甘、生津与尾韵连起来，把整泡茶的收口撑住",
    requirement: "回甘 / 生津 / 尾韵 / 耐泡度（至少录入一项）",
    evidence_refs: [
      "product.huigan",
      "product.salivation",
      "product.finish",
      "product.late_stage",
      "product.endurance",
      "product.sweetness",
      "dna.taste"
    ],
    acceptance_required: true,
    spec_ref: "§45"
  },
  {
    key: "memory_point",
    label: "记忆点 Memory Point",
    short_label: "记忆点",
    question: "什么是最强记忆点？",
    definition: "最强记忆点：喝完最先想起来的那一个特征，也是这款茶与同类拉开距离的地方",
    requirement: "风格 / 感官 / 产地标识（至少录入一项）",
    evidence_refs: [
      "product.dry_leaf_aroma",
      "product.liquor_aroma",
      "product.hot_cup_aroma",
      "product.entry_taste",
      "product.thickness",
      "product.mountain",
      "product.raw_material",
      "product.series_name",
      "dna.flavor",
      "dna.architecture_signals",
      "dna.identity"
    ],
    acceptance_required: true,
    spec_ref: "§45 / §57"
  },
  {
    key: "value_role",
    label: "价值位 Value Role",
    short_label: "价值位",
    question: "为什么这些部分组合起来不像普通茶？",
    definition: "价值位：把各角色的分工串成一句「不是堆卖点，而是每一部分都有自己的任务」，即 §5 的结构叙事",
    requirement: `至少 ${PRODUCT_ARCHITECTURE_LIMITS.minWrittenRolesForValueRole} 个其它角色已经写实`,
    evidence_refs: [],
    acceptance_required: false,
    spec_ref: "§5 / §45"
  }
];

export const PRODUCT_ARCHITECTURE_ROLE_META_BY_KEY = Object.fromEntries(
  PRODUCT_ARCHITECTURE_ROLE_META.map((meta) => [meta.key, meta] as const)
) as Record<ProductArchitectureRoleKey, ProductArchitectureRoleMeta>;

export const PRODUCT_ARCHITECTURE_ROLE_LABELS = Object.fromEntries(
  PRODUCT_ARCHITECTURE_ROLE_META.map((meta) => [meta.key, meta.label] as const)
) as Record<ProductArchitectureRoleKey, string>;

export const PRODUCT_ARCHITECTURE_ROLE_SHORT_LABELS = Object.fromEntries(
  PRODUCT_ARCHITECTURE_ROLE_META.map((meta) => [meta.key, meta.short_label] as const)
) as Record<ProductArchitectureRoleKey, string>;

/** §57 验收口径：产品结构必须能回答「谁负责骨架／香气／汤感／回甘／记忆点」。 */
export const PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS: readonly ProductArchitectureRoleKey[] =
  PRODUCT_ARCHITECTURE_ROLE_META.filter((meta) => meta.acceptance_required).map((meta) => meta.key);

export const PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION =
  "产品结构必须能回答：谁负责骨架／谁负责香气／谁负责汤感／谁负责回甘／谁负责记忆点（§57）";

/* ---------------------------------------------------------- 下游交接 */

/**
 * 下游交接：已交付阶段不再登记（§60）。
 * 配方哲学（Phase 11）与成交话术（Phase 12）已交付，交接关系见合同的 `rules`；
 * 本阶段不代写，也不再用 PENDING 占位条目冒充未交付（§62-15 / §60）。
 */
export const PRODUCT_ARCHITECTURE_DOWNSTREAM: readonly CategoryDownstreamItem[] = [];

/** 供 API 自检与前端展示：九个角色、§45 八问与红线只从这里读取。 */
export const PRODUCT_ARCHITECTURE_CONTRACT = {
  spec_ref: "§5 / §45",
  role_count: PRODUCT_ARCHITECTURE_ROLE_COUNT,
  roles: PRODUCT_ARCHITECTURE_ROLE_META.map((meta) => ({
    key: meta.key,
    label: meta.label,
    short_label: meta.short_label,
    question: meta.question,
    definition: meta.definition,
    requirement: meta.requirement,
    evidence_refs: meta.evidence_refs,
    acceptance_required: meta.acceptance_required,
    spec_ref: meta.spec_ref
  })),
  agent7_questions: PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS,
  acceptance: {
    spec_ref: "§57",
    question: PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION,
    required_keys: PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS
  },
  limits: PRODUCT_ARCHITECTURE_LIMITS,
  /** §45：不允许增加任何原料或配方事实 */
  no_new_facts: true,
  /** §62-6：不虚构研发关系 / 配方比例 / 树龄山头年份 / 获奖大师 */
  no_fabricated_relation: true,
  /** §11 / §62-7：未录入即留空，不用形容词补圆 */
  gap_stays_empty: true,
  /** §62-5：证据只引用本产品已录入字段与 Value DNA */
  evidence_only_from_own_product: true,
  /** §24 / §62-8：允许极强修辞，但修辞只说结构分工 */
  rhetoric_allowed_for_structure_only: true,
  /** §5：输出必须是结构叙事，不是参数罗列 */
  structure_not_parameter_list: true,
  downstream_phases: PRODUCT_ARCHITECTURE_DOWNSTREAM,
  rules: [
    "九个角色与顺序由 §5 固定（backbone / identity / aroma_role / body_role / front_stage_role / middle_stage_role / finish_role / memory_point / value_role），不得增删或重排",
    "§45 的 8 个问题必须逐条落到角色上：骨架 / 香气身份 / 第一口冲击 / 中段厚度 / 回甘（尾韵是 finish_role 的延伸）/ 最强记忆点 / 为什么不像普通茶（value_role）",
    "§45 明文：不允许增加任何原料或配方事实；角色文案只能引用本产品已录入字段与 Value DNA",
    "不得虚构研发关系 / 配方比例 / 树龄山头年份 / 获奖大师（§62-6）",
    "事实不足的角色留空并写缺口，不得用形容词补圆；value_role 不足 3 个写实角色时不成立（§11 / §62-7）",
    "允许极强修辞，但修辞只能描述「各部分承担什么任务」，不能造事实（§24 / §62-8）",
    "产品结构是配方哲学与成交话术的输入，二者由 Phase 11 / 12 交付，本阶段不代写（§60）"
  ]
} as const;

/* ------------------------------------------------------------ API 对象 */

export const productArchitectureRoleViewSchema = z
  .object({
    key: productArchitectureRoleKeySchema,
    label: z.string(),
    short_label: z.string(),
    question: z.string(),
    definition: z.string(),
    requirement: z.string(),
    /** 角色文案；事实不足时为 ""（留空，不写弱化版） */
    text: z.string(),
    status: productArchitectureRoleStatusSchema,
    /** §24 分层：结构解释是 INTERPRETATION，价值位收口是 RHETORIC */
    layer: z.enum(["INTERPRETATION", "RHETORIC"]),
    /** 这条角色文案引用了哪些字段（product.* / dna.*），可逐条回查 */
    evidence_refs: z.array(z.string()),
    /** 引用的已录入事实原文（ref=value），用于前端逐条对照 */
    citations: z.array(z.string()),
    /** 缺口说明；status=WRITTEN 时为 null */
    gap: z.string().nullable(),
    acceptance_required: z.boolean(),
    spec_ref: z.string()
  })
  .strict()
  .refine((role) => (role.status === "WRITTEN") === role.text.trim().length > 0, {
    message: "WRITTEN 角色必须有文案，GAP 角色必须留空（§11 / §62-7）",
    path: ["text"]
  })
  .refine((role) => (role.status === "WRITTEN") === (role.gap === null), {
    message: "只有 GAP 角色携带缺口说明",
    path: ["gap"]
  });
export type ProductArchitectureRoleView = z.infer<typeof productArchitectureRoleViewSchema>;

export const productArchitectureRoleCountsSchema = z
  .object({
    written: z.number().int().nonnegative(),
    gap: z.number().int().nonnegative()
  })
  .strict();
export type ProductArchitectureRoleCounts = z.infer<typeof productArchitectureRoleCountsSchema>;

export const productArchitectureAcceptanceSchema = z
  .object({
    spec_ref: z.literal("§57"),
    question: z.string(),
    required_keys: z.array(productArchitectureRoleKeySchema),
    written_keys: z.array(productArchitectureRoleKeySchema),
    missing_keys: z.array(productArchitectureRoleKeySchema),
    passed: z.boolean()
  })
  .strict();
export type ProductArchitectureAcceptance = z.infer<typeof productArchitectureAcceptanceSchema>;

export const productArchitectureRecordSchema = z
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
    /** 九个角色（§5 固定顺序） */
    roles: z.array(productArchitectureRoleViewSchema).length(PRODUCT_ARCHITECTURE_ROLE_COUNT),
    /** §35.3 的存储形状：九个字段的扁平快照，事实不足的字段是 "" */
    architecture: productArchitectureSchema,
    /** §5 的结构叙事段落（= value_role 成稿；不足 3 个写实角色时为 ""） */
    narrative: z.string(),
    role_counts: productArchitectureRoleCountsSchema,
    acceptance: productArchitectureAcceptanceSchema,
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
    spec_ref: z.literal("§5 / §45")
  })
  .strict();
export type ProductArchitectureRecordView = z.infer<typeof productArchitectureRecordSchema>;

export const productArchitectureVersionSummarySchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    written_roles: z.number().int().nonnegative(),
    acceptance_passed: z.boolean(),
    missing_acceptance_keys: z.array(productArchitectureRoleKeySchema),
    is_confirmed: z.boolean(),
    created_at: z.string()
  })
  .strict();
export type ProductArchitectureVersionSummary = z.infer<typeof productArchitectureVersionSummarySchema>;

export const productArchitectureOverviewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    preference: z.string(),
    mode: z.string(),
    resolved_by: z.string(),
    mode_reason: z.string(),
    can_generate: z.boolean(),
    block_reason: z.string().nullable(),
    record: productArchitectureRecordSchema.nullable(),
    versions: z.array(productArchitectureVersionSummarySchema),
    /** 这个产品还缺什么角色（用于「产品结构」页排产） */
    missing_acceptance_keys: z.array(productArchitectureRoleKeySchema),
    spec_ref: z.literal("§5 / §45")
  })
  .strict();
export type ProductArchitectureOverview = z.infer<typeof productArchitectureOverviewSchema>;

/** 「产品结构」跨产品列表行：只做检索与排产，不改写任何产品事实。 */
export const productArchitectureMatrixRowSchema = z
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
    written_roles: z.number().int().nonnegative(),
    gap_roles: z.number().int().nonnegative(),
    missing_acceptance_keys: z.array(productArchitectureRoleKeySchema),
    acceptance_passed: z.boolean(),
    /** 结构叙事正文（未生成时为 null） */
    narrative: z.string().nullable(),
    generated_at: z.string().nullable(),
    spec_ref: z.literal("§5 / §45")
  })
  .strict();
export type ProductArchitectureMatrixRow = z.infer<typeof productArchitectureMatrixRowSchema>;

export const productArchitectureGenerateSchema = z
  .object({
    notes: z.string().trim().max(2000).optional()
  })
  .strict();
export type ProductArchitectureGenerateInput = z.infer<typeof productArchitectureGenerateSchema>;

export const productArchitectureUpdateSchema = z
  .object({
    is_confirmed: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type ProductArchitectureUpdateInput = z.infer<typeof productArchitectureUpdateSchema>;

export const productArchitectureSortSchema = z.enum([
  "-updated_at",
  "updated_at",
  "product_name",
  "-product_name",
  "-written_roles",
  "-gap_roles"
]);
export type ProductArchitectureSort = z.infer<typeof productArchitectureSortSchema>;

export const productArchitectureListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(PRODUCT_ARCHITECTURE_LIMITS.maxPageSize).optional(),
    product_id: z.string().uuid().optional(),
    role: productArchitectureRoleKeySchema.optional(),
    /** 只看还没生成产品结构的产品 */
    missing: z.coerce.boolean().optional(),
    /**
     * §17 已解析模式：与 `AnchorsService.resolveMode` 同口径（同一组阈值常量），
     * 用于跨产品「最近要优先讲哪些茶」的排产式检索，不参与任何打分。
     */
    mode: resolvedResearchModeSchema.optional(),
    q: z.string().trim().max(200).optional(),
    sort: productArchitectureSortSchema.optional()
  })
  .strict();
export type ProductArchitectureListQuery = z.infer<typeof productArchitectureListQuerySchema>;

/* ------------------------------------------------------------ 纯函数构建器 */

/**
 * 产品侧输入：字段口径与自建标准（§10.1–§10.4）一致，
 * 再补上结构角色会用到、而六个标准轴没有覆盖到的字段。
 */
export interface ProductArchitectureProductInput extends CategoryStandardProductInput {
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

export interface ProductArchitectureBuildInput {
  product: ProductArchitectureProductInput;
  /** §9 Value DNA；未生成时传 null（11 维全空同样视同未生成） */
  value_dna: ValueDna | null;
}

export interface ProductArchitectureDraft {
  roles: ProductArchitectureRoleView[];
  architecture: ProductArchitecture;
  narrative: string;
  role_counts: ProductArchitectureRoleCounts;
  acceptance: ProductArchitectureAcceptance;
  evidence_gaps: string[];
  evidence_refs: string[];
  fact_refs: string[];
  value_dna_refs: string[];
}

export interface ProductArchitectureFactHit {
  /** 事实来源字段路径，例如 product.mountain / dna.origin */
  ref: string;
  value: string;
}

/**
 * 只认「本产品已录入字段」这张白名单：没在这里列出的字段路径一律取不到值，
 * 因此不可能把对标产品、模型记忆或补写内容当成结构事实（§45 / §62-5 / §62-7）。
 */
const PRODUCT_FACT_FIELDS: Record<string, keyof ProductArchitectureProductInput> = {
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

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 按字段路径回查本产品已录入事实；取不到就是没录，绝不补全。 */
export function productArchitectureFactValue(
  product: ProductArchitectureProductInput,
  ref: string
): string | null {
  const field = PRODUCT_FACT_FIELDS[ref];
  return field ? trimToNull(product[field]) : null;
}

/** Value DNA 只在通过 §9 schema 且至少一维有内容时参与结构（与价值映射同一口径）。 */
function usableValueDna(value_dna: ValueDna | null): ValueDna | null {
  if (!value_dna) {
    return null;
  }
  const hasContent = VALUE_DNA_DIMENSIONS.some((dimension) => (value_dna[dimension]?.length ?? 0) > 0);
  return hasContent ? value_dna : null;
}

function roleHits(
  product: ProductArchitectureProductInput,
  dna: ValueDna | null,
  refs: readonly string[]
): ProductArchitectureFactHit[] {
  const hits: ProductArchitectureFactHit[] = [];
  let dnaHits = 0;
  for (const ref of refs) {
    if (ref.startsWith("dna.")) {
      const dimension = ref.slice(4);
      if (!(VALUE_DNA_DIMENSIONS as readonly string[]).includes(dimension)) {
        continue;
      }
      const values = dna?.[dimension as ValueDnaDimension] ?? [];
      for (const value of values) {
        // 上限按「角色」而不是「单个维度」计：否则一个角色挂两三个维度就能被 DNA 刷满。
        if (dnaHits >= PRODUCT_ARCHITECTURE_LIMITS.maxDnaRefsPerRole) {
          break;
        }
        const trimmed = value.trim();
        if (trimmed) {
          hits.push({ ref, value: trimmed });
          dnaHits += 1;
        }
      }
      continue;
    }
    const value = productArchitectureFactValue(product, ref);
    if (value) {
      hits.push({ ref, value });
    }
  }
  return hits;
}

interface RoleDraft {
  text: string | null;
  /** 短句式（如「布朗山负责骨架」），只用于拼 §5 的价值位叙事 */
  phrase: string | null;
  hits: ProductArchitectureFactHit[];
  gap: string | null;
}

/**
 * 事实不足时写什么：缺口必须指回具体字段，供研究员补齐，绝不留一句「待补充」。
 * 生成与读取共用同一段文案，避免接口两侧口径漂移。
 */
export function productArchitectureGapReason(
  meta: ProductArchitectureRoleMeta,
  writtenRoles = 0
): string {
  if (meta.key === "value_role") {
    return `写实的结构角色只有 ${writtenRoles} 个，不足 ${PRODUCT_ARCHITECTURE_LIMITS.minWrittenRolesForValueRole} 个：先补齐骨架 / 香气 / 第一口 / 中段 / 后半程 / 记忆点里的事实，再谈「为什么不像普通茶」（§11 / §62-7）`;
  }
  return `未录入相关事实，先补：${meta.requirement}（字段 ${meta.evidence_refs
    .filter((ref) => !ref.startsWith("dna."))
    .join(" / ")}，§45 / §62-7）`;
}

function gapFor(meta: ProductArchitectureRoleMeta, writtenRoles = 0): RoleDraft {
  return {
    text: null,
    phrase: null,
    hits: [],
    gap: productArchitectureGapReason(meta, writtenRoles)
  };
}

/** 取前 n 条互不重复的事实值，做「多事实共同负责一个角色」的写法。 */
function joinValues(hits: readonly ProductArchitectureFactHit[], max: number): string {
  const values: string[] = [];
  for (const hit of hits) {
    if (values.length >= max) {
      break;
    }
    if (!values.includes(hit.value)) {
      values.push(hit.value);
    }
  }
  return values.join("、");
}

function buildRoleDraft(
  meta: ProductArchitectureRoleMeta,
  product: ProductArchitectureProductInput,
  dna: ValueDna | null
): RoleDraft {
  const hits = roleHits(product, dna, meta.evidence_refs);
  const primary = hits[0];
  if (!primary) {
    return gapFor(meta);
  }

  switch (meta.key) {
    case "backbone": {
      const extra = hits
        .slice(1)
        .find((hit) => hit.value !== primary.value && !primary.value.includes(hit.value));
      return {
        text: `${primary.value}负责骨架：它决定这款${product.tea_type}的汤感结构${
          extra ? `，${extra.value}负责把这一层压实` : ""
        }，后面的表现都建立在它上面。`,
        phrase: `${primary.value}负责骨架`,
        hits,
        gap: null
      };
    }
    case "identity": {
      const series = productArchitectureFactValue(product, "product.series_name");
      const subject = series ?? primary.value;
      const typePhrase = `${product.tea_type}${product.tea_subtype ? `／${product.tea_subtype}` : ""}`;
      return {
        text: `${subject}负责身份：${typePhrase}的坐标立在这里，不用形容词证明它是谁，别人一看就知道是哪一路货。`,
        phrase: `${subject}负责身份`,
        hits,
        gap: null
      };
    }
    case "aroma_role": {
      return {
        text: `${primary.value}负责香气身份：还没下水判断就已经开始，喝完香气还留在杯底和记忆里。`,
        phrase: `${primary.value}负责香气身份`,
        hits,
        gap: null
      };
    }
    case "body_role": {
      const subjects = joinValues(hits, 3);
      return {
        text: `${subjects}负责底气：入口的厚度和浓度是它们给的，不是形容词给的。`,
        phrase: `${subjects}负责底气`,
        hits,
        gap: null
      };
    }
    case "front_stage_role": {
      return {
        text: `${primary.value}负责第一口冲击：入口就把话说清楚，不给含糊的余地。`,
        phrase: `${primary.value}负责第一口`,
        hits,
        gap: null
      };
    }
    case "middle_stage_role": {
      const extra = hits.slice(1).find((hit) => hit.value !== primary.value);
      return {
        text: `${primary.value}负责中段厚度：汤感在中段不散${extra ? `（${extra.value}）` : ""}，后半程才有得谈。`,
        phrase: `${primary.value}负责中段厚度`,
        hits,
        gap: null
      };
    }
    case "finish_role": {
      const subjects = joinValues(hits, 3);
      const hasTail = hits.some((hit) =>
        ["product.finish", "product.late_stage", "product.endurance"].includes(hit.ref)
      );
      return {
        text: `${subjects}负责后半程：回甘与生津把后半程撑起来${
          hasTail ? "，尾韵一路收到杯底" : ""
        }，一泡茶才算有完整的收口。`,
        phrase: `${subjects}负责后半程`,
        hits,
        gap: null
      };
    }
    case "memory_point": {
      return {
        text: `${primary.value}是最强记忆点：喝完最先想起来的是它，也是这款茶最难被同类替代的地方。`,
        phrase: `${primary.value}是最强记忆点`,
        hits,
        gap: null
      };
    }
    default:
      return gapFor(meta);
  }
}

function buildValueRole(
  meta: ProductArchitectureRoleMeta,
  drafts: readonly { meta: ProductArchitectureRoleMeta; draft: RoleDraft }[]
): RoleDraft {
  const written = drafts.filter((item) => item.draft.phrase !== null);
  if (written.length < PRODUCT_ARCHITECTURE_LIMITS.minWrittenRolesForValueRole) {
    return {
      text: null,
      phrase: null,
      hits: [],
      gap: productArchitectureGapReason(meta, written.length)
    };
  }
  const phrases = written.map((item) => item.draft.phrase);
  const hits = written.flatMap((item) => item.draft.hits);
  return {
    text: `它不是把卖点堆在一起，而是每一部分都有自己的任务：${phrases.join("，")}。少一个环节，都撑不起它现在这个位置。`,
    phrase: `${meta.short_label}成立`,
    hits,
    gap: null
  };
}

/**
 * 生成与读取必须同一口径：只有**逐字写进正文**的事实才算这条角色的证据。
 * 否则会生成出「引用了某个字段、正文里却找不到这个词」的假引用（§45 / §62-5）。
 *
 * DNA 引用还有一层按角色的上限：value_role 的证据是各角色分工的并集，
 * 若不在这一层收口，一个价值位就能把全部 DNA 维度一次挂满（§9 / §11）。
 */
function usedHits(draft: RoleDraft): ProductArchitectureFactHit[] {
  if (draft.text === null) {
    return [];
  }
  const text = draft.text;
  const used: ProductArchitectureFactHit[] = [];
  const seen = new Set<string>();
  let dnaHits = 0;
  for (const hit of draft.hits) {
    if (!text.includes(hit.value)) {
      continue;
    }
    const citation = `${hit.ref}=${hit.value}`;
    if (seen.has(citation)) {
      continue;
    }
    if (hit.ref.startsWith("dna.")) {
      if (dnaHits >= PRODUCT_ARCHITECTURE_LIMITS.maxDnaRefsPerRole) {
        continue;
      }
      dnaHits += 1;
    }
    seen.add(citation);
    used.push(hit);
  }
  return used;
}

function toRoleView(meta: ProductArchitectureRoleMeta, draft: RoleDraft): ProductArchitectureRoleView {
  const cited = usedHits(draft);
  const evidenceRefs = [...new Set(cited.map((hit) => hit.ref))];
  return productArchitectureRoleViewSchema.parse({
    key: meta.key,
    label: meta.label,
    short_label: meta.short_label,
    question: meta.question,
    definition: meta.definition,
    requirement: meta.requirement,
    text: draft.text ?? "",
    status: draft.text === null ? "GAP" : "WRITTEN",
    layer: meta.key === "value_role" ? "RHETORIC" : "INTERPRETATION",
    evidence_refs: evidenceRefs,
    citations: cited.map((hit) => `${hit.ref}=${hit.value}`),
    gap: draft.gap,
    acceptance_required: meta.acceptance_required,
    spec_ref: meta.spec_ref
  });
}

/**
 * 从已录入事实 + Value DNA 推导产品结构叙事（§5 / §45）。
 *
 * 纯函数：不读数据库、不调用 AI、不做任何推断性补全。
 * 事实不足时输出的是「角色留空 + 缺口清单」，而不是弱化版结构；
 * 九个角色只引用本产品已录入字段，因此不可能凭空出现原料或配方事实（§45 / §62-6）。
 */
export function buildProductArchitecture(
  input: ProductArchitectureBuildInput
): ProductArchitectureDraft {
  const dna = usableValueDna(input.value_dna);
  const drafts = PRODUCT_ARCHITECTURE_ROLE_META.filter((meta) => meta.key !== "value_role").map(
    (meta) => ({ meta, draft: buildRoleDraft(meta, input.product, dna) })
  );
  const valueMeta = PRODUCT_ARCHITECTURE_ROLE_META_BY_KEY.value_role;
  const valueDraft = buildValueRole(valueMeta, drafts);

  const ordered = PRODUCT_ARCHITECTURE_ROLE_META.map((meta) => {
    if (meta.key === "value_role") {
      return { meta, draft: valueDraft };
    }
    const found = drafts.find((item) => item.meta.key === meta.key);
    return found ?? { meta, draft: gapFor(meta) };
  });

  const roles = ordered.map((item) => toRoleView(item.meta, item.draft));
  const byKey = new Map(roles.map((role) => [role.key, role] as const));
  const textOf = (key: ProductArchitectureRoleKey): string => byKey.get(key)?.text ?? "";

  const architecture = productArchitectureSchema.parse({
    backbone: textOf("backbone"),
    identity: textOf("identity"),
    aroma_role: textOf("aroma_role"),
    body_role: textOf("body_role"),
    front_stage_role: textOf("front_stage_role"),
    middle_stage_role: textOf("middle_stage_role"),
    finish_role: textOf("finish_role"),
    memory_point: textOf("memory_point"),
    value_role: textOf("value_role")
  });

  const writtenKeys = roles.filter((role) => role.status === "WRITTEN").map((role) => role.key);
  const missingAcceptanceKeys = PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS.filter(
    (key) => !writtenKeys.includes(key)
  );
  const roleCounts = productArchitectureRoleCountsSchema.parse({
    written: writtenKeys.length,
    gap: roles.length - writtenKeys.length
  });
  const acceptance = productArchitectureAcceptanceSchema.parse({
    spec_ref: "§57",
    question: PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION,
    required_keys: [...PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS],
    written_keys: writtenKeys,
    missing_keys: missingAcceptanceKeys,
    passed: missingAcceptanceKeys.length === 0
  });

  const gapRoles = roles.filter((role) => role.gap !== null);
  const evidenceGaps = gapRoles.map((role) => `${role.short_label}：${role.gap ?? ""}`);
  if (!dna) {
    evidenceGaps.push("尚未生成价值 DNA（§9）：香气、滋味与结构信号只能从录入字段直接取，覆盖面会偏窄");
  }

  const evidenceRefs = [...new Set(roles.flatMap((role) => role.evidence_refs))];

  return {
    roles,
    architecture,
    narrative: valueDraft.text ?? "",
    role_counts: roleCounts,
    acceptance,
    evidence_gaps: evidenceGaps,
    evidence_refs: evidenceRefs,
    fact_refs: evidenceRefs.filter((ref) => ref.startsWith("product.")),
    value_dna_refs: evidenceRefs.filter((ref) => ref.startsWith("dna."))
  };
}

/**
 * 从九个角色的正文得出「写实了几个 / 哪些角色仍是 GAP / §57 验收缺哪些」。
 *
 * 生成、读取既有版本、以及下游的价值叙事（Phase 9 的产品结构故事）都走这一个口径，
 * 避免两处各写一份判定导致「结构说齐了、故事说缺」这种漂移（§5 / §57）。
 */
export function productArchitectureSummary(architecture: ProductArchitecture): {
  written_roles: number;
  gap_role_keys: ProductArchitectureRoleKey[];
  gap_role_labels: string[];
  missing_acceptance_keys: ProductArchitectureRoleKey[];
  acceptance_passed: boolean;
} {
  const writtenKeys: ProductArchitectureRoleKey[] = [];
  const gapRoleKeys: ProductArchitectureRoleKey[] = [];
  for (const meta of PRODUCT_ARCHITECTURE_ROLE_META) {
    if (architecture[meta.key].trim().length > 0) {
      writtenKeys.push(meta.key);
    } else {
      gapRoleKeys.push(meta.key);
    }
  }
  const missingAcceptanceKeys = PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS.filter(
    (key) => !writtenKeys.includes(key)
  );
  return {
    written_roles: writtenKeys.length,
    gap_role_keys: gapRoleKeys,
    gap_role_labels: gapRoleKeys.map((key) => PRODUCT_ARCHITECTURE_ROLE_META_BY_KEY[key].short_label),
    missing_acceptance_keys: missingAcceptanceKeys,
    acceptance_passed: missingAcceptanceKeys.length === 0
  };
}

/**
 * 读取既有版本时用的逐条回查：把角色文案与本产品已录入字段做逐字比对，
 * 结果只可能来自已录入事实，因此既不会漂移也不会造事实（§45 / §62-5）。
 *
 * `refs` 默认取角色自己的字段白名单；value_role 例外——它把各角色的分工串成一句话，
 * 证据来自这些角色的并集（生成时已写入行的 evidence_ids），因此由调用方显式传入。
 */
export function productArchitectureCitations(
  product: ProductArchitectureProductInput,
  dna: ValueDna | null,
  meta: ProductArchitectureRoleMeta,
  text: string,
  refs: readonly string[] = meta.evidence_refs
): string[] {
  if (!text.trim()) {
    return [];
  }
  const citations: string[] = [];
  let dnaCitations = 0;
  for (const ref of refs) {
    if (ref.startsWith("dna.")) {
      const dimension = ref.slice(4);
      if (!(VALUE_DNA_DIMENSIONS as readonly string[]).includes(dimension)) {
        continue;
      }
      const values = dna?.[dimension as ValueDnaDimension] ?? [];
      for (const value of values) {
        // 与生成侧同一口径：上限按角色计，避免「回查比生成更宽」导致两边漂移。
        if (dnaCitations >= PRODUCT_ARCHITECTURE_LIMITS.maxDnaRefsPerRole) {
          break;
        }
        const trimmed = value.trim();
        if (trimmed && text.includes(trimmed)) {
          citations.push(`${ref}=${trimmed}`);
          dnaCitations += 1;
        }
      }
      continue;
    }
    const value = productArchitectureFactValue(product, ref);
    if (value && text.includes(value)) {
      citations.push(`${ref}=${value}`);
    }
  }
  return citations;
}
