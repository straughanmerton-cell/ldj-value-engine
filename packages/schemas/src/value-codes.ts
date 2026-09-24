import { z } from "zod";
import {
  researchModeSchema,
  resolvedResearchModeSchema,
  valueCodeKeySchema,
  valueCodeKeys,
  valueCodeStatusSchema,
  type ResolvedResearchMode,
  type ValueCodeKey,
  type ValueCodeStatus
} from "./enums.js";
import { anchorResolveSourceSchema, type AnchorResolveSource } from "./anchor.js";
import { VALUE_DNA_DIMENSIONS, type ValueDna, type ValueDnaDimension } from "./value-dna.js";
import {
  categoryDownstreamItemSchema,
  type CategoryDownstreamItem,
  type CategoryStandardProductInput
} from "./category-creator.js";
import { PRODUCT_ARCHITECTURE_LIMITS } from "./product-architecture.js";
import { FORMULA_PHILOSOPHY_LIMITS } from "./formula-philosophy.js";

/**
 * Value Codes 与龙德记价值映射（规格 §18 / §19 / §20 / §30 / §43 / §44 / §55）。
 *
 * 这一层只回答一个问题：**一款高价产品是在哪些底层条件上先赢了，才轮得到价格。**
 *
 * §43（Agent 5）要求分析高价产品为什么贵，维度为 品牌 / 身份 / 系列 / 年份 / 山头 / 原料 /
 * 工艺 / 风格 / 稀缺 / 陈化 / 流通 / 收藏群体，每项标 fact / inference / unknown，并输出 Value Codes；
 * §44（Agent 6）要求判断目标产品对这 16 个 Code 处于哪种状态，重点是「找出高价值产品形成之前
 * 就必须具备的底层条件」，**且不得把竞品事实移植过来**。
 *
 * 四条铁律直接写进类型与校验：
 * 1. 16 个 Code 固定、顺序固定（§18），每个 Code 必须有 `evidence` / `contribution` / `status`；
 * 2. 状态只有 5 种（§19）；事实不足一律 `UNKNOWN`，禁止把推测写成 fact（§11 / §62-7）；
 * 3. `TIME_DEPENDENT` **不得**写成「以后一定会有。」，成交层只能是固定安全句式（§19）；
 * 4. 证据只引用**本产品**已录入事实与 Value DNA；对标只提供「标准」，不提供「本产品的事实」（§44 / §62-5）。
 */

export const VALUE_CODE_COUNT = valueCodeKeys.length;

export const VALUE_CODE_LIMITS = {
  /** 单产品保留的历史价值映射版本上限（所有版本必须保留，这里只限制活跃版本数） */
  maxProfilesPerProduct: 20,
  defaultPageSize: 20,
  maxPageSize: 100,
  /** 同一 Code 最多摘录多少条 DNA 证据，避免证据列表被单维度刷满 */
  maxDnaEvidencePerCode: 3
} as const;

/* ------------------------------------------------ §43 十二个分析维度 */

export const valueCodeAnalysisDimensions = [
  "BRAND",
  "IDENTITY",
  "SERIES",
  "VINTAGE",
  "ORIGIN",
  "MATERIAL",
  "CRAFT",
  "STYLE",
  "SCARCITY",
  "AGING",
  "LIQUIDITY",
  "COLLECTION_GROUP"
] as const;
export const valueCodeAnalysisDimensionSchema = z.enum(valueCodeAnalysisDimensions);
export type ValueCodeAnalysisDimension = z.infer<typeof valueCodeAnalysisDimensionSchema>;

/** 顺序与 §43 原文一致，不得重排（重排等于改口径）。 */
export const VALUE_CODE_DIMENSION_LABELS: Record<ValueCodeAnalysisDimension, string> = {
  BRAND: "品牌",
  IDENTITY: "身份",
  SERIES: "系列",
  VINTAGE: "年份",
  ORIGIN: "山头",
  MATERIAL: "原料",
  CRAFT: "工艺",
  STYLE: "风格",
  SCARCITY: "稀缺",
  AGING: "陈化",
  LIQUIDITY: "流通",
  COLLECTION_GROUP: "收藏群体"
};

/* ------------------------------------------------------------ §19 状态 */

/** 成交层唯一允许的 TIME_DEPENDENT 表达（§19 原文）。 */
export const TIME_DEPENDENT_SAFE_EXPRESSION = "今天看的是它有没有把未来需要的底子先做好。";

/** §19 明确禁止的写法，保留为常量用于测试断言与前端提示。 */
export const TIME_DEPENDENT_FORBIDDEN_EXPRESSION = "以后一定会有。";

export const VALUE_CODE_STATUS_ORDER: readonly ValueCodeStatus[] = [
  "ALREADY_HAVE",
  "PARTIAL",
  "TIME_DEPENDENT",
  "NOT_HAVE",
  "UNKNOWN"
];

export const VALUE_CODE_STATUS_META = [
  {
    status: "ALREADY_HAVE" as const,
    label: "已经具备",
    short_label: "已具备",
    tone: "ok",
    meaning: "本产品已录入的事实足以支撑这个 Code（至少两条可交叉印证的记录）",
    rule: "可以直接进入价值叙事与成交表达，但只能说已录入的事实"
  },
  {
    status: "PARTIAL" as const,
    label: "部分具备",
    short_label: "单点事实",
    tone: "warn",
    meaning: "只有一条事实记录，方向对但还不足以放大",
    rule: "先补到可交叉印证的粒度，再放大表达；不得用单点事实撑成交"
  },
  {
    status: "TIME_DEPENDENT" as const,
    label: "时间依赖",
    short_label: "时间依赖",
    tone: "info",
    meaning: "今天还不成立，但已具备未来成立所需的底层条件（陈化 / 流通 / 收藏认知）",
    rule: `成交层只能写固定句式「${TIME_DEPENDENT_SAFE_EXPRESSION}」，不得承诺「${TIME_DEPENDENT_FORBIDDEN_EXPRESSION}」`
  },
  {
    status: "NOT_HAVE" as const,
    label: "不具备",
    short_label: "不具备",
    tone: "danger",
    meaning: "已录入事实明确排除了这个 Code（例如原料记录为台地小树），不是没录，而是不成立",
    rule: "必须写清是哪条已录入事实排除了它；不当成交点用，也不改写事实"
  },
  {
    status: "UNKNOWN" as const,
    label: "未录入（不得书写）",
    short_label: "未录入",
    tone: "danger",
    meaning: "没有可用于判断的事实记录",
    rule: "一律 UNKNOWN，禁止补全、禁止推测；只能写进缺口清单（§11 / §62-7）"
  }
] as const;

export const VALUE_CODE_STATUS_LABELS: Record<ValueCodeStatus, string> = {
  ALREADY_HAVE: "已经具备",
  PARTIAL: "部分具备",
  TIME_DEPENDENT: "时间依赖",
  NOT_HAVE: "不具备",
  UNKNOWN: "未录入（不得书写）"
};

export const VALUE_CODE_STATUS_SHORT_LABELS: Record<ValueCodeStatus, string> = {
  ALREADY_HAVE: "已具备",
  PARTIAL: "单点事实",
  TIME_DEPENDENT: "时间依赖",
  NOT_HAVE: "不具备",
  UNKNOWN: "未录入"
};

export const VALUE_CODE_STATUS_TONES: Record<ValueCodeStatus, "ok" | "warn" | "info" | "danger"> = {
  ALREADY_HAVE: "ok",
  PARTIAL: "warn",
  TIME_DEPENDENT: "info",
  NOT_HAVE: "danger",
  UNKNOWN: "danger"
};

/* --------------------------------------------------------- §18 16 个 Code */

export interface ValueCodeMeta {
  code: ValueCodeKey;
  label: string;
  /** 这个 Code 到底在说什么（内部分析口径） */
  definition: string;
  /** §43 的哪个 / 哪些分析维度会产出它 */
  dimensions: readonly ValueCodeAnalysisDimension[];
  /** §44 的底层条件：高价值产品形成之前就必须具备什么 */
  requirement: string;
  /** 这个 Code 对「为什么贵得起」的贡献（INTERPRETATION） */
  contribution: string;
  /** 只允许引用本产品的这些事实字段（product.* / dna.*） */
  evidence_refs: readonly string[];
  /** 是否属于「今天不成立、看未来底子」的时间依赖型 Code */
  time_dependent: boolean;
  spec_ref: string;
}

/**
 * 16 个 Value Code 的固定清单（§18 顺序）。
 *
 * `requirement` / `contribution` 是内部分析口径，不是对产品的断言；
 * 只有 `evidence` 里出现的事实才允许进入前台表达（§24 三层标记）。
 */
export const VALUE_CODE_META: readonly ValueCodeMeta[] = [
  {
    code: "PEACOCK_IDENTITY",
    label: "孔雀身份",
    definition: "产品有一个能被记住、能被复述的身份符号（命名体系 / 系列身份 / 视觉母题），不是同类里的泛称。",
    dimensions: ["IDENTITY"],
    requirement: "讲价格之前，先有一个一句话说得清、且能被记住的身份符号。",
    contribution: "身份符号决定别人怎么记住它：没有身份，价格就只能靠参数解释。",
    evidence_refs: ["product.series_name", "product.tea_subtype", "dna.identity", "dna.naming_concepts"],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "CORE_ORIGIN",
    label: "核心产区",
    definition: "产区骨架明确到可核查的山头 / 村寨 / 区域，而不是泛泛的省份。",
    dimensions: ["ORIGIN"],
    requirement: "骨架层必须落到具体山头或村寨，浓强才会被当成风格而不是重口味。",
    contribution: "骨架层决定「有结构」还是「只有味道」。",
    evidence_refs: [
      "product.mountain",
      "product.village",
      "product.origin_region",
      "product.origin_city",
      "product.origin_province",
      "dna.origin"
    ],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "PREMIUM_MATERIAL",
    label: "高端原料",
    definition: "原料类型 / 树型 / 树龄 / 季节 / 等级说得清楚，并指向高端原料。",
    dimensions: ["MATERIAL"],
    requirement: "底气层必须说得清，且不能拿台地 / 小树的口径当高端原料讲。",
    contribution: "底气层决定高端定位是真底气，还是包装撑出来的。",
    evidence_refs: [
      "product.raw_material",
      "product.tree_type",
      "product.tree_age",
      "product.season",
      "product.grade",
      "dna.material"
    ],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "FORMULA_ARCHITECTURE",
    label: "配方结构",
    definition: "系列 / 配方结构清楚：谁负责骨架、谁负责香气、谁负责甜感与后半程。",
    dimensions: ["SERIES"],
    requirement: "配方层要有明确分工，而不是把原料堆在一起。",
    contribution: "配方结构决定它是一款「设计出来」的产品，还是一批「凑出来」的产品。",
    evidence_refs: [
      "product.blend_description",
      "product.series_name",
      "dna.architecture_signals",
      "dna.positioning"
    ],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "SMOKY_SIGNATURE",
    label: "烟香签名",
    definition: "烟香构成可辨识的嗅觉签名（干茶 / 杯香 / 汤香任一层有记录）。",
    dimensions: ["STYLE"],
    requirement: "风格层要有一个一入口就能被记住的嗅觉签名。",
    contribution: "辨识度越高，越容易被复述、被转述、被记住。",
    evidence_refs: [
      "product.dry_leaf_aroma",
      "product.hot_cup_aroma",
      "product.liquor_aroma",
      "dna.flavor"
    ],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "STRONG_BODY",
    label: "浓强茶汤",
    definition: "入口滋味浓强，汤感有厚度与存在感。",
    dimensions: ["STYLE"],
    requirement: "第一口必须打出存在感，否则后面讲什么都没人听。",
    contribution: "第一口决定后面所有解释有没有人愿意听。",
    evidence_refs: [
      "product.entry_taste",
      "product.thickness",
      "product.bitterness",
      "product.astringency",
      "product.viscosity",
      "product.water_texture",
      "dna.taste"
    ],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "FAST_HUIGAN",
    label: "回甘快",
    definition: "回甘记录明确，且节奏快、接得住。",
    dimensions: ["STYLE"],
    requirement: "后半程要接得住：回甘跟不上，前半程再猛也撑不长。",
    contribution: "后半程决定这款茶能不能撑起长线定位。",
    evidence_refs: ["product.huigan", "product.sweetness", "product.late_stage", "product.finish"],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "STRONG_SALIVATION",
    label: "生津强",
    definition: "生津记录明确，强度高，能延续到中后段。",
    dimensions: ["STYLE"],
    requirement: "生津必须接得住，否则汤感强只是一次性冲击。",
    contribution: "生津决定喝完之后还有没有回味，直接影响复购与口碑。",
    evidence_refs: ["product.salivation", "product.middle_stage", "product.endurance"],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "CHA_QI",
    label: "茶气",
    definition: "茶气记录明确，体感能被描述。",
    dimensions: ["STYLE"],
    requirement: "茶气是高端体感层，必须有记录才允许讲。",
    contribution: "茶气把「好喝」抬到「有体感」，是高端叙事里少见的硬体验。",
    evidence_refs: ["product.cha_qi", "product.early_stage"],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "SCARCITY",
    label: "稀缺性",
    definition: "由原料 / 批次 / 等级带来的稀缺属性，只用已录入事实说明。",
    dimensions: ["SCARCITY"],
    requirement: "稀缺必须是可核查的事实，不能靠形容词，也不能推测产量。",
    contribution: "稀缺决定价格上限还有多少弹性。",
    evidence_refs: ["product.tree_age", "product.harvest_standard", "product.grade", "product.season"],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "AGE_VALUE",
    label: "陈化价值",
    definition: "具备长期陈化的底子：原料、工艺与存放条件支持时间增值。",
    dimensions: ["VINTAGE", "AGING"],
    requirement: `陈化价值看的是今天有没有把未来需要的底子先做好（§19：只能说「${TIME_DEPENDENT_SAFE_EXPRESSION}」）。`,
    contribution: TIME_DEPENDENT_SAFE_EXPRESSION,
    evidence_refs: [
      "product.raw_material",
      "product.tree_type",
      "product.tree_age",
      "product.season",
      "product.kill_green_method",
      "product.drying_method",
      "product.pressing_method",
      "product.storage",
      "dna.material",
      "dna.process"
    ],
    time_dependent: true,
    spec_ref: "§18 / §19 / §43"
  },
  {
    code: "BRAND_PREMIUM",
    label: "品牌溢价",
    definition: "品牌与系列本身具备溢价认知（有品牌归属与系列身份记录）。",
    dimensions: ["BRAND"],
    requirement: "品牌溢价是长期形成的，但它由系列身份与产品结构一层层堆出来。",
    contribution: "品牌溢价决定它不是一饼孤立的茶，而是一个体系里的一个位置。",
    evidence_refs: ["product.brand_name", "product.series_name", "dna.positioning", "dna.identity"],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "COLLECTION_RECOGNITION",
    label: "收藏认知",
    definition: "被收藏群体识别、讨论、愿意长期持有的属性。",
    dimensions: ["COLLECTION_GROUP"],
    requirement: `收藏认知需要时间沉淀，但要先看清今天有没有把未来需要的底子做好（§19：只能说「${TIME_DEPENDENT_SAFE_EXPRESSION}」）。`,
    contribution: TIME_DEPENDENT_SAFE_EXPRESSION,
    evidence_refs: ["product.series_name", "product.tree_age", "product.grade", "dna.collection", "dna.identity"],
    time_dependent: true,
    spec_ref: "§18 / §19 / §43"
  },
  {
    code: "MARKET_LIQUIDITY",
    label: "市场流通性",
    definition: "在市场上能被识别、能被交易、有人接盘。",
    dimensions: ["LIQUIDITY"],
    requirement: `流通性是市场长期给出的结果，今天只能检查它的底子是否已经具备（§19：只能说「${TIME_DEPENDENT_SAFE_EXPRESSION}」）。`,
    contribution: TIME_DEPENDENT_SAFE_EXPRESSION,
    evidence_refs: ["product.series_name", "product.brand_name", "dna.collection", "dna.positioning"],
    time_dependent: true,
    spec_ref: "§18 / §19 / §43"
  },
  {
    code: "STYLE_RECOGNITION",
    label: "风格辨识度",
    definition: "整体风格可被命名、可被区分、可被复述，而不是只有某一个感官维度。",
    dimensions: ["STYLE"],
    requirement: "风格必须能被命名，否则只能靠价格解释。",
    contribution: "风格辨识度决定它在同类里是不是一眼就能被认出来。",
    evidence_refs: [
      "product.dry_leaf_aroma",
      "product.hot_cup_aroma",
      "product.entry_taste",
      "product.thickness",
      "product.cha_qi",
      "dna.identity",
      "dna.flavor",
      "dna.taste",
      "dna.category"
    ],
    time_dependent: false,
    spec_ref: "§18 / §43"
  },
  {
    code: "CRAFT_VALUE",
    label: "工艺价值",
    definition: "杀青 / 揉捻 / 干燥 / 压制 / 发酵等工艺做法明确且可控。",
    dimensions: ["CRAFT"],
    requirement: "工艺不可控，前面的原料与产区都白给。",
    contribution: "工艺价值是原料能不能变成结构的分水岭。",
    evidence_refs: [
      "product.kill_green_method",
      "product.rolling_method",
      "product.drying_method",
      "product.pressing_method",
      "product.fermentation_degree",
      "product.fermentation_method",
      "product.storage",
      "product.processing_notes",
      "dna.process"
    ],
    time_dependent: false,
    spec_ref: "§18 / §43"
  }
];

export const VALUE_CODE_META_BY_KEY: Record<ValueCodeKey, ValueCodeMeta> = Object.fromEntries(
  VALUE_CODE_META.map((meta) => [meta.code, meta])
) as Record<ValueCodeKey, ValueCodeMeta>;

/**
 * §44：Code 被明确排除（NOT_HAVE）时，必须能指到具体已录入事实。
 * 只有「事实写明不支持」才允许 NOT_HAVE；没有记录一律 UNKNOWN。
 */
export const VALUE_CODE_NEGATIONS: Partial<
  Record<ValueCodeKey, readonly { field: string; pattern: RegExp; reason: string }[]>
> = {
  PREMIUM_MATERIAL: [
    {
      field: "product.tree_type",
      pattern: /台地|小树|矮化/,
      reason: "已录入树型为台地 / 小树 / 矮化，不能按高端原料讲"
    },
    {
      field: "product.raw_material",
      pattern: /台地|小树|矮化|夏茶|秋茶/,
      reason: "已录入原料为台地 / 小树 / 夏秋茶，不能按高端原料讲"
    }
  ],
  AGE_VALUE: [
    {
      field: "product.tea_type",
      pattern: /绿茶|黄茶/,
      reason: "已录入茶类为绿茶 / 黄茶，不具备长期陈化的底子"
    }
  ]
};

/* ------------------------------------------------- §20 六类价值故事 */

export const valueStoryKeys = [
  "identity_story",
  "price_ceiling_story",
  "product_architecture_story",
  "formula_philosophy_story",
  "flavor_identity_story",
  "time_story"
] as const;
export const valueStoryKeySchema = z.enum(valueStoryKeys);
export type ValueStoryKey = z.infer<typeof valueStoryKeySchema>;

export const VALUE_STORY_LABELS: Record<ValueStoryKey, string> = {
  identity_story: "身份故事（Identity Story）",
  price_ceiling_story: "价格上限故事（Price Ceiling Story）",
  product_architecture_story: "产品结构故事（Product Architecture Story）",
  formula_philosophy_story: "配方哲学故事（Formula Philosophy Story）",
  flavor_identity_story: "风味身份故事（Flavor Identity Story）",
  time_story: "时间故事（Time Story）"
};

export const valueStoryStatuses = ["READY", "PARTIAL", "GAP", "HANDOFF"] as const;
export const valueStoryStatusSchema = z.enum(valueStoryStatuses);
export type ValueStoryStatus = z.infer<typeof valueStoryStatusSchema>;

export const VALUE_STORY_STATUS_LABELS: Record<ValueStoryStatus, string> = {
  READY: "可讲",
  PARTIAL: "只够单点事实",
  GAP: "事实不足（不得书写）",
  HANDOFF: "由后续 Phase 交付"
};

/**
 * 已无交接中的价值故事：六类故事全部由当前 Phase 正面提供正文。
 *
 * 产品结构故事（§5 / §20）在 Phase 10 落地后不再交接；配方哲学故事（§6 / §20）在 Phase 11 落地后同样不再交接：
 * 产品有配方哲学时直接取它的设计逻辑正文，没有则留空写缺口（GAP），不允许退回 Code 拼装的简化版（§60）。
 * 这张表保留为空对象，后续若再出现「必须整段交接」的故事，仍在这里登记交付 Phase。
 */
export const VALUE_STORY_HANDOFF_PHASES: Partial<Record<ValueStoryKey, number>> = {};

export const valueStorySchema = z
  .object({
    label: z.string(),
    status: valueStoryStatusSchema,
    /** 故事正文；GAP / HANDOFF 时必须为 null（宁可留空，不得编） */
    text: z.string().nullable(),
    /** §24 三层标记：故事属于解释还是修辞 */
    layer: z.enum(["INTERPRETATION", "RHETORIC"]),
    /** 这个故事引用了哪些 Value Code */
    based_on: z.array(valueCodeKeySchema),
    gap: z.string().nullable(),
    /** 非 null 表示完整内容由该 Phase 交付 */
    handoff_phase: z.number().int().positive().nullable(),
    note: z.string().nullable()
  })
  .refine((story) => story.status !== "GAP" || story.text === null, {
    message: "GAP 故事不得携带正文：事实不足时宁可留空",
    path: ["text"]
  })
  .refine((story) => story.status !== "HANDOFF" || (story.text === null && story.handoff_phase !== null), {
    message: "HANDOFF 故事必须留空并标明交付 Phase",
    path: ["handoff_phase"]
  });
export type ValueStory = z.infer<typeof valueStorySchema>;

export const valueStoriesSchema = z
  .object({
    identity_story: valueStorySchema,
    price_ceiling_story: valueStorySchema,
    product_architecture_story: valueStorySchema,
    formula_philosophy_story: valueStorySchema,
    flavor_identity_story: valueStorySchema,
    time_story: valueStorySchema
  })
  .strict();
export type ValueStories = z.infer<typeof valueStoriesSchema>;

export function storyList(stories: ValueStories): { key: ValueStoryKey; story: ValueStory }[] {
  return valueStoryKeys.map((key) => ({ key, story: stories[key] }));
}

/* ------------------------------------------------------------ Item / 聚合 */

export const valueCodeItemSchema = z
  .object({
    code: valueCodeKeySchema,
    label: z.string(),
    definition: z.string(),
    dimensions: z.array(valueCodeAnalysisDimensionSchema).min(1),
    /** §44 的底层条件：高价值产品形成之前就必须具备什么 */
    requirement: z.string(),
    /** §18 的 contribution：这个 Code 对「为什么贵得起」的贡献 */
    contribution: z.string(),
    /** §18 的 evidence：只引用本产品已录入事实（product.* / dna.*） */
    evidence: z.array(z.string()),
    evidence_refs: z.array(z.string()),
    /** §18 的 status */
    status: valueCodeStatusSchema,
    status_reason: z.string(),
    /** 前台表达；UNKNOWN 必须为 null */
    statement: z.string().nullable(),
    /** TIME_DEPENDENT 必须等于 §19 的固定安全句式 */
    safe_expression: z.string().nullable(),
    gap: z.string().nullable(),
    layer: z.literal("INTERPRETATION")
  })
  .strict()
  .refine((item) => item.status !== "UNKNOWN" || item.statement === null, {
    message: "UNKNOWN 的 Code 不得携带前台表达（§11 / §62-7）",
    path: ["statement"]
  })
  .refine((item) => (item.status === "TIME_DEPENDENT") === (item.safe_expression === TIME_DEPENDENT_SAFE_EXPRESSION), {
    message: `TIME_DEPENDENT 的成交表达只能是固定句式「${TIME_DEPENDENT_SAFE_EXPRESSION}」（§19）`,
    path: ["safe_expression"]
  })
  .refine(
    (item) =>
      item.status !== "TIME_DEPENDENT" || item.statement === TIME_DEPENDENT_SAFE_EXPRESSION,
    {
      message: `TIME_DEPENDENT 的 statement 必须等于 §19 的固定句式，不得写成「${TIME_DEPENDENT_FORBIDDEN_EXPRESSION}」`,
      path: ["statement"]
    }
  )
  .refine(
    (item) =>
      !(item.statement ?? "").includes(TIME_DEPENDENT_FORBIDDEN_EXPRESSION) &&
      !(item.contribution ?? "").includes(TIME_DEPENDENT_FORBIDDEN_EXPRESSION),
    {
      message: `任何 Code 都不得出现「${TIME_DEPENDENT_FORBIDDEN_EXPRESSION}」（§19）`,
      path: ["statement"]
    }
  );
export type ValueCodeItem = z.infer<typeof valueCodeItemSchema>;

export const valueCodeCountsSchema = z.record(valueCodeStatusSchema, z.number().int().nonnegative());
export type ValueCodeCounts = z.infer<typeof valueCodeCountsSchema>;

/* ------------------------------------------------------------ API 对象 */

export const valueCodeAnchorContextSchema = z
  .object({
    anchor_id: z.string().uuid().nullable(),
    name: z.string().nullable(),
    similarity_score: z.number().min(0).max(100).nullable(),
    price_evidence_score: z.number().min(0).max(100).nullable(),
    /** 对标只提供「标准」，不提供「本产品的事实」（§44 / §62-5） */
    usage: z.literal("STANDARD_ONLY")
  })
  .strict();
export type ValueCodeAnchorContext = z.infer<typeof valueCodeAnchorContextSchema>;

export const valueCodeProfileSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    version: z.number().int().positive(),
    preference: researchModeSchema,
    mode_at_generation: resolvedResearchModeSchema,
    resolved_by: anchorResolveSourceSchema,
    mode_reason: z.string(),
    /** 对标上下文：只用于说明「高价值产品需要什么底层条件」，不作为本产品证据 */
    anchor_context: valueCodeAnchorContextSchema.nullable(),
    codes: z.array(valueCodeItemSchema).length(VALUE_CODE_COUNT),
    code_counts: valueCodeCountsSchema,
    stories: valueStoriesSchema,
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
    spec_ref: z.literal("§18 / §19 / §20")
  })
  .strict();
export type ValueCodeProfileView = z.infer<typeof valueCodeProfileSchema>;

export const valueCodeVersionSummarySchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    mode_at_generation: resolvedResearchModeSchema,
    resolved_by: anchorResolveSourceSchema,
    code_counts: valueCodeCountsSchema,
    time_dependent_count: z.number().int().nonnegative(),
    unknown_count: z.number().int().nonnegative(),
    is_confirmed: z.boolean(),
    created_at: z.string()
  })
  .strict();
export type ValueCodeVersionSummary = z.infer<typeof valueCodeVersionSummarySchema>;

export const valueCodeOverviewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    preference: researchModeSchema,
    mode: resolvedResearchModeSchema,
    resolved_by: anchorResolveSourceSchema,
    mode_reason: z.string(),
    /** 当前是否还能生成新版价值映射，以及不能生成的原因 */
    can_generate: z.boolean(),
    block_reason: z.string().nullable(),
    profile: valueCodeProfileSchema.nullable(),
    versions: z.array(valueCodeVersionSummarySchema),
    spec_ref: z.literal("§18 / §19 / §20")
  })
  .strict();
export type ValueCodeOverview = z.infer<typeof valueCodeOverviewSchema>;

/** 价值密码库（§31 一级导航）的跨产品行：只做检索与复盘，不改写任何产品事实。 */
export const valueCodeMatrixRowSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    year: z.number().int(),
    tea_type: z.string(),
    mountain: z.string().nullable(),
    mode: resolvedResearchModeSchema,
    preference: researchModeSchema,
    profile_id: z.string().uuid().nullable(),
    version: z.number().int().positive().nullable(),
    is_confirmed: z.boolean(),
    code_counts: valueCodeCountsSchema,
    time_dependent_codes: z.array(valueCodeKeySchema),
    unknown_codes: z.array(valueCodeKeySchema),
    already_have_codes: z.array(valueCodeKeySchema),
    /** §19 的固定安全句式；没有 TIME_DEPENDENT 时为 null */
    time_dependent_expression: z.string().nullable(),
    generated_at: z.string().nullable(),
    spec_ref: z.literal("§18 / §19 / §20")
  })
  .strict();
export type ValueCodeMatrixRow = z.infer<typeof valueCodeMatrixRowSchema>;

export const valueCodeGenerateSchema = z
  .object({
    notes: z.string().trim().max(2000).optional()
  })
  .strict();
export type ValueCodeGenerateInput = z.infer<typeof valueCodeGenerateSchema>;

export const valueCodeUpdateSchema = z
  .object({
    is_confirmed: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type ValueCodeUpdateInput = z.infer<typeof valueCodeUpdateSchema>;

export const valueCodeSortSchema = z.enum([
  "-updated_at",
  "updated_at",
  "product_name",
  "-product_name",
  "-unknown_count",
  "-time_dependent_count"
]);
export type ValueCodeSort = z.infer<typeof valueCodeSortSchema>;

export const valueCodeListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(VALUE_CODE_LIMITS.maxPageSize).optional(),
    product_id: z.string().uuid().optional(),
    status: valueCodeStatusSchema.optional(),
    mode: resolvedResearchModeSchema.optional(),
    q: z.string().trim().max(200).optional(),
    sort: valueCodeSortSchema.optional()
  })
  .strict();
export type ValueCodeListQuery = z.infer<typeof valueCodeListQuerySchema>;

/* ---------------------------------------------------------- 下游交接 */

/**
 * 下游交接：已交付阶段不再登记（§60）。
 * 产品结构（Phase 10）与配方哲学（Phase 11）已交付并直接为正下方提供正文，
 * 因此本清单为空；六类价值故事的交接关系见 `rules` 与故事字段本身。
 */
export const VALUE_CODES_DOWNSTREAM: readonly CategoryDownstreamItem[] = [];

/** 供 API 自检与前端展示：16 个 Code、5 种状态与 §19 安全表达只从这里读取。 */
export const VALUE_CODES_CONTRACT = {
  spec_ref: "§18 / §19 / §20",
  codes: VALUE_CODE_META.map((meta) => ({
    code: meta.code,
    label: meta.label,
    definition: meta.definition,
    dimensions: meta.dimensions,
    requirement: meta.requirement,
    contribution: meta.contribution,
    evidence_refs: meta.evidence_refs,
    time_dependent: meta.time_dependent,
    spec_ref: meta.spec_ref
  })),
  dimensions: valueCodeAnalysisDimensions.map((dimension) => ({
    dimension,
    label: VALUE_CODE_DIMENSION_LABELS[dimension]
  })),
  statuses: VALUE_CODE_STATUS_META,
  stories: valueStoryKeys.map((key) => ({ key, label: VALUE_STORY_LABELS[key] })),
  time_dependent_safe_expression: TIME_DEPENDENT_SAFE_EXPRESSION,
  time_dependent_forbidden_expression: TIME_DEPENDENT_FORBIDDEN_EXPRESSION,
  /** §44 红线：竞品事实不得移植到自有产品 */
  no_competitor_fact_transplant: true,
  /** §19 红线：TIME_DEPENDENT 不得承诺未来 */
  time_dependent_not_promise: true,
  /** 未录入一律 UNKNOWN，不得补全（§11 / §62-7） */
  unknown_is_written_as_unknown: true,
  /** NOT_HAVE 必须能指到具体已录入事实 */
  not_have_requires_recorded_fact: true,
  /** 证据只引用本产品已录入事实与 Value DNA */
  evidence_only_from_own_product: true,
  downstream_phases: VALUE_CODES_DOWNSTREAM,
  rules: [
    "16 个 Value Code 与顺序由 §18 固定，不得增删或重排",
    "每个 Code 必须同时给出 evidence / contribution / status（§18）",
    "状态只有 ALREADY_HAVE / PARTIAL / TIME_DEPENDENT / NOT_HAVE / UNKNOWN 五种（§19）",
    `TIME_DEPENDENT 的成交层表达只能是「${TIME_DEPENDENT_SAFE_EXPRESSION}」，不得写成「${TIME_DEPENDENT_FORBIDDEN_EXPRESSION}」（§19）`,
    "未录入一律 UNKNOWN，禁止推测补全（§11 / §62-7）",
    "验证高价值原因只提供标准，不得把竞品事实移植到自有产品（§44 / §62-5）",
    "产品结构故事取 Phase 10 的产品结构正文（没有结构时留空写缺口），配方哲学由 Phase 11 交付；两者都不得用简化版代替（§60）"
  ]
} as const;

/* ------------------------------------------------------------ 纯函数构建器 */

/**
 * 产品侧输入：字段口径与自建标准（§10.1–§10.4）一致，
 * 再补上 Value Code 证据会用到、而六个标准轴没覆盖到的字段。
 */
export interface ValueCodeProductInput extends CategoryStandardProductInput {
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

export interface ValueCodeFactHit {
  /** 事实来源字段路径，例如 product.mountain / dna.identity */
  ref: string;
  value: string;
}

export interface ValueCodeBuildInput {
  product: ValueCodeProductInput;
  /** §9 Value DNA；未生成时传 null（11 维全空同样视同未生成） */
  value_dna: ValueDna | null;
  /** 已判定模式（§17）：高价值对标 / 自建高端标准 */
  mode: ResolvedResearchMode;
  /** 模式来源（与锚点引擎同一口径） */
  resolved_by: AnchorResolveSource;
  /** 对标上下文：只说明「高价值产品需要什么底层条件」，不作为本产品证据（§44） */
  anchor_context?: ValueCodeAnchorContext | null;
  /**
   * Phase 10 产品结构（§5 / §45）的最新一版：只用于填 `product_architecture_story`。
   * 未生成时传 null —— 那时故事留空写缺口，不得用 Code 拼一个简化版（§60）。
   */
  product_architecture?: ValueCodeArchitectureInput | null;
  /**
   * Phase 11 配方哲学（§6 / §46）的最新一版：只用于填 `formula_philosophy_story`。
   * 未生成时传 null —— 那时故事留空写缺口，不得用 Code 拼一个简化版（§60）。
   */
  formula_philosophy?: ValueCodePhilosophyInput | null;
}

/** 产品结构在价值叙事层的输入：只带九个角色正文、验收结果与叙事正文。 */
export interface ValueCodeArchitectureInput {
  /** 版本号（§62-15：所有版本必须保留，故事正文取最新一版） */
  version: number;
  /** 九个角色中写实（正文非空）的个数 */
  written_roles: number;
  /** §57 验收是否通过（骨架 / 香气 / 汤感 / 回甘 / 记忆点齐全） */
  acceptance_passed: boolean;
  /** §5 的结构叙事正文（各角色分工串成一段），不足 3 个写实角色时为空串 */
  narrative: string;
  /** 仍是 GAP 的角色短名，写进缺口清单供研究员补齐 */
  gap_role_labels: string[];
}

/** 配方哲学在价值叙事层的输入：只带设计逻辑正文、验收结果与分量覆盖。 */
export interface ValueCodePhilosophyInput {
  /** 版本号（§62-15：所有版本必须保留，故事正文取最新一版） */
  version: number;
  /** 五个分量中写实（正文非空）的个数 */
  written_components: number;
  /** §57 验收是否通过（设计逻辑成稿 + 没有编比例） */
  acceptance_passed: boolean;
  /** 设计逻辑是否成稿（写实分量 ≥ 2） */
  design_logic_ready: boolean;
  /** §6.2 / §46 的 `formula_strategy` 设计逻辑正文，不足 2 个写实分量时为空串 */
  strategy: string;
  /** 仍是 GAP 的分量短名，写进缺口清单供研究员补齐 */
  gap_component_labels: string[];
}

export interface ValueCodeDraft {
  codes: ValueCodeItem[];
  code_counts: ValueCodeCounts;
  stories: ValueStories;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
}

/** 时间依赖型 Code（§19）：今天不成立，只能表达「底子有没有先做好」。 */
export const VALUE_CODE_TIME_DEPENDENT_KEYS: readonly ValueCodeKey[] = VALUE_CODE_META.filter(
  (meta) => meta.time_dependent
).map((meta) => meta.code);

/**
 * 只认「本产品已录入字段」这张白名单。没在这里列出的字段路径一律取不到值，
 * 因此不可能把对标产品或模型补写的内容当成证据（§44 / §62-5 / §62-7）。
 */
function productFactValue(product: ValueCodeProductInput, ref: string): string | null {
  switch (ref) {
    case "product.product_name":
      return product.product_name;
    case "product.series_name":
      return product.series_name;
    case "product.tea_type":
      return product.tea_type;
    case "product.tea_subtype":
      return product.tea_subtype;
    case "product.origin_province":
      return product.origin_province;
    case "product.origin_city":
      return product.origin_city;
    case "product.origin_region":
      return product.origin_region;
    case "product.mountain":
      return product.mountain;
    case "product.village":
      return product.village;
    case "product.raw_material":
      return product.raw_material;
    case "product.tree_type":
      return product.tree_type;
    case "product.tree_age":
      return product.tree_age;
    case "product.season":
      return product.season;
    case "product.grade":
      return product.grade;
    case "product.harvest_standard":
      return product.harvest_standard;
    case "product.blend_description":
      return product.blend_description;
    case "product.kill_green_method":
      return product.kill_green_method;
    case "product.rolling_method":
      return product.rolling_method;
    case "product.drying_method":
      return product.drying_method;
    case "product.pressing_method":
      return product.pressing_method;
    case "product.fermentation_degree":
      return product.fermentation_degree;
    case "product.fermentation_method":
      return product.fermentation_method;
    case "product.storage":
      return product.storage;
    case "product.processing_notes":
      return product.processing_notes;
    case "product.dry_leaf_aroma":
      return product.dry_leaf_aroma;
    case "product.hot_cup_aroma":
      return product.hot_cup_aroma;
    case "product.liquor_aroma":
      return product.liquor_aroma;
    case "product.entry_taste":
      return product.entry_taste;
    case "product.bitterness":
      return product.bitterness;
    case "product.astringency":
      return product.astringency;
    case "product.sweetness":
      return product.sweetness;
    case "product.huigan":
      return product.huigan;
    case "product.salivation":
      return product.salivation;
    case "product.cha_qi":
      return product.cha_qi;
    case "product.thickness":
      return product.thickness;
    case "product.viscosity":
      return product.viscosity;
    case "product.water_texture":
      return product.water_texture;
    case "product.early_stage":
      return product.early_stage;
    case "product.middle_stage":
      return product.middle_stage;
    case "product.late_stage":
      return product.late_stage;
    case "product.finish":
      return product.finish;
    case "product.endurance":
      return product.endurance;
    case "product.brand_name":
      return product.brand_name;
    default:
      return null;
  }
}

/** 11 个维度全空的 DNA 视同「尚未生成」：不给证据，也不给它撑起任何 Code。 */
function usableValueDna(value_dna: ValueDna | null): ValueDna | null {
  if (!value_dna) {
    return null;
  }
  const hasContent = VALUE_DNA_DIMENSIONS.some((dimension) => (value_dna[dimension]?.length ?? 0) > 0);
  return hasContent ? value_dna : null;
}

/** 按 Code 声明的 evidence_refs 逐条回查已录入事实；查不到就是没录，不补全。 */
function codeHits(
  product: ValueCodeProductInput,
  dna: ValueDna | null,
  refs: readonly string[]
): ValueCodeFactHit[] {
  const hits: ValueCodeFactHit[] = [];
  for (const ref of refs) {
    if (ref.startsWith("dna.")) {
      const dimension = ref.slice(4);
      if (!(VALUE_DNA_DIMENSIONS as readonly string[]).includes(dimension)) {
        continue;
      }
      const values = dna?.[dimension as ValueDnaDimension] ?? [];
      for (const value of values.slice(0, VALUE_CODE_LIMITS.maxDnaEvidencePerCode)) {
        const trimmed = value.trim();
        if (trimmed) {
          hits.push({ ref, value: trimmed });
        }
      }
      continue;
    }
    const value = productFactValue(product, ref)?.trim();
    if (value) {
      hits.push({ ref, value });
    }
  }
  return hits;
}

interface ValueCodeNegationHit {
  field: string;
  reason: string;
}

/** NOT_HAVE 的前提：已录入事实明确排除，而不是「没录」。 */
function negationHit(product: ValueCodeProductInput, code: ValueCodeKey): ValueCodeNegationHit | null {
  const rules = VALUE_CODE_NEGATIONS[code];
  if (!rules) {
    return null;
  }
  for (const rule of rules) {
    const value = productFactValue(product, rule.field)?.trim();
    if (value && rule.pattern.test(value)) {
      return { field: rule.field, reason: `${rule.reason}（${rule.field}=${value}）` };
    }
  }
  return null;
}

function formatHitValues(hits: readonly ValueCodeFactHit[]): string {
  return hits.map((hit) => hit.value).join(" / ");
}

function buildCodeItem(
  product: ValueCodeProductInput,
  dna: ValueDna | null,
  meta: ValueCodeMeta
): ValueCodeItem {
  const hits = codeHits(product, dna, meta.evidence_refs);
  const negation = negationHit(product, meta.code);

  const status: ValueCodeStatus = negation
    ? "NOT_HAVE"
    : meta.time_dependent
      ? hits.length > 0
        ? "TIME_DEPENDENT"
        : "UNKNOWN"
      : hits.length >= 2
        ? "ALREADY_HAVE"
        : hits.length === 1
          ? "PARTIAL"
          : "UNKNOWN";

  const hitRefs = [...new Set(hits.map((hit) => hit.ref))];
  const statusReason =
    status === "ALREADY_HAVE"
      ? `已录入 ${hits.length} 条可交叉印证的事实：${hitRefs.join(" / ")}`
      : status === "PARTIAL"
        ? `只有 1 条事实记录：${hitRefs.join(" / ")}，不足以放大表达`
        : status === "TIME_DEPENDENT"
          ? `今天尚不成立，但底子已经录入：${hitRefs.join(" / ")}`
          : status === "NOT_HAVE"
            ? `已录入事实明确排除：${negation?.reason ?? "不成立"}`
            : "没有可用于判断的事实记录";

  const statement =
    status === "UNKNOWN"
      ? null
      : status === "TIME_DEPENDENT"
        ? TIME_DEPENDENT_SAFE_EXPRESSION
        : status === "NOT_HAVE"
          ? `已录入事实不支持这一项：${negation?.reason ?? "事实明确排除"}，因此不作为成交点使用。`
          : status === "PARTIAL"
            ? `${meta.label}的方向已经清楚（${formatHitValues(hits)}），但还只有单点事实，先补到可以交叉印证再用。`
            : `${meta.label}已经成立（${formatHitValues(hits)}）：${meta.contribution}`;

  const gap =
    status === "ALREADY_HAVE"
      ? null
      : status === "TIME_DEPENDENT"
        ? `今天尚不成立：成交层只能表达它的底子（${TIME_DEPENDENT_SAFE_EXPRESSION}）`
        : status === "NOT_HAVE"
          ? `已录入事实明确排除：${negation?.reason ?? "不成立"}`
          : status === "PARTIAL"
            ? `只有单点事实，先补齐到可交叉印证的粒度（${meta.evidence_refs.join(" / ")}）`
            : `未录入相关事实：${meta.evidence_refs.join(" / ")}（§11 / §62-7）`;

  return valueCodeItemSchema.parse({
    code: meta.code,
    label: meta.label,
    definition: meta.definition,
    dimensions: [...meta.dimensions],
    requirement: meta.requirement,
    contribution: meta.contribution,
    evidence: hits.map((hit) => `${hit.ref}=${hit.value}`),
    evidence_refs: hitRefs,
    status,
    status_reason: statusReason,
    statement,
    safe_expression: status === "TIME_DEPENDENT" ? TIME_DEPENDENT_SAFE_EXPRESSION : null,
    gap,
    layer: "INTERPRETATION"
  });
}

/* ---------------------------------------------------------- 六类价值故事 */

interface ValueStoryDefinition {
  key: ValueStoryKey;
  codes: readonly ValueCodeKey[];
  /** 这个故事回答的问题（不新增任何事实断言） */
  lead: string;
}

/** 故事 → Code 的映射固定，防止「先写故事再找证据」。 */
const VALUE_STORY_DEFINITIONS: readonly ValueStoryDefinition[] = [
  {
    key: "identity_story",
    codes: ["PEACOCK_IDENTITY", "STYLE_RECOGNITION", "BRAND_PREMIUM"],
    lead: "身份故事回答「别人凭什么记住它」"
  },
  {
    key: "price_ceiling_story",
    codes: ["SCARCITY", "BRAND_PREMIUM", "AGE_VALUE", "COLLECTION_RECOGNITION", "MARKET_LIQUIDITY"],
    lead: "价格上限故事回答「价格还剩多少弹性」"
  },
  {
    key: "product_architecture_story",
    codes: ["FORMULA_ARCHITECTURE", "CORE_ORIGIN", "PREMIUM_MATERIAL"],
    lead: "产品结构故事回答「它由哪几层撑起来」"
  },
  {
    key: "formula_philosophy_story",
    codes: ["FORMULA_ARCHITECTURE", "CRAFT_VALUE"],
    lead: "配方哲学故事回答「为什么这样配」"
  },
  {
    key: "flavor_identity_story",
    codes: ["SMOKY_SIGNATURE", "STRONG_BODY", "FAST_HUIGAN", "STRONG_SALIVATION", "CHA_QI", "STYLE_RECOGNITION"],
    lead: "风味身份故事回答「喝起来是什么」"
  },
  {
    key: "time_story",
    codes: ["AGE_VALUE", "COLLECTION_RECOGNITION", "MARKET_LIQUIDITY"],
    lead: "时间故事回答「时间会怎么对它」"
  }
];

function firstEvidenceValue(item: ValueCodeItem): string | null {
  const first = item.evidence[0];
  if (!first) {
    return null;
  }
  const index = first.indexOf("=");
  return index >= 0 ? first.slice(index + 1) : first;
}

function describeItems(items: readonly ValueCodeItem[]): string {
  return items.map((item) => `${item.label}（${firstEvidenceValue(item) ?? "已录入事实"}）`).join("、");
}

/** 模式来源的人话说明（与锚点引擎同一口径）。 */
function resolvedByText(resolvedBy: AnchorResolveSource): string {
  switch (resolvedBy) {
    case "AUTO_ANCHOR":
      return "自动锚点仍然成立";
    case "MANUAL_PREFERENCE":
      return "产品负责人指定了模式";
    case "NO_RELIABLE_ANCHOR":
      return "没有任何候选同时满足 Similarity ≥ 70 与 PriceEvidence ≥ 75";
  }
}

/** 价格上限故事的来源声明：对标只提供标准，绝不提供本产品的事实（§44 / §62-5）。 */
function priceCeilingNote(input: ValueCodeBuildInput): string {
  if (input.mode === "CATEGORY_CREATOR") {
    return `当前走自建高端标准（${resolvedByText(input.resolved_by)}）：价格上限由自身结构决定，不得照抄任何竞品（§4.2 / §62-5）。`;
  }
  const name = input.anchor_context?.name;
  return `${name ? `对标「${name}」` : "对标"}只提供「高价值产品需要什么底层条件」这一层标准，本产品的事实全部来自自身录入（§44 / §62-5）。`;
}

/**
 * 产品结构故事（§5 / §20）：正文直接取 Phase 10 的产品结构叙事，不新增任何事实。
 *
 * - 有结构且 §57 验收通过 → READY；
 * - 有结构但写实角色不足验收要求 → PARTIAL（正文照给，缺口写明缺哪几个角色）；
 * - 没有结构，或写实角色不足 3 个（`value_role` 不成立，叙事为空）→ GAP：留空 + 指回产品结构页。
 *
 * 任何一种情况都**不允许**退回「用 Value Code 拼一段简化版结构」（§60）。
 */
function buildArchitectureStory(
  input: ValueCodeBuildInput,
  definition: ValueStoryDefinition
): ValueStory {
  const architecture = input.product_architecture ?? null;
  const minRoles = PRODUCT_ARCHITECTURE_LIMITS.minWrittenRolesForValueRole;
  const text = architecture?.narrative.trim() ?? "";

  if (!architecture) {
    return valueStorySchema.parse({
      label: VALUE_STORY_LABELS[definition.key],
      status: "GAP",
      text: null,
      layer: "INTERPRETATION",
      based_on: [...definition.codes],
      gap: `${definition.lead}：尚未生成产品结构（§5 / §45），先在产品详情「产品结构」里生成一版；本阶段不得用简化版代替（§60）`,
      handoff_phase: null,
      note: "产品结构故事由 Phase 10 的产品结构正文提供，本阶段只做引用，不新增事实（§45 / §62-5）。"
    });
  }

  if (text.length === 0) {
    return valueStorySchema.parse({
      label: VALUE_STORY_LABELS[definition.key],
      status: "GAP",
      text: null,
      layer: "INTERPRETATION",
      based_on: [...definition.codes],
      gap: `${definition.lead}：产品结构第 ${architecture.version} 版的写实角色只有 ${architecture.written_roles} 个，不足 ${minRoles} 个，价值位不成立；先补：${
        architecture.gap_role_labels.join("、") || "相关事实"
      }（§5 / §11 / §62-7）`,
      handoff_phase: null,
      note: "缺口来自产品结构本身：事实不齐时不输出任何结构叙事（§11 / §62-7）。"
    });
  }

  const status: ValueStoryStatus = architecture.acceptance_passed
    ? "READY"
    : architecture.written_roles >= minRoles
      ? "PARTIAL"
      : "GAP";

  return valueStorySchema.parse({
    label: VALUE_STORY_LABELS[definition.key],
    status,
    text: status === "GAP" ? null : text,
    layer: "INTERPRETATION",
    based_on: [...definition.codes],
    gap:
      status === "READY"
        ? null
        : `${definition.lead}：§57 验收还缺 ${architecture.gap_role_labels.join("、") || "部分角色"}，写实角色 ${architecture.written_roles} 个（先补 §5 / §45 里的事实）`,
    handoff_phase: null,
    note: `正文取产品结构第 ${architecture.version} 版的叙事段落，逐条可回查到本产品已录入事实（§45 / §62-5）。`
  });
}

/**
 * 配方哲学故事（§6 / §20）：正文直接取 Phase 11 的配方哲学设计逻辑，不新增任何事实。
 *
 * - 有配方哲学且 §57 验收通过（设计逻辑成稿 + 没有编比例）→ READY；
 * - 有设计逻辑但写实分量不足 / 验收未过 → PARTIAL（正文照给，缺口写明缺哪几个分量）；
 * - 没有配方哲学，或写实分量不足 2 个导致设计逻辑为空 → GAP：留空 + 指回配方哲学页。
 *
 * 任何一种情况都**不允许**退回「用 Value Code 拼一段简化版配方哲学」（§60）。
 */
function buildFormulaPhilosophyStory(
  input: ValueCodeBuildInput,
  definition: ValueStoryDefinition
): ValueStory {
  const philosophy = input.formula_philosophy ?? null;
  const minComponents = FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy;
  const text = philosophy?.strategy.trim() ?? "";

  if (!philosophy) {
    return valueStorySchema.parse({
      label: VALUE_STORY_LABELS[definition.key],
      status: "GAP",
      text: null,
      layer: "INTERPRETATION",
      based_on: [...definition.codes],
      gap: `${definition.lead}：尚未生成配方哲学（§6 / §46），先在产品详情「配方哲学」里生成一版；本阶段不得用简化版代替（§60）`,
      handoff_phase: null,
      note: "配方哲学故事由 Phase 11 的设计逻辑正文提供，本阶段只做引用，不新增事实（§6.1 / §46）。"
    });
  }

  if (text.length === 0) {
    return valueStorySchema.parse({
      label: VALUE_STORY_LABELS[definition.key],
      status: "GAP",
      text: null,
      layer: "INTERPRETATION",
      based_on: [...definition.codes],
      gap: `${definition.lead}：配方哲学第 ${philosophy.version} 版写实的分量只有 ${philosophy.written_components} 个，不足 ${minComponents} 个，设计逻辑不成立；先补：${
        philosophy.gap_component_labels.join("、") || "相关事实"
      }（§6.2 / §11 / §62-7）`,
      handoff_phase: null,
      note: "缺口来自配方哲学本身：没有比例时不编比例，事实不齐时不硬写设计逻辑（§6.1 / §11）。"
    });
  }

  const status: ValueStoryStatus =
    philosophy.acceptance_passed && philosophy.design_logic_ready
      ? "READY"
      : philosophy.written_components >= minComponents
        ? "PARTIAL"
        : "GAP";

  return valueStorySchema.parse({
    label: VALUE_STORY_LABELS[definition.key],
    status,
    text: status === "GAP" ? null : text,
    layer: "INTERPRETATION",
    based_on: [...definition.codes],
    gap:
      status === "READY"
        ? null
        : `${definition.lead}：§57 验收还缺 ${philosophy.gap_component_labels.join("、") || "部分分量"}，写实分量 ${philosophy.written_components} 个${
            philosophy.design_logic_ready ? "" : "，设计逻辑尚未成稿"
          }（先补 §6.3 里的事实）`,
    handoff_phase: null,
    note: `正文取配方哲学第 ${philosophy.version} 版的设计逻辑，逐条可回查到本产品已录入事实（§6.1 / §46）。`
  });
}

function buildValueStories(items: readonly ValueCodeItem[], input: ValueCodeBuildInput): ValueStories {
  const byCode = new Map(items.map((item) => [item.code, item] as const));
  const stories = {} as Record<ValueStoryKey, ValueStory>;

  for (const definition of VALUE_STORY_DEFINITIONS) {
    // 产品结构故事（§5 / §20）：Phase 10 落地后直接取产品结构叙事正文，不再走 HANDOFF。
    if (definition.key === "product_architecture_story") {
      stories[definition.key] = buildArchitectureStory(input, definition);
      continue;
    }

    // 配方哲学故事（§6 / §20）：Phase 11 落地后直接取设计逻辑正文，不再走 HANDOFF。
    if (definition.key === "formula_philosophy_story") {
      stories[definition.key] = buildFormulaPhilosophyStory(input, definition);
      continue;
    }

    const handoffPhase = VALUE_STORY_HANDOFF_PHASES[definition.key] ?? null;
    if (handoffPhase !== null) {
      stories[definition.key] = valueStorySchema.parse({
        label: VALUE_STORY_LABELS[definition.key],
        status: "HANDOFF",
        text: null,
        layer: "INTERPRETATION",
        based_on: [...definition.codes],
        gap: `完整内容由 Phase ${handoffPhase} 交付，本阶段只登记交接（§60）`,
        handoff_phase: handoffPhase,
        note: `${definition.lead}；本阶段不得用简化版代替（§60）。`
      });
      continue;
    }

    const related = definition.codes
      .map((code) => byCode.get(code))
      .filter((item): item is ValueCodeItem => item !== undefined);
    const ready = related.filter((item) => item.status === "ALREADY_HAVE");
    const partial = related.filter((item) => item.status === "PARTIAL");
    const timeDependent = related.filter((item) => item.status === "TIME_DEPENDENT");
    const missing = related.filter((item) => item.status === "UNKNOWN" || item.status === "NOT_HAVE");

    if (definition.key === "time_story") {
      const status: ValueStoryStatus =
        timeDependent.length > 0 ? "READY" : ready.length + partial.length > 0 ? "PARTIAL" : "GAP";
      const foundation = [...timeDependent, ...ready];
      const foundationGap = related
        .filter((item) => item.status !== "ALREADY_HAVE" && item.status !== "TIME_DEPENDENT")
        .map((item) => item.label)
        .join("、");
      stories[definition.key] = valueStorySchema.parse({
        label: VALUE_STORY_LABELS[definition.key],
        status,
        text:
          status === "GAP"
            ? null
            : `${definition.lead}：${TIME_DEPENDENT_SAFE_EXPRESSION}${
                foundation.length > 0 ? `已经具备的底子：${describeItems(foundation)}。` : ""
              }`,
        layer: "INTERPRETATION",
        based_on: [...definition.codes],
        gap: status === "READY" ? null : `时间依赖项今天都还没有底子：${foundationGap}（先补 §10 / §9 录入）`,
        handoff_phase: null,
        note: `时间不会替它说话：只有底子先成立，时间才有意义；不得承诺「${TIME_DEPENDENT_FORBIDDEN_EXPRESSION}」（§19）。`
      });
      continue;
    }

    const status: ValueStoryStatus =
      ready.length >= 2 ? "READY" : ready.length + partial.length >= 1 ? "PARTIAL" : "GAP";
    const cite = status === "READY" ? ready : [...ready, ...partial];
    const gapItems = status === "READY" ? missing : [...partial, ...missing];

    stories[definition.key] = valueStorySchema.parse({
      label: VALUE_STORY_LABELS[definition.key],
      status,
      text: status === "GAP" ? null : `${definition.lead}：${describeItems(cite)}。`,
      layer: "INTERPRETATION",
      based_on: [...definition.codes],
      gap:
        gapItems.length > 0
          ? `${definition.lead}还缺少可交叉印证的事实：${gapItems
              .map((item) => item.label)
              .join("、")}（先补 §10 / §9 录入，不得改写事实）`
          : null,
      handoff_phase: null,
      note: definition.key === "price_ceiling_story" ? priceCeilingNote(input) : null
    });
  }

  return valueStoriesSchema.parse(stories);
}

/**
 * 从已录入事实 + Value DNA 推导龙德记价值映射（§18 / §19 / §20 / §44）。
 *
 * 纯函数：不读数据库、不调用 AI、不做任何推断性补全。
 * 事实不足时输出的是「UNKNOWN + 缺口清单」，而不是弱化版故事；
 * TIME_DEPENDENT 的成交层表达永远是 §19 的固定安全句式。
 */
export function buildValueCodeDraft(input: ValueCodeBuildInput): ValueCodeDraft {
  const dna = usableValueDna(input.value_dna);
  const codes = VALUE_CODE_META.map((meta) => buildCodeItem(input.product, dna, meta));

  const code_counts: Record<ValueCodeStatus, number> = {
    ALREADY_HAVE: 0,
    PARTIAL: 0,
    TIME_DEPENDENT: 0,
    NOT_HAVE: 0,
    UNKNOWN: 0
  };
  for (const item of codes) {
    code_counts[item.status] += 1;
  }

  const evidence_gaps: string[] = [
    ...codes
      .filter((item) => item.status === "UNKNOWN")
      .map(
        (item) =>
          `${item.label}：未录入相关事实，先补 ${VALUE_CODE_META_BY_KEY[item.code].evidence_refs.join(" / ")}（§11 / §62-7）`
      ),
    ...codes
      .filter((item) => item.status === "PARTIAL")
      .map((item) => `${item.label}：${item.status_reason}`),
    ...codes.filter((item) => item.status === "NOT_HAVE").map((item) => `${item.label}：${item.status_reason}`)
  ];
  if (!dna) {
    evidence_gaps.push("尚未生成价值 DNA（§9）：身份 / 风格 / 配方层的证据面会偏窄");
  }

  return {
    codes,
    code_counts: valueCodeCountsSchema.parse(code_counts),
    stories: buildValueStories(codes, input),
    evidence_gaps,
    fact_refs: [...new Set(codes.flatMap((item) => item.evidence_refs))],
    value_dna_refs: dna
      ? VALUE_DNA_DIMENSIONS.filter((dimension) => (dna[dimension]?.length ?? 0) > 0).map(
          (dimension) => `dna.${dimension}`
        )
      : []
  };
}
