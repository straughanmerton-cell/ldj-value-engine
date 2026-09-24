import { z } from "zod";
import {
  anchorResolveSourceSchema,
  type AnchorResolveSource,
  type BenchmarkModeView
} from "./anchor.js";
import {
  categoryDownstreamItemSchema,
  categoryStyleIdentitySchema,
  type CategoryDownstreamItem,
  type CategoryStyleIdentity,
  type CategoryStandardProductInput
} from "./category-creator.js";
import {
  DEFAULT_COPY_INTENSITY,
  INTENSIFY_LEVEL_TO_COPY_INTENSITY,
  copyIntensitySchema,
  intensifyLevelSchema,
  intensifyLevels,
  researchModeSchema,
  resolvedResearchModeSchema,
  riskLevelSchema,
  type CopyIntensity,
  type IntensifyLevel,
  type ResearchMode,
  type ResolvedResearchMode,
  type RiskLevel,
  type ValueCodeKey,
  type ValueCodeStatus
} from "./enums.js";
import {
  FORBIDDEN_AUTO_FILL_LABELS,
  findForbiddenFabrications
} from "./fact-normalizer.js";
import {
  FORBIDDEN_FABRICATION_CATEGORIES,
  FORBIDDEN_PROMISES,
  RND_ALLOWED_PHRASES,
  RND_RESTRICTED_PHRASES,
  type ForbiddenFabricationCategory
} from "./forbidden-claims.js";
import {
  IMPACT_SCORE_BANDS,
  IMPACT_SCORE_TOTAL,
  IMPACT_SCORE_WEIGHTS,
  LEVEL5_REQUIREMENTS,
  MAX_AUTO_INTENSIFY_ROUNDS,
  MIN_IMPACT_SCORE_BY_INTENSITY
} from "./thresholds.js";
import type { ProductArchitecture } from "./product.js";
import {
  VALUE_DNA_DIMENSIONS,
  valueDnaSchema,
  type ValueDna,
  type ValueDnaDimension
} from "./value-dna.js";

/**
 * 强成交话术 Strong Sales Copy（规格 §21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §48 / §57 / §58）。
 *
 * 这一层是整套系统的「成交面」：研究层必须严谨，成交层必须有压迫感。
 * 因此这里同时固化两件看起来相反、实际必须共存的事：
 *
 * 1. **不许变成说明书**（§62-11）：输出必须包含 §26 的九种成稿与 §47 的十五项清单，
 *    且 Level 4 / Level 5 必须过 §23 的成交冲击力阈值（≥85 / ≥90）；
 * 2. **不许为了好看造事实**（§24 / §62-5 / §62-8）：
 *    正文只能引用本产品已录入字段、Value DNA 与上游成稿（产品结构 / 配方哲学 / 自建标准），
 *    没有可靠价格锚点时**必须**改用 §22 的标准句，无 `RND_CONFIRMED` 时一个字都不许暗示研发关系。
 *
 * Phase 13 起补齐 §7 / §34 / §48 的「再狠一点」：强化器仍是**纯规则引擎，不接 AI**，
 * 因为它必须机械保证「一个字都不许新增」与「越没有锚点越要把标准立起来」这两条，
 * 而这正是强化过程最容易出事故的地方（§34 / §48）。
 */

/* ------------------------------------------------------------ §21 文案强度 */

export interface CopyIntensityMeta {
  level: CopyIntensity;
  label: string;
  short_label: string;
  tone: "neutral" | "info" | "warn" | "brand" | "ok";
  /** 这一档到底怎么说话 */
  definition: string;
  /** 这一档必须做到什么 */
  requirement: string;
  /** 是否 Level 5 王者（§22 的七项强制只对它生效） */
  is_king: boolean;
  spec_ref: string;
}

/** §21 的五档强度：研究 / 专业 / 强销售 / 直播爆款 / 王者，默认 Level 4。 */
export const COPY_INTENSITY_META: readonly CopyIntensityMeta[] = [
  {
    level: 1,
    label: "Level 1｜研究",
    short_label: "研究",
    tone: "neutral",
    definition: "只陈述事实：产地、用料、工艺、感官，不加修辞、不做价值升级。",
    requirement: "每一句都能逐字回查到本产品已录入字段",
    is_king: false,
    spec_ref: "§21"
  },
  {
    level: 2,
    label: "Level 2｜专业",
    short_label: "专业",
    tone: "info",
    definition: "用专业口径把事实说清：身份、结构、术语先立住，再谈价值。",
    requirement: "必须出现身份与价值逻辑，不出现价格高度叙事",
    is_king: false,
    spec_ref: "§21"
  },
  {
    level: 3,
    label: "Level 3｜强销售",
    short_label: "强势",
    tone: "warn",
    definition: "把参数语言升级成价值语言：对比、排比、身份塑造开始上场。",
    requirement: "必须出现价值语言升级与产品结构叙事",
    is_king: false,
    spec_ref: "§21 / §8"
  },
  {
    level: 4,
    label: "Level 4｜直播爆款",
    short_label: "爆款",
    tone: "brand",
    definition: "主播拿起来就能讲：开场 3 秒抓人、画面感、记忆点、金句密度全部拉满。",
    requirement: `成交冲击力 ≥ ${MIN_IMPACT_SCORE_BY_INTENSITY[4]}（§23）`,
    is_king: false,
    spec_ref: "§21 / §23 / §33"
  },
  {
    level: 5,
    label: "Level 5｜王者",
    short_label: "王者",
    tone: "ok",
    definition: "王者话术：身份拉满、价值感拉满、结构感拉满，每一个关键位置都不留给平庸。",
    requirement: `§22 七项强制全部落地，且成交冲击力 ≥ ${MIN_IMPACT_SCORE_BY_INTENSITY[5]}（§23）`,
    is_king: true,
    spec_ref: "§21 / §22 / §30"
  }
];

export const COPY_INTENSITY_META_BY_LEVEL: Record<CopyIntensity, CopyIntensityMeta> =
  Object.fromEntries(COPY_INTENSITY_META.map((meta) => [meta.level, meta])) as Record<
    CopyIntensity,
    CopyIntensityMeta
  >;

export const SALES_COPY_INTENSITY_LABELS = Object.fromEntries(
  COPY_INTENSITY_META.map((meta) => [meta.level, meta.label] as const)
) as Record<CopyIntensity, string>;

export const SALES_COPY_INTENSITY_SHORT_LABELS = Object.fromEntries(
  COPY_INTENSITY_META.map((meta) => [meta.level, meta.short_label] as const)
) as Record<CopyIntensity, string>;

export const SALES_COPY_INTENSITY_TONES = Object.fromEntries(
  COPY_INTENSITY_META.map((meta) => [meta.level, meta.tone] as const)
) as Record<CopyIntensity, CopyIntensityMeta["tone"]>;

/** §23 各档最低成交冲击力：只有 Level 4 / Level 5 有硬性要求。 */
export const SALES_COPY_REQUIRED_SCORE: Readonly<Record<number, number>> = MIN_IMPACT_SCORE_BY_INTENSITY;

/* ------------------------------------------------------ §7 / §34 牛逼化按钮 */

export interface IntensifyButtonMeta {
  level: IntensifyLevel;
  label: string;
  /** §7 内部映射：NORMAL→2 / STRONG→3 / VIRAL→4 / KING→5 */
  copy_intensity: CopyIntensity;
  note: string;
  spec_ref: string;
}

/**
 * §7 四档按钮文案。
 *
 * 这是**独立于 §33「文案强度」五档的一套标签**：规格 §7 的四档原文就是
 * 普通 / 强势 / 爆款 / 王者，所以 NORMAL 写「普通」，不复用 §21 强度短标签的「专业」
 * （「专业」是 Level 2 的强度名，不是按钮名）。
 */
export const INTENSIFY_BUTTON_LABELS: Record<IntensifyLevel, string> = {
  NORMAL: "普通",
  STRONG: "强势",
  VIRAL: "爆款",
  KING: "王者"
};

export const INTENSIFY_BUTTON_META: readonly IntensifyButtonMeta[] = intensifyLevels.map((level) => {
  const copyIntensity = INTENSIFY_LEVEL_TO_COPY_INTENSITY[level];
  return {
    level,
    label: INTENSIFY_BUTTON_LABELS[level],
    copy_intensity: copyIntensity,
    note:
      level === "KING"
        ? "王者强度：触发 §22 七项强制，必须过 90 分"
        : `映射到 Level ${copyIntensity}（${SALES_COPY_INTENSITY_SHORT_LABELS[copyIntensity]}）`,
    spec_ref: "§7 / §21 / §34"
  };
});

export const INTENSIFY_LEVELS_ORDER: readonly IntensifyLevel[] = [...intensifyLevels];

/**
 * §7.1 / §34：强化器每一档到底做哪些机械动作（累计，不重排、不删减）。
 *
 * 这些动作的共同点是**只换说法、不换事实**：所有补进去的句子要么是纯修辞，
 * 要么逐字来自这一版正文本身，因此强化后的事实引用清单只能是源版本的子集。
 */
export const intensifyActionKeys = [
  "hook",
  "identity",
  "standard",
  "structure",
  "differentiation",
  "imagery",
  "quotes",
  "memory_point",
  "closing"
] as const;
export type IntensifyActionKey = (typeof intensifyActionKeys)[number];

export interface IntensifyActionMeta {
  key: IntensifyActionKey;
  label: string;
  /** 这一动作提升 §7.1 的哪一项「感」 */
  raise: string;
  /** 提升后必须满足的机械条件（与 §23 的 criteria 同源） */
  check: string;
  spec_ref: string;
}

export const INTENSIFY_ACTION_META: readonly IntensifyActionMeta[] = [
  {
    key: "hook",
    label: "开场 3 秒抓人",
    raise: "气势",
    check: "开场格非空、≤ 60 字、无说明书腔，且是强反问或强祈使（§23 hook_present / hook_rhetorical / hook_short_and_clean）",
    spec_ref: "§7.1 / §48"
  },
  {
    key: "identity",
    label: "身份拉满",
    raise: "身份",
    check: "身份定义格写明身份，或逐字落在已录入事实上（§23 identity_named）",
    spec_ref: "§7.1 / §48"
  },
  {
    key: "standard",
    label: "价值高度 / 标准立住",
    raise: "价值",
    check: "价格或标准叙事格含「高度」或「标准」；没有可靠价格锚点时逐字保留 §22 标准句（§22 / §23 anchor_explicit）",
    spec_ref: "§7.1 / §22 / §48"
  },
  {
    key: "structure",
    label: "产品结构感",
    raise: "结构",
    check: "产品结构或配方哲学叙事格非空（§5 / §6 / §23 structure_or_formula_present）",
    spec_ref: "§7.1 / §48"
  },
  {
    key: "differentiation",
    label: "差异化对比",
    raise: "差异化",
    check: "差异化格含「不是…而是」或「差别在 / 差别是」（§23 differentiation_contrast）",
    spec_ref: "§7.1 / §48"
  },
  {
    key: "imagery",
    label: "画面感",
    raise: "画面",
    check: "画面格含「第一口 / 入口 / 下水 / 嘴里 / 舌面 / 口腔」（§23 imagery_visual）",
    spec_ref: "§7.1 / §48"
  },
  {
    key: "quotes",
    label: "短视频金句密度",
    raise: "记忆点",
    check:
      "从本版正文里抽出 6–48 字、自带收束、不以指代词开头的短句补进备用金句（§26 / §58-10；5 句核心 + 20 句备用的下限一句都不许少）",
    spec_ref: "§7.1 / §26 / §48"
  },
  {
    key: "memory_point",
    label: "记忆点立得住",
    raise: "记忆点",
    check: "记忆点格写清身份 / 辨识度 / 记住，或逐字落在已录入事实上（§23 memory_point_identity）",
    spec_ref: "§7.1 / §48"
  },
  {
    key: "closing",
    label: "成交推进收口",
    raise: "成交推进",
    check: "收口格含「带走 / 决定 / 记住 / 想清楚 / 判断」（§23 closing_present）",
    spec_ref: "§7.1 / §48"
  }
];

export const INTENSIFY_ACTION_META_BY_KEY: Record<IntensifyActionKey, IntensifyActionMeta> =
  Object.fromEntries(
    INTENSIFY_ACTION_META.map((meta) => [meta.key, meta] as const)
  ) as Record<IntensifyActionKey, IntensifyActionMeta>;

/** 四档各自执行的累计动作清单（§7.1：档位越高，越多项必须拉满）。 */
export const INTENSIFY_ACTIONS_BY_LEVEL: Record<IntensifyLevel, readonly IntensifyActionKey[]> = {
  NORMAL: ["hook", "closing"],
  STRONG: ["hook", "closing", "identity", "standard"],
  VIRAL: ["hook", "closing", "identity", "standard", "structure", "differentiation", "imagery"],
  KING: [
    "hook",
    "closing",
    "identity",
    "standard",
    "structure",
    "differentiation",
    "imagery",
    "quotes",
    "memory_point"
  ]
};

/** §34 / §48 的机械闸门：强化只能动用这一版已经用过的事实，一条都不许新增、一条都不许丢。 */
export const INTENSIFY_FACT_RULE =
  "强化后的正文逐字回查到的引用清单必须是源版本的子集：不许出现源版本没用过的已录入事实（不增加新事实，多一条就拒绝落库）；源版本已经引用的已录入事实如果被改写写弱，会写进新版本的自动备注供人工抽查（§34）";

/**
 * §48 Agent 10 八项自检（每一项都直接复用 §23 的机械判定，不另写一套主观标准）。
 * 其中「说明书味太重」是负向检查：出现说明书腔调即判不通过（§62-11）。
 */
export const intensifySelfCheckKeys = [
  "opening_hook",
  "identity",
  "value_height",
  "product_structure",
  "quotes",
  "memory_point",
  "closing_push",
  "no_manual_tone"
] as const;
export type IntensifySelfCheckKey = (typeof intensifySelfCheckKeys)[number];

export interface IntensifySelfCheckMeta {
  key: IntensifySelfCheckKey;
  label: string;
  check: string;
  /** 负向检查：满足条件反而算不通过（目前只有「说明书味太重」一项） */
  negative: boolean;
  /** 这一项复用 §23 的哪几条 criteria */
  criteria: readonly string[];
  spec_ref: string;
}

export const INTENSIFY_SELF_CHECK_META: readonly IntensifySelfCheckMeta[] = [
  {
    key: "opening_hook",
    label: "开头 3 秒抓人",
    check: "开场格非空、≤ 60 字、无说明书腔，且是强反问或强祈使",
    negative: false,
    criteria: ["hook_present", "hook_rhetorical", "hook_short_and_clean"],
    spec_ref: "§48"
  },
  {
    key: "identity",
    label: "身份拉满",
    check: "身份定义格写明身份，或逐字落在已录入事实上",
    negative: false,
    criteria: ["identity_definition_present", "identity_named"],
    spec_ref: "§48"
  },
  {
    key: "value_height",
    label: "价值高度拉满",
    check: "价值故事格非空，且价格 / 标准叙事讲的是高度或标准",
    negative: false,
    criteria: ["value_story_present", "anchor_honest"],
    spec_ref: "§48"
  },
  {
    key: "product_structure",
    label: "产品结构讲清楚",
    check: "产品结构或配方哲学叙事格非空",
    negative: false,
    criteria: ["structure_or_formula_present"],
    spec_ref: "§48"
  },
  {
    key: "quotes",
    label: "短视频金句密度",
    check: `可独立传播金句 ≥ ${LEVEL5_REQUIREMENTS.minQuotableLines} 句`,
    negative: false,
    criteria: ["quotable_lines_enough"],
    spec_ref: "§48"
  },
  {
    key: "memory_point",
    label: "记忆点立得住",
    check: "记忆点格非空，且写到身份 / 辨识度 / 记住或落在已录入事实上",
    negative: false,
    criteria: ["memory_point_present", "memory_point_identity"],
    spec_ref: "§48"
  },
  {
    key: "closing_push",
    label: "成交推进收口",
    check: "收口格含「带走 / 决定 / 记住 / 想清楚 / 判断」",
    negative: false,
    criteria: ["closing_present"],
    spec_ref: "§48"
  },
  {
    key: "no_manual_tone",
    label: "说明书味太重",
    check: "十三格骨架里不出现「说明书 / 参数 / 规格如下 / 指标如下 / 本品 / 产品参数」",
    negative: true,
    criteria: [],
    spec_ref: "§48 / §62-11"
  }
];

export const INTENSIFY_SELF_CHECK_META_BY_KEY: Record<IntensifySelfCheckKey, IntensifySelfCheckMeta> =
  Object.fromEntries(
    INTENSIFY_SELF_CHECK_META.map((meta) => [meta.key, meta] as const)
  ) as Record<IntensifySelfCheckKey, IntensifySelfCheckMeta>;

export const intensifySelfCheckKeySchema = z.enum(intensifySelfCheckKeys);

export const intensifySelfCheckItemSchema = z
  .object({
    key: intensifySelfCheckKeySchema,
    label: z.string(),
    check: z.string(),
    /** 负向检查里 true 表示「没有说明书味」 */
    passed: z.boolean(),
    evidence: z.string().nullable(),
    spec_ref: z.string()
  })
  .strict();
export type IntensifySelfCheckItem = z.infer<typeof intensifySelfCheckItemSchema>;

/**
 * §48 自检结论。
 *
 * `passed` 必须同时满足「八项全过」与「分数达档」：Level 4 ≥ 85、Level 5 ≥ 90（§23 / §48）。
 * 达不到就如实标未达标——最多自动强化 3 轮，第 3 轮之后必须人工处理（不造假、不压分）。
 */
export const intensifySelfCheckSchema = z
  .object({
    spec_ref: z.literal("§48"),
    level: intensifyLevelSchema,
    intensity: copyIntensitySchema,
    score: z.number().int().nonnegative(),
    required_score: z.number().int().positive().nullable(),
    score_passed: z.boolean(),
    items: z.array(intensifySelfCheckItemSchema).length(intensifySelfCheckKeys.length),
    missing: z.array(intensifySelfCheckKeySchema),
    passed: z.boolean(),
    max_auto_rounds: z.number().int().positive(),
    note: z.string()
  })
  .strict()
  .refine((check) => check.passed === (check.missing.length === 0 && check.score_passed), {
    message: "§48 自检结论必须由八项明细与分数阈值共同推导",
    path: ["passed"]
  });
export type SalesCopyIntensifySelfCheck = z.infer<typeof intensifySelfCheckSchema>;

/* -------------------------------------------------- §23 成交冲击力评分八项 */

export const impactScoreItemKeys = [
  "hook",
  "product_identity",
  "high_value_sense",
  "price_or_standard_anchor",
  "differentiation",
  "imagery",
  "memory_point",
  "closing"
] as const;
export const impactScoreItemKeySchema = z.enum(impactScoreItemKeys);
export type ImpactScoreItemKey = z.infer<typeof impactScoreItemKeySchema>;

export interface ImpactScoreCriterion {
  key: string;
  /** 这一条判定到底看什么（机械条件，不看主观印象） */
  check: string;
  points: number;
}

export interface ImpactScoreItemMeta {
  key: ImpactScoreItemKey;
  label: string;
  /** §23 权重（合计 100） */
  weight: number;
  /** 这一项在成稿里对应什么 */
  criterion: string;
  /** 打分依赖的输入 */
  source: string;
  /** 逐条机械判定条件，权重 = 各条 points 之和 */
  criteria: readonly ImpactScoreCriterion[];
  spec_ref: string;
}

export const IMPACT_SCORE_META: readonly ImpactScoreItemMeta[] = [
  {
    key: "hook",
    label: "开场抓人",
    weight: IMPACT_SCORE_WEIGHTS.hook,
    criterion: "开头 3 秒能不能把人按住：强反问或强指认，且不像说明书开头",
    source: "opening_hook",
    criteria: [
      { key: "hook_present", check: "开场钩子非空", points: 5 },
      { key: "hook_rhetorical", check: "开场是强反问或强指认句式", points: 5 },
      { key: "hook_short_and_clean", check: "开场 ≤ 60 字且不含说明书措辞", points: 5 }
    ],
    spec_ref: "§23 / §48"
  },
  {
    key: "product_identity",
    label: "产品身份",
    weight: IMPACT_SCORE_WEIGHTS.productIdentity,
    criterion: "这款茶是谁：一句话定位 + 身份定义句有没有立住",
    source: "one_liner / identity_definition",
    criteria: [
      { key: "one_liner_present", check: "一句话定位非空", points: 5 },
      { key: "identity_definition_present", check: "存在身份定义句（§22）", points: 5 },
      { key: "identity_named", check: "身份句点名了产品 / 系列或明确说「身份」", points: 5 }
    ],
    spec_ref: "§22 / §23"
  },
  {
    key: "high_value_sense",
    label: "高价值感",
    weight: IMPACT_SCORE_WEIGHTS.highValueSense,
    criterion: "为什么值钱：价值故事 + 价格或标准锚定 + 结构 / 配方叙事",
    source: "value_story / price_or_standard_story / architecture & formula story",
    criteria: [
      { key: "value_story_present", check: "价值故事非空", points: 7 },
      { key: "price_or_standard_present", check: "价格高度叙事或自建标准叙事非空", points: 7 },
      {
        key: "structure_or_formula_present",
        check: "产品结构叙事或配方哲学叙事至少有一段",
        points: 6
      }
    ],
    spec_ref: "§21 / §22 / §23"
  },
  {
    key: "price_or_standard_anchor",
    label: "价格 / 标准锚定",
    weight: IMPACT_SCORE_WEIGHTS.priceOrStandardAnchor,
    criterion: "有锚点讲价格高度，没有锚点把标准立起来——两种都必须锚得住",
    source: "anchor 上下文 / price_or_standard_story",
    criteria: [
      {
        key: "anchor_honest",
        check: "有锚点时报出锚点或市场高度；无锚点时逐字含 §22 标准句",
        points: 5
      },
      { key: "no_fake_price", check: "全文不出现凭空价格数字", points: 5 },
      { key: "anchor_explicit", check: "明确「高度」或「标准」，不模糊带过", points: 5 }
    ],
    spec_ref: "§22 / §25 / §62-2"
  },
  {
    key: "differentiation",
    label: "产品差异",
    weight: IMPACT_SCORE_WEIGHTS.differentiation,
    criterion: "它和「普通产品」差在哪：必须落到本产品的已录入事实上",
    source: "differentiation",
    criteria: [
      { key: "differentiation_present", check: "差异化句非空", points: 4 },
      { key: "differentiation_grounded", check: "差异化句逐字引用了已录入事实", points: 3 },
      { key: "differentiation_contrast", check: "含「不是……而是」这类对比结构", points: 3 }
    ],
    spec_ref: "§8 / §23"
  },
  {
    key: "imagery",
    label: "画面感",
    weight: IMPACT_SCORE_WEIGHTS.imagery,
    criterion: "能不能让人「看见」第一口：画面句必须落在已录入感官事实上",
    source: "imagery",
    criteria: [
      { key: "imagery_present", check: "画面句非空", points: 4 },
      { key: "imagery_grounded", check: "画面句逐字引用了已录入感官事实", points: 3 },
      { key: "imagery_visual", check: "含第一口 / 入口 / 下水这类画面词", points: 3 }
    ],
    spec_ref: "§8 / §23 / §48"
  },
  {
    key: "memory_point",
    label: "记忆点",
    weight: IMPACT_SCORE_WEIGHTS.memoryPoint,
    criterion: "听完记住什么：记忆点句 + 至少 3 句可独立传播的金句",
    source: "memory_point / core_quotes / backup_quotes",
    criteria: [
      { key: "memory_point_present", check: "记忆点句非空", points: 4 },
      { key: "memory_point_identity", check: "记忆点句带身份关键词", points: 3 },
      {
        key: "quotable_lines_enough",
        check: `可独立传播金句 ≥ ${LEVEL5_REQUIREMENTS.minQuotableLines} 句`,
        points: 3
      }
    ],
    spec_ref: "§22 / §23"
  },
  {
    key: "closing",
    label: "成交推进",
    weight: IMPACT_SCORE_WEIGHTS.closing,
    criterion: "有没有把话收在成交上（§22 的成交收口）",
    source: "closing",
    criteria: [{ key: "closing_present", check: "成交收口非空且带推进动作", points: 5 }],
    spec_ref: "§22 / §23"
  }
];

export const IMPACT_SCORE_META_BY_KEY: Record<ImpactScoreItemKey, ImpactScoreItemMeta> =
  Object.fromEntries(IMPACT_SCORE_META.map((meta) => [meta.key, meta])) as Record<
    ImpactScoreItemKey,
    ImpactScoreItemMeta
  >;

export const impactScoreBands = ["REWRITE", "USABLE", "EXCELLENT", "CORE"] as const;
export const impactScoreBandSchema = z.enum(impactScoreBands);
export type ImpactScoreBand = z.infer<typeof impactScoreBandSchema>;

export interface ImpactScoreBandMeta {
  band: ImpactScoreBand;
  label: string;
  /** 分数下限（含） */
  min: number;
  tone: "danger" | "warn" | "ok" | "brand";
  note: string;
}

/** §23 分档：<70 自动重写 / 70–79 可用 / 80–89 优秀 / 90+ 核心主播稿。 */
export const IMPACT_SCORE_BAND_META: readonly ImpactScoreBandMeta[] = [
  {
    band: "REWRITE",
    label: "自动重写",
    min: 0,
    tone: "danger",
    note: `< ${IMPACT_SCORE_BANDS.REWRITE_BELOW} 分：不得发布，必须重写`
  },
  {
    band: "USABLE",
    label: "可用",
    min: IMPACT_SCORE_BANDS.REWRITE_BELOW,
    tone: "warn",
    note: `${IMPACT_SCORE_BANDS.REWRITE_BELOW}–${IMPACT_SCORE_BANDS.USABLE - 1} 分：可用，但还没到爆款`
  },
  {
    band: "EXCELLENT",
    label: "优秀",
    min: IMPACT_SCORE_BANDS.USABLE,
    tone: "ok",
    note: `${IMPACT_SCORE_BANDS.USABLE}–${IMPACT_SCORE_BANDS.EXCELLENT - 1} 分：优秀`
  },
  {
    band: "CORE",
    label: "核心主播稿",
    min: IMPACT_SCORE_BANDS.EXCELLENT,
    tone: "brand",
    note: `${IMPACT_SCORE_BANDS.EXCELLENT}+ 分：核心主播稿`
  }
];

export const IMPACT_SCORE_BAND_META_BY_KEY: Record<ImpactScoreBand, ImpactScoreBandMeta> =
  Object.fromEntries(IMPACT_SCORE_BAND_META.map((meta) => [meta.band, meta])) as Record<
    ImpactScoreBand,
    ImpactScoreBandMeta
  >;

export function impactScoreBandOf(score: number): ImpactScoreBand {
  if (score >= IMPACT_SCORE_BANDS.EXCELLENT) {
    return "CORE";
  }
  if (score >= IMPACT_SCORE_BANDS.USABLE) {
    return "EXCELLENT";
  }
  if (score >= IMPACT_SCORE_BANDS.REWRITE_BELOW) {
    return "USABLE";
  }
  return "REWRITE";
}

export const IMPACT_SCORE_MAX = IMPACT_SCORE_TOTAL;

/* ------------------------------------------------- §22 Level 5 七项强制 */

export const level5RequirementKeys = [
  "rhetorical_question",
  "identity_definition",
  "price_height_story",
  "product_architecture_story",
  "style_identity",
  "quotable_lines",
  "closing"
] as const;
export const level5RequirementKeySchema = z.enum(level5RequirementKeys);
export type Level5RequirementKey = z.infer<typeof level5RequirementKeySchema>;

export interface Level5RequirementMeta {
  key: Level5RequirementKey;
  label: string;
  /** §22 原文要求 */
  requirement: string;
  /** 机械判定条件 */
  check: string;
  /** 取哪一段成稿作为证据 */
  source: string;
  spec_ref: string;
}

/**
 * §22 Level 5 的七项强制写作要求。
 *
 * 第 3 项（价格高度叙事）带条件：**只有存在可靠价格锚点时才允许写价格故事**，
 * 否则必须改用下面的 `NO_ANCHOR_STANDARD_SENTENCE`（§22 原文句，逐字不得改写）。
 */
export const LEVEL5_REQUIREMENT_META: readonly Level5RequirementMeta[] = [
  {
    key: "rhetorical_question",
    label: "强反问",
    requirement: "1 个强反问",
    check: "成稿里存在以问号收束的强反问句",
    source: "opening_hook / level5.rhetorical_question",
    spec_ref: "§22"
  },
  {
    key: "identity_definition",
    label: "身份定义",
    requirement: "1 个身份定义",
    check: "存在「它不是 X，它是 Y」这类身份定义句",
    source: "identity_definition",
    spec_ref: "§22"
  },
  {
    key: "price_height_story",
    label: "价格高度叙事",
    requirement: "1 个价格高度叙事（有证据时）；无可靠价格锚点时改用 §22 标准句",
    check: "有锚点时讲价格高度；无锚点时逐字包含 §22 标准句",
    source: "price_or_standard_story",
    spec_ref: "§22 / §25"
  },
  {
    key: "product_architecture_story",
    label: "产品结构叙事",
    requirement: "1 个产品结构叙事",
    check: "存在把骨架 / 香气 / 汤感 / 记忆点分配给具体事实的结构叙事",
    source: "product_architecture_story",
    spec_ref: "§5 / §22"
  },
  {
    key: "style_identity",
    label: "风格身份证",
    requirement: "1 个风格身份证",
    check: "存在把辨识度写成「身份证 / 认得出」的风格句",
    source: "style_identity",
    spec_ref: "§4.2 / §22"
  },
  {
    key: "quotable_lines",
    label: "短视频金句",
    requirement: `≥ ${LEVEL5_REQUIREMENTS.minQuotableLines} 句短视频金句`,
    check: `可独立传播金句 ≥ ${LEVEL5_REQUIREMENTS.minQuotableLines} 句`,
    source: "core_quotes / backup_quotes",
    spec_ref: "§22 / §58-10"
  },
  {
    key: "closing",
    label: "成交收口",
    requirement: "1 个成交收口",
    check: "存在把话收在成交上的收口句",
    source: "closing",
    spec_ref: "§22"
  }
];

export const LEVEL5_REQUIREMENT_META_BY_KEY: Record<Level5RequirementKey, Level5RequirementMeta> =
  Object.fromEntries(LEVEL5_REQUIREMENT_META.map((meta) => [meta.key, meta])) as Record<
    Level5RequirementKey,
    Level5RequirementMeta
  >;

/**
 * §22 原文：没有可靠价格锚点时**必须**改用这一句，逐字不得改写，且不得写任何具体价格故事。
 * 抽成常量是为了让生成侧 / 回看侧 / 测试引用同一份文本，避免有人「顺手优化」这句话。
 */
export const NO_ANCHOR_STANDARD_SENTENCE =
  "这款茶不是用别人现成的价格给自己撑腰，而是先把自己的产品标准立起来。";

/* ---------------------------------------------- §26 / §47 输出清单 */

export const salesCopyScriptKeys = ["sec15", "sec30", "sec60", "min3"] as const;
export const salesCopyScriptKeySchema = z.enum(salesCopyScriptKeys);
export type SalesCopyScriptKey = z.infer<typeof salesCopyScriptKeySchema>;

/** §26「必须生成」的九项主播输出，顺序即前端展示顺序。 */
export const salesCopyOutputKeys = [
  "core_quotes",
  "backup_quotes",
  "sec15",
  "sec30",
  "sec60",
  "min3",
  "level5_release",
  "dealer_copy",
  "objections"
] as const;
export const salesCopyOutputKeySchema = z.enum(salesCopyOutputKeys);
export type SalesCopyOutputKey = z.infer<typeof salesCopyOutputKeySchema>;

export interface SalesCopyOutputMeta {
  key: SalesCopyOutputKey;
  label: string;
  /** §26 对这一项的要求 */
  requirement: string;
  /** 成稿落在哪个字段 */
  source: string;
  spec_ref: string;
}

export const SALES_COPY_OUTPUT_META: readonly SalesCopyOutputMeta[] = [
  {
    key: "core_quotes",
    label: "5 句核心金句",
    requirement: "5 句可独立传播的核心金句，每一句都能单独当一条短视频文案",
    source: "quotes.core_quotes",
    spec_ref: "§26 / §47 / §58-10"
  },
  {
    key: "backup_quotes",
    label: "20 句备用金句",
    requirement: "20 句备用金句，供主播轮换、剪辑挑句、直播空档补位",
    source: "quotes.backup_quotes",
    spec_ref: "§26 / §47"
  },
  {
    key: "sec15",
    label: "15 秒",
    requirement: "15 秒脚本：钩子 + 身份 + 记忆点，句子必须短到能一口气说完",
    source: "scripts.sec15",
    spec_ref: "§26 / §47"
  },
  {
    key: "sec30",
    label: "30 秒",
    requirement: "30 秒脚本：钩子 + 身份 + 价值高度 + 成交收口",
    source: "scripts.sec30",
    spec_ref: "§26 / §47"
  },
  {
    key: "sec60",
    label: "60 秒",
    requirement: "60 秒脚本：在 30 秒基础上加产品结构与第一口画面",
    source: "scripts.sec60",
    spec_ref: "§26 / §47"
  },
  {
    key: "min3",
    label: "3 分钟",
    requirement: "3 分钟主播稿按 §27 八段时序展开，每一段只讲该段的事",
    source: "scripts.min3",
    spec_ref: "§26 / §27 / §47"
  },
  {
    key: "level5_release",
    label: "Level 5 新品发布",
    requirement: "新品发布稿：§22 七项强制全部落地，成交冲击力 ≥ 90",
    source: "level5_release",
    spec_ref: "§21 / §22 / §26 / §47"
  },
  {
    key: "dealer_copy",
    label: "经销商版",
    requirement: "给经销商讲定位、讲结构、讲怎么卖，语气比主播稿更稳、更清楚",
    source: "dealer_copy",
    spec_ref: "§26 / §47 / §52"
  },
  {
    key: "objections",
    label: "异议处理",
    requirement: "把「凭什么这么贵 / 没有对标凭什么 / 是不是在讲故事」这类异议逐条接住",
    source: "objections",
    spec_ref: "§26 / §47"
  }
];

export const SALES_COPY_OUTPUT_META_BY_KEY: Record<SalesCopyOutputKey, SalesCopyOutputMeta> =
  Object.fromEntries(SALES_COPY_OUTPUT_META.map((meta) => [meta.key, meta] as const)) as Record<
    SalesCopyOutputKey,
    SalesCopyOutputMeta
  >;

/** §47 Agent 9 的十五项输出，顺序即交付顺序（第一项是一句话定位）。 */
export const SALES_COPY_AGENT9_OUTPUT_KEYS = [
  "one_liner",
  "core_quotes",
  "backup_quotes",
  "opening_hook",
  "selling_points",
  "value_story",
  "product_architecture_story",
  "formula_philosophy",
  "sec15",
  "sec30",
  "sec60",
  "min3",
  "level5_release",
  "dealer_copy",
  "objections"
] as const;
export type SalesCopyAgent9OutputKey = (typeof SALES_COPY_AGENT9_OUTPUT_KEYS)[number];

export interface SalesCopyAgent9OutputMeta {
  key: SalesCopyAgent9OutputKey;
  label: string;
  source: string;
  spec_ref: string;
}

export const SALES_COPY_AGENT9_OUTPUTS: readonly SalesCopyAgent9OutputMeta[] = [
  { key: "one_liner", label: "一句话定位", source: "headline.one_liner", spec_ref: "§47" },
  { key: "core_quotes", label: "5 句核心金句", source: "quotes.core_quotes", spec_ref: "§47" },
  { key: "backup_quotes", label: "20 句备用金句", source: "quotes.backup_quotes", spec_ref: "§47" },
  { key: "opening_hook", label: "开场钩子", source: "headline.opening_hook", spec_ref: "§47 / §48" },
  { key: "selling_points", label: "7 大卖点", source: "selling_points", spec_ref: "§47" },
  { key: "value_story", label: "价值故事", source: "headline.value_story", spec_ref: "§47" },
  {
    key: "product_architecture_story",
    label: "产品结构故事",
    source: "headline.product_architecture_story",
    spec_ref: "§47 / §5"
  },
  {
    key: "formula_philosophy",
    label: "配方哲学",
    source: "headline.formula_philosophy_story",
    spec_ref: "§47 / §6"
  },
  { key: "sec15", label: "15 秒", source: "scripts.sec15", spec_ref: "§47" },
  { key: "sec30", label: "30 秒", source: "scripts.sec30", spec_ref: "§47" },
  { key: "sec60", label: "60 秒", source: "scripts.sec60", spec_ref: "§47" },
  { key: "min3", label: "3 分钟", source: "scripts.min3", spec_ref: "§47 / §27" },
  { key: "level5_release", label: "Level 5", source: "level5_release", spec_ref: "§47 / §22" },
  { key: "dealer_copy", label: "经销商版", source: "dealer_copy", spec_ref: "§47 / §52" },
  { key: "objections", label: "异议处理", source: "objections", spec_ref: "§47" }
];

/* -------------------------------------------- §27 3 分钟八段时序 */

export const min3SegmentKeys = [
  "hook",
  "identity",
  "value_track",
  "value_logic",
  "structure_or_formula",
  "palate",
  "who_for",
  "closing"
] as const;
export const min3SegmentKeySchema = z.enum(min3SegmentKeys);
export type Min3SegmentKey = z.infer<typeof min3SegmentKeySchema>;

export interface Min3SegmentMeta {
  key: Min3SegmentKey;
  /** §27 原文时间轴 */
  time_range: string;
  label: string;
  /** 这一段必须讲什么 */
  requirement: string;
  /** 成稿取哪一段 */
  source: string;
  spec_ref: string;
}

export const MIN3_TIMELINE: readonly Min3SegmentMeta[] = [
  {
    key: "hook",
    time_range: "00:00–00:15",
    label: "炸场钩子",
    requirement: "一句话把人按住：强反问或强指认，禁止说明书式开场",
    source: "headline.opening_hook",
    spec_ref: "§27 / §48"
  },
  {
    key: "identity",
    time_range: "00:15–00:35",
    label: "产品身份",
    requirement: "一句话定位 + 身份定义：它是谁、站在哪条价值赛道上",
    source: "headline.one_liner / headline.identity_definition",
    spec_ref: "§27 / §22"
  },
  {
    key: "value_track",
    time_range: "00:35–01:00",
    label: "价值赛道 / 自建标准",
    requirement: "有锚点讲赛道价格高度；没有锚点讲自建标准（§22 标准句）",
    source: "headline.price_or_standard_story",
    spec_ref: "§27 / §17 / §22"
  },
  {
    key: "value_logic",
    time_range: "01:00–01:30",
    label: "高价值逻辑",
    requirement: "为什么它值钱：价值故事 + 差异化，不靠形容词靠结构",
    source: "headline.value_story / headline.differentiation",
    spec_ref: "§27"
  },
  {
    key: "structure_or_formula",
    time_range: "01:30–02:10",
    label: "产品结构 / 配方哲学",
    requirement: "谁负责骨架、谁负责香气、谁负责汤感、谁负责回甘、谁负责记忆点",
    source: "headline.product_architecture_story / headline.formula_philosophy_story",
    spec_ref: "§27 / §5 / §6"
  },
  {
    key: "palate",
    time_range: "02:10–02:35",
    label: "口感体验",
    requirement: "第一口到后半程的画面感，必须落在已录入感官事实上",
    source: "headline.imagery",
    spec_ref: "§27 / §24"
  },
  {
    key: "who_for",
    time_range: "02:35–02:50",
    label: "适合谁",
    requirement: "讲清楚什么人适合它、什么人可以先不买，不许用「所有人」糊过去",
    source: "headline.who_for",
    spec_ref: "§27"
  },
  {
    key: "closing",
    time_range: "02:50–03:00",
    label: "成交收口",
    requirement: "把话收在成交上，给出明确的推进动作",
    source: "headline.closing",
    spec_ref: "§27 / §22"
  }
];

/* -------------------------------------------------- §33 价值重点八项 */

export const valueFocusKeys = [
  "identity",
  "market_price",
  "material",
  "mountain",
  "formula_philosophy",
  "style",
  "time",
  "collection"
] as const;
export const valueFocusKeySchema = z.enum(valueFocusKeys);
export type ValueFocusKey = z.infer<typeof valueFocusKeySchema>;

export const VALUE_FOCUS_LABELS: Record<ValueFocusKey, string> = {
  identity: "身份",
  market_price: "市场高价",
  material: "原料",
  mountain: "山头",
  formula_philosophy: "配方哲学",
  style: "风格",
  time: "时间",
  collection: "收藏"
};

export interface ValueFocusMeta {
  key: ValueFocusKey;
  label: string;
  /** 勾上这一项之后，文案必须多讲什么 */
  requirement: string;
  /** 允许引用的证据（product.* 白名单 / dna.* / 上游成稿） */
  evidence_refs: readonly string[];
  spec_ref: string;
}

export const VALUE_FOCUS_META: readonly ValueFocusMeta[] = [
  {
    key: "identity",
    label: "身份",
    requirement: "把「它是谁」写死：一句话定位、身份定义句与记忆点都要落在这一项上",
    evidence_refs: [
      "product.product_name",
      "product.series_name",
      "product.tea_type",
      "product.tea_subtype",
      "dna.identity"
    ],
    spec_ref: "§22 / §33"
  },
  {
    key: "market_price",
    label: "市场高价",
    requirement: "有可靠锚点时讲赛道价格高度；没有锚点时逐字改用 §22 标准句，绝不写具体价格",
    evidence_refs: ["anchor.primary_anchor"],
    spec_ref: "§17 / §22 / §33"
  },
  {
    key: "material",
    label: "原料",
    requirement: "讲用料标准与底气，只能引用已录入原料事实，不新增原料",
    evidence_refs: [
      "product.raw_material",
      "product.tree_type",
      "product.tree_age",
      "product.season",
      "product.grade",
      "product.blend_description",
      "dna.material"
    ],
    spec_ref: "§10.2 / §33"
  },
  {
    key: "mountain",
    label: "山头",
    requirement: "讲山头给出的骨架与风格，只能引用已录入产地事实，不新增山头",
    evidence_refs: [
      "product.mountain",
      "product.village",
      "product.origin_region",
      "product.origin_city",
      "product.origin_province",
      "dna.origin"
    ],
    spec_ref: "§10.1 / §33"
  },
  {
    key: "formula_philosophy",
    label: "配方哲学",
    requirement: "讲设计逻辑：不是把料混起来，而是让每一类原料承担自己的任务（Phase 11 成稿）",
    evidence_refs: ["philosophy.formula_strategy", "philosophy.sales_explanation"],
    spec_ref: "§6 / §46 / §33"
  },
  {
    key: "style",
    label: "风格",
    requirement: "讲风格身份证：一入口就能被认出来的那一点（Phase 8 风格身份证 / 已录入香气事实）",
    evidence_refs: [
      "product.dry_leaf_aroma",
      "product.hot_cup_aroma",
      "product.liquor_aroma",
      "category.style_identity",
      "dna.style"
    ],
    spec_ref: "§4.2 / §33"
  },
  {
    key: "time",
    label: "时间",
    requirement: "讲时间需要什么底子，只能讲今天已经具备的条件，不承诺未来价格",
    evidence_refs: ["product.year", "product.storage", "product.fermentation_degree", "dna.time"],
    spec_ref: "§19 / §33"
  },
  {
    key: "collection",
    label: "收藏",
    requirement: "讲它凭什么被留下来，不允许出现必涨 / 稳赚 / 保值这类承诺",
    evidence_refs: [
      "product.series_name",
      "product.year",
      "product.grade",
      "product.pressing_method",
      "product.endurance"
    ],
    spec_ref: "§33 / §62-9"
  }
];

export const VALUE_FOCUS_META_BY_KEY: Record<ValueFocusKey, ValueFocusMeta> = Object.fromEntries(
  VALUE_FOCUS_META.map((meta) => [meta.key, meta])
) as Record<ValueFocusKey, ValueFocusMeta>;

/** §33 的默认勾选：八项全开（用户可以取消其中几项）。 */
export const DEFAULT_VALUE_FOCUS: readonly ValueFocusKey[] = [...valueFocusKeys];

/* -------------------------------------------------- §26 / §33 / §62-15 限额 */

export const SALES_COPY_LIMITS = {
  /** 单产品保留的历史成稿版本上限（所有版本必须保留，§62-15） */
  maxVersionsPerProduct: 20,
  /** §26：必须生成 5 句核心金句 */
  coreQuoteCount: 5,
  /** §26：必须生成 20 句备用金句 */
  backupQuoteCount: 20,
  /** §47：7 大卖点 */
  sellingPointCount: 7,
  /** §26：异议处理最多几条（再多主播也记不住） */
  maxObjections: 8,
  /** §22 / §58-10：Level 5 至少要有几句可独立传播的金句 */
  minLevel5QuotableLines: LEVEL5_REQUIREMENTS.minQuotableLines,
  /** 已录入事实少于这个数时，缺口清单会提示「先把事实录全再谈成交」 */
  minRecordedFacts: 4,
  /** 金句长度区间：太短没有信息量，太长剪不进短视频 */
  minQuoteLength: 6,
  maxQuoteLength: 120,
  /** 单段成稿长度上限（防止纯规则引擎出现复制粘贴式的无限拼接） */
  maxTextLength: 8000,
  defaultPageSize: 20,
  maxPageSize: 100
} as const;

/** §34：同一版本最多自动增强 3 次（与 `thresholds.ts` 同源，Phase 13 接线时直接读这里） */
export const SALES_COPY_MAX_INTENSIFY_ROUNDS = MAX_AUTO_INTENSIFY_ROUNDS;

export interface SalesCopyIntensityProfile {
  level: CopyIntensity;
  label: string;
  /** 下面八项是这一档必须出现的机械动作，直接对应 §23 的八项评分 */
  rhetorical_hook: boolean;
  identity_definition: boolean;
  price_or_standard_story: boolean;
  product_architecture_story: boolean;
  style_identity: boolean;
  contrast: boolean;
  visual_imagery: boolean;
  closing_push: boolean;
  /**
   * §7.1 王者档独有的三种「感觉」：**强「产品有设计」/ 强「不是普通茶」/ 强「懂的人才能看懂」**。
   *
   * 只有 Level 5 为 true。这三条纯修辞式要求让「爆款 → 王者」这一步在**正文层面**真正加了一层，
   * 而不是只把分数线从 85 抬到 90：否则 §34「提高气势 / 记忆点 / 金句密度」在最高一档会变成空动作，
   * 运营点「王者」会拿到一版和爆款逐字相同的新版本。
   */
  king_takeover: boolean;
  /** §23：这一档的最低成交冲击力；没有硬性要求时为 null */
  required_score: number | null;
  spec_ref: string;
}

/**
 * 五档强度的机械画像（§21）。
 *
 * 这套画像决定「同一份事实在不同档位被写成什么样」：
 * Level 1 只陈述事实，Level 2 起立身份，Level 3 起上价值语言与结构，Level 4 / 5 才是主播稿。
 * 无论哪一档，`closing_push` 恒为 true —— §22 的成交收口不允许被任何档位省掉。
 */
export const SALES_COPY_INTENSITY_PROFILES: readonly SalesCopyIntensityProfile[] =
  COPY_INTENSITY_META.map((meta) => ({
    level: meta.level,
    label: meta.short_label,
    rhetorical_hook: meta.level >= 3,
    identity_definition: meta.level >= 2,
    /**
     * 这一项在**所有档位**都成立：没有可靠价格锚点时，schema 层面强制逐字使用 §22 标准句，
     * 只有强销售档以上、且锚点自带可靠价格证据时才换成「价格高度」的写法（§22 / §58-9）。
     */
    price_or_standard_story: true,
    product_architecture_story: meta.level >= 3,
    style_identity: meta.level >= 3,
    contrast: meta.level >= 3,
    visual_imagery: meta.level >= 3,
    closing_push: true,
    king_takeover: meta.level >= 5,
    required_score: MIN_IMPACT_SCORE_BY_INTENSITY[meta.level] ?? null,
    spec_ref: "§21 / §23"
  }));

export const SALES_COPY_INTENSITY_PROFILE_BY_LEVEL: Record<CopyIntensity, SalesCopyIntensityProfile> =
  Object.fromEntries(
    SALES_COPY_INTENSITY_PROFILES.map((profile) => [profile.level, profile] as const)
  ) as Record<CopyIntensity, SalesCopyIntensityProfile>;

/* ---------------------------------------------------------- 下游交接 */

/**
 * 下游交接：已交付阶段不再登记（§60）。
 * Phase 14 事实审核与人工审批在 `fact-review.ts` 里自带合同，这里不再重复占位。
 */
export const SALES_COPY_DOWNSTREAM: readonly CategoryDownstreamItem[] = [];

/** §57 验收口径：文案必须能回答「主播能不能拿起来就讲，而且够狠」。 */
export const SALES_COPY_ACCEPTANCE_QUESTION =
  "强成交话术必须能回答：主播拿起来就能讲、够狠、不变成说明书，且一个字都没有编（§57 / §62-11）";

/** 供 API 自检与前端展示：五档强度、九种输出、八项评分与红线只从这里读取。 */
export const SALES_COPY_CONTRACT = {
  spec_ref: "§21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §48",
  levels: COPY_INTENSITY_META,
  default_level: DEFAULT_COPY_INTENSITY,
  intensify_button: {
    levels: INTENSIFY_BUTTON_META,
    mapping: INTENSIFY_LEVEL_TO_COPY_INTENSITY,
    max_auto_rounds: SALES_COPY_MAX_INTENSIFY_ROUNDS,
    /** §48 Agent 10 八项自检：达不到阈值最多再强化 3 轮，缺一项都不算达标 */
    self_check: INTENSIFY_SELF_CHECK_META,
    /** 强化的机械闸门：新版本的引用清单必须是源版本的子集，多出任何一条已录入事实就拒绝落库 */
    fact_rule: INTENSIFY_FACT_RULE,
    note: "「再狠一点」只能把现有事实讲得更狠，不得增加任何新事实（§34 / §48）"
  },
  impact_score: {
    spec_ref: "§23",
    max: IMPACT_SCORE_MAX,
    items: IMPACT_SCORE_META,
    bands: IMPACT_SCORE_BAND_META,
    min_score_by_intensity: MIN_IMPACT_SCORE_BY_INTENSITY
  },
  level5_requirements: LEVEL5_REQUIREMENT_META,
  level5_requirement_count: LEVEL5_REQUIREMENT_META.length,
  outputs: SALES_COPY_OUTPUT_META,
  agent9_outputs: SALES_COPY_AGENT9_OUTPUTS,
  min3_timeline: MIN3_TIMELINE,
  value_focus: VALUE_FOCUS_META,
  default_value_focus: DEFAULT_VALUE_FOCUS,
  modes: ["AUTO", "BENCHMARK", "CATEGORY_CREATOR"],
  limits: SALES_COPY_LIMITS,
  no_anchor_standard_sentence: NO_ANCHOR_STANDARD_SENTENCE,
  /** §17 / §58-9 / §62-10：没有可靠价格锚点时，文案不得降级成平庸版本，必须切到自建标准 */
  no_anchor_not_weak: true,
  /** §34 / §48：任何强化都不得增加新事实 */
  no_new_fact: true,
  /** §25：只有 RND_CONFIRMED 才允许出现真实研发关系暗示 */
  rnd_requires_confirmation: true,
  /** §22：只有存在可靠价格锚点时才允许写价格高度叙事 */
  price_story_only_with_anchor: true,
  /** §24 / §62-9：允许极强修辞（反问 / 比喻 / 排比 / 对比 / 身份塑造 / 情绪放大） */
  rhetoric_allowed: true,
  /** §57 / §62-14：RED claim 禁止发布 */
  red_blocks_publish: true,
  /** §62-11：前台文案不能因为研究层谨慎而变成说明书 */
  no_manual_style: true,
  /** §62-15：所有版本必须保留 */
  keep_all_versions: true,
  rules: [
    "五档强度由 §21 固定（研究 / 专业 / 强销售 / 直播爆款 / 王者），默认 Level 4，不得增删或重排",
    "§26 必须生成九种输出：5 句核心金句 / 20 句备用金句 / 15 秒 / 30 秒 / 60 秒 / 3 分钟 / Level 5 新品发布 / 经销商版 / 异议处理",
    "§23 八项评分合计 100，Level 4 ≥ 85、Level 5 ≥ 90；< 70 自动重写，不得发布",
    "§22 Level 5 七项强制全部落地：强反问 / 身份定义 / 价格高度叙事（有证据时）/ 产品结构叙事 / 风格身份证 / ≥ 3 句金句 / 成交收口",
    `§22 没有可靠价格锚点时，价格高度叙事必须逐字改用：「${NO_ANCHOR_STANDARD_SENTENCE}」，且不得写任何具体价格故事`,
    "§25 只有 RND_CONFIRMED 才允许出现「研发阶段曾参考 X / 团队拆解过 X / 作为风格参考之一」；禁止「复刻 X」「同款配方」「按 X 配方做」",
    "§47 允许比喻 / 反问 / 排比 / 对比 / 身份塑造 / 价格锚定 / 标准锚定 / 情绪放大 / 时间故事 / 高度修辞；禁止虚构 14 类硬事实与 5 类承诺",
    "§62-11 前台文案不得变成说明书：研究层的谨慎只能在 `evidence_gaps` 里说，不能把正文写成参数表",
    "§34 「再狠一点」最多自动增强 3 次，每次都要重新评分，且不得增加任何新事实",
    "§62-15 所有版本必须保留：重新生成只新增 version，人工确认写在 is_confirmed 上"
  ]
} as const;

/* ------------------------------------------------------------ 成稿对象 */

/** 金句：既要能独立传播，也要能剪进短视频（长度落到 §26 的限额上）。 */
export const salesCopyQuoteSchema = z
  .string()
  .trim()
  .min(SALES_COPY_LIMITS.minQuoteLength)
  .max(SALES_COPY_LIMITS.maxQuoteLength);
export type SalesCopyQuote = z.infer<typeof salesCopyQuoteSchema>;

/** 文案骨架：每一格正好对应 §23 里的一项评分，前端也能一眼看出缺哪一格。 */
export const salesCopyHeadlineSchema = z
  .object({
    /** §47 一句话定位 */
    one_liner: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §47 / §48 开场钩子：强反问或强指认（§23 开场抓人） */
    opening_hook: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §22 身份定义 */
    identity_definition: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §22 价格高度叙事；没有可靠价格锚点时逐字等于 §22 标准句 */
    price_or_standard_story: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §47 价值故事 */
    value_story: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §5 / §47 产品结构故事 */
    product_architecture_story: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §6 / §47 配方哲学 */
    formula_philosophy_story: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §4.2 风格身份证 */
    style_identity: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §8 差异化 */
    differentiation: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §8 / §48 画面感 */
    imagery: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §22 记忆点 */
    memory_point: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §27 02:35–02:50 适合谁：讲清楚什么人适合它、什么人可以先不买 */
    who_for: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    /** §22 成交收口 */
    closing: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength)
  })
  .strict();
export type SalesCopyHeadline = z.infer<typeof salesCopyHeadlineSchema>;

/**
 * §26 的金句两档。
 *
 * 这里用 `min` 而不是 `length`：§26 要求「必须生成 5 句 / 20 句」，
 * 多写几句不算违规，少写就是没交付。
 */
export const salesCopyQuotesSchema = z
  .object({
    core_quotes: z.array(salesCopyQuoteSchema).min(SALES_COPY_LIMITS.coreQuoteCount),
    backup_quotes: z.array(salesCopyQuoteSchema).min(SALES_COPY_LIMITS.backupQuoteCount)
  })
  .strict();
export type SalesCopyQuotes = z.infer<typeof salesCopyQuotesSchema>;

/** §27 的一段：时间轴取原文，正文只允许来自本产品已录入事实与上游成稿。 */
export const min3SegmentViewSchema = z
  .object({
    key: min3SegmentKeySchema,
    time_range: z.string(),
    label: z.string(),
    requirement: z.string(),
    text: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength)
  })
  .strict();
export type Min3SegmentView = z.infer<typeof min3SegmentViewSchema>;

export const min3ScriptSchema = z
  .object({
    segments: z.array(min3SegmentViewSchema).length(min3SegmentKeys.length),
    /** 八段串成的完整口播稿 */
    text: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength)
  })
  .strict();
export type Min3Script = z.infer<typeof min3ScriptSchema>;

export const salesCopyScriptsSchema = z
  .object({
    sec15: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    sec30: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    sec60: z.string().trim().max(SALES_COPY_LIMITS.maxTextLength),
    min3: min3ScriptSchema
  })
  .strict();
export type SalesCopyScripts = z.infer<typeof salesCopyScriptsSchema>;

/** §26 异议处理：应答属于解释或修辞，但同样一个字都不许编（§24）。 */
export const salesCopyObjectionSchema = z
  .object({
    objection: z.string().trim().min(1).max(SALES_COPY_LIMITS.maxTextLength),
    response: z.string().trim().min(1).max(SALES_COPY_LIMITS.maxTextLength),
    layer: z.enum(["INTERPRETATION", "RHETORIC"]),
    spec_ref: z.string()
  })
  .strict();
export type SalesCopyObjection = z.infer<typeof salesCopyObjectionSchema>;

/** §47 的一句话定位 / 开场钩子 / 价值故事等十五项输出，逐项报告交付状态。 */
export const salesCopyOutputStatusSchema = z
  .object({
    key: salesCopyOutputKeySchema,
    label: z.string(),
    requirement: z.string(),
    /** DONE = 这一项已经真的产出内容；MISSING = 这一项没交付 */
    status: z.enum(["DONE", "MISSING"]),
    /** 这一项产出多少句（脚本类为 0） */
    count: z.number().int().nonnegative(),
    /** 这一项产出多少字 */
    chars: z.number().int().nonnegative(),
    spec_ref: z.string()
  })
  .strict();
export type SalesCopyOutputStatus = z.infer<typeof salesCopyOutputStatusSchema>;

/* ------------------------------------------------- §23 成交冲击力评分对象 */

export const impactScoreCriterionResultSchema = z
  .object({
    key: z.string(),
    check: z.string(),
    points: z.number().int().nonnegative(),
    passed: z.boolean()
  })
  .strict();
export type ImpactScoreCriterionResult = z.infer<typeof impactScoreCriterionResultSchema>;

export const impactScoreItemViewSchema = z
  .object({
    key: impactScoreItemKeySchema,
    label: z.string(),
    /** §23 权重 */
    weight: z.number().int().positive(),
    criterion: z.string(),
    /** 本项实得分（各条通过项 points 之和） */
    points: z.number().int().nonnegative(),
    criteria: z.array(impactScoreCriterionResultSchema),
    spec_ref: z.string()
  })
  .strict();
export type ImpactScoreItemView = z.infer<typeof impactScoreItemViewSchema>;

export const impactScoreSchema = z
  .object({
    spec_ref: z.literal("§23"),
    total: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    band: impactScoreBandSchema,
    band_label: z.string(),
    /** §23：本档要求的最低分；只有 Level 4 / Level 5 有硬性要求，其余为 null */
    required: z.number().int().nonnegative().nullable(),
    passed: z.boolean(),
    /** 这一版正文逐字回查到的已录入事实条数（事实不足会被硬性压分，见 `note`） */
    facts_used: z.number().int().nonnegative(),
    /** 分数口径说明：是否被「事实不足」压分、为什么 */
    note: z.string(),
    items: z.array(impactScoreItemViewSchema).length(impactScoreItemKeys.length)
  })
  .strict()
  .refine((score) => score.max === IMPACT_SCORE_MAX, {
    message: `成交冲击力满分固定为 ${IMPACT_SCORE_MAX}（§23）`,
    path: ["max"]
  })
  .refine((score) => score.band === impactScoreBandOf(score.total), {
    message: "band 必须由总分与 §23 分档同源推导",
    path: ["band"]
  });
export type ImpactScore = z.infer<typeof impactScoreSchema>;

/* ------------------------------------------- §24 / §25 合规与 Level 5 自检 */

/**
 * 合规自检（§24 / §25 / §49 / §62）。
 *
 * 关键口径：**修辞不判 RED**。只有「会让消费者误认为存在一个并不存在的可核验事实」
 * （虚构研发关系、禁止承诺、虚构硬事实类别）才推高风险等级。
 */
export const salesCopyComplianceSchema = z
  .object({
    spec_ref: z.literal("§24 / §25 / §62"),
    /** 本产品是否存在 RND_CONFIRMED 的研发参考 */
    rnd_confirmed: z.boolean(),
    /** 正文里是否出现了研发关系暗示（无 RND_CONFIRMED 时为违规） */
    rnd_claimed: z.boolean(),
    /** 命中的禁止承诺（必涨 / 稳赚 / 保值 / 未来达到某价格 / 固定投资回报） */
    forbidden_promises: z.array(z.string()),
    /** 命中的受限措辞（复刻 X / 同款配方 / 按照 X 配方做） */
    restricted_phrases: z.array(z.string()),
    /** 命中的虚构硬事实类别（年份 / 树龄 / 山头 / 原料 / …） */
    fabricated_categories: z.array(z.string()),
    /** GREEN 可发布 / YELLOW 需人工确认 / RED 禁止发布（§49 / §57） */
    risk: riskLevelSchema,
    note: z.string()
  })
  .strict();
export type SalesCopyCompliance = z.infer<typeof salesCopyComplianceSchema>;

export const level5RequirementStatusSchema = z
  .object({
    key: level5RequirementKeySchema,
    label: z.string(),
    requirement: z.string(),
    check: z.string(),
    status: z.enum(["DONE", "MISSING"]),
    /** 命中证据原文；MISSING 时为 null */
    evidence: z.string().nullable(),
    spec_ref: z.string()
  })
  .strict();
export type Level5RequirementStatus = z.infer<typeof level5RequirementStatusSchema>;

export const salesCopyLevel5CheckSchema = z
  .object({
    spec_ref: z.literal("§22"),
    /** 只有 Level 5 才有七项强制；其它档位为 false（不要求，但已经做到的照样记账） */
    required: z.boolean(),
    satisfied: z.boolean(),
    missing: z.array(level5RequirementKeySchema),
    requirements: z.array(level5RequirementStatusSchema).length(LEVEL5_REQUIREMENT_META.length),
    /** 无可靠价格锚点时强制使用的 §22 原文句（供前端逐字对照） */
    no_anchor_standard_sentence: z.string()
  })
  .strict();
export type SalesCopyLevel5Check = z.infer<typeof salesCopyLevel5CheckSchema>;

/** §57 MVP 验收：分数、九种输出、Level 5 七项、合规四项全过才算通过。 */
export const salesCopyAcceptanceSchema = z
  .object({
    spec_ref: z.literal("§57"),
    question: z.string(),
    intensity: copyIntensitySchema,
    required_score: z.number().int().nonnegative().nullable(),
    impact_score: z.number().int().nonnegative(),
    score_passed: z.boolean(),
    quotes_total: z.number().int().nonnegative(),
    min_quotes: z.number().int().positive(),
    core_quotes: z.number().int().nonnegative(),
    backup_quotes: z.number().int().nonnegative(),
    outputs_complete: z.boolean(),
    missing_outputs: z.array(salesCopyOutputKeySchema),
    level5_passed: z.boolean(),
    compliance_passed: z.boolean(),
    passed: z.boolean(),
    missing: z.array(z.string())
  })
  .strict();
export type SalesCopyAcceptance = z.infer<typeof salesCopyAcceptanceSchema>;

/* -------------------------------------------------------------- API 对象 */

/**
 * 对标上下文（§4.1 / §4.2 / §17）。
 *
 * `has_reliable_price_anchor` 的唯一来源是锚点引擎（`AnchorsService.benchmarkMode()`）：
 * 只有解析出 `mode === "BENCHMARK"` 才算「有可靠价格锚点」——本层不重算任何阈值，
 * 也不允许因为「看起来像」就把自建标准写成价格高度（§17 / §58-9 / §62-10）。
 */
export const salesCopyAnchorRefSchema = z
  .object({
    has_reliable_price_anchor: z.boolean(),
    primary_anchor_id: z.string().uuid().nullable(),
    primary_anchor_name: z.string().nullable(),
    anchor_count: z.number().int().nonnegative(),
    /** 对标只提供「价格高度」这一层标准，绝不提供本产品的事实（§44 / §62-5） */
    usage: z.literal("STANDARD_ONLY")
  })
  .strict();
export type SalesCopyAnchorRef = z.infer<typeof salesCopyAnchorRefSchema>;

/** 上游成稿的到位情况：只如实报告，不替上游做判断，也不代替上游补内容（§60）。 */
export const salesCopyUpstreamStatusSchema = z
  .object({
    architecture_version: z.number().int().positive().nullable(),
    architecture_acceptance_passed: z.boolean(),
    philosophy_version: z.number().int().positive().nullable(),
    philosophy_acceptance_passed: z.boolean(),
    /** Phase 8 自建标准 / 风格身份证是否已就绪 */
    category_creator_ready: z.boolean(),
    /** Phase 9 价值映射是否已生成 */
    value_codes_ready: z.boolean()
  })
  .strict();
export type SalesCopyUpstreamStatus = z.infer<typeof salesCopyUpstreamStatusSchema>;

/**
 * 一版强成交话术成稿（§21 / §22 / §23 / §26 / §27 / §47）。
 *
 * 七条 refine 把「铁律」写进 schema，而不是写在文档里：
 * 分数、Level 5、合规三项必须与各自的明细同源；没有可靠价格锚点时必须逐字用 §22 标准句，
 * 且不得挂上一个锚点 id；Benchmark Mode 必须真有可靠锚点；没有 RND_CONFIRMED 时一个字都不许暗示研发关系。
 */
export const salesCopyRecordSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    version: z.number().int().positive(),
    /** 产品录入时的模式偏好：AUTO / BENCHMARK / CATEGORY_CREATOR（§33 模式控件） */
    preference: researchModeSchema,
    /** 本版生成时实际生效的模式（§17） */
    mode_at_generation: resolvedResearchModeSchema,
    resolved_by: anchorResolveSourceSchema,
    mode_reason: z.string(),
    /** §21 本版使用的成交强度（默认 Level 4） */
    intensity: copyIntensitySchema,
    /** §34 / §48：这一版实际自动增强了多少轮（0–3，最多 3 轮） */
    intensify_rounds: z.number().int().nonnegative().max(SALES_COPY_MAX_INTENSIFY_ROUNDS),
    /** §33 本版命中的价值重点八项 */
    value_focus: z.array(valueFocusKeySchema),
    anchor: salesCopyAnchorRefSchema,
    upstream: salesCopyUpstreamStatusSchema,
    headline: salesCopyHeadlineSchema,
    quotes: salesCopyQuotesSchema,
    /** §47 七大卖点，正好七条 */
    selling_points: z.array(z.string()).length(SALES_COPY_LIMITS.sellingPointCount),
    scripts: salesCopyScriptsSchema,
    level5_release: z.string(),
    dealer_copy: z.string(),
    objections: z.array(salesCopyObjectionSchema).max(SALES_COPY_LIMITS.maxObjections),
    /** §26 九种输出的逐项交付状态 */
    output_statuses: z.array(salesCopyOutputStatusSchema).length(salesCopyOutputKeys.length),
    impact_score: impactScoreSchema,
    level5: salesCopyLevel5CheckSchema,
    compliance: salesCopyComplianceSchema,
    acceptance: salesCopyAcceptanceSchema,
    evidence_gaps: z.array(z.string()),
    fact_refs: z.array(z.string()),
    value_dna_refs: z.array(z.string()),
    /** 引用了哪些上游成稿，例如 architecture:3 / formula_philosophy:2 */
    upstream_refs: z.array(z.string()),
    is_confirmed: z.boolean(),
    confirmed_by: z.string().uuid().nullable(),
    confirmed_at: z.string().nullable(),
    notes: z.string().nullable(),
    created_by: z.string().uuid().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    spec_ref: z.literal("§21 / §22 / §23 / §26 / §27 / §33 / §47")
  })
  .strict()
  .refine((record) => record.acceptance.impact_score === record.impact_score.total, {
    message: "验收里的成交冲击力必须与 §23 评分同源（§57）",
    path: ["acceptance", "impact_score"]
  })
  .refine((record) => record.acceptance.level5_passed === record.level5.satisfied, {
    message: "验收里的 Level 5 结论必须与 §22 七项自检同源（§22 / §57）",
    path: ["acceptance", "level5_passed"]
  })
  .refine((record) => record.acceptance.compliance_passed === (record.compliance.risk !== "RED"), {
    message: "只有 RED 才禁止发布：验收的合规结论必须由 §24 风险等级推导（§57）",
    path: ["acceptance", "compliance_passed"]
  })
  .refine(
    (record) =>
      record.anchor.has_reliable_price_anchor ||
      record.headline.price_or_standard_story.includes(NO_ANCHOR_STANDARD_SENTENCE),
    {
      message: `没有可靠价格锚点时，价格高度叙事必须逐字改用 §22 标准句（${NO_ANCHOR_STANDARD_SENTENCE}）`,
      path: ["headline", "price_or_standard_story"]
    }
  )
  .refine((record) => record.anchor.has_reliable_price_anchor || record.anchor.primary_anchor_id === null, {
    message: "没有可靠价格锚点时不得挂上锚点 id（§17 / §62-10）",
    path: ["anchor", "primary_anchor_id"]
  })
  .refine(
    (record) => record.mode_at_generation === "CATEGORY_CREATOR" || record.anchor.has_reliable_price_anchor,
    {
      message: "Benchmark Mode 必须有可靠价格锚点，没有就必须进 Category Creator（§17 / §62-10）",
      path: ["mode_at_generation"]
    }
  )
  .refine((record) => record.compliance.rnd_confirmed || !record.compliance.rnd_claimed, {
    message: "没有 RND_CONFIRMED 时不得出现任何真实研发关系暗示（§25 / §62-8）",
    path: ["compliance", "rnd_claimed"]
  });
export type SalesCopyRecordView = z.infer<typeof salesCopyRecordSchema>;

export const salesCopyVersionSummarySchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    intensity: copyIntensitySchema,
    /** §34 / §48：这一版已经自动增强过几轮（0–3） */
    intensify_rounds: z.number().int().nonnegative().max(SALES_COPY_MAX_INTENSIFY_ROUNDS),
    impact_score: z.number().int().nonnegative(),
    band: impactScoreBandSchema,
    score_passed: z.boolean(),
    outputs_complete: z.boolean(),
    level5_passed: z.boolean(),
    compliance_passed: z.boolean(),
    acceptance_passed: z.boolean(),
    is_confirmed: z.boolean(),
    created_at: z.string()
  })
  .strict();
export type SalesCopyVersionSummary = z.infer<typeof salesCopyVersionSummarySchema>;

export const salesCopyOverviewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    preference: researchModeSchema,
    mode: resolvedResearchModeSchema,
    resolved_by: anchorResolveSourceSchema,
    mode_reason: z.string(),
    /** 产品录入的默认强度（§10.5 / §21） */
    default_intensity: copyIntensitySchema,
    can_generate: z.boolean(),
    block_reason: z.string().nullable(),
    record: salesCopyRecordSchema.nullable(),
    versions: z.array(salesCopyVersionSummarySchema),
    /** 还没交付的 §26 输出（用于强成交页面排产） */
    missing_outputs: z.array(salesCopyOutputKeySchema),
    anchor: salesCopyAnchorRefSchema,
    upstream: salesCopyUpstreamStatusSchema,
    spec_ref: z.literal("§21 / §26 / §27 / §47")
  })
  .strict();
export type SalesCopyOverview = z.infer<typeof salesCopyOverviewSchema>;

/** 「强成交文案」跨产品列表行：只做检索与排产，不改写任何产品事实或上游成稿。 */
export const salesCopyMatrixRowSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    year: z.number().int(),
    tea_type: z.string(),
    mountain: z.string().nullable(),
    mode: resolvedResearchModeSchema,
    preference: researchModeSchema,
    has_reliable_price_anchor: z.boolean(),
    record_id: z.string().uuid().nullable(),
    version: z.number().int().positive().nullable(),
    intensity: copyIntensitySchema.nullable(),
    impact_score: z.number().int().nonnegative().nullable(),
    band: impactScoreBandSchema.nullable(),
    is_confirmed: z.boolean(),
    outputs_complete: z.boolean(),
    level5_passed: z.boolean(),
    compliance_passed: z.boolean(),
    acceptance_passed: z.boolean(),
    missing_outputs: z.array(salesCopyOutputKeySchema),
    one_liner: z.string().nullable(),
    generated_at: z.string().nullable(),
    spec_ref: z.literal("§21 / §26 / §47")
  })
  .strict();
export type SalesCopyMatrixRow = z.infer<typeof salesCopyMatrixRowSchema>;

export const salesCopyGenerateSchema = z
  .object({
    /** §21 成交强度；不传就用产品录入的 `copy_intensity_default`（默认 Level 4） */
    intensity: copyIntensitySchema.optional(),
    /** §33 价值重点八项；不传就按 §33 默认全选 */
    value_focus: z.array(valueFocusKeySchema).min(1).max(valueFocusKeys.length).optional(),
    /**
     * §33 模式控件：AUTO 走 §17 自动判定；手动选 BENCHMARK 时必须有可靠价格锚点，
     * 否则服务层直接 400（宁可报错，也不许把没有对标的茶写成 Benchmark Mode，§62-10）。
     */
    mode: researchModeSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type SalesCopyGenerateInput = z.infer<typeof salesCopyGenerateSchema>;

/**
 * §7 / §34「再狠一点」请求体。
 *
 * `level` 是 UI 上点的那一档（普通 / 强势 / 爆款 / 王者），内部映射到 §21 成交强度；
 * `record_id` 指定要强化的那一版，不传就强化最新版；`notes` 只记录人工备注。
 * 这里没有「改哪几句」「加什么事实」之类的参数——强化器不接受任何事实输入（§34）。
 */
export const salesCopyIntensifySchema = z
  .object({
    level: intensifyLevelSchema,
    /** 要强化的那一版；不传就取最新版（§62-15） */
    record_id: z.string().uuid().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type SalesCopyIntensifyInput = z.infer<typeof salesCopyIntensifySchema>;

export const salesCopyIntensifyPreviousSchema = z
  .object({
    version: z.number().int().positive(),
    intensity: copyIntensitySchema,
    impact_score: z.number().int().nonnegative(),
    band: impactScoreBandSchema,
    passed: z.boolean()
  })
  .strict();

/**
 * §7 / §34 / §48「再狠一点」响应体。
 *
 * 三个关键口径写进 schema 而不是文档：
 * 1. `added_facts` 必须是空数组——强化器在机械层面就不允许增加任何新事实（§34）；
 * 2. `record` 是**新版本**的完整视图，源版本原封不动保留（§62-15）；
 * 3. `self_check` 是 §48 的八项自检结论，达不到分数阈值时如实标 `score_passed: false`。
 */
export const salesCopyIntensifyResultSchema = z
  .object({
    level: intensifyLevelSchema,
    /** 新版本的成交强度：只升不降，取「源版本强度」与「按钮映射档位」的较大者（§7 / §21） */
    intensity: copyIntensitySchema,
    source_intensity: copyIntensitySchema,
    /** 这是第几轮自动强化（源版本 + 1，上限 3） */
    round: z.number().int().positive().max(SALES_COPY_MAX_INTENSIFY_ROUNDS),
    max_auto_rounds: z.number().int().positive(),
    previous: salesCopyIntensifyPreviousSchema,
    /** 与源版本相比真正被改写的位置（逐格对比，便于人工抽查） */
    changed_elements: z.array(z.string()),
    /** §34：必须为空。任何非空都说明强化器动了新事实，服务层会直接报错 */
    added_facts: z.array(z.string()).max(0),
    self_check: intensifySelfCheckSchema,
    /** 强化产出的新版本（完整成稿，含 §23 评分 / §22 七项 / §24 合规 / §57 验收） */
    record: salesCopyRecordSchema,
    spec_ref: z.literal("§7 / §34 / §48")
  })
  .strict()
  .refine((result) => result.record.intensity === result.intensity, {
    message: "新版本的成交强度必须与强化结论同源（§21）",
    path: ["record", "intensity"]
  })
  .refine((result) => result.record.intensify_rounds === result.round, {
    message: "新版本的增强轮次必须与本次强化轮次一致（§48）",
    path: ["record", "intensify_rounds"]
  })
  .refine((result) => result.self_check.score === result.record.impact_score.total, {
    message: "§48 自检分数必须与 §23 评分同源",
    path: ["self_check", "score"]
  });
export type SalesCopyIntensifyResult = z.infer<typeof salesCopyIntensifyResultSchema>;

export const salesCopyUpdateSchema = z
  .object({
    is_confirmed: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type SalesCopyUpdateInput = z.infer<typeof salesCopyUpdateSchema>;

export const salesCopySortSchema = z.enum([
  "-updated_at",
  "updated_at",
  "product_name",
  "-product_name",
  "-impact_score",
  "-version"
]);
export type SalesCopySort = z.infer<typeof salesCopySortSchema>;

export const salesCopyListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(SALES_COPY_LIMITS.maxPageSize).optional(),
    product_id: z.string().uuid().optional(),
    /** 查询串是字符串：先用 `coerce` 变数字，再用五档枚举卡死取值 */
    intensity: z.coerce.number().int().pipe(copyIntensitySchema).optional(),
    /**
     * 查询串里的布尔值一律用 `stringbool`：
     * `z.coerce.boolean()` 会把 `"false"` 解析成 true，让筛选结果整体反过来（见 agent_memory/bugs.md）。
     */
    level5: z.stringbool().optional(),
    has_anchor: z.stringbool().optional(),
    /** 排产筛选：`true` 只看还没生成强成交话术的产品，`false` 只看已经写成稿的产品（两个方向都要能筛） */
    missing: z.stringbool().optional(),
    /** §17 已解析模式：与锚点引擎同口径（同一组阈值常量），只用于排产检索，不参与任何打分 */
    mode: resolvedResearchModeSchema.optional(),
    q: z.string().trim().max(200).optional(),
    sort: salesCopySortSchema.optional()
  })
  .strict();
export type SalesCopyListQuery = z.infer<typeof salesCopyListQuerySchema>;

/* ------------------------------------------------------------ 纯函数构建器 */

/**
 * 产品侧输入：字段口径与产品结构（§5 / §45）、配方哲学（§6）完全一致。
 * 三个上游 Phase 引用的是同一份已录入事实，因此成交层不可能「多知道」任何东西（§62-5）。
 */
export interface SalesCopyProductInput extends CategoryStandardProductInput {
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

export interface SalesCopyFactHit {
  /** 事实来源字段路径，例如 product.mountain / dna.origin */
  ref: string;
  value: string;
}

/** Phase 10 产品结构：只作为结构与记忆点的叙事来源，不作本产品的硬事实（§5 / §45）。 */
export interface SalesCopyArchitectureInput {
  version: number;
  written_roles: number;
  acceptance_passed: boolean;
  roles: ProductArchitecture;
  /** 上游成稿正文（逐字引用，不做二次改写） */
  narrative: string;
  gap_role_labels: string[];
}

/** Phase 11 配方哲学：设计逻辑与成交层解释直接引用上游成稿（§6 / §46）。 */
export interface SalesCopyPhilosophyInput {
  version: number;
  written_components: number;
  acceptance_passed: boolean;
  design_logic_ready: boolean;
  strategy: string;
  sales_explanation: string;
  gap_component_labels: string[];
}

/** Phase 8 自建标准 / 风格身份证（§4.2 / §8）。 */
export interface SalesCopyCategoryInput {
  style_identity: CategoryStyleIdentity;
  standard_summary: string;
}

/**
 * §24 / §25 合规语料与逐字回查所需的上下文。
 *
 * 抽出这一层是因为**语料口径只能有一份实现**（Phase 11 的教训）：Phase 14 的逐句事实审核
 * 只需要这几项就能算出与 Phase 12 完全相同的 `salesCopyComplianceCorpus()`，
 * 生成侧（`SalesCopyBuildInput`）与审核侧（`FactReviewBuildInput`）都从它派生。
 */
export interface SalesCopyComplianceCorpusInput {
  product: SalesCopyProductInput;
  /** §9 Value DNA；未生成时传 null（11 维全空同样视同未生成） */
  value_dna: ValueDna | null;
  architecture?: SalesCopyArchitectureInput | null;
  philosophy?: SalesCopyPhilosophyInput | null;
  category?: SalesCopyCategoryInput | null;
}

export interface SalesCopyBuildInput extends SalesCopyComplianceCorpusInput {
  /** 产品录入时的模式偏好（§33 模式控件） */
  preference: ResearchMode;
  /** §17 实际生效模式：由锚点引擎解析，本层不重算任何阈值 */
  mode: ResolvedResearchMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  /** §21 成交强度（默认 Level 4） */
  intensity: CopyIntensity;
  /** §33 价值重点八项（勾中的项必须多讲，未勾中的不硬塞） */
  value_focus: readonly ValueFocusKey[];
  /** 锚点引擎的完整视图；没有对标时传 null */
  anchor: BenchmarkModeView | null;
  value_codes?: Partial<Record<ValueCodeKey, ValueCodeStatus>> | null;
  /** §25：是否存在 RND_CONFIRMED 的研发参考 */
  rnd_confirmed: boolean;
}

/** 一版成稿的可读内容（正文本身）。读取既有版本时同样从这七个字段复盘。 */
export interface SalesCopyBody {
  headline: SalesCopyHeadline;
  quotes: SalesCopyQuotes;
  selling_points: string[];
  scripts: SalesCopyScripts;
  level5_release: string;
  dealer_copy: string;
  objections: SalesCopyObjection[];
}

export interface SalesCopyDraft extends SalesCopyBody {
  anchor: SalesCopyAnchorRef;
  upstream: SalesCopyUpstreamStatus;
  /** §26 九种输出的逐项交付状态（生成与回看共用同一份实现） */
  output_statuses: SalesCopyOutputStatus[];
  impact_score: ImpactScore;
  level5: SalesCopyLevel5Check;
  compliance: SalesCopyCompliance;
  acceptance: SalesCopyAcceptance;
  /** §34 / §48：本版已经自动增强过几轮（0–3；新建版本恒为 0，每次「再狠一点」生成的新版本 +1） */
  intensify_rounds: number;
  /** 有可靠价格锚点、且锚点本身带可靠价格证据时才为 true */
  price_high_story_ready: boolean;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  upstream_refs: string[];
}

/**
 * 只认「本产品已录入字段」这张白名单：没在这里列出的字段路径一律取不到值。
 * 对标产品、模型记忆、网页抽取出来的候选事实都不能出现在成交文案里（§24 / §44 / §62-5）。
 */
const SALES_COPY_FACT_FIELDS: Record<string, keyof SalesCopyProductInput> = {
  "product.product_name": "product_name",
  "product.series_name": "series_name",
  "product.year": "year",
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
 * 事实回查白名单的全部字段路径（`product.*`）。
 *
 * Phase 14 的逐句事实审核要按同一份白名单取证据，因此这里把键列出来；
 * 白名单本身仍然只有一份（`SALES_COPY_FACT_FIELDS`），不另建一份字段清单。
 */
export const SALES_COPY_FACT_REFS: readonly string[] = Object.keys(SALES_COPY_FACT_FIELDS);

/**
 * §33 价值重点八项里唯一不吃「产品已录入字段」白名单的一项：
 * 它走锚点（对标只提供价格高度这一层标准），因此不参与事实回查。
 */
const ANCHOR_FOCUS_REF = "anchor.primary_anchor";

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 按字段路径回查本产品已录入事实；取不到就是没录，绝不补全（§24 / §46）。 */
export function salesCopyFactValue(product: SalesCopyProductInput, ref: string): string | null {
  const field = SALES_COPY_FACT_FIELDS[ref];
  if (!field) {
    return null;
  }
  const raw = product[field];
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : null;
  }
  return trimToNull(raw);
}

/**
 * Value DNA 只在至少一维有内容时参与成交话术（与产品结构 / 配方哲学同一口径）。
 *
 * Phase 14 的逐句事实审核同样只认这一份「空 DNA = 未生成」的归一，
 * 否则同一句话在生成侧与审核侧会得到不同的引用结论。
 */
export function usableValueDna(value_dna: ValueDna | null): ValueDna | null {
  if (!value_dna) {
    return null;
  }
  const hasContent = VALUE_DNA_DIMENSIONS.some((dimension) => (value_dna[dimension]?.length ?? 0) > 0);
  return hasContent ? value_dna : null;
}

/**
 * 对标上下文的唯一判定口径（§4.1 / §16 / §17）：
 * 有可靠价格锚点 = 锚点引擎给出 BENCHMARK 模式，且存在 primary_anchor。
 * 本层不重算相似度、不重算价格证据阈值——否则「有锚点」会出现两套结论。
 */
export function salesCopyAnchorRefOf(benchmark: BenchmarkModeView | null): SalesCopyAnchorRef {
  const primary = benchmark?.primary_anchor ?? null;
  const hasReliable = benchmark?.mode === "BENCHMARK" && primary !== null;
  return salesCopyAnchorRefSchema.parse({
    has_reliable_price_anchor: hasReliable,
    primary_anchor_id: hasReliable ? primary?.id ?? null : null,
    primary_anchor_name: hasReliable
      ? primary?.candidate_name ?? primary?.snapshot.candidate.name ?? null
      : null,
    anchor_count: benchmark?.anchors.length ?? 0,
    usage: "STANDARD_ONLY"
  });
}

/**
 * 「这一版能不能讲价格高度」= 有可靠锚点 **且** 锚点自己带着可靠价格证据（§16.1）。
 *
 * 只有候选、没有可靠价格时，价格高度是讲不出来的：此时一律改用 §22 标准句，
 * 宁可把标准立起来，也不拿一个没有价格证据的候选去撑价格叙事（§58-9）。
 */
export function salesCopyPriceStoryReady(
  benchmark: BenchmarkModeView | null,
  anchor: SalesCopyAnchorRef
): boolean {
  const primary = benchmark?.primary_anchor ?? null;
  if (!anchor.has_reliable_price_anchor || !primary) {
    return false;
  }
  return primary.snapshot.reliable_price_count > 0;
}

/** 上游成稿到位情况：只如实报告，不替上游做判断（§60）。 */
export function salesCopyUpstreamStatusOf(input: SalesCopyBuildInput): SalesCopyUpstreamStatus {
  const categoryIdentity = input.category?.style_identity ?? null;
  return salesCopyUpstreamStatusSchema.parse({
    architecture_version: input.architecture?.version ?? null,
    architecture_acceptance_passed: input.architecture?.acceptance_passed ?? false,
    philosophy_version: input.philosophy?.version ?? null,
    philosophy_acceptance_passed: input.philosophy?.acceptance_passed ?? false,
    category_creator_ready: Boolean(
      categoryIdentity &&
        (trimToNull(categoryIdentity.identity_name) !== null ||
          trimToNull(categoryIdentity.category_positioning) !== null)
    ),
    value_codes_ready: Boolean(input.value_codes && Object.keys(input.value_codes).length > 0)
  });
}

/** 供 API 自检与前端展示：本阶段是纯规则引擎，AI 三个 Prompt 已登记但尚未接线（Phase 13+）。 */
export const SALES_COPY_ENGINE_INFO = {
  name: "Strong Sales Copy Engine（Agent 9 强成交文案师 + Agent 10 成交冲击力评分）",
  strategy: "RULE_BASED",
  ai_wired: false,
  prompt_keys: ["SALES_COPYWRITER", "COPY_INTENSIFIER", "FACT_REVIEWER"],
  spec_ref: "§21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §48",
  note:
    "Phase 13 仍为纯规则引擎：只把本产品已录入事实与上游成稿（产品结构 / 配方哲学 / 自建标准）写成成交稿，" +
    "不调用 AI、不新增任何事实；「再狠一点」（§34）已接线——它用同一份事实、更高一档的机械画像重跑总装，" +
    "并在机械层面比对强化前后的引用清单，保证新版本绝不出现源版本没有的事实（§48 最多自动强化 3 轮）。"
} as const;

/* -------------------------------------------------- 事实槽位（只读白名单） */

export interface SalesCopyFactPool {
  product: SalesCopyProductInput;
  dna: ValueDna | null;
}

/**
 * 槽位 → 允许引用的字段路径。
 *
 * 一个槽位（例如「香气」）可以有几个候选字段，取第一个录了的。
 * 这样「只录入 liquor_aroma」和「只录入 dry_leaf_aroma」的产品都能写出香气这一层，
 * 而且写出来的永远是**录入过的那一句**，不是模型补的（§24 / §46）。
 */
const SLOT_REFS = {
  name: ["product.product_name"],
  series: ["product.series_name"],
  type: ["product.tea_subtype", "product.tea_type"],
  place: [
    "product.mountain",
    "product.village",
    "product.origin_region",
    "product.origin_city",
    "product.origin_province",
    "dna.origin"
  ],
  material: [
    "product.raw_material",
    "product.tree_type",
    "product.tree_age",
    "product.season",
    "product.grade",
    "dna.material"
  ],
  aroma: [
    "product.liquor_aroma",
    "product.hot_cup_aroma",
    "product.dry_leaf_aroma",
    "dna.flavor"
  ],
  taste: ["product.entry_taste", "product.sweetness", "product.thickness", "dna.taste"],
  aftertaste: [
    "product.huigan",
    "product.salivation",
    "product.cha_qi",
    "product.bitterness",
    "product.astringency"
  ],
  body: [
    "product.thickness",
    "product.viscosity",
    "product.water_texture",
    "product.middle_stage",
    "dna.architecture_signals"
  ],
  finish: ["product.finish", "product.endurance", "product.late_stage", "product.early_stage"],
  craft: [
    "product.harvest_standard",
    "product.kill_green_method",
    "product.rolling_method",
    "product.drying_method",
    "product.pressing_method",
    "product.fermentation_method",
    "product.processing_notes",
    "dna.process"
  ],
  time: ["product.year", "product.storage", "product.fermentation_degree", "product.season", "dna.collection"],
  signature: [
    "product.cha_qi",
    "product.dry_leaf_aroma",
    "product.liquor_aroma",
    "dna.positioning",
    "dna.identity"
  ]
} as const;

type SlotKey = keyof typeof SLOT_REFS;

/** 事实不足时用于兜底的「只讲已经成立的东西」句式：不是事实，也不冒充事实。 */
const SLOT_FALLBACK: Record<SlotKey, string> = {
  name: "这一款",
  series: "",
  type: "茶",
  place: "",
  material: "",
  aroma: "",
  taste: "",
  aftertaste: "",
  body: "",
  finish: "",
  craft: "",
  time: "",
  signature: ""
};

function dnaFact(dna: ValueDna | null, ref: string): SalesCopyFactHit | null {
  if (!dna || !ref.startsWith("dna.")) {
    return null;
  }
  const dimension = ref.slice(4);
  if (!(VALUE_DNA_DIMENSIONS as readonly string[]).includes(dimension)) {
    return null;
  }
  const values = dna[dimension as ValueDnaDimension] ?? [];
  const value = values.map((item) => item.trim()).find((item) => item.length > 0);
  return value ? { ref, value } : null;
}

function productFact(pool: SalesCopyFactPool, ref: string): SalesCopyFactHit | null {
  const value = salesCopyFactValue(pool.product, ref);
  return value ? { ref, value } : null;
}

function slotHit(pool: SalesCopyFactPool, key: SlotKey): SalesCopyFactHit | null {
  for (const ref of SLOT_REFS[key]) {
    const hit = ref.startsWith("dna.") ? dnaFact(pool.dna, ref) : productFact(pool, ref);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** 槽位取值：录了就逐字引用，没录就返回 null（由调用方决定是换句式还是留空）。 */
function slotValue(pool: SalesCopyFactPool, key: SlotKey): string | null {
  return slotHit(pool, key)?.value ?? null;
}

/** 槽位取值 + 兜底句式：兜底文本只写「没录就不补」这类话，绝不假装是事实。 */
function slotText(pool: SalesCopyFactPool, key: SlotKey, fallback?: string): string {
  return slotValue(pool, key) ?? fallback ?? SLOT_FALLBACK[key];
}

/**
 * 已录入事实的逐字值集合（用于判定某段文案是否落在事实上）。
 *
 * Phase 14 事实审核的逐句判定走同一份实现：只认本产品已录入字段与 Value DNA，
 * 对标产品的事实永远进不来（§24 / §44 / §62-5）。
 */
export function salesCopyRecordedValues(pool: SalesCopyFactPool): string[] {
  const values: string[] = [];
  for (const ref of Object.keys(SALES_COPY_FACT_FIELDS)) {
    const value = salesCopyFactValue(pool.product, ref);
    if (value) {
      values.push(value);
    }
  }
  if (pool.dna) {
    for (const dimension of VALUE_DNA_DIMENSIONS) {
      for (const item of pool.dna[dimension] ?? []) {
        const value = item.trim();
        if (value) {
          values.push(value);
        }
      }
    }
  }
  return values;
}

function textsOf(values: readonly string[]): string {
  return values.filter((value) => value.trim().length > 0).join("、");
}

function uniqueLines(lines: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

/**
 * 金句收口：`salesCopyQuoteSchema` 卡的是 6–120 字，超出区间会在 parse 时直接失败。
 * 因此这里先把落在区间外的候选剔掉，再从纯修辞备用金句库里补足——宁可少说一句，
 * 也不允许某一版因为「某个字段特别长」而整版生成失败（§26 / §58-10）。
 */
function usableQuotes(lines: readonly string[], limit: number): string[] {
  const usable = lines
    .map((line) => line.trim())
    .filter(
      (line) => line.length >= SALES_COPY_LIMITS.minQuoteLength && line.length <= SALES_COPY_LIMITS.maxQuoteLength
    );
  return uniqueLines(usable, limit);
}

/** §58-10：可独立传播 = 6–48 字、自带收束、不以指代词开头。 */
export const SALES_COPY_QUOTABLE_MAX_LENGTH = 48;

export function salesCopyQuotableLines(lines: readonly string[]): string[] {
  return lines.filter((line) => {
    const text = line.trim();
    if (text.length < SALES_COPY_LIMITS.minQuoteLength || text.length > SALES_COPY_QUOTABLE_MAX_LENGTH) {
      return false;
    }
    if (!/[。？！!?]$/.test(text)) {
      return false;
    }
    return !/^(它|这个|这款茶也|上述)/.test(text);
  });
}

/**
 * 备用金句库：**全部是修辞**（反问 / 对比 / 身份塑造 / 情绪放大），一句都不含硬事实，
 * 因此不存在「金句写多了编出事实」的风险（§47 / §58-8）。
 */
const BACKUP_QUOTE_BANK: readonly string[] = [
  "标准立不住，价格就只是数字。",
  "先立标准，再谈价格。",
  "真正的高度，从来不是标出来的。",
  "听懂一句话很容易，喝懂一款茶很难。",
  "不要让别人的价格，决定你的判断。",
  "它是给懂的人准备的，不是给所有人准备的。",
  "先看结构，再谈香气。",
  "好茶的共同点只有一条：喝完还在。",
  "同样的一口茶，喝的是底子，不是包装。",
  "记忆点不是喊出来的，是留得住的。",
  "讲得再热，也要对得上那一口。",
  "不怕被比较，只怕没有标准。",
  "价格可以学，标准学不来。",
  "一饼茶的高度，先写在结构里。",
  "喝完之后还想着的，才是它的价值。",
  "把话说满很容易，把标准立住很难。",
  "你记住的不是形容词，是那一口。",
  "越是没有对标，越要把标准讲清楚。",
  "不靠别人的名字，靠自己的一口。",
  "收藏的理由从来不是承诺，是条件。",
  "入门看价格，进阶看结构。",
  "能复述的一口，才算被记住。",
  "高级感不是形容词，是设计出来的次序。",
  "位置不是抢来的，是立起来的。",
  "好茶不用喊，它需要被喝到。",
  "它的底气，来自能核对的事实。",
  "你以为在挑价格，其实在挑标准。",
  "第一口骗不了人，第四泡更骗不了人。",
  "能被记住的茶，都有自己的一层结构。",
  "别急着问贵不贵，先问它凭什么。"
];

/* ---------------------------------------------------------- 成稿内容构建 */

interface SalesCopyContext extends SalesCopyFactPool {
  intensity: CopyIntensity;
  focus: ReadonlySet<ValueFocusKey>;
  anchor: SalesCopyAnchorRef;
  price_high_story_ready: boolean;
  architecture: SalesCopyArchitectureInput | null;
  philosophy: SalesCopyPhilosophyInput | null;
  category: SalesCopyCategoryInput | null;
  rnd_confirmed: boolean;
  profile: SalesCopyIntensityProfile;
}

function joinSentences(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

function productName(ctx: SalesCopyContext): string {
  return ctx.product.product_name;
}

function typeLabel(ctx: SalesCopyContext): string {
  return slotText(ctx, "type", "茶");
}

/** §47 一句话定位：who / when / what / 用料与辨识度，全部逐字来自已录入事实。 */
function headingOneLiner(ctx: SalesCopyContext): string {
  const place = slotValue(ctx, "place");
  const material = slotValue(ctx, "material");
  const signature = slotValue(ctx, "signature");
  return [
    productName(ctx),
    `${ctx.product.year} 年${place ? `${place} ` : ""}${typeLabel(ctx)}`,
    material ? `用料落在 ${material} 上` : "",
    signature ? `辨识度在 ${signature}` : ""
  ]
    .filter((part) => part.length > 0)
    .join("｜");
}

/**
 * §48 开场钩子：强销售档以上用强反问，研究 / 专业档只做直给。
 *
 * §7.1 王者档多一层「懂的人才能看懂」的指认式开场（仍然带强反问，且守 60 字上限 / 无说明书腔）。
 */
function headingOpeningHook(ctx: SalesCopyContext): string {
  if (ctx.profile.king_takeover) {
    return ctx.anchor.has_reliable_price_anchor
      ? "懂的人不用别人介绍，一眼就知道它是什么级别——那你有没有想过：它凭什么敢站上这一档？"
      : "懂的人不用别人介绍，一眼就知道它是什么级别——那你有没有想过：它凭什么敢把标准立得这么硬？";
  }
  if (ctx.profile.rhetorical_hook) {
    return ctx.anchor.has_reliable_price_anchor
      ? "同一类茶里，为什么只有极少数能站上高价带？答案不在标签上，在它自己的标准里。"
      : "你有没有想过：一款没有对标价格的茶，凭什么敢把标准立得这么硬？";
  }
  return `${ctx.product.year} 年${slotValue(ctx, "place") ?? ""}的${typeLabel(ctx)}，先看三件事：料、结构，还有那一口。`;
}

/** §22 身份定义：必须是「它不是 X，它是 Y」这种句式。 */
function headingIdentityDefinition(ctx: SalesCopyContext): string {
  if (!ctx.profile.identity_definition) {
    return "";
  }
  const series = slotValue(ctx, "series");
  return `它不是一饼普通的${typeLabel(ctx)}，它是${series ? `${series}里的` : ""}有身份的那一款：${productName(ctx)}。`;
}

/**
 * §22 价格高度叙事。
 *
 * 三个条件同时成立才写「价格高度」：强度 ≥ 3、锚点引擎给出可靠锚点、锚点自带可靠价格证据；
 * 任一不成立都逐字改用 §22 标准句 —— 没有证据时宁可立标准，也不编价格（§25 / §58-9 / §62-2）。
 */
function headingPriceOrStandardStory(ctx: SalesCopyContext): string {
  const canTellPriceHeight =
    ctx.intensity >= 3 && ctx.anchor.has_reliable_price_anchor && ctx.price_high_story_ready;
  if (!canTellPriceHeight) {
    return NO_ANCHOR_STANDARD_SENTENCE;
  }
  const ground = textsOf(
    [slotValue(ctx, "material"), slotValue(ctx, "place"), slotValue(ctx, "body")].filter(
      (value): value is string => value !== null
    )
  );
  return `它站的是价格高度这一条线：同一类茶里能站上高价带的，靠的都是${
    ground || "用料与结构"
  }这一层底子，而它已经站在这条赛道上。`;
}

/** §47 价值故事：优先引用 Phase 11 的成交层解释，没有上游时用已录入事实自己说。 */
function headingValueStory(ctx: SalesCopyContext): string {
  if (ctx.intensity < 2) {
    return "";
  }
  const philosophy = ctx.philosophy;
  if (philosophy && philosophy.design_logic_ready && philosophy.sales_explanation.trim().length > 0) {
    return philosophy.sales_explanation.trim();
  }
  const ground = textsOf(
    [slotValue(ctx, "material"), slotValue(ctx, "aroma"), slotValue(ctx, "body")].filter(
      (value): value is string => value !== null
    )
  );
  return ground
    ? `它的价值不在标签上：${ground} 都是喝得到的证据。`
    : "它的价值不在标签上：能核对的部分写在结构里，喝得到的部分写在那一口里。";
}

/** §5 / §22 产品结构叙事：谁负责骨架、香气、汤感、记忆点。 */
function headingArchitectureStory(ctx: SalesCopyContext): string {
  if (!ctx.profile.product_architecture_story) {
    return "";
  }
  const parts: string[] = [];
  const architecture = ctx.architecture;
  if (architecture && architecture.written_roles > 0) {
    const roles = architecture.roles;
    const push = (label: string, value: string): void => {
      const text = (value ?? "").trim();
      if (text) {
        parts.push(`${text} 负责${label}`);
      }
    };
    push("骨架", roles.backbone);
    push("香气", roles.aroma_role);
    push("汤感", roles.body_role);
    push("记忆点", roles.memory_point);
  }
  if (parts.length === 0) {
    const place = slotValue(ctx, "place");
    const aroma = slotValue(ctx, "aroma");
    const body = slotValue(ctx, "body");
    const signature = slotValue(ctx, "signature");
    if (place) {
      parts.push(`骨架来自 ${place}`);
    }
    if (aroma) {
      parts.push(`香气定在 ${aroma}`);
    }
    if (body) {
      parts.push(`汤感靠 ${body}`);
    }
    if (signature) {
      parts.push(`记忆点留在 ${signature}`);
    }
  }
  const tail = "骨架、香气、汤感、记忆点各自有位置，缺一个都不算立住。";
  return parts.length === 0 ? `往上拆一层：${tail}` : `往上拆一层：${parts.join("，")}。${tail}`;
}

/** §6 / §47 配方哲学：优先逐字引用 Phase 11 成稿，没有上游时只讲设计逻辑、绝不猜比例。 */
function headingFormulaStory(ctx: SalesCopyContext): string {
  if (ctx.intensity < 3) {
    return "";
  }
  const philosophy = ctx.philosophy;
  if (philosophy && philosophy.strategy.trim().length > 0) {
    return philosophy.strategy.trim();
  }
  if (philosophy && philosophy.sales_explanation.trim().length > 0) {
    return philosophy.sales_explanation.trim();
  }
  return "配方这一层不硬猜：只讲站得住的那部分——让不同的部分各管一件事，每一口都归到同一个风格目标上。";
}

/** §8 差异化：必须落在已录入事实上，且用「不是……而是……」的对比结构。 */
function headingDifferentiation(ctx: SalesCopyContext): string {
  if (ctx.intensity < 2) {
    return "";
  }
  const ground = textsOf(
    [slotValue(ctx, "material"), slotValue(ctx, "place"), slotValue(ctx, "aroma"), slotValue(ctx, "body")].filter(
      (value): value is string => value !== null
    )
  );
  if (ctx.intensity >= 3) {
    return ground
      ? `它不是靠一句「好喝」撑起来的，而是靠 ${ground} 这种能对上号的事实撑起来的。`
      : "它不是靠低价抢位置的那一类，而是先把能核对的事实摆出来。";
  }
  return ground
    ? `它和普通 ${typeLabel(ctx)} 的差别在 ${ground}：这些都是可以逐条对上的记录。`
    : `它和普通 ${typeLabel(ctx)} 的差别在底子：先把能核对的部分讲清楚。`;
}

/** §8 / §48 画面感：第一口到后半程，每一句都落在已录入感官事实上。 */
function headingImagery(ctx: SalesCopyContext): string {
  if (!ctx.profile.visual_imagery) {
    return "";
  }
  const taste = slotValue(ctx, "taste");
  const aroma = slotValue(ctx, "aroma");
  const body = slotValue(ctx, "body");
  const finish = slotValue(ctx, "finish");
  const aftertaste = slotValue(ctx, "aftertaste");
  const parts: string[] = [taste ? `第一口是 ${taste}` : "第一口下去，先记住它在嘴里的那一层"];
  if (aroma) {
    parts.push(`香气跟着 ${aroma} 走`);
  }
  if (body) {
    parts.push(`中段汤感靠 ${body} 撑住`);
  }
  if (finish) {
    parts.push(`到尾水还有 ${finish}`);
  }
  if (aftertaste) {
    parts.push(`喝完 ${aftertaste} 还留在口腔里`);
  }
  return `${parts.join("，")}。`;
}

/** §22 记忆点：必须带身份，不能只是一句形容词；§7.1 王者档再补一句「懂的人才能看懂」。 */
function headingMemoryPoint(ctx: SalesCopyContext): string {
  if (ctx.intensity < 2) {
    return "";
  }
  const signature = slotValue(ctx, "signature");
  if (ctx.profile.king_takeover) {
    return signature
      ? `记住这一点：${productName(ctx)} 的辨识度在 ${signature}，这是它的身份，不是别人家的风格；懂的人才能看懂这一口。`
      : `记住这一点：${productName(ctx)} 的身份不在价格上，在能被认出来的那一口上；懂的人才能看懂这一口。`;
  }
  return signature
    ? `记住这一点：${productName(ctx)} 的辨识度在 ${signature}，这是它的身份，不是别人家的风格。`
    : `记住这一点：${productName(ctx)} 的身份不在价格上，在能被认出来的那一口上。`;
}

/** §4.2 风格身份证：一入口就能被认出来的那一点。 */
function headingStyleIdentity(ctx: SalesCopyContext): string {
  if (!ctx.profile.style_identity) {
    return "";
  }
  const identity = ctx.category?.style_identity ?? null;
  const trait =
    trimToNull(identity?.signature_trait ?? null) ??
    trimToNull(identity?.first_impression ?? null) ??
    slotValue(ctx, "signature");
  return trait
    ? `风格身份证：一入口就该被认出来——${trait}。`
    : "风格身份证：不靠包装，靠那一口；认得出它的人，一喝就知道是它。";
}

/** §27 02:35–02:50：适合谁、谁可以先不买。 */
function headingWhoFor(ctx: SalesCopyContext): string {
  const material = slotValue(ctx, "material");
  const audience =
    ctx.focus.has("collection") || ctx.focus.has("time")
      ? "准备把它留下来、慢慢喝的人"
      : "先看底子、再谈价格的人";
  return material
    ? `它适合认 ${material} 这一层用料的人，也适合${audience}；如果你只想要一个最便宜的选项，这一版可以先不买。`
    : `它适合${audience}；如果你只想要一个最便宜的选项，这一版可以先不买。`;
}

/** §22 成交收口：所有档位都必须有，不允许被省掉。 */
function headingClosing(ctx: SalesCopyContext): string {
  return `不用急着下判断：先把 ${productName(ctx)} 这一口记住，想清楚自己的标准，再决定要不要把它带走。`;
}

function buildHeadline(ctx: SalesCopyContext): SalesCopyHeadline {
  return salesCopyHeadlineSchema.parse({
    one_liner: headingOneLiner(ctx),
    opening_hook: headingOpeningHook(ctx),
    identity_definition: headingIdentityDefinition(ctx),
    price_or_standard_story: headingPriceOrStandardStory(ctx),
    value_story: headingValueStory(ctx),
    product_architecture_story: headingArchitectureStory(ctx),
    formula_philosophy_story: headingFormulaStory(ctx),
    style_identity: headingStyleIdentity(ctx),
    differentiation: headingDifferentiation(ctx),
    imagery: headingImagery(ctx),
    memory_point: headingMemoryPoint(ctx),
    who_for: headingWhoFor(ctx),
    closing: headingClosing(ctx)
  });
}

/** §26 五句核心金句：每一句都能单独当一条短视频文案（§58-10）。 */
function buildCoreQuotes(ctx: SalesCopyContext): string[] {
  const signature = slotValue(ctx, "signature");
  const place = slotValue(ctx, "place");
  const material = slotValue(ctx, "material");
  const aroma = slotValue(ctx, "aroma");
  const name = productName(ctx);
  /** §7.1 王者档专属金句：强「不是普通茶」/ 强「懂的人才能看懂」，纯修辞、不含任何事实。 */
  const kingCandidates = ctx.profile.king_takeover
    ? [
        "懂的人不用别人介绍，一眼就认得出它是什么级别。",
        "不是给所有人准备的茶，是给看得懂的人准备的。"
      ]
    : [];
  const candidates = [
    `${name} 不是用别人的价格给自己撑腰的茶，是把自己的标准立起来的茶。`,
    "贵不贵看标签，值不值看第一口。",
    signature ? `${signature}，就是它最容易被记住的地方。` : "真正留在记忆里的从来不是价格，是那一口。",
    place ? `${place} 给它骨架，它自己给标准。` : "先立标准，再谈价格，这句话对它一样成立。",
    material ? `${material} 是它能讲结构的前提。` : "它的底气来自能核对的事实。",
    aroma ? `${aroma} 是它的身份，不是它的形容词。` : "身份不是形容词，是那一口。",
    "认得出它的人，不用别人告诉他这饼茶是谁。",
    "越是没有对标，越要把标准讲清楚。"
  ];
  return usableQuotes([...kingCandidates, ...candidates, ...BACKUP_QUOTE_BANK], SALES_COPY_LIMITS.coreQuoteCount);
}

/** §26 二十句备用金句：事实句 + 纯修辞句，全部可独立传播。 */
function buildBackupQuotes(ctx: SalesCopyContext): string[] {
  const place = slotValue(ctx, "place");
  const material = slotValue(ctx, "material");
  const aroma = slotValue(ctx, "aroma");
  const taste = slotValue(ctx, "taste");
  const body = slotValue(ctx, "body");
  const finish = slotValue(ctx, "finish");
  const aftertaste = slotValue(ctx, "aftertaste");
  const craft = slotValue(ctx, "craft");
  const time = slotValue(ctx, "time");
  const signature = slotValue(ctx, "signature");
  const factual: string[] = [];
  if (aroma) {
    factual.push(`它的香气写在 ${aroma} 上。`);
  }
  if (taste) {
    factual.push(`第一口是 ${taste}，这是它自己的名片。`);
  }
  if (place) {
    factual.push(`${place} 给它的不是名气，是骨架。`);
  }
  if (material) {
    factual.push(`${material} 是它能讲结构的前提。`);
  }
  if (craft) {
    factual.push(`${craft} 这一步，决定了它后面能讲什么。`);
  }
  if (time) {
    factual.push(`${time} 这一层，是它现在站得住的理由。`);
  }
  if (signature) {
    factual.push(`${signature}，就是它的风格身份证。`);
  }
  if (body) {
    factual.push(`${body} 撑起了它的中段。`);
  }
  if (finish) {
    factual.push(`${finish} 是它收口的底气。`);
  }
  if (aftertaste) {
    factual.push(`${aftertaste} 还留在口腔里，它就还没讲完。`);
  }
  return usableQuotes([...factual, ...BACKUP_QUOTE_BANK], SALES_COPY_LIMITS.backupQuoteCount);
}

/** §47 七大卖点：七条都必须落在已录入事实上，缺一层就照实说缺。 */
function buildSellingPoints(ctx: SalesCopyContext): string[] {
  const place = slotValue(ctx, "place");
  const material = slotValue(ctx, "material");
  const aroma = slotValue(ctx, "aroma");
  const taste = slotValue(ctx, "taste");
  const body = slotValue(ctx, "body");
  const craft = slotValue(ctx, "craft");
  const signature = slotValue(ctx, "signature");
  const series = slotValue(ctx, "series");
  return [
    `身份清楚：${ctx.product.year} 年${place ? `${place}的` : ""}${typeLabel(ctx)}${
      series ? `，属于 ${series}` : ""
    }。`,
    material ? `用料这一层落在 ${material} 上，底气从这里开始。` : "用料这一层只讲已录入的内容，没录的不补。",
    aroma ? `香气走 ${aroma} 这条线，一入口就分得出来。` : "香气按已录入的记录讲，不替它加戏。",
    taste ? `第一口是 ${taste}，这是喝得到的答案。` : "口感按已录入的记录讲，喝到多少说多少。",
    body ? `中段汤感由 ${body} 撑住，不靠形容词。` : "汤感这一层同样只讲记录里有的那部分。",
    craft ? `${craft} 这一步，决定它后面能讲什么。` : "工艺细节按已录入记录讲，不延伸猜测。",
    signature ? `记忆点留在 ${signature} 上，这就是它的身份。` : "记忆点不是包装，是它那一口留下来的东西。"
  ];
}

/** §27 3 分钟八段：每一段的正文只从该段要求的来源取。 */
function buildMin3Segments(headline: SalesCopyHeadline): Min3SegmentView[] {
  return MIN3_TIMELINE.map((meta) => {
    let text = "";
    switch (meta.key) {
      case "hook":
        text = headline.opening_hook;
        break;
      case "identity":
        text = joinSentences([headline.one_liner, headline.identity_definition]);
        break;
      case "value_track":
        text = headline.price_or_standard_story;
        break;
      case "value_logic":
        text = joinSentences([headline.value_story, headline.differentiation]);
        break;
      case "structure_or_formula":
        text = joinSentences([headline.product_architecture_story, headline.formula_philosophy_story]);
        break;
      case "palate":
        text = headline.imagery;
        break;
      case "who_for":
        text = headline.who_for;
        break;
      case "closing":
        text = headline.closing;
        break;
    }
    return {
      key: meta.key,
      time_range: meta.time_range,
      label: meta.label,
      requirement: meta.requirement,
      text
    };
  });
}

function buildScripts(headline: SalesCopyHeadline, coreQuotes: readonly string[]): SalesCopyScripts {
  const identity = headline.identity_definition || headline.one_liner;
  const segments = buildMin3Segments(headline);
  return salesCopyScriptsSchema.parse({
    sec15: joinSentences([headline.opening_hook, identity, headline.memory_point || headline.style_identity]),
    sec30: joinSentences([
      headline.opening_hook,
      identity,
      headline.price_or_standard_story,
      headline.value_story,
      headline.closing
    ]),
    sec60: joinSentences([
      headline.opening_hook,
      identity,
      headline.price_or_standard_story,
      headline.value_story,
      headline.product_architecture_story,
      headline.formula_philosophy_story,
      headline.imagery,
      headline.memory_point,
      headline.closing
    ]),
    min3: {
      segments,
      text: joinSentences(segments.map((segment) => segment.text))
    }
  });
}

/** §26 Level 5 新品发布稿：爆款 / 王者档才交付，前两档不硬凑（也照实记账为未交付）。 */
function buildLevel5Release(
  ctx: SalesCopyContext,
  headline: SalesCopyHeadline,
  coreQuotes: readonly string[]
): string {
  if (ctx.intensity < 4) {
    return "";
  }
  const paragraphs = [
    "【新品发布】",
    headline.opening_hook,
    headline.identity_definition,
    headline.price_or_standard_story,
    headline.product_architecture_story,
    headline.formula_philosophy_story,
    headline.value_story,
    headline.style_identity,
    coreQuotes[0] ?? "",
    headline.memory_point,
    headline.differentiation,
    headline.imagery,
    headline.who_for,
    headline.closing
  ];
  return paragraphs
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .join("\n");
}

/** §26 / §52 经销商版：讲定位、讲结构、讲怎么卖，语气比主播稿更稳。 */
function buildDealerCopy(
  ctx: SalesCopyContext,
  headline: SalesCopyHeadline,
  coreQuotes: readonly string[]
): string {
  const structure = joinSentences([
    headline.product_architecture_story,
    headline.formula_philosophy_story
  ]);
  const lines = [
    "【经销商版】",
    `定位：${headline.one_liner}`,
    `标准：${headline.price_or_standard_story}`,
    structure ? `结构：${structure}` : "",
    `记住三句：${coreQuotes.slice(0, 3).join(" ")}`,
    `收口：${headline.closing}`
  ];
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** §26 / §47 异议处理：每一条都只用已录入事实或上游成稿来回答。 */
function buildObjections(ctx: SalesCopyContext, headline: SalesCopyHeadline): SalesCopyObjection[] {
  const ground = textsOf(
    [
      slotValue(ctx, "material"),
      slotValue(ctx, "place"),
      slotValue(ctx, "aroma"),
      slotValue(ctx, "taste"),
      slotValue(ctx, "body")
    ].filter((value): value is string => value !== null)
  );
  const candidates: SalesCopyObjection[] = [
    {
      objection: "凭什么卖这个价？",
      response:
        ctx.anchor.has_reliable_price_anchor && ctx.price_high_story_ready
          ? `价格不是我们自己喊的：${headline.price_or_standard_story}`
          : headline.price_or_standard_story,
      layer: "INTERPRETATION",
      spec_ref: "§22 / §26"
    },
    {
      objection: ctx.anchor.has_reliable_price_anchor ? "有对标就一定有高度吗？" : "没有对标，凭什么讲高度？",
      response: ctx.anchor.has_reliable_price_anchor
        ? "对标只用来定位价格高度这一层，我们的结构、香气、汤感全部来自本产品自己的记录。"
        : NO_ANCHOR_STANDARD_SENTENCE,
      layer: "INTERPRETATION",
      spec_ref: "§17 / §22 / §26"
    },
    {
      objection: "是不是在讲故事？",
      response: ground
        ? `讲的是能逐字核对的事实：${ground}；对不上的部分不会写进正文。`
        : "讲的是能逐字核对的事实：对不上的部分不会写进正文。",
      layer: "INTERPRETATION",
      spec_ref: "§24 / §26"
    },
    {
      objection: "这些说法凭什么让人信？",
      response: "每一条都来自已录入的产品事实或上游成稿，能逐字回查；查不到的就不该出现在这一版里。",
      layer: "INTERPRETATION",
      spec_ref: "§24 / §57"
    },
    {
      objection: "它真有那么特别吗？",
      response: headline.imagery || "第一口会替它说话：先把注意力放在舌面上。",
      layer: "RHETORIC",
      spec_ref: "§8 / §26"
    },
    {
      objection: "现在不买，会不会错过什么？",
      response: "这里不给你任何承诺，只给你判断标准：喝过一次，再决定要不要把它带走。",
      layer: "RHETORIC",
      spec_ref: "§26 / §62-9"
    }
  ];
  return candidates
    .filter((item) => item.objection.trim().length > 0 && item.response.trim().length > 0)
    .slice(0, SALES_COPY_LIMITS.maxObjections)
    .map((item) => salesCopyObjectionSchema.parse(item));
}

/* ---------------------------------------------- §24 / §46 事实逐字回查 */

/**
 * 一版成稿的全部可读正文（§26 九种输出 + §47 十五项输出）。
 *
 * 顺序固定：headline 十三格 → 五句核心金句 → 二十句备用金句 → 七大卖点 →
 * 15s / 30s / 60s → 3 分钟全文与八段正文 → Level 5 新品发布 → 经销商版 → 异议处理。
 * 生成侧与回看侧共用这一份实现，避免「生成时说引用了 6 条事实、回看时变成 4 条」。
 */
export function salesCopyTexts(body: SalesCopyBody): string[] {
  const headline = body.headline;
  const headlineTexts = [
    headline.one_liner,
    headline.opening_hook,
    headline.identity_definition,
    headline.price_or_standard_story,
    headline.value_story,
    headline.product_architecture_story,
    headline.formula_philosophy_story,
    headline.style_identity,
    headline.differentiation,
    headline.imagery,
    headline.memory_point,
    headline.who_for,
    headline.closing
  ];
  const segments = body.scripts.min3.segments.map((segment) => segment.text);
  const objections = body.objections.flatMap((item) => [item.objection, item.response]);
  return [
    ...headlineTexts,
    ...body.quotes.core_quotes,
    ...body.quotes.backup_quotes,
    ...body.selling_points,
    body.scripts.sec15,
    body.scripts.sec30,
    body.scripts.sec60,
    body.scripts.min3.text,
    ...segments,
    body.level5_release,
    body.dealer_copy,
    ...objections
  ]
    .map((text) => text.trim())
    .filter((text) => text.length > 0);
}

/**
 * 逐字回查：只有正文里真的出现了某个已录入事实的原文，才把这一条记进引用清单。
 *
 * 这是「一个字都没有编」这条铁律唯一的机械证据（§24 / §46 / §57）：
 * 白名单之外的字段（对标产品的年份、价格、山头……）根本取不到值，因此不可能被记进来（§62-5）。
 */
export function salesCopyCitations(pool: SalesCopyFactPool, texts: readonly string[]): string[] {
  const joined = texts.join("\n");
  const citations: string[] = [];
  const push = (ref: string, value: string): void => {
    const citation = `${ref}=${value}`;
    if (!citations.includes(citation)) {
      citations.push(citation);
    }
  };
  for (const ref of Object.keys(SALES_COPY_FACT_FIELDS)) {
    const value = salesCopyFactValue(pool.product, ref);
    if (value && joined.includes(value)) {
      push(ref, value);
    }
  }
  if (pool.dna) {
    for (const dimension of VALUE_DNA_DIMENSIONS) {
      for (const item of pool.dna[dimension] ?? []) {
        const value = item.trim();
        if (value && joined.includes(value)) {
          push(`dna.${dimension}`, value);
        }
      }
    }
  }
  return citations;
}

/** 把引用清单分流成产品事实引用与 Value DNA 引用（前端分别展示两栏）。 */
export function salesCopyRefsOf(citations: readonly string[]): {
  fact_refs: string[];
  value_dna_refs: string[];
} {
  const fact_refs: string[] = [];
  const value_dna_refs: string[] = [];
  for (const citation of citations) {
    const index = citation.indexOf("=");
    const ref = index >= 0 ? citation.slice(0, index) : citation;
    if (!ref) {
      continue;
    }
    if (ref.startsWith("dna.")) {
      if (!value_dna_refs.includes(ref)) {
        value_dna_refs.push(ref);
      }
    } else if (!fact_refs.includes(ref)) {
      fact_refs.push(ref);
    }
  }
  return { fact_refs, value_dna_refs };
}

/* ------------------------------------------------------ §23 成交冲击力评分 */

/** 说明书腔调：出现这些词就不算「开场 3 秒把人按住」（§62-11）。 */
const MANUAL_TONE_PATTERN = /(说明书|参数|规格如下|指标如下|本品|产品参数)/;

/** 正文里出现的价格数字；只有能在已录入事实里逐字找到的才算有据（§3 / §25 / §62-2）。 */
const SALES_COPY_PRICE_PATTERN = /\d+(?:\.\d+)?\s*(?:万元|万|元|块)/g;

/**
 * 事实不足时的硬性压分上限（§23 / §57）。
 * 事实越少越不该把话说满：只有回查到 4 条以上已录入事实，才允许拿满分。
 */
const SALES_COPY_FACT_SCORE_CAP = {
  three: 84,
  two: 74,
  one: 68,
  zero: 55
} as const;

function factScoreCap(factsUsed: number): number {
  if (factsUsed >= SALES_COPY_LIMITS.minRecordedFacts) {
    return IMPACT_SCORE_MAX;
  }
  if (factsUsed === 3) {
    return SALES_COPY_FACT_SCORE_CAP.three;
  }
  if (factsUsed === 2) {
    return SALES_COPY_FACT_SCORE_CAP.two;
  }
  if (factsUsed === 1) {
    return SALES_COPY_FACT_SCORE_CAP.one;
  }
  return SALES_COPY_FACT_SCORE_CAP.zero;
}

/** 某段正文是否逐字引用了已录入事实（少于 2 个字的值不算证据，避免「茶 / 年」这类巧合命中）。 */
function mentionsRecorded(recorded: readonly string[], text: string): boolean {
  return recorded.some((value) => value.trim().length >= 2 && text.includes(value.trim()));
}

/**
 * 找不到出处的价格数字：这一条同时是评分项与合规红线（§3 / §25）。
 * Phase 14 的事实审核按句复核同一口径，因此导出复用，不再另写一份价格扫描。
 */
export function salesCopyFakePriceHits(
  texts: readonly string[],
  recorded: readonly string[]
): string[] {
  const hits: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(SALES_COPY_PRICE_PATTERN)) {
      const raw = match[0].replace(/\s+/g, "");
      const known = recorded.some((value) => value.replace(/\s+/g, "").includes(raw));
      if (!known && !hits.includes(raw)) {
        hits.push(raw);
      }
    }
  }
  return hits;
}

interface ImpactCheckContext {
  headline: SalesCopyHeadline;
  anchor: SalesCopyAnchorRef;
  price_high_story_ready: boolean;
  recorded: readonly string[];
  texts: readonly string[];
  quotable: number;
}

/** §23 每一条判定都是机械条件：同样的成稿永远得到同样的分，不做主观加减。 */
function impactCriterionPassed(key: string, ctx: ImpactCheckContext): boolean {
  const headline = ctx.headline;
  const story = headline.price_or_standard_story.trim();
  switch (key) {
    case "hook_present":
      return headline.opening_hook.trim().length > 0;
    case "hook_rhetorical":
      return /[？?]/.test(headline.opening_hook) || /(先看|先立|先问|别急|记住)/.test(headline.opening_hook);
    case "hook_short_and_clean":
      return (
        headline.opening_hook.trim().length > 0 &&
        headline.opening_hook.trim().length <= 60 &&
        !MANUAL_TONE_PATTERN.test(headline.opening_hook)
      );
    case "one_liner_present":
      return headline.one_liner.trim().length > 0;
    case "identity_definition_present":
      return headline.identity_definition.trim().length > 0;
    case "identity_named":
      return (
        headline.identity_definition.includes("身份") ||
        mentionsRecorded(ctx.recorded, headline.identity_definition)
      );
    case "value_story_present":
      return headline.value_story.trim().length > 0;
    case "price_or_standard_present":
      return story.length > 0;
    case "structure_or_formula_present":
      return (
        headline.product_architecture_story.trim().length > 0 ||
        headline.formula_philosophy_story.trim().length > 0
      );
    case "anchor_honest":
      if (ctx.anchor.has_reliable_price_anchor && ctx.price_high_story_ready) {
        return /(价格高度|高价|赛道)/.test(story);
      }
      return story.includes(NO_ANCHOR_STANDARD_SENTENCE);
    case "no_fake_price":
      return salesCopyFakePriceHits(ctx.texts, ctx.recorded).length === 0;
    case "anchor_explicit":
      return /(高度|标准)/.test(story);
    case "differentiation_present":
      return headline.differentiation.trim().length > 0;
    case "differentiation_grounded":
      return mentionsRecorded(ctx.recorded, headline.differentiation);
    case "differentiation_contrast":
      return (
        (headline.differentiation.includes("不是") && headline.differentiation.includes("而是")) ||
        headline.differentiation.includes("差别在") ||
        headline.differentiation.includes("差别是")
      );
    case "imagery_present":
      return headline.imagery.trim().length > 0;
    case "imagery_grounded":
      return mentionsRecorded(ctx.recorded, headline.imagery);
    case "imagery_visual":
      return /(第一口|入口|下水|嘴里|舌面|口腔)/.test(headline.imagery);
    case "memory_point_present":
      return headline.memory_point.trim().length > 0;
    case "memory_point_identity":
      return (
        /(身份|辨识度|记住)/.test(headline.memory_point) ||
        mentionsRecorded(ctx.recorded, headline.memory_point)
      );
    case "quotable_lines_enough":
      return ctx.quotable >= LEVEL5_REQUIREMENTS.minQuotableLines;
    case "closing_present":
      return (
        headline.closing.trim().length > 0 && /(带走|决定|记住|想清楚|判断)/.test(headline.closing)
      );
    default:
      return false;
  }
}

export interface SalesCopyImpactInput {
  intensity: CopyIntensity;
  anchor: SalesCopyAnchorRef;
  price_high_story_ready: boolean;
  headline: SalesCopyHeadline;
  quotes: SalesCopyQuotes;
  /** `salesCopyTexts()` 的产物：用于「凭空价格」这一条全文扫描 */
  texts: readonly string[];
  /** 已录入事实的逐字值（用于判定「落在事实上」） */
  recorded: readonly string[];
  /** `salesCopyCitations()` 的产物：这一版真正回查到的事实条数 */
  citations: readonly string[];
}

/**
 * §23 成交冲击力评分（满分 100，八项权重与 `IMPACT_SCORE_WEIGHTS` 同源）。
 *
 * 只做机械求和；事实不足时按 `SALES_COPY_FACT_SCORE_CAP` 硬性压分，
 * 让「没录几条事实却喊到 100 分」在系统里不可能出现。
 */
export function scoreImpact(input: SalesCopyImpactInput): ImpactScore {
  const quotable = salesCopyQuotableLines([...input.quotes.core_quotes, ...input.quotes.backup_quotes]).length;
  const ctx: ImpactCheckContext = {
    headline: input.headline,
    anchor: input.anchor,
    price_high_story_ready: input.price_high_story_ready,
    recorded: input.recorded,
    texts: input.texts,
    quotable
  };
  const items = IMPACT_SCORE_META.map((meta) => {
    const criteria = meta.criteria.map((criterion) => ({
      key: criterion.key,
      check: criterion.check,
      points: criterion.points,
      passed: impactCriterionPassed(criterion.key, ctx)
    }));
    return impactScoreItemViewSchema.parse({
      key: meta.key,
      label: meta.label,
      weight: meta.weight,
      criterion: meta.criterion,
      points: criteria.reduce((sum, criterion) => sum + (criterion.passed ? criterion.points : 0), 0),
      criteria,
      spec_ref: meta.spec_ref
    });
  });
  const raw = items.reduce((sum, item) => sum + item.points, 0);
  const factsUsed = input.citations.length;
  const total = Math.min(raw, factScoreCap(factsUsed));
  const required = SALES_COPY_REQUIRED_SCORE[input.intensity] ?? null;
  const band = impactScoreBandOf(total);
  const note =
    total === raw
      ? `逐字回查到 ${factsUsed} 条已录入事实；机械原始分 ${raw} 分，未被事实不足压分（§23）。`
      : `逐字回查到 ${factsUsed} 条已录入事实，低于 §57 要求的 ${SALES_COPY_LIMITS.minRecordedFacts} 条：机械原始分 ${raw} 分被硬性压到 ${total} 分，事实没录全就不许把话说满（§23 / §57）。`;
  return impactScoreSchema.parse({
    spec_ref: "§23",
    total,
    max: IMPACT_SCORE_MAX,
    band,
    band_label: IMPACT_SCORE_BAND_META_BY_KEY[band].label,
    required,
    passed: required === null || total >= required,
    facts_used: factsUsed,
    note,
    items
  });
}

/* --------------------------------------------------- §22 Level 5 七项自检 */

export interface SalesCopyLevel5Input {
  intensity: CopyIntensity;
  anchor: SalesCopyAnchorRef;
  price_high_story_ready: boolean;
  headline: SalesCopyHeadline;
  quotes: SalesCopyQuotes;
}

/** 价格高度叙事的证据：有可靠价格锚点就讲高度，没有就必须是 §22 原文句（逐字）。 */
function priceHeightEvidence(input: SalesCopyLevel5Input): string | null {
  const story = input.headline.price_or_standard_story;
  if (input.anchor.has_reliable_price_anchor && input.price_high_story_ready) {
    return /(价格高度|高价|赛道)/.test(story) ? story : null;
  }
  return story.includes(NO_ANCHOR_STANDARD_SENTENCE) ? NO_ANCHOR_STANDARD_SENTENCE : null;
}

/**
 * §22 七项强制自检。
 *
 * `required` 只对 Level 5（王者）为 true；其余档位「不要求，但已经做到的照样记账」，
 * 这样前端在任何档位都能看出这一版离王者稿还差哪几项。
 */
export function checkLevel5Requirements(input: SalesCopyLevel5Input): SalesCopyLevel5Check {
  const headline = input.headline;
  const quotable = salesCopyQuotableLines([...input.quotes.core_quotes, ...input.quotes.backup_quotes]);
  const evidence: Record<Level5RequirementKey, string | null> = {
    rhetorical_question: /[？?]/.test(headline.opening_hook) ? headline.opening_hook : null,
    identity_definition: headline.identity_definition.includes("身份") ? headline.identity_definition : null,
    price_height_story: priceHeightEvidence(input),
    product_architecture_story:
      headline.product_architecture_story.trim().length > 0 ? headline.product_architecture_story : null,
    style_identity: headline.style_identity.trim().length > 0 ? headline.style_identity : null,
    quotable_lines: quotable[0] ?? null,
    closing: headline.closing.trim().length > 0 ? headline.closing : null
  };
  const requirements = LEVEL5_REQUIREMENT_META.map((meta) =>
    level5RequirementStatusSchema.parse({
      key: meta.key,
      label: meta.label,
      requirement: meta.requirement,
      check: meta.check,
      status: evidence[meta.key] === null ? "MISSING" : "DONE",
      evidence: evidence[meta.key],
      spec_ref: meta.spec_ref
    })
  );
  const missing = requirements.filter((item) => item.status === "MISSING").map((item) => item.key);
  return salesCopyLevel5CheckSchema.parse({
    spec_ref: "§22",
    required: input.intensity >= 5,
    satisfied: missing.length === 0,
    missing,
    requirements,
    no_anchor_standard_sentence: NO_ANCHOR_STANDARD_SENTENCE
  });
}

/* -------------------------------------------- §24 / §25 合规扫描与证据缺口 */

export interface SalesCopyComplianceInput {
  /** `salesCopyTexts()` 的产物 */
  texts: readonly string[];
  /** 已录入事实的逐字值 */
  recorded: readonly string[];
  /** 允许被引用的语料（已录入事实 + 上游成稿）：语料里有的表述不算「凭空编」 */
  corpus: string;
  rnd_confirmed: boolean;
  facts_used: number;
}

/**
 * §24 / §25 合规自检。
 *
 * 关键口径：**修辞不判 RED**。比喻、反问、排比、身份塑造本身不构成违规；
 * 只有「让消费者误以为存在一个并不存在的可核验事实」才推高风险等级：
 * 禁止承诺（必涨 / 稳赚 / 保值……）、受限研发措辞、凭空出现的硬事实与价格数字。
 */
export function salesCopyCompliance(input: SalesCopyComplianceInput): SalesCopyCompliance {
  const contains = (phrase: string): boolean => input.texts.some((text) => text.includes(phrase));
  const forbidden_promises = FORBIDDEN_PROMISES.filter(contains);
  const restricted_phrases = RND_RESTRICTED_PHRASES.filter(contains);
  const rnd_claimed = [...RND_RESTRICTED_PHRASES, ...RND_ALLOWED_PHRASES].some(contains);
  const fabricated = new Set<ForbiddenFabricationCategory>();
  for (const text of input.texts) {
    for (const category of findForbiddenFabrications(text, input.corpus)) {
      fabricated.add(category);
    }
  }
  const fakePrices = salesCopyFakePriceHits(input.texts, input.recorded);
  if (fakePrices.length > 0) {
    fabricated.add("transaction_price");
  }
  const fabricated_categories = [...fabricated];
  const unconfirmedRndClaim = rnd_claimed && !input.rnd_confirmed;
  const red =
    forbidden_promises.length > 0 ||
    restricted_phrases.length > 0 ||
    fabricated_categories.length > 0 ||
    unconfirmedRndClaim;
  const risk: RiskLevel = red
    ? "RED"
    : input.facts_used < SALES_COPY_LIMITS.minRecordedFacts
      ? "YELLOW"
      : "GREEN";
  const notes: string[] = [
    `已按 §49 扫描 ${FORBIDDEN_FABRICATION_CATEGORIES.length} 类禁止虚构硬事实，语料 = 本产品已录入事实 + 上游成稿。`
  ];
  if (forbidden_promises.length > 0) {
    notes.push(`命中禁止承诺：${forbidden_promises.join(" / ")}`);
  }
  if (restricted_phrases.length > 0) {
    notes.push(`命中 §25 受限研发措辞：${restricted_phrases.join(" / ")}`);
  }
  if (fabricated_categories.length > 0) {
    notes.push(
      `命中禁止虚构硬事实：${fabricated_categories
        .map((category) => FORBIDDEN_AUTO_FILL_LABELS[category] ?? category)
        .join(" / ")}`
    );
  }
  if (unconfirmedRndClaim) {
    notes.push("没有 RND_CONFIRMED 证据却出现研发关系暗示：一个字都不许暗示（§25 / §62-8）");
  }
  if (!red && input.facts_used < SALES_COPY_LIMITS.minRecordedFacts) {
    notes.push(`已录入事实只有 ${input.facts_used} 条：不构成红线，但发布前需要人工确认（§49 / §57）`);
  }
  if (risk === "GREEN") {
    notes.push("修辞（比喻 / 反问 / 排比 / 身份塑造）不判红线，全部落在已录入事实与上游成稿上。");
  }
  return salesCopyComplianceSchema.parse({
    spec_ref: "§24 / §25 / §62",
    rnd_confirmed: input.rnd_confirmed,
    rnd_claimed,
    forbidden_promises,
    restricted_phrases,
    fabricated_categories,
    risk,
    note: notes.join("；")
  });
}

export interface SalesCopyEvidenceGapInput {
  facts_used: number;
  anchor: SalesCopyAnchorRef;
  price_high_story_ready: boolean;
  upstream: SalesCopyUpstreamStatus;
  value_dna_ready: boolean;
  level5: SalesCopyLevel5Check;
  outputs: readonly SalesCopyOutputStatus[];
}

/**
 * 证据缺口清单：顺序固定，供前端逐条排产（§46 / §57 / §62-13）。
 * 只报告「缺什么」，绝不因为缺就顺手补一个（补事实是上游的事）。
 */
export function salesCopyEvidenceGaps(input: SalesCopyEvidenceGapInput): string[] {
  const gaps: string[] = [];
  if (input.facts_used < SALES_COPY_LIMITS.minRecordedFacts) {
    gaps.push(
      `已录入事实只有 ${input.facts_used} 条：低于 §57 要求的 ${SALES_COPY_LIMITS.minRecordedFacts} 条，先把事实录全再谈成交。`
    );
  }
  if (!input.anchor.has_reliable_price_anchor) {
    gaps.push(
      "没有可靠价格锚点：价格高度叙事已按 §22 改用标准句；要讲价格高度，先补够 §16.1 的相似度与价格证据。"
    );
  } else if (!input.price_high_story_ready) {
    gaps.push("锚点缺少可靠价格证据（reliable_price_count = 0）：价格高度讲不出来，已改用 §22 标准句。");
  }
  if (!input.upstream.architecture_acceptance_passed) {
    gaps.push("Phase 10 产品结构还没有通过验收：结构与记忆点只能按已录入事实讲。");
  }
  if (!input.upstream.philosophy_acceptance_passed) {
    gaps.push("Phase 11 配方哲学还没有通过验收：配方这一层只讲设计逻辑，不猜比例。");
  }
  if (!input.upstream.category_creator_ready) {
    gaps.push("Phase 8 自建标准还没有就绪：风格身份证只能按已录入香气事实写。");
  }
  if (!input.upstream.value_codes_ready) {
    gaps.push("Phase 9 价值映射还没有生成：价值故事只能引用已录入事实。");
  }
  if (!input.value_dna_ready) {
    gaps.push("缺少 §9 Value DNA：事实回查只能覆盖产品录入字段。");
  }
  if (input.level5.required && input.level5.missing.length > 0) {
    const labels = input.level5.requirements
      .filter((item) => item.status === "MISSING")
      .map((item) => item.label);
    gaps.push(`§22 Level 5 七项还有 ${labels.length} 项没落地：${labels.join(" / ")}`);
  }
  const missingOutputs = input.outputs.filter((item) => item.status === "MISSING").map((item) => item.label);
  if (missingOutputs.length > 0) {
    gaps.push(`§26 还缺 ${missingOutputs.length} 种输出：${missingOutputs.join(" / ")}`);
  }
  return gaps;
}

/* ------------------------------------ §26 输出状态 / §57 验收 / Phase 12 总装 */

/** §26 九种输出的逐项交付状态：生成侧与回看侧共用同一份实现（Phase 11 的教训）。 */
export function salesCopyOutputStatuses(body: SalesCopyBody): SalesCopyOutputStatus[] {
  const segments = body.scripts.min3.segments;
  const filledSegments = segments.filter((segment) => segment.text.trim().length > 0).length;
  const releaseLines = body.level5_release.split("\n").filter((line) => line.trim().length > 0).length;
  const dealerLines = body.dealer_copy.split("\n").filter((line) => line.trim().length > 0).length;
  const plans: Record<SalesCopyOutputKey, { text: readonly string[]; count: number; done: boolean }> = {
    core_quotes: {
      text: body.quotes.core_quotes,
      count: body.quotes.core_quotes.length,
      done: body.quotes.core_quotes.length >= SALES_COPY_LIMITS.coreQuoteCount
    },
    backup_quotes: {
      text: body.quotes.backup_quotes,
      count: body.quotes.backup_quotes.length,
      done: body.quotes.backup_quotes.length >= SALES_COPY_LIMITS.backupQuoteCount
    },
    sec15: { text: [body.scripts.sec15], count: 0, done: body.scripts.sec15.trim().length > 0 },
    sec30: { text: [body.scripts.sec30], count: 0, done: body.scripts.sec30.trim().length > 0 },
    sec60: { text: [body.scripts.sec60], count: 0, done: body.scripts.sec60.trim().length > 0 },
    min3: {
      text: [body.scripts.min3.text, ...segments.map((segment) => segment.text)],
      count: filledSegments,
      done:
        segments.length === min3SegmentKeys.length &&
        filledSegments === min3SegmentKeys.length &&
        body.scripts.min3.text.trim().length > 0
    },
    level5_release: {
      text: [body.level5_release],
      count: releaseLines,
      done: body.level5_release.trim().length > 0
    },
    dealer_copy: {
      text: [body.dealer_copy],
      count: dealerLines,
      done: body.dealer_copy.trim().length > 0
    },
    objections: {
      text: body.objections.flatMap((item) => [item.objection, item.response]),
      count: body.objections.length,
      done: body.objections.length > 0
    }
  };
  return SALES_COPY_OUTPUT_META.map((meta) => {
    const plan = plans[meta.key];
    return salesCopyOutputStatusSchema.parse({
      key: meta.key,
      label: meta.label,
      requirement: meta.requirement,
      status: plan.done ? "DONE" : "MISSING",
      count: plan.count,
      chars: plan.text.join("\n").trim().length,
      spec_ref: meta.spec_ref
    });
  });
}

export interface SalesCopyAcceptanceInput {
  intensity: CopyIntensity;
  impact: ImpactScore;
  quotes: SalesCopyQuotes;
  level5: SalesCopyLevel5Check;
  compliance: SalesCopyCompliance;
  outputs: readonly SalesCopyOutputStatus[];
}

/** §57 验收：分数、金句数量、§26 九种输出、§22 七项、§24 合规五项全过才算通过。 */
export function salesCopyAcceptance(input: SalesCopyAcceptanceInput): SalesCopyAcceptance {
  const core = input.quotes.core_quotes.length;
  const backup = input.quotes.backup_quotes.length;
  const quotesTotal = core + backup;
  const minQuotes = SALES_COPY_LIMITS.coreQuoteCount + SALES_COPY_LIMITS.backupQuoteCount;
  const quotesOk = quotesTotal >= minQuotes;
  const missingOutputs = input.outputs.filter((item) => item.status === "MISSING");
  const outputsComplete = missingOutputs.length === 0;
  const level5Ok = !input.level5.required || input.level5.satisfied;
  const complianceOk = input.compliance.risk !== "RED";
  const missing: string[] = [];
  if (!input.impact.passed) {
    missing.push(
      `成交冲击力 ${input.impact.total} 分，低于 ${input.intensity} 档要求的 ${input.impact.required ?? 0} 分（§23）`
    );
  }
  if (!quotesOk) {
    missing.push(`金句共 ${quotesTotal} 句，低于 §26 要求的 ${minQuotes} 句`);
  }
  if (!outputsComplete) {
    missing.push(
      `§26 还缺 ${missingOutputs.length} 种输出：${missingOutputs.map((item) => item.label).join(" / ")}`
    );
  }
  if (!level5Ok) {
    const labels = input.level5.requirements
      .filter((item) => item.status === "MISSING")
      .map((item) => item.label);
    missing.push(`§22 Level 5 七项还有 ${labels.length} 项没落地：${labels.join(" / ")}`);
  }
  if (!complianceOk) {
    missing.push(`§24 合规风险为 ${input.compliance.risk}：${input.compliance.note}`);
  }
  return salesCopyAcceptanceSchema.parse({
    spec_ref: "§57",
    question: SALES_COPY_ACCEPTANCE_QUESTION,
    intensity: input.intensity,
    required_score: input.impact.required,
    impact_score: input.impact.total,
    score_passed: input.impact.passed,
    quotes_total: quotesTotal,
    min_quotes: minQuotes,
    core_quotes: core,
    backup_quotes: backup,
    outputs_complete: outputsComplete,
    missing_outputs: missingOutputs.map((item) => item.key),
    level5_passed: input.level5.satisfied,
    compliance_passed: complianceOk,
    passed: input.impact.passed && quotesOk && outputsComplete && level5Ok && complianceOk,
    missing
  });
}

/** 引用了哪些上游成稿：版本号即证据，没有上游就不硬写（§60）。 */
function upstreamRefsOf(input: SalesCopyBuildInput): string[] {
  const refs: string[] = [];
  if (input.architecture) {
    refs.push(`architecture:${input.architecture.version}`);
  }
  if (input.philosophy) {
    refs.push(`formula_philosophy:${input.philosophy.version}`);
  }
  const identity = input.category?.style_identity;
  if (identity && (identity.identity_name.trim().length > 0 || identity.category_positioning.trim().length > 0)) {
    refs.push("category_creator:1");
  }
  if (input.value_codes && Object.keys(input.value_codes).length > 0) {
    refs.push(`value_codes:${Object.keys(input.value_codes).length}`);
  }
  return refs;
}

/**
 * 合规扫描的语料：本产品已录入事实 + 上游成稿（对标产品的事实绝不进语料，§44 / §62-5）。
 *
 * Phase 14 的逐句事实审核用同一份语料判定「这句话是不是凭空冒出来的硬事实」，
 * 因此导出复用：语料口径只能有一份，否则同一句话会出现两个结论。
 */
export function salesCopyComplianceCorpus(
  input: SalesCopyComplianceCorpusInput,
  recorded: readonly string[]
): string {
  const parts: string[] = [...recorded];
  if (input.architecture?.narrative) {
    parts.push(input.architecture.narrative);
  }
  if (input.philosophy?.strategy) {
    parts.push(input.philosophy.strategy);
  }
  if (input.philosophy?.sales_explanation) {
    parts.push(input.philosophy.sales_explanation);
  }
  const identity = input.category?.style_identity;
  if (identity) {
    parts.push(identity.identity_name, identity.category_positioning);
    if (identity.signature_trait) {
      parts.push(identity.signature_trait);
    }
    if (identity.first_impression) {
      parts.push(identity.first_impression);
    }
  }
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * 强成交话术总装（Phase 12 是纯规则引擎：不调用 AI、不新增任何事实）。
 *
 * 顺序即依赖：先按 §21 档位画像写出十三格骨架，再产出 §26 九种输出，
 * 最后用同一份正文完成「事实回查 → §23 评分 → §22 七项 → §24 合规 → §57 验收」。
 */
export function buildSalesCopy(input: SalesCopyBuildInput): SalesCopyDraft {
  const anchor = salesCopyAnchorRefOf(input.anchor);
  const priceHighStoryReady = salesCopyPriceStoryReady(input.anchor, anchor);
  const pool: SalesCopyFactPool = { product: input.product, dna: usableValueDna(input.value_dna) };
  const focus: ReadonlySet<ValueFocusKey> = new Set<ValueFocusKey>(
    input.value_focus.length > 0 ? input.value_focus : DEFAULT_VALUE_FOCUS
  );
  const ctx: SalesCopyContext = {
    product: pool.product,
    dna: pool.dna,
    intensity: input.intensity,
    focus,
    anchor,
    price_high_story_ready: priceHighStoryReady,
    architecture: input.architecture ?? null,
    philosophy: input.philosophy ?? null,
    category: input.category ?? null,
    rnd_confirmed: input.rnd_confirmed,
    profile: SALES_COPY_INTENSITY_PROFILE_BY_LEVEL[input.intensity]
  };
  const headline = buildHeadline(ctx);
  const coreQuotes = buildCoreQuotes(ctx);
  const quotes = salesCopyQuotesSchema.parse({
    core_quotes: coreQuotes,
    backup_quotes: buildBackupQuotes(ctx)
  });
  const body: SalesCopyBody = {
    headline,
    quotes,
    selling_points: buildSellingPoints(ctx),
    scripts: buildScripts(headline, coreQuotes),
    level5_release: buildLevel5Release(ctx, headline, coreQuotes),
    dealer_copy: buildDealerCopy(ctx, headline, coreQuotes),
    objections: buildObjections(ctx, headline)
  };
  return {
    ...body,
    ...salesCopyReviewOf(input, body, {
      anchor,
      price_high_story_ready: priceHighStoryReady
    }),
    intensify_rounds: 0
  };
}

/** 一版成稿的全部派生结论（正文之外的一切判定）。 */
export interface SalesCopyDerived {
  anchor: SalesCopyAnchorRef;
  upstream: SalesCopyUpstreamStatus;
  output_statuses: SalesCopyOutputStatus[];
  impact_score: ImpactScore;
  level5: SalesCopyLevel5Check;
  compliance: SalesCopyCompliance;
  acceptance: SalesCopyAcceptance;
  price_high_story_ready: boolean;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  upstream_refs: string[];
}

/**
 * 回看一版成稿：**生成侧与回看侧唯一共用的一份判定实现**。
 *
 * `input` 是当版落库时冻结的上下文（产品事实 / Value DNA / 上游成稿引用 / 研发证据），
 * `body` 是当版正文，`context` 是当版落库时冻结的锚点结论。
 * 三者一起才能复现「这一版当时被判定成什么样」——因此读取历史版本时，
 * 判定结果不会随今日的产品事实或锚点变化而漂（§23 / §57 / §62-15）。
 */
export function salesCopyReviewOf(
  input: SalesCopyBuildInput,
  body: SalesCopyBody,
  context: { anchor: SalesCopyAnchorRef; price_high_story_ready: boolean }
): SalesCopyDerived {
  const pool: SalesCopyFactPool = { product: input.product, dna: usableValueDna(input.value_dna) };
  const { anchor } = context;
  const priceHighStoryReady = context.price_high_story_ready;
  const texts = salesCopyTexts(body);
  const recorded = salesCopyRecordedValues(pool);
  const citations = salesCopyCitations(pool, texts);
  const refs = salesCopyRefsOf(citations);
  const upstream = salesCopyUpstreamStatusOf(input);
  const impact = scoreImpact({
    intensity: input.intensity,
    anchor,
    price_high_story_ready: priceHighStoryReady,
    headline: body.headline,
    quotes: body.quotes,
    texts,
    recorded,
    citations
  });
  const level5 = checkLevel5Requirements({
    intensity: input.intensity,
    anchor,
    price_high_story_ready: priceHighStoryReady,
    headline: body.headline,
    quotes: body.quotes
  });
  const compliance = salesCopyCompliance({
    texts,
    recorded,
    corpus: salesCopyComplianceCorpus(input, recorded),
    rnd_confirmed: input.rnd_confirmed,
    facts_used: impact.facts_used
  });
  const outputs = salesCopyOutputStatuses(body);
  const acceptance = salesCopyAcceptance({
    intensity: input.intensity,
    impact,
    quotes: body.quotes,
    level5,
    compliance,
    outputs
  });
  return {
    anchor,
    upstream,
    output_statuses: outputs,
    impact_score: impact,
    level5,
    compliance,
    acceptance,
    price_high_story_ready: priceHighStoryReady,
    evidence_gaps: salesCopyEvidenceGaps({
      facts_used: impact.facts_used,
      anchor,
      price_high_story_ready: priceHighStoryReady,
      upstream,
      value_dna_ready: pool.dna !== null,
      level5,
      outputs
    }),
    fact_refs: refs.fact_refs,
    value_dna_refs: refs.value_dna_refs,
    upstream_refs: upstreamRefsOf(input)
  };
}

/* --------------------------------------------- §7 / §34 / §48 牛逼化强化器 */

/** 从完整成稿里取出「正文本身」这七个字段，生成侧 / 回看侧 / 强化侧共用一份实现。 */
export function salesCopyBodyOf(draft: SalesCopyDraft): SalesCopyBody {
  return {
    headline: draft.headline,
    quotes: draft.quotes,
    selling_points: draft.selling_points,
    scripts: draft.scripts,
    level5_release: draft.level5_release,
    dealer_copy: draft.dealer_copy,
    objections: draft.objections
  };
}

/**
 * 逐格对比两版正文，返回**真正被改写的位置**（稳定 key，例如 `headline.opening_hook` /
 * `quotes.core_quotes[2]`）。
 *
 * 强化器只换说法、不换事实，因此人工抽查时需要的不是「换了几句话」这个数字，
 * 而是「哪一格被动过」——这份清单就是 §34 强化轮次的人工抽查入口。
 */
export function changedElementsOf(source: SalesCopyBody, next: SalesCopyBody): string[] {
  const changed: string[] = [];
  const push = (key: string, before: string, after: string): void => {
    if (before.trim() !== after.trim()) {
      changed.push(key);
    }
  };
  const pushList = (key: string, before: readonly string[], after: readonly string[]): void => {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      push(`${key}[${index}]`, before[index] ?? "", after[index] ?? "");
    }
  };

  for (const key of Object.keys(source.headline) as (keyof SalesCopyHeadline)[]) {
    push(`headline.${key}`, source.headline[key], next.headline[key]);
  }
  pushList("quotes.core_quotes", source.quotes.core_quotes, next.quotes.core_quotes);
  pushList("quotes.backup_quotes", source.quotes.backup_quotes, next.quotes.backup_quotes);
  pushList("selling_points", source.selling_points, next.selling_points);
  push("scripts.sec15", source.scripts.sec15, next.scripts.sec15);
  push("scripts.sec30", source.scripts.sec30, next.scripts.sec30);
  push("scripts.sec60", source.scripts.sec60, next.scripts.sec60);
  push("scripts.min3.text", source.scripts.min3.text, next.scripts.min3.text);
  pushList(
    "scripts.min3.segments",
    source.scripts.min3.segments.map((segment) => segment.text),
    next.scripts.min3.segments.map((segment) => segment.text)
  );
  push("level5_release", source.level5_release, next.level5_release);
  push("dealer_copy", source.dealer_copy, next.dealer_copy);
  pushList(
    "objections.objection",
    source.objections.map((item) => item.objection),
    next.objections.map((item) => item.objection)
  );
  pushList(
    "objections.response",
    source.objections.map((item) => item.response),
    next.objections.map((item) => item.response)
  );
  return changed;
}

export interface SalesCopyIntensifyFactDiff {
  /** 新版本多出来的事实引用：**必须为空**，非空说明强化器动了新事实（§34） */
  added: string[];
  /** 源版本有、新版本没有的事实引用：不是违规，但说明这一格被写弱了，值得人工看一眼 */
  lost: string[];
}

/** 强化前后的事实引用清单对比：只做集合差，不做任何「补全」。 */
export function intensifyFactDiff(
  sourceCitations: readonly string[],
  nextCitations: readonly string[]
): SalesCopyIntensifyFactDiff {
  return {
    added: nextCitations.filter((citation) => !sourceCitations.includes(citation)),
    lost: sourceCitations.filter((citation) => !nextCitations.includes(citation))
  };
}

/** 说明书腔调出现的位置（负向自检项的证据）。 */
function manualToneHits(body: SalesCopyBody): string[] {
  const hits: string[] = [];
  for (const text of Object.values(body.headline)) {
    const match = text.match(MANUAL_TONE_PATTERN);
    if (match && !hits.includes(match[0])) {
      hits.push(match[0]);
    }
  }
  return hits;
}

/** 每一项自检的机械证据：不是解释，而是「凭什么判过 / 判不过」的原文。 */
function intensifySelfCheckEvidence(
  key: IntensifySelfCheckKey,
  ctx: { body: SalesCopyBody; quotable: number; manualTone: readonly string[] }
): string | null {
  const headline = ctx.body.headline;
  switch (key) {
    case "opening_hook":
      return trimToNull(headline.opening_hook);
    case "identity":
      return trimToNull(headline.identity_definition);
    case "value_height":
      return trimToNull(headline.value_story);
    case "product_structure":
      return trimToNull(headline.product_architecture_story) ?? trimToNull(headline.formula_philosophy_story);
    case "quotes":
      return `${ctx.quotable} 句可独立传播金句（核心 ${ctx.body.quotes.core_quotes.length} 句 / 备用 ${ctx.body.quotes.backup_quotes.length} 句）`;
    case "memory_point":
      return trimToNull(headline.memory_point);
    case "closing_push":
      return trimToNull(headline.closing);
    case "no_manual_tone":
      return ctx.manualTone.length > 0 ? `十三格骨架里出现：${ctx.manualTone.join(" / ")}` : null;
    default:
      return null;
  }
}

export interface SalesCopyIntensifyCheckInput {
  level: IntensifyLevel;
  intensity: CopyIntensity;
  /** 新版本的 §23 评分结论（八项明细里已经带着每一条 criterion 的通过与否） */
  impact: ImpactScore;
  /** 新版本正文 */
  body: SalesCopyBody;
}

/**
 * §48 Agent 10 八项自检。
 *
 * 八项全部直接复用 §23 的机械判定（`impact.items[].criteria[].passed`），
 * 不另写一套主观标准：同一份成稿在评分与自检里永远得到同一个结论。
 * `passed` 必须同时满足「八项全过」与「分数达档」（Level 4 ≥ 85、Level 5 ≥ 90）。
 */
export function intensifySelfCheckOf(input: SalesCopyIntensifyCheckInput): SalesCopyIntensifySelfCheck {
  const criteria = new Map<string, boolean>();
  for (const item of input.impact.items) {
    for (const criterion of item.criteria) {
      criteria.set(criterion.key, criterion.passed);
    }
  }
  const quotable = salesCopyQuotableLines([
    ...input.body.quotes.core_quotes,
    ...input.body.quotes.backup_quotes
  ]).length;
  const manualTone = manualToneHits(input.body);
  const ctx = { body: input.body, quotable, manualTone };

  const items = INTENSIFY_SELF_CHECK_META.map((meta) =>
    intensifySelfCheckItemSchema.parse({
      key: meta.key,
      label: meta.label,
      check: meta.check,
      passed: meta.negative
        ? manualTone.length === 0
        : meta.criteria.every((key) => criteria.get(key) === true),
      evidence: intensifySelfCheckEvidence(meta.key, ctx),
      spec_ref: meta.spec_ref
    })
  );
  const missing = items.filter((item) => !item.passed).map((item) => item.key);
  const required = input.impact.required;
  const scorePassed = required === null || input.impact.total >= required;
  const passed = missing.length === 0 && scorePassed;
  const note = passed
    ? `八项自检全部通过，成交冲击力 ${input.impact.total} 分${
        required === null ? "（本档无硬性分数线）" : `，达到 Level ${input.intensity} 的 ${required} 分门槛`
      }（§48）。`
    : `八项自检未达标：${
        missing.length === 0
          ? "八项全过但分数不够"
          : `未通过 ${missing.map((key) => INTENSIFY_SELF_CHECK_META_BY_KEY[key].label).join(" / ")}`
      }${
        scorePassed ? "" : `；成交冲击力 ${input.impact.total} 分低于 Level ${input.intensity} 要求的 ${required} 分`
      }。最多自动强化 ${SALES_COPY_MAX_INTENSIFY_ROUNDS} 轮，之后必须人工处理（§48）。`;

  return intensifySelfCheckSchema.parse({
    spec_ref: "§48",
    level: input.level,
    intensity: input.intensity,
    score: input.impact.total,
    required_score: required,
    score_passed: scorePassed,
    items,
    missing,
    passed,
    max_auto_rounds: SALES_COPY_MAX_INTENSIFY_ROUNDS,
    note
  });
}

/** 档位映射：只升不降（取「源版本强度」与「按钮映射档位」的较大者）。 */
export function intensifyTargetIntensity(
  level: IntensifyLevel,
  sourceIntensity: CopyIntensity
): CopyIntensity {
  const mapped = INTENSIFY_LEVEL_TO_COPY_INTENSITY[level];
  return (mapped > sourceIntensity ? mapped : sourceIntensity) as CopyIntensity;
}

export interface SalesCopyIntensifyGuardInput {
  level: IntensifyLevel;
  /** 要强化的那一版的成交强度 */
  source_intensity: CopyIntensity;
  /** 要强化的那一版已经自动强化过几轮 */
  source_intensify_rounds: number;
  /** 该产品当前已有的版本数（含源版本） */
  total_versions: number;
}

/**
 * 「再狠一点」的前置闸门：返回不可强化的原因，可强化时返回 null。
 *
 * 三条硬边界写在纯函数里而不是路由里：轮次上限（§48 最多 3 轮）、版本上限（§62-15）、
 * 以及**只升不降**（§7 只有四档递进，没有「写弱一点」这个动作）。
 */
export function intensifyGuardReason(input: SalesCopyIntensifyGuardInput): string | null {
  if (input.source_intensify_rounds >= SALES_COPY_MAX_INTENSIFY_ROUNDS) {
    return `这一版已经自动强化过 ${SALES_COPY_MAX_INTENSIFY_ROUNDS} 轮，必须人工处理（§48）`;
  }
  if (input.total_versions >= SALES_COPY_LIMITS.maxVersionsPerProduct) {
    return `单个产品最多保留 ${SALES_COPY_LIMITS.maxVersionsPerProduct} 版强成交话术，请先归档历史版本`;
  }
  const target = INTENSIFY_LEVEL_TO_COPY_INTENSITY[input.level];
  const sourceLabel = SALES_COPY_INTENSITY_SHORT_LABELS[input.source_intensity];
  if (target < input.source_intensity) {
    return `这一版已经是 Level ${input.source_intensity}（${sourceLabel}），「${INTENSIFY_BUTTON_LABELS[input.level]}」档不能把强度调低（§7 / §34）`;
  }
  if (target === input.source_intensity) {
    return `这一版已经是「${INTENSIFY_BUTTON_LABELS[input.level]}」强度，请点更高的一档（§7）`;
  }
  return null;
}

export interface SalesCopyIntensifyParams {
  /**
   * 强化后的构建输入：**与生成一版新稿完全同源**，只有 `intensity` 被抬到目标档位，
   * 产品事实 / Value DNA / 上游成稿 / 锚点全部沿用同一份上下文（§62-5）。
   */
  input: SalesCopyBuildInput;
  /** 要强化的源版本正文 */
  source_body: SalesCopyBody;
  /** UI 上点的那一档 */
  level: IntensifyLevel;
  /** 源版本的成交强度（用于校验「只升不降」并列进结论） */
  source_intensity: CopyIntensity;
  /** 源版本已强化轮次（新版本 = 源 + 1，上限 3） */
  source_intensify_rounds: number;
}

export interface SalesCopyIntensifyOutcome {
  level: IntensifyLevel;
  intensity: CopyIntensity;
  source_intensity: CopyIntensity;
  round: number;
  changed_elements: string[];
  /** §34：必须为空 */
  added_facts: string[];
  /** 被写弱的引用（不是违规，但会写进备注供人工抽查） */
  lost_facts: string[];
  self_check: SalesCopyIntensifySelfCheck;
  /** 强化产出的新版本草稿（含 §23 评分 / §22 七项 / §24 合规 / §57 验收） */
  draft: SalesCopyDraft;
}

/**
 * §7 / §34「再狠一点」：**用同一份事实、更高一档的机械画像重跑一次总装**。
 *
 * 强化器不接受任何事实输入：它拿到的是「源版本正文 + 源版本用的那份上下文」，
 * 换掉的只有 §21 的强度档位。因此新版本的事实引用只可能是源版本的子集——
 * 这一点不是靠提示词保证，而是这里逐条比对 `salesCopyCitations()` 得出的机械结论。
 */
export function intensifySalesCopy(params: SalesCopyIntensifyParams): SalesCopyIntensifyOutcome {
  const draft = buildSalesCopy(params.input);
  const body = salesCopyBodyOf(draft);
  const pool: SalesCopyFactPool = {
    product: params.input.product,
    dna: usableValueDna(params.input.value_dna)
  };
  const diff = intensifyFactDiff(
    salesCopyCitations(pool, salesCopyTexts(params.source_body)),
    salesCopyCitations(pool, salesCopyTexts(body))
  );
  const round = params.source_intensify_rounds + 1;
  return {
    level: params.level,
    intensity: params.input.intensity,
    source_intensity: params.source_intensity,
    round,
    changed_elements: changedElementsOf(params.source_body, body),
    added_facts: diff.added,
    lost_facts: diff.lost,
    self_check: intensifySelfCheckOf({
      level: params.level,
      intensity: params.input.intensity,
      impact: draft.impact_score,
      body
    }),
    draft: { ...draft, intensify_rounds: round }
  };
}
