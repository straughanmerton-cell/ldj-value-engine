import { z } from "zod";
import type { CategoryDownstreamItem } from "./category-creator.js";
import { claimTypeSchema, claimTypes, riskLevelSchema, type ClaimType, type RiskLevel } from "./enums.js";
import { FORBIDDEN_PROMISES, RND_ALLOWED_PHRASES, RND_RESTRICTED_PHRASES } from "./forbidden-claims.js";
import { FORBIDDEN_AUTO_FILL_LABELS, findForbiddenFabrications } from "./fact-normalizer.js";
import {
  salesCopyCitations,
  salesCopyCompliance,
  salesCopyComplianceCorpus,
  salesCopyComplianceSchema,
  salesCopyFakePriceHits,
  salesCopyRecordedValues,
  salesCopyTexts,
  usableValueDna,
  type SalesCopyAnchorRef,
  type SalesCopyBody,
  type SalesCopyCompliance,
  type SalesCopyComplianceCorpusInput,
  type SalesCopyFactPool,
  type SalesCopyProductInput
} from "./sales-copy.js";
import type { ValueDna } from "./value-dna.js";
import type { FactEvidenceKind } from "./fact-review-evidence.js";

/** 证据行口径与 `claim_evidence` 表同源，统一从证据模块透出（避免两处各定义一份）。 */
export {
  factEvidenceKindSchema,
  factEvidenceKinds,
  factEvidenceSchema,
  type FactEvidence,
  type FactEvidenceKind
} from "./fact-review-evidence.js";

/**
 * Phase 14｜事实审核与人工审批（规格 §24 / §25 / §49 / §53 / §57 / §58）。
 *
 * §53 要求每一句都显示 `句子 / Claim Type / Risk / Evidence / 修改建议`；§49 要求按
 * FACT / INTERPRETATION / RHETORIC 三层标记与 GREEN / YELLOW / RED 三档风险逐句判定。
 *
 * 三条硬约束：
 *
 * 1. **修辞不是事实造假**（§24）：比喻、反问、排比、身份塑造本身不判 RED。唯一的关键检查是
 *    「会不会让消费者误以为存在一个并不存在的可核验事实」——只有禁止承诺、§25 受限研发措辞、
 *    禁止虚构的硬事实、凭空价格，以及「市场第一 / 最贵 / 唯一 / 投资回报」这类无据断言才判 RED；
 * 2. **同一口径只能有一份实现**（Phase 11 的教训）：逐字证据、语料、禁止项与价格扫描全部复用
 *    `sales-copy.ts` 里 Phase 12 已经在用的那几份实现，本文件不另造一套判定；
 * 3. **机械结论是硬闸门**：`buildFactReview()` 是纯规则引擎，Agent 11（FACT_REVIEWER）只能
 *    在它之上 **加严**——AI 标出的红线一定保留，AI 标的 GREEN 洗不掉规则判出的 RED。
 *    这样「能不能发布」永远是一个可复现、可审计的机械结论（§57 / §62-14）。
 */

export const FACT_REVIEW_SPEC_REF = "§24 / §25 / §49 / §53";

/** 下游交接：Phase 15（主播中心 / 经销商中心 / 导出）交付后已无后续阶段，固定为空数组。 */
export const FACT_REVIEW_DOWNSTREAM: readonly CategoryDownstreamItem[] = [];

/** §49 的重点审核项（逐字照抄规格清单）：前端标签与判定说明都读这一份。 */
export const FACT_REVIEW_FOCUS_LABELS: readonly string[] = [
  "对标关系",
  "研发关系",
  "配方",
  "原料",
  "树龄",
  "山头",
  "年份",
  "历史",
  "价格",
  "市场第一",
  "最贵",
  "唯一",
  "投资回报"
];

/** §24 三层标记的中文口径。 */
export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  FACT: "事实",
  INTERPRETATION: "解释",
  RHETORIC: "修辞"
};

export const CLAIM_TYPE_HINTS: Record<ClaimType, string> = {
  FACT: "可核验事实：必须能在本产品已录入字段或上游成稿里逐字找到出处（§24）",
  INTERPRETATION: "基于事实与品饮表现的产品解释：可以讲作用与设计逻辑，但不得新增硬事实（§24）",
  RHETORIC: "修辞表达：比喻 / 反问 / 排比 / 身份塑造，允许极限；但不得让消费者误以为存在可核验事实（§24 / §49）"
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  GREEN: "可发布",
  YELLOW: "需人工确认",
  RED: "禁止发布"
};

export const RISK_LEVEL_HINTS: Record<RiskLevel, string> = {
  GREEN: "落在已录入事实、上游成稿或纯修辞上，机械层面没有发现虚构（§49）",
  YELLOW: "不是红线，但发布前需要人工确认出处；缺少出处就必须改写或删除（§49 / §57）",
  RED: "禁止审批、禁止发布：必须改写或删除后才允许进入下一步（§53 / §57 / §62-14）"
};

/** 人工审批状态：只有「这次审核没有 RED」才允许 APPROVED。 */
export const factReviewStatuses = ["PENDING", "APPROVED", "REJECTED"] as const;
export const factReviewStatusSchema = z.enum(factReviewStatuses);
export type FactReviewStatus = z.infer<typeof factReviewStatusSchema>;

export const FACT_REVIEW_STATUS_LABELS: Record<FactReviewStatus, string> = {
  PENDING: "待审批",
  APPROVED: "已审批通过",
  REJECTED: "已否决"
};

/** 审核引擎：RULE = 纯规则；RULE_AI = 规则 + Agent 11 标注（AI 只能加严）。 */
export const factReviewEngines = ["RULE", "RULE_AI"] as const;
export const factReviewEngineSchema = z.enum(factReviewEngines);
export type FactReviewEngine = z.infer<typeof factReviewEngineSchema>;

export const FACT_EVIDENCE_KIND_LABELS: Record<FactEvidenceKind, string> = {
  PRODUCT_FACT: "产品已录入字段",
  VALUE_DNA: "Value DNA",
  UPSTREAM_COPY: "上游成稿",
  RND_REFERENCE: "研发记录"
};

export const FACT_REVIEW_ENGINE_INFO = {
  prompt_key: "FACT_REVIEWER",
  /** Phase 14 起 Agent 11 已接线（Mock / 失败时一律回落纯规则引擎） */
  ai_wired: true,
  /** 纯规则引擎始终先跑一遍，AI 不能覆盖它判出的红线 */
  rule_engine_authoritative: true,
  spec_ref: FACT_REVIEW_SPEC_REF
} as const;

/**
 * 事实审核的边界（与强成交话术 / 产品结构 / 配方哲学同一口径）。
 *
 * `maxVersionsPerCopy` 只封顶**新增**审核：§62-15 要求所有版本必须保留，
 * 因此超出上限时返回 400 让人工归档，而不是覆盖或删除历史审核（§53 / §57）。
 */
export const FACT_REVIEW_LIMITS = {
  maxVersionsPerCopy: 20
} as const;

/** §49 风险等级从低到高：合并规则结论与 AI 结论时按这个顺序取更严的一档。 */
export const RISK_LEVEL_ORDER: readonly RiskLevel[] = ["GREEN", "YELLOW", "RED"];

export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_LEVEL_ORDER.indexOf(a) >= RISK_LEVEL_ORDER.indexOf(b) ? a : b;
}

/* ------------------------------------------------------------ 机械特征 */

/** 修辞的机械特征：反问 / 比喻 / 拟人 / 身份塑造（§24 的 RHETORIC）。 */
const RHETORIC_PATTERNS: readonly RegExp[] = [
  /[？?]/,
  /(像|仿佛|好比|如同|犹如|活像)/,
  /(身份证|身份|名片|签名|性格|脾气|灵魂|血脉|基因|骨子里|天生)/,
  /(就是它的|这才是|才是真正的|不是.{0,24}而是)/,
  /(骗不了|一口就知道|一眼就知道|一听就懂)/
];

/** 解释的机械特征：讲「事实起了什么作用」（§24 的 INTERPRETATION）。 */
const INTERPRETATION_PATTERNS: readonly RegExp[] = [
  /(提供|撑起|托起|打底|决定|形成|带来|负责|来自|源于|靠|构成|组成|撑住|收口)/,
  /(所以|因此|意味着|说明|逻辑|结构|层次|骨架|底子|厚度|余韵|节奏)/,
  /(越.{0,24}越)/
];

/** 硬事实线索：出现这些词或两位以上数字，说明这句话在断言可核验的硬事实（§49 重点项）。 */
const HARD_FACT_PATTERNS: readonly RegExp[] = [
  /\d{2,}/,
  /(古树|大树|老树|乔木|单株|高杆|树龄)/,
  /(山头|茶区|产区|寨子|村寨)/,
  /(年份|陈化|干仓|湿仓|仓储|头春|春料|秋料|谷花)/
];

/**
 * §49 明文点名的「配方关系」断言：即使不含「复刻 / 同款配方」这类受限词，
 * 只要把自家产品说成「按某款配方做的」，在没有 RND 证据时同样是 RED。
 */
const FORMULA_RELATION_PATTERN =
  /(配方做|配方做出|配方一模一样|配方完全相同|同一套配方|配方来源|配方就是|同款|复刻|原配方|照.{0,8}配方|按.{0,10}配方)/;

/** §25 研发关系暗示（研发 / 拆解 / 风格参考）：没有 RND_CONFIRMED 时为 RED。 */
const RND_CLAIM_PATTERN =
  /(研发阶段|研发时|研发关系|团队拆解|拆解过|风格参考|参考了.{0,12}(香气|汤感|结构|风格|配方))/;

/** §49「市场第一 / 最贵 / 唯一 / 投资回报」这类无据断言（「第一口」不算市场第一）。 */
const SUPERLATIVE_PATTERN =
  /(市场第一|全国第一|行业第一|销量第一|第一名|最贵|唯一|绝无仅有|投资回报|升值空间|只涨不跌)/;

/** §49「价格高度故事」：只有存在可靠价格锚点时才允许这么讲。 */
const PRICE_HEIGHT_PATTERN = /(价格高度|高价带|高价赛道|站上高价|上万元|几千元|卖到\s*\d)/;

/* ------------------------------------------------------------ §53 对象 */

/**
 * §53 的逐句审核行：`句子 / Claim Type / Risk / Evidence / 修改建议`。
 *
 * `evidence_refs` 一律是**机械逐字回查**的结果（`字段路径=逐字值`），AI 不得增删，
 * 这样「Evidence」这一列永远能点回产品自己录入的那条事实（§24 / §46 / §57）。
 */
export const factReviewSentenceSchema = z
  .object({
    index: z.number().int().positive(),
    text: z.string().trim().min(1).max(2000),
    claim_type: claimTypeSchema,
    risk: riskLevelSchema,
    evidence_refs: z.array(z.string().trim().min(1)),
    issue: z.string().trim().min(1).nullable(),
    suggestion: z.string().trim().min(1).nullable(),
    /** RED = 阻断句：存在任何一条就不允许审批（§53 / §57） */
    is_blocking: z.boolean()
  })
  .strict()
  .refine((sentence) => sentence.is_blocking === (sentence.risk === "RED"), {
    message: "只有 RED 才能是阻断句：禁止审批的依据必须与风险等级同源（§53）",
    path: ["is_blocking"]
  });
export type FactReviewSentence = z.infer<typeof factReviewSentenceSchema>;

/** 三层标记与三档风险的计数（前端标签页与审批横幅直接读这一份）。 */
export const factReviewSummarySchema = z
  .object({
    green: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    red: z.number().int().nonnegative()
  })
  .strict();
export type FactReviewSummary = z.infer<typeof factReviewSummarySchema>;

export const factReviewClaimCountsSchema = z
  .object({
    FACT: z.number().int().nonnegative(),
    INTERPRETATION: z.number().int().nonnegative(),
    RHETORIC: z.number().int().nonnegative()
  })
  .strict();
export type FactReviewClaimCounts = z.infer<typeof factReviewClaimCountsSchema>;

/**
 * 纯规则 / 规则+AI 的**审核结论本体**（不含落库身份字段）。
 *
 * 服务层把它与 `generated_claims` 的行 id、产品 id、成稿版本一起组装成 `FactReview`，
 * 因此同一次判定既能在单测里直接断言，也能原样落库并回看。
 */
export interface FactReviewDraft {
  engine: FactReviewEngine;
  sentences: FactReviewSentence[];
  claim_counts: FactReviewClaimCounts;
  summary: FactReviewSummary;
  overall_risk: RiskLevel;
  /** RED 存在即 false：禁止审批（§53 / §57 / §62-14） */
  publishable: boolean;
  /** 阻断句原文，供审批接口 400 直接回给前端 */
  blocking_sentences: string[];
  /** 逐句缺少出处的事实断言（§49 / §57） */
  evidence_gaps: string[];
  /** §23 同口径：这一版逐字回查到的已录入事实条数 */
  facts_used: number;
  /** §24 / §25 合规结论（与逐句判定同源） */
  compliance: SalesCopyCompliance;
  warnings: string[];
}

/** 一次事实审核的完整视图（一版成稿可以审核多次，`version` 只增不删，§62-15）。 */
export const factReviewSchema = z
  .object({
    id: z.string().uuid(),
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    copy_output_id: z.string().uuid(),
    /** 被审核的那一版强成交话术 */
    copy_version: z.number().int().positive(),
    /** 这一版成稿的第几次事实审核（从 1 递增） */
    version: z.number().int().positive(),
    engine: factReviewEngineSchema,
    /** §25：审核时这一版是否存在 RND_CONFIRMED 研发证据 */
    rnd_confirmed: z.boolean(),
    /** §17 / §22：这一版有没有可靠价格锚点，以及够不够讲价格高度 */
    has_reliable_price_anchor: z.boolean(),
    price_high_story_ready: z.boolean(),
    sentences: z.array(factReviewSentenceSchema).min(1),
    claim_counts: factReviewClaimCountsSchema,
    summary: factReviewSummarySchema,
    overall_risk: riskLevelSchema,
    publishable: z.boolean(),
    blocking_sentences: z.array(z.string()),
    evidence_gaps: z.array(z.string()),
    facts_used: z.number().int().nonnegative(),
    compliance: salesCopyComplianceSchema,
    warnings: z.array(z.string()),
    created_at: z.string(),
    spec_ref: z.literal(FACT_REVIEW_SPEC_REF)
  })
  .strict()
  .refine((review) => review.summary.green + review.summary.yellow + review.summary.red === review.sentences.length, {
    message: "三档风险计数必须覆盖全部句子（§53）",
    path: ["summary"]
  })
  .refine((review) => review.publishable === (review.summary.red === 0 && review.compliance.risk !== "RED"), {
    message: "只有「逐句无 RED 且 §24 合规不是 RED」才可发布（§53 / §57 / §62-14）",
    path: ["publishable"]
  })
  .refine(
    (review) =>
      review.blocking_sentences.length === review.sentences.filter((sentence) => sentence.is_blocking).length,
    {
      message: "阻断句清单必须与逐句 RED 标记一一对应（§53）",
      path: ["blocking_sentences"]
    }
  )
  .refine((review) => review.overall_risk === overallRiskOf(review.summary, review.compliance.risk), {
    message: "整体风险必须由逐句风险与 §24 合规风险共同推导（§49）",
    path: ["overall_risk"]
  });
export type FactReview = z.infer<typeof factReviewSchema>;

function overallRiskOf(summary: FactReviewSummary, complianceRisk: RiskLevel): RiskLevel {
  if (summary.red > 0 || complianceRisk === "RED") {
    return "RED";
  }
  return summary.yellow > 0 || complianceRisk === "YELLOW" ? "YELLOW" : "GREEN";
}

/** 审核版本摘要：版本列表只读冻结结论，不重新判定（§62-15）。 */
export const factReviewVersionSummarySchema = z
  .object({
    /** 该审核版本首句所在行的 id（审核版本的身份 = 成稿 + 审核序号） */
    id: z.string().uuid(),
    version: z.number().int().positive(),
    copy_version: z.number().int().positive(),
    engine: factReviewEngineSchema,
    overall_risk: riskLevelSchema,
    publishable: z.boolean(),
    green: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
    facts_used: z.number().int().nonnegative(),
    created_at: z.string()
  })
  .strict()
  .refine((summary) => summary.publishable === (summary.red === 0), {
    message: "版本摘要的发布结论必须由 RED 计数推导（§53）",
    path: ["publishable"]
  });
export type FactReviewVersionSummary = z.infer<typeof factReviewVersionSummarySchema>;

/** 人工审批状态：`reviewed_version` 指被审批的那一次事实审核。 */
export const factReviewApprovalSchema = z
  .object({
    status: factReviewStatusSchema,
    reviewed_version: z.number().int().positive().nullable(),
    note: z.string().nullable(),
    reviewed_by: z.string().uuid().nullable(),
    reviewed_at: z.string().nullable()
  })
  .strict()
  .refine((approval) => approval.status === "PENDING" || approval.reviewed_version !== null, {
    message: "审批 / 否决必须指向一次具体的事实审核版本（§53 / §62-15）",
    path: ["reviewed_version"]
  });
export type FactReviewApproval = z.infer<typeof factReviewApprovalSchema>;

/** 产品级总览：最新一版成稿 + 它的审核结论与审批状态（§53 页面首屏）。 */
export const factReviewOverviewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable().optional(),
    copy_record_id: z.string().uuid().nullable(),
    copy_version: z.number().int().positive().nullable(),
    can_review: z.boolean(),
    block_reason: z.string().nullable(),
    review: factReviewSchema.nullable(),
    versions: z.array(factReviewVersionSummarySchema),
    approval: factReviewApprovalSchema,
    spec_ref: z.literal("§24 / §49 / §53")
  })
  .strict()
  .refine((overview) => overview.can_review === (overview.copy_record_id !== null), {
    message: "没有可审的成稿版本时不得允许运行事实审核（§53）",
    path: ["can_review"]
  });
export type FactReviewOverview = z.infer<typeof factReviewOverviewSchema>;

export const factReviewGenerateSchema = z
  .object({
    /** 要审核哪一版强成交话术；不传就审核最新一版（§62-15） */
    record_id: z.string().uuid().optional(),
    /** 是否调用 Agent 11（默认跟随 AI Provider；Mock / 失败时自动回落纯规则引擎） */
    use_ai: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type FactReviewGenerateInput = z.infer<typeof factReviewGenerateSchema>;

export const factReviewDecisionSchema = z
  .object({
    /** 审批哪一次审核；不传就审批最新一次（§62-15） */
    version: z.number().int().positive().optional(),
    note: z.string().trim().max(2000).nullable().optional()
  })
  .strict();
export type FactReviewDecisionInput = z.infer<typeof factReviewDecisionSchema>;

/* ------------------------------------------------------------ 逐句切分 */

/**
 * 逐句切分：按「。！？；换行」切开，保持 §26 九种输出的原始顺序。
 *
 * 权威正文序列仍然只有一份（`salesCopyTexts()`），本函数只在它之上做切分，
 * 因此「审核了 63 句」与「成稿有 63 句」永远对得上。
 */
export function factReviewSentences(body: SalesCopyBody): string[] {
  const sentences: string[] = [];
  for (const text of salesCopyTexts(body)) {
    for (const part of text.split(/(?<=[。！？；!?;\n])/)) {
      const sentence = part.trim();
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
    }
  }
  return sentences;
}

/* ------------------------------------------------------------ 逐句判定 */

export interface FactReviewBuildInput extends SalesCopyComplianceCorpusInput {
  product: SalesCopyProductInput;
  value_dna: ValueDna | null;
  body: SalesCopyBody;
  /** §17 冻结在成稿里的锚点结论（历史版本不随今日锚点漂移） */
  anchor: SalesCopyAnchorRef;
  price_high_story_ready: boolean;
  /** §25：是否存在 RND_CONFIRMED 研发参考 */
  rnd_confirmed: boolean;
}

interface SentenceContext {
  text: string;
  citations: readonly string[];
  corpus: string;
  recorded: readonly string[];
  rnd_confirmed: boolean;
  price_high_story_ready: boolean;
}

interface SentenceFinding {
  risk: RiskLevel;
  issues: string[];
  suggestions: string[];
}

/**
 * §49 的三档风险判定。
 *
 * 判定顺序即优先级：先把「一定不能讲」的红线挑出来（禁止承诺 / 受限研发措辞 / 无据的研发关系 /
 * 禁止虚构硬事实 / 凭空价格 / 绝对化断言），再处理需要人工确认的 YELLOW，最后默认 GREEN。
 * 纯修辞（比喻 / 反问 / 身份句）不会命中任何一条，因此不会被误判成 RED（§24）。
 */
function sentenceFinding(ctx: SentenceContext): SentenceFinding {
  let risk: RiskLevel = "GREEN";
  const issues: string[] = [];
  const suggestions: string[] = [];
  const raise = (level: RiskLevel, issue: string, suggestion: string): void => {
    risk = maxRiskLevel(risk, level);
    issues.push(issue);
    suggestions.push(suggestion);
  };

  const promises = FORBIDDEN_PROMISES.filter((phrase) => ctx.text.includes(phrase));
  if (promises.length > 0) {
    raise(
      "RED",
      `命中禁止承诺：${promises.join(" / ")}`,
      "删除收益 / 升值承诺，只讲这饼茶自己的标准与体感（§47）"
    );
  }

  const restricted = RND_RESTRICTED_PHRASES.filter((phrase) => ctx.text.includes(phrase));
  if (restricted.length > 0) {
    raise(
      "RED",
      `命中 §25 受限研发措辞：${restricted.join(" / ")}`,
      "改成「研发阶段曾把 X 作为风格参考之一」，并在研发资料里留下可查记录（§25）"
    );
  }

  const relation = FORMULA_RELATION_PATTERN.exec(ctx.text);
  if (relation) {
    if (ctx.rnd_confirmed) {
      raise(
        "YELLOW",
        `研发 / 配方关系表述：${relation[0]}`,
        "人工确认研发记录能证明这句关系表述；讲不清就把关系收回到「风格参考」这一层（§25）"
      );
    } else {
      raise(
        "RED",
        "没有 RND_CONFIRMED 证据却写出配方 / 研发关系",
        "改写为「先把自己的产品标准立起来」，不得暗示一条并不存在的研发关系（§25 / §49）"
      );
    }
  }

  const rndClaimed =
    RND_CLAIM_PATTERN.test(ctx.text) || RND_ALLOWED_PHRASES.some((phrase) => ctx.text.includes(phrase));
  if (rndClaimed && !ctx.rnd_confirmed) {
    raise(
      "RED",
      "没有 RND_CONFIRMED 证据却出现研发关系暗示",
      "把研发关系整句删掉；有研发记录之后再按 §25 允许的句式讲（§25 / §62-8）"
    );
  }

  for (const category of findForbiddenFabrications(ctx.text, ctx.corpus)) {
    raise(
      "RED",
      `命中禁止虚构硬事实：${FORBIDDEN_AUTO_FILL_LABELS[category]}`,
      "删除这条凭空的硬事实；只能讲本产品已录入的那一份内容（§49 / §62-6）"
    );
  }

  const fakePrices = salesCopyFakePriceHits([ctx.text], ctx.recorded);
  if (fakePrices.length > 0) {
    raise(
      "RED",
      `凭空出现的价格数字：${fakePrices.join(" / ")}`,
      "价格必须来自本产品已录入字段或可靠价格锚点；没有就改用 §22 标准句（§3 / §49）"
    );
  }

  const superlative = SUPERLATIVE_PATTERN.exec(ctx.text);
  if (superlative) {
    raise(
      "RED",
      `无据的绝对化断言：${superlative[0]}`,
      "「市场第一 / 最贵 / 唯一 / 投资回报」必须有可核验证据，否则改成主观体感表达（§49）"
    );
  }

  if (!ctx.price_high_story_ready && PRICE_HEIGHT_PATTERN.test(ctx.text)) {
    raise(
      "YELLOW",
      "价格高度叙事缺少可靠价格锚点",
      "没有可靠价格锚点时必须逐字改用 §22 标准句，不得讲价格高度（§22 / §49）"
    );
  }

  if (risk === "GREEN" && ctx.citations.length === 0 && HARD_FACT_PATTERNS.some((p) => p.test(ctx.text))) {
    raise(
      "YELLOW",
      "这条硬事实断言在已录入字段与上游成稿里找不到逐字出处",
      "补录原始依据，或把句子改成不依赖这条事实的表达（§24 / §49）"
    );
  }

  return { risk, issues, suggestions };
}

/** §24 三层标记：修辞与解释优先于「引用了事实」这一条，避免把修辞句误判成 FACT。 */
function claimTypeOf(ctx: SentenceContext): ClaimType {
  if (RHETORIC_PATTERNS.some((pattern) => pattern.test(ctx.text))) {
    return "RHETORIC";
  }
  if (INTERPRETATION_PATTERNS.some((pattern) => pattern.test(ctx.text))) {
    return "INTERPRETATION";
  }
  if (ctx.citations.length > 0) {
    return "FACT";
  }
  if (HARD_FACT_PATTERNS.some((pattern) => pattern.test(ctx.text))) {
    return "FACT";
  }
  return "INTERPRETATION";
}

/** 证据行拆分：`product.mountain=布朗山` → 来源字段路径 + 逐字出处（§53 的 Evidence 列）。 */
export function factReviewEvidenceOf(citations: readonly string[]): {
  source_ref: string;
  source_id: string | null;
  excerpt: string;
  evidence_kind: FactEvidenceKind;
  traceable: boolean;
}[] {
  const evidence: {
    source_ref: string;
    source_id: string | null;
    excerpt: string;
    evidence_kind: FactEvidenceKind;
    traceable: boolean;
  }[] = [];
  for (const citation of citations) {
    const separator = citation.indexOf("=");
    const sourceRef = separator >= 0 ? citation.slice(0, separator) : citation;
    const excerpt = separator >= 0 ? citation.slice(separator + 1) : "";
    if (!sourceRef || excerpt.trim().length === 0) {
      continue;
    }
    evidence.push({
      source_ref: sourceRef,
      source_id: null,
      excerpt: excerpt.trim(),
      evidence_kind: sourceRef.startsWith("dna.") ? "VALUE_DNA" : "PRODUCT_FACT",
      traceable: true
    });
  }
  return evidence;
}

function claimCountsOf(sentences: readonly FactReviewSentence[]): FactReviewClaimCounts {
  const counts: FactReviewClaimCounts = { FACT: 0, INTERPRETATION: 0, RHETORIC: 0 };
  for (const sentence of sentences) {
    counts[sentence.claim_type] += 1;
  }
  return counts;
}

function summaryOf(sentences: readonly FactReviewSentence[]): FactReviewSummary {
  return {
    green: sentences.filter((sentence) => sentence.risk === "GREEN").length,
    yellow: sentences.filter((sentence) => sentence.risk === "YELLOW").length,
    red: sentences.filter((sentence) => sentence.risk === "RED").length
  };
}

function draftOf(
  engine: FactReviewEngine,
  sentences: FactReviewSentence[],
  compliance: SalesCopyCompliance,
  factsUsed: number,
  warnings: string[]
): FactReviewDraft {
  const summary = summaryOf(sentences);
  const blocking = sentences.filter((sentence) => sentence.risk === "RED").map((sentence) => sentence.text);
  if (compliance.risk === "RED" && summary.red === 0) {
    warnings = [
      ...warnings,
      "§24 合规全文扫描判定 RED，但逐句扫描没有定位到具体句子：请人工核对这一版成稿（§49）"
    ];
  }
  return {
    engine,
    sentences,
    claim_counts: claimCountsOf(sentences),
    summary,
    overall_risk: overallRiskOf(summary, compliance.risk),
    publishable: summary.red === 0 && compliance.risk !== "RED",
    blocking_sentences: blocking,
    evidence_gaps: sentences
      .filter((sentence) => sentence.claim_type === "FACT" && sentence.evidence_refs.length === 0)
      .map((sentence) => `第 ${sentence.index} 句缺少逐字出处：${sentence.text}`),
    facts_used: factsUsed,
    compliance,
    warnings
  };
}

/**
 * 纯规则逐句审核引擎（Agent 11 的机械底座）。
 *
 * 输入是**一版已经落库的成稿**（正文 + 冻结的锚点结论 + 当版事实与上游成稿语料），
 * 因此同一版成稿无论今天看还是三个月后看，逐句结论都一模一样（§57 / §62-15）。
 */
export function buildFactReview(input: FactReviewBuildInput): FactReviewDraft {
  const pool: SalesCopyFactPool = { product: input.product, dna: usableValueDna(input.value_dna) };
  const recorded = salesCopyRecordedValues(pool);
  const corpus = salesCopyComplianceCorpus(input, recorded);
  const bodyTexts = salesCopyTexts(input.body);
  const citations = salesCopyCitations(pool, bodyTexts);

  const sentences: FactReviewSentence[] = factReviewSentences(input.body).map((text, position) => {
    const ctx: SentenceContext = {
      text,
      citations: salesCopyCitations(pool, [text]),
      corpus,
      recorded,
      rnd_confirmed: input.rnd_confirmed,
      price_high_story_ready: input.price_high_story_ready
    };
    const finding = sentenceFinding(ctx);
    return factReviewSentenceSchema.parse({
      index: position + 1,
      text,
      claim_type: claimTypeOf(ctx),
      risk: finding.risk,
      evidence_refs: ctx.citations,
      issue: finding.issues.length > 0 ? finding.issues.join("；") : null,
      suggestion: finding.suggestions.length > 0 ? finding.suggestions.join("；") : null,
      is_blocking: finding.risk === "RED"
    });
  });

  const compliance = salesCopyCompliance({
    texts: bodyTexts,
    recorded,
    corpus,
    rnd_confirmed: input.rnd_confirmed,
    facts_used: citations.length
  });
  return draftOf("RULE", sentences, compliance, citations.length, []);
}

/** 把审核结论与落库身份字段组装成完整视图（服务层与单测共用同一份组装口径）。 */
export function factReviewRecord(
  draft: FactReviewDraft,
  identity: {
    id: string;
    product_id: string;
    product_name?: string | null;
    copy_output_id: string;
    copy_version: number;
    version: number;
    rnd_confirmed: boolean;
    has_reliable_price_anchor: boolean;
    price_high_story_ready: boolean;
    created_at: string;
  }
): FactReview {
  return factReviewSchema.parse({
    ...draft,
    ...identity,
    spec_ref: FACT_REVIEW_SPEC_REF
  });
}

/* ------------------------------------------------------------ AI 合并 */

/** Agent 11 的逐句输出（与 `prompts/fact-reviewer.md` 的 JSON 契约逐字一致）。 */
export const factReviewAiSentenceSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    claim_type: claimTypeSchema,
    risk: riskLevelSchema,
    evidence_refs: z.array(z.string()).default([]),
    issue: z.string().trim().max(1000).nullable().optional(),
    suggestion: z.string().trim().max(1000).nullable().optional()
  })
  .strict();
export type FactReviewAiSentence = z.infer<typeof factReviewAiSentenceSchema>;

export const factReviewAiOutputSchema = z
  .object({
    sentences: z.array(factReviewAiSentenceSchema).min(1),
    summary: factReviewSummarySchema,
    publishable: z.boolean(),
    blocking_sentences: z.array(z.string())
  })
  .strict();
export type FactReviewAiOutput = z.infer<typeof factReviewAiOutputSchema>;

/**
 * 把 Agent 11 的标注合并进规则结论。
 *
 * 合并规则（AI 只能加严）：
 * 1. 逐句结论按**顺序**对齐；AI 返回的句数与切分结果不一致时整份忽略，回落规则结论；
 * 2. 句子文本对不上（归一化后不一致）的那一句回落规则结论，避免 AI 标错行；
 * 3. 风险取「规则 / AI」里更严的一档；Evidence 永远用机械逐字回查的结果；
 * 4. 只有单句文案（issue / suggestion）允许 AI 覆盖，且 AI 留空时保留规则文案。
 */
export function mergeFactReviewAi(
  draft: FactReviewDraft,
  ai: FactReviewAiOutput
): { draft: FactReviewDraft; warnings: string[] } {
  const warnings: string[] = [];
  if (ai.sentences.length !== draft.sentences.length) {
    return {
      draft,
      warnings: [
        `Agent 11 返回 ${ai.sentences.length} 句、逐句切分得到 ${draft.sentences.length} 句：已整份忽略 AI 标注，保留规则结论（§53）`
      ]
    };
  }

  const sentences = draft.sentences.map((sentence, position) => {
    const item = ai.sentences[position];
    if (!item || normalizeSentence(item.text) !== normalizeSentence(sentence.text)) {
      warnings.push(`第 ${sentence.index} 句 AI 标注与原文对不上：已回落规则结论（§53）`);
      return sentence;
    }
    const risk = maxRiskLevel(sentence.risk, item.risk);
    return factReviewSentenceSchema.parse({
      index: sentence.index,
      text: sentence.text,
      claim_type: item.claim_type,
      risk,
      evidence_refs: sentence.evidence_refs,
      issue: item.issue && item.issue.trim().length > 0 ? item.issue.trim() : sentence.issue,
      suggestion:
        item.suggestion && item.suggestion.trim().length > 0 ? item.suggestion.trim() : sentence.suggestion,
      is_blocking: risk === "RED"
    });
  });

  return {
    draft: draftOf(
      "RULE_AI",
      sentences,
      draft.compliance,
      draft.facts_used,
      [...draft.warnings, ...warnings]
    ),
    warnings
  };
}

function normalizeSentence(text: string): string {
  return text.replace(/\s+/g, "").replace(/[。！？；!?;]$/, "");
}

/** §53 逐句表格的列定义：前端表头与文档口径都读这一份。 */
export const FACT_REVIEW_SENTENCE_COLUMNS: readonly string[] = [
  "句子",
  "Claim Type",
  "Risk",
  "Evidence",
  "修改建议"
];

/** 供 API 自检与前端展示：三层标记 / 三档风险 / 审批闸门只从这里读取。 */
export const FACT_REVIEW_CONTRACT = {
  spec_ref: FACT_REVIEW_SPEC_REF,
  claim_types: claimTypes.map((type) => ({
    key: type,
    label: CLAIM_TYPE_LABELS[type],
    hint: CLAIM_TYPE_HINTS[type],
    spec_ref: "§24"
  })),
  risk_levels: RISK_LEVEL_ORDER.map((level) => ({
    key: level,
    label: RISK_LEVEL_LABELS[level],
    hint: RISK_LEVEL_HINTS[level],
    spec_ref: "§49"
  })),
  statuses: factReviewStatuses.map((status) => ({
    key: status,
    label: FACT_REVIEW_STATUS_LABELS[status],
    spec_ref: "§53"
  })),
  evidence_kinds: (Object.keys(FACT_EVIDENCE_KIND_LABELS) as FactEvidenceKind[]).map((kind) => ({
    key: kind,
    label: FACT_EVIDENCE_KIND_LABELS[kind]
  })),
  focus_items: FACT_REVIEW_FOCUS_LABELS,
  sentence_columns: FACT_REVIEW_SENTENCE_COLUMNS,
  engine: FACT_REVIEW_ENGINE_INFO,
  /** §24：修辞不是事实造假，不能因为不是字面事实就全部判 RED */
  rhetoric_not_fraud: true,
  /** §53 / §57：RED 禁止审批 */
  red_blocks_approval: true,
  /** §57：修辞可以保留 */
  rhetoric_kept: true,
  /** §62-15：所有版本必须保留 */
  keep_all_versions: true,
  /** §25：只有 RND_CONFIRMED 才允许出现真实研发关系暗示 */
  rnd_requires_confirmation: true,
  /** AI 只能加严：规则判出的 RED 不会被 AI 洗白 */
  ai_can_only_tighten: true,
  rules: [
    "§24 三层标记 FACT / INTERPRETATION / RHETORIC：修辞本身不判 RED，关键检查只有一条——会不会让消费者误以为存在一个并不存在的可核验事实",
    "§25 允许「研发时曾将 X 作为风格参考之一」（前提 RND_CONFIRMED）、「团队拆解过 X 的香气、汤感和结构」（前提有研发记录）；不允许「这就是按照 X 配方做出来的」「复刻 X」",
    "§49 十三项重点：对标关系 / 研发关系 / 配方 / 原料 / 树龄 / 山头 / 年份 / 历史 / 价格 / 市场第一 / 最贵 / 唯一 / 投资回报",
    "§49 无 RND 证据却写「我们就是按 2003 某六星孔雀配方做的」→ RED；必涨 / 稳赚 / 保值 / 未来达到某价格 / 固定投资回报 → RED",
    "§49 无可靠价格锚点却写出具体价格高度故事 → RED（必须逐字改用 §22 标准句）",
    "§53 每一句都必须给出 句子 / Claim Type / Risk / Evidence / 修改建议；Evidence 一律是机械逐字回查结果",
    "§53 / §57 RED 禁止审批与发布：存在任何一条阻断句时，审批接口直接 400 并把阻断句回给前端",
    "§57 修辞可以保留：身份句、画面句、反问句按 RHETORIC / GREEN 处理，不需要为了过审把文案写成说明书",
    "§58 自动测试：不自动生成 300 年古树 / 班章 / 复刻 2003 六星孔雀 / 同款配方 / 研发关系，但允许高度修辞与产品结构、配方哲学",
    "§62-15 所有版本必须保留：重新审核只新增审核版本，人工审批与否决都留痕"
  ]
} as const;
