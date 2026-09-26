import { z } from "zod";
import { copyIntensitySchema, riskLevelSchema, type RiskLevel } from "./enums.js";
import type { CategoryDownstreamItem } from "./category-creator.js";
import { FACT_REVIEW_SPEC_REF, factReviewStatusSchema } from "./fact-review.js";
import { SENSORY_FIELDS, type SensoryFieldKey } from "./product-fields.js";
import {
  NO_ANCHOR_STANDARD_SENTENCE,
  SALES_COPY_LIMITS,
  impactScoreBandSchema,
  type SalesCopyRecordView
} from "./sales-copy.js";

/**
 * Phase 15 交付层（规格 §31 一级导航 / §32 产品详情 Tabs / §51 主播中心 / §52 经销商中心 /
 * §53 逐句风险 / §57 版本冻结 / §60 Phase 15 / §62-14 / §62-15）。
 *
 * 这一层只做一件事：**把「已审批的最新一版成稿」换一种排版再讲一遍**。四条铁律写在代码里：
 *
 * 1. **派生视图，不落库**（§62-15）：主播中心 / 经销商中心 / 导出都是对某一版成稿的只读重排，
 *    不新增表、不改写正文、不生成「第二份话术」——否则同一款茶会出现两份会互相打架的稿子；
 * 2. **发布闸门只有一条口径**（§53 / §57 / §62-14）：内容必须来自「已人工审批通过、
 *    且属于当前最新一版成稿」的那一次事实审核；RED 阻断句存在时一律不给最终资料，
 *    并明确引导去事实审核——上一版通过不能给新版当绿灯；
 * 3. **不移植竞品事实**（§62-5）：锚点只提供「价格高度标准」这一层，
 *    经销商中心的「主要锚点 / 同赛道市场认知」绝不把对标产品的原料、树龄、山头写成自己的事实；
 * 4. **主播不需要自己琢磨**（§64）：§51 十项每一格都给「照着讲就行」的原文，
 *    不出现任何算法细节，也不要求主播自己换算中间量。
 */

export const DELIVERY_SPEC_REF = "§51 / §52 / §53 / §57 / §62-14 / §62-15";
export const HOST_CENTER_SPEC_REF = "§51 / §53 / §57";
export const DEALER_CENTER_SPEC_REF = "§52 / §53 / §57";
export const DELIVERY_GATE_SPEC_REF = "§53 / §57 / §62-14";
export const HANDCARD_SPEC_REF = "§47 / §10.4 / §22 / §60";

/** 交付层统一色调：与前端 `Pill` 的 tone 取值一一对应，禁止各页面自行拼色值。 */
export type DeliveryTone = "brand" | "ok" | "warn" | "danger" | "info" | "neutral" | "outline";
export const deliveryToneSchema = z.enum([
  "brand",
  "ok",
  "warn",
  "danger",
  "info",
  "neutral",
  "outline"
]);

/* --------------------------------------------------- §51 主播中心十项 */

export const hostCenterSlotKeys = [
  "product_identity",
  "one_liner",
  "must_say_three",
  "value_track",
  "product_structure",
  "formula_philosophy",
  "core_quotes",
  "sec60",
  "min3",
  "objections"
] as const;
export const hostCenterSlotKeySchema = z.enum(hostCenterSlotKeys);
export type HostCenterSlotKey = z.infer<typeof hostCenterSlotKeySchema>;

export interface HostCenterSlotMeta {
  key: HostCenterSlotKey;
  /** §51 原文用词，一个字都不改 */
  label: string;
  /** 这一格主播必须拿到什么 */
  requirement: string;
  /** 对应成稿的哪个字段（派生的唯一来源） */
  source: string;
  spec_ref: string;
}

/**
 * §51 原文十项，顺序即页面顺序、导出顺序。
 *
 * 「今天必讲 3 点」在基线里没有单独定义，这里取**成稿前三条核心卖点**机械派生：
 * 卖点本来就是「这一款茶最该被讲出来的七件事」按重要性排序的结果，
 * 不再由本层另起一套规则去挑（否则同一款茶会出现两套「必讲」）。
 */
export const HOST_CENTER_SLOT_META: readonly HostCenterSlotMeta[] = [
  {
    key: "product_identity",
    label: "产品身份",
    requirement: "它是谁：身份定义直接可念，不要求主播自己总结",
    source: "headline.identity_definition",
    spec_ref: "§51 / §22"
  },
  {
    key: "one_liner",
    label: "一句话定位",
    requirement: "一句话把它放在哪条价值赛道上",
    source: "headline.one_liner",
    spec_ref: "§51 / §47"
  },
  {
    key: "must_say_three",
    label: "今天必讲 3 点",
    requirement: "今天这场直播必须讲到的三件事（取成稿前三条核心卖点）",
    source: "selling_points[0..2]",
    spec_ref: "§51"
  },
  {
    key: "value_track",
    label: "价值赛道 / 产品标准",
    requirement: "有可靠价格锚点就讲赛道价格高度；没有锚点就逐字讲 §22 标准句立自己的标准",
    source: "headline.price_or_standard_story",
    spec_ref: "§51 / §17 / §22"
  },
  {
    key: "product_structure",
    label: "产品结构",
    requirement: "谁负责骨架、谁负责香气、谁负责汤感、谁负责回甘、谁负责记忆点",
    source: "headline.product_architecture_story",
    spec_ref: "§51 / §5 / §45"
  },
  {
    key: "formula_philosophy",
    label: "配方哲学",
    requirement: "设计逻辑与风格身份证：这款茶是按什么思路做的",
    source: "headline.formula_philosophy_story",
    spec_ref: "§51 / §6 / §46"
  },
  {
    key: "core_quotes",
    label: "5 句金句",
    requirement: "五句可以单独剪成短视频的核心金句",
    source: "quotes.core_quotes",
    spec_ref: "§51 / §26"
  },
  {
    key: "sec60",
    label: "60 秒稿",
    requirement: "一分钟讲完钩子、身份、价值高度、结构与成交收口",
    source: "scripts.sec60",
    spec_ref: "§51 / §26"
  },
  {
    key: "min3",
    label: "3 分钟稿",
    requirement: "三分钟完整主播稿，按 §27 八段时序展开",
    source: "scripts.min3",
    spec_ref: "§51 / §26 / §27"
  },
  {
    key: "objections",
    label: "异议回答",
    requirement: "把「凭什么这么贵 / 没有对标凭什么 / 是不是在讲故事」逐条接住",
    source: "objections",
    spec_ref: "§51 / §26"
  }
];

export const HOST_CENTER_SLOT_META_BY_KEY: Record<HostCenterSlotKey, HostCenterSlotMeta> =
  Object.fromEntries(HOST_CENTER_SLOT_META.map((meta) => [meta.key, meta] as const)) as Record<
    HostCenterSlotKey,
    HostCenterSlotMeta
  >;

/* ------------------------------------------------- §52 经销商中心十项 */

export const dealerCenterSlotKeys = [
  "positioning",
  "selling_points",
  "why_this_price",
  "market_cognition",
  "primary_anchor",
  "product_structure",
  "formula_philosophy",
  "consumer",
  "how_to_introduce",
  "faq"
] as const;
export const dealerCenterSlotKeySchema = z.enum(dealerCenterSlotKeys);
export type DealerCenterSlotKey = z.infer<typeof dealerCenterSlotKeySchema>;

export interface DealerCenterSlotMeta {
  key: DealerCenterSlotKey;
  /** §52 原文用词 */
  label: string;
  requirement: string;
  source: string;
  spec_ref: string;
}

/**
 * §52 原文十项，顺序即页面顺序、导出顺序。
 *
 * 「同赛道市场认知 / 主要锚点」只用 §17 锚点的**价格高度标准**这一层，
 * 绝不把对标产品的原料 / 树龄 / 山头 / 价格写成自己的事实（§44 / §62-5）。
 */
export const DEALER_CENTER_SLOT_META: readonly DealerCenterSlotMeta[] = [
  {
    key: "positioning",
    label: "产品定位",
    requirement: "一句话定位 + 身份定义：它站在哪条价值赛道上",
    source: "headline.one_liner / headline.identity_definition",
    spec_ref: "§52 / §47"
  },
  {
    key: "selling_points",
    label: "核心卖点",
    requirement: "七大卖点逐条讲清，经销商可以直接照着讲给终端",
    source: "selling_points",
    spec_ref: "§52 / §47"
  },
  {
    key: "why_this_price",
    label: "为什么值这个价",
    requirement: "有可靠价格锚点讲价格高度；没有锚点讲自建标准，绝不编一个价格",
    source: "headline.price_or_standard_story",
    spec_ref: "§52 / §22"
  },
  {
    key: "market_cognition",
    label: "同赛道市场认知",
    requirement: "只讲这条赛道的价格高度标准是什么，不搬运任何竞品的产品事实",
    source: "anchor.usage = STANDARD_ONLY",
    spec_ref: "§52 / §17 / §44 / §62-5"
  },
  {
    key: "primary_anchor",
    label: "主要锚点",
    requirement: "主要价格高度参照是谁；没有可靠锚点就如实说没有，并给自建标准",
    source: "anchor.primary_anchor_name",
    spec_ref: "§52 / §17"
  },
  {
    key: "product_structure",
    label: "产品结构",
    requirement: "结构即价值逻辑：每个位置由什么负责",
    source: "headline.product_architecture_story",
    spec_ref: "§52 / §5 / §45"
  },
  {
    key: "formula_philosophy",
    label: "配方哲学",
    requirement: "设计逻辑与风格身份证，缺比例就如实说缺，不编配比",
    source: "headline.formula_philosophy_story",
    spec_ref: "§52 / §6 / §46"
  },
  {
    key: "consumer",
    label: "消费人群",
    requirement: "什么人适合它、什么人可以先不买，不许用「所有人」糊过去",
    source: "headline.who_for",
    spec_ref: "§52 / §27"
  },
  {
    key: "how_to_introduce",
    label: "如何介绍",
    requirement: "给经销商的完整介绍口径：先讲定位，再讲结构，最后讲怎么卖",
    source: "dealer_copy",
    spec_ref: "§52 / §26"
  },
  {
    key: "faq",
    label: "常见问题",
    requirement: "终端最常问的几个问题与标准回答",
    source: "objections",
    spec_ref: "§52 / §26"
  }
];

export const DEALER_CENTER_SLOT_META_BY_KEY: Record<DealerCenterSlotKey, DealerCenterSlotMeta> =
  Object.fromEntries(DEALER_CENTER_SLOT_META.map((meta) => [meta.key, meta] as const)) as Record<
    DealerCenterSlotKey,
    DealerCenterSlotMeta
  >;

/* ------------------------------------------------------- §60 导出与边界 */

export const deliveryExportFormats = ["MARKDOWN", "TEXT", "HANDCARD"] as const;
export const deliveryExportFormatSchema = z.enum(deliveryExportFormats);
export type DeliveryExportFormat = z.infer<typeof deliveryExportFormatSchema>;

export interface DeliveryExportFormatMeta {
  key: DeliveryExportFormat;
  label: string;
  extension: string;
  content_type: string;
  hint: string;
}

/**
 * 导出格式（§60 原文只有「导出」两个字，格式由本层自己定）。
 *
 * 三种格式都**不产生任何新内容**：Markdown 给人看、纯文本给提词器用、
 * 卖点一页纸（HTML）给客户看与打印。
 *
 * 为什么「一页纸 HTML」不算「第二份可编辑产物」（§62-15）：
 * 它是**只读派生视图**——每一句正文逐字来自那一版已审批成稿或已录入事实，
 * 系统里没有对应的可写表，页面上也改不动任何一个字；改稿只能回上游重新生成版本并重新送审。
 * 因此它和主播中心 / 经销商中心是同一类东西，只是换了一种排版。
 * 仍然不导出 PDF / Word：那两类是**可编辑**产物，改完就与系统脱钩，才是真正的第二事实源。
 */
export const DELIVERY_EXPORT_FORMAT_META: readonly DeliveryExportFormatMeta[] = [
  {
    key: "MARKDOWN",
    label: "Markdown",
    extension: ".md",
    content_type: "text/markdown; charset=utf-8",
    hint: "带标题层级与编号列表，适合贴进飞书 / Notion / 公众号后台"
  },
  {
    key: "TEXT",
    label: "纯文本",
    extension: ".txt",
    content_type: "text/plain; charset=utf-8",
    hint: "去掉所有符号，适合直接进提词器或打印成主播手卡"
  },
  {
    key: "HANDCARD",
    label: "卖点一页纸",
    extension: ".html",
    content_type: "text/html; charset=utf-8",
    hint: "01 介绍 / 02 卖点 / 03 口感特点 / 04 补充清单排成一页纸，浏览器打开即可打印或另存 PDF"
  }
];

export const DELIVERY_EXPORT_FORMAT_META_BY_KEY: Record<DeliveryExportFormat, DeliveryExportFormatMeta> =
  Object.fromEntries(
    DELIVERY_EXPORT_FORMAT_META.map((meta) => [meta.key, meta] as const)
  ) as Record<DeliveryExportFormat, DeliveryExportFormatMeta>;

export const deliveryExportScopes = ["HOST", "DEALER", "ALL"] as const;
export const deliveryExportScopeSchema = z.enum(deliveryExportScopes);
export type DeliveryExportScope = z.infer<typeof deliveryExportScopeSchema>;

export const DELIVERY_EXPORT_SCOPE_META: readonly { key: DeliveryExportScope; label: string; hint: string }[] = [
  { key: "HOST", label: "只要主播中心", hint: "§51 十项：主播自己上台要用的那一份" },
  { key: "DEALER", label: "只要经销商中心", hint: "§52 十项：给经销商 / 终端讲的那一份" },
  { key: "ALL", label: "主播 + 经销商完整资料", hint: "两个中心合成一份文件，默认选项" }
];

/**
 * 交付层边界。
 *
 * `maxExportChars` 是防呆而不是业务规则：一份正常的主播 + 经销商资料在 1 万字上下，
 * 超过 12 万字基本意味着选错了产品或数据异常，此时宁可 400 让人确认，也不悄悄截断正文。
 */
export const DELIVERY_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: SALES_COPY_LIMITS.maxPageSize,
  maxExportChars: 120000,
  maxQueryLength: 200
} as const;

/** 下游交接：Phase 15 是最后一个阶段，交付后不再有下游（与其它 `_DOWNSTREAM` 同口径）。 */
export const DELIVERY_DOWNSTREAM: readonly CategoryDownstreamItem[] = [];

/* --------------------------------------------------- §53 / §57 发布闸门 */

/**
 * 一次事实审核的**冻结结论摘要**（只读落库行，不重新判定）。
 *
 * 交付层拿到的永远是这个摘要，而不是「现场再算一遍」的结论：三个月前审的那一版，
 * 今天看到的仍然是那时的风险计数与审批状态（§57 / §62-15）。
 */
export const deliveryReviewSummarySchema = z
  .object({
    copy_output_id: z.string().uuid(),
    /** 这一版成稿的第几次事实审核 */
    review_version: z.number().int().positive(),
    approval_status: factReviewStatusSchema,
    /** 逐句无 RED 且 §24 合规不是 RED（§53 / §57） */
    publishable: z.boolean(),
    red_count: z.number().int().nonnegative(),
    sentence_count: z.number().int().positive(),
    /** RED 阻断句原文：前端直接摆出来，不让运营自己去找（§53） */
    blocking_sentences: z.array(z.string()),
    approved: z.boolean(),
    spec_ref: z.literal(FACT_REVIEW_SPEC_REF)
  })
  .strict()
  .refine((summary) => summary.approved === (summary.approval_status === "APPROVED"), {
    message: "只有 APPROVED 才算审批通过（§53）",
    path: ["approved"]
  })
  .refine((summary) => summary.red_count === 0 || !summary.publishable, {
    message: "存在 RED 阻断句时不得标记为可发布（§53 / §57）",
    path: ["publishable"]
  })
  .refine((summary) => summary.blocking_sentences.length === summary.red_count, {
    message: "阻断句清单必须与逐句 RED 计数一一对应（§53）",
    path: ["blocking_sentences"]
  });
export type DeliveryReviewSummary = z.infer<typeof deliveryReviewSummarySchema>;

/**
 * 发布闸门（§53 / §57 / §62-14）：主播中心 / 经销商中心 / 导出**只有一条口径**。
 *
 * 三个条件同时满足才 `ready`：
 * 1. 有最新一版成稿（`copy_record_id` 非空）；
 * 2. 这一版最新一次事实审核的结论是 `publishable`（逐句与 §24 合规都没有 RED）；
 * 3. 这一次审核被人工审批**通过**（APPROVED）。
 *
 * 之所以把三件事写成一个对象而不是三个布尔散落在各处：上一版审批通过、当前版刚生成还没审，
 * 是最容易出假绿灯的场景（`approvalOf()` 只回答「最近一次审批是什么」）。闸门把
 * 「审批归属哪一版成稿」这件事显式表达出来，前端与测试都只看 `ready`。
 */
export const deliveryGateSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string().nullable(),
    copy_record_id: z.string().uuid().nullable(),
    copy_version: z.number().int().positive().nullable(),
    /** 被交付的那一次事实审核序号；没有审核时为 null */
    review_version: z.number().int().positive().nullable(),
    approval_status: factReviewStatusSchema,
    approved: z.boolean(),
    publishable: z.boolean(),
    ready: z.boolean(),
    red_count: z.number().int().nonnegative(),
    blocking_sentences: z.array(z.string()),
    /** 不能交付的原因；`ready` 为 true 时必须是 null */
    reason: z.string().nullable(),
    /** 该去哪里解决；`ready` 为 true 时必须是 null */
    next_action: z.string().nullable(),
    spec_ref: z.literal(DELIVERY_GATE_SPEC_REF)
  })
  .strict()
  .refine((gate) => gate.approved === (gate.approval_status === "APPROVED"), {
    message: "只有 APPROVED 才算审批通过（§53）",
    path: ["approved"]
  })
  .refine((gate) => gate.ready === (gate.copy_record_id !== null && gate.approved && gate.publishable), {
    message: "发布闸门 = 属于最新成稿 + 已人工审批通过 + 审核结论可发布（§57 / §62-14）",
    path: ["ready"]
  })
  .refine((gate) => (gate.copy_record_id === null) === (gate.copy_version === null), {
    message: "成稿 id 与版本号必须同时存在或同时为空（§62-15）",
    path: ["copy_version"]
  })
  .refine((gate) => (gate.ready ? gate.reason === null && gate.next_action === null : gate.reason !== null), {
    message: "可交付时不得带原因，不可交付时必须说明原因（§64：主播不用自己琢磨）",
    path: ["reason"]
  })
  .refine((gate) => gate.red_count === 0 || !gate.publishable, {
    message: "存在 RED 阻断句时不得标记为可发布（§53 / §57）",
    path: ["publishable"]
  });
export type DeliveryGate = z.infer<typeof deliveryGateSchema>;

export interface DeliveryGateInput {
  product_id: string;
  product_name: string | null;
  copy_record_id: string | null;
  copy_version: number | null;
  /** 最新一版成稿的最新一次事实审核结论；没有审过时传 null */
  review: DeliveryReviewSummary | null;
}

/** 发布闸门的唯一实现：视图、导出、跨产品列表都走这一个函数（§62-14：同一口径只有一份实现）。 */
export function buildDeliveryGate(input: DeliveryGateInput): DeliveryGate {
  const base = {
    product_id: input.product_id,
    product_name: input.product_name,
    copy_record_id: input.copy_record_id,
    copy_version: input.copy_version,
    spec_ref: DELIVERY_GATE_SPEC_REF
  } as const;

  if (input.copy_record_id === null || input.copy_version === null) {
    return deliveryGateSchema.parse({
      ...base,
      review_version: null,
      approval_status: "PENDING",
      approved: false,
      publishable: false,
      ready: false,
      red_count: 0,
      blocking_sentences: [],
      reason: "这款产品还没有强成交话术成稿：先生成一版主播稿（§21 / §26），再逐句做事实审核并人工审批（§53）。",
      next_action: "去生成强成交话术"
    });
  }

  const review = input.review;
  if (!review) {
    return deliveryGateSchema.parse({
      ...base,
      review_version: null,
      approval_status: "PENDING",
      approved: false,
      publishable: false,
      ready: false,
      red_count: 0,
      blocking_sentences: [],
      reason: `最新一版成稿 v${input.copy_version} 还没有做过逐句事实审核：对外讲之前必须审完并人工审批通过（§53 / §57）。`,
      next_action: "去事实审核"
    });
  }

  const shared = {
    ...base,
    review_version: review.review_version,
    approval_status: review.approval_status,
    approved: review.approved,
    publishable: review.publishable,
    red_count: review.red_count,
    blocking_sentences: review.blocking_sentences
  } as const;

  if (!review.publishable || review.red_count > 0) {
    return deliveryGateSchema.parse({
      ...shared,
      ready: false,
      reason: `最新一版成稿 v${input.copy_version} 的审核（第 ${review.review_version} 次）存在 ${review.red_count} 条 RED 阻断句，禁止发布：必须改写或删除后重新送审（§53 / §57 / §62-14）。`,
      next_action: "去事实审核改稿"
    });
  }

  if (review.approval_status === "REJECTED") {
    return deliveryGateSchema.parse({
      ...shared,
      ready: false,
      reason: `最新一版成稿 v${input.copy_version} 的审核（第 ${review.review_version} 次）已被人工否决：按备注修正后重新送审（§53）。`,
      next_action: "去事实审核"
    });
  }

  if (!review.approved) {
    return deliveryGateSchema.parse({
      ...shared,
      ready: false,
      reason: `最新一版成稿 v${input.copy_version} 的审核（第 ${review.review_version} 次）还没有人工审批通过：审核通过后才能出最终资料（§53 / §57）。`,
      next_action: "去事实审核"
    });
  }

  return deliveryGateSchema.parse({
    ...shared,
    ready: true,
    reason: null,
    next_action: null
  });
}

/** 闸门色调与一句话标签：前端 Pill 直接读这两份，不自己拼状态文案。 */
export function deliveryGateTone(gate: DeliveryGate): DeliveryTone {
  if (gate.ready) {
    return "ok";
  }
  if (gate.copy_record_id === null) {
    return "outline";
  }
  // 有最新一版成稿但还没审过：这不是 RED，也不是「等审批」，而是「先把审核跑起来」（§53）。
  if (gate.review_version === null) {
    return "info";
  }
  if (gate.red_count > 0 || !gate.publishable) {
    return "danger";
  }
  return gate.approval_status === "REJECTED" ? "danger" : "warn";
}

export function deliveryGateLabel(gate: DeliveryGate): string {
  if (gate.ready) {
    return "可交付";
  }
  if (gate.copy_record_id === null) {
    return "还没有成稿";
  }
  if (gate.review_version === null) {
    return "待事实审核";
  }
  if (gate.red_count > 0 || !gate.publishable) {
    return "被 RED 阻断";
  }
  return gate.approval_status === "REJECTED" ? "已被否决" : "待人工审批";
}

/** 风险等级 → 色调：只用于「合规风险」这一处展示，避免各页面自己配色（§24 / §49）。 */
export function riskLevelTone(risk: RiskLevel): DeliveryTone {
  switch (risk) {
    case "GREEN":
      return "ok";
    case "YELLOW":
      return "warn";
    default:
      return "danger";
  }
}

/* ------------------------------------------------- §51 / §52 格子视图 */

/**
 * 一格里的一个条目。
 *
 * 四类格子共用同一个形状，是因为主播要的动作只有两个：**照着念**（`text`）
 * 和**按顺序念**（`items[].text`）。`detail` 放「这句话背后的要求或标准回答」，
 * 让主播不必回头翻上游（§64）。
 */
export const deliverySlotItemSchema = z
  .object({
    index: z.number().int().positive(),
    /** 条目标签：必讲序号 / 金句序号 / 3 分钟时间轴 / 异议序号 */
    label: z.string().nullable(),
    text: z.string(),
    /** 补充说明：3 分钟稿每段的要求、异议的标准回答等 */
    detail: z.string().nullable()
  })
  .strict();
export type DeliverySlotItem = z.infer<typeof deliverySlotItemSchema>;

/** 十项格子共用的字段形状；两套 key 枚举各自拼上前缀，避免两份形状漂移。 */
const slotViewShape = {
  /** §51 / §52 原文用词 */
  label: z.string(),
  /** 这一格主播 / 经销商必须拿到什么 */
  requirement: z.string(),
  /** 派生来源（成稿的哪个字段） */
  source: z.string(),
  spec_ref: z.string(),
  tone: deliveryToneSchema,
  /** 可直接念的单段正文；没有内容时为 null */
  text: z.string().nullable(),
  /** 可直接念的条目文本（与 items 同源的纯文本，供复制与导出） */
  lines: z.array(z.string()),
  items: z.array(deliverySlotItemSchema),
  /** 这一格的字数：0 表示这一格没有内容 */
  chars: z.number().int().nonnegative(),
  /** 是否真的有内容（闸门未通过时全部为 false） */
  present: z.boolean()
};

export const hostCenterSlotViewSchema = z
  .object({ key: hostCenterSlotKeySchema, ...slotViewShape })
  .strict();
export type HostCenterSlotView = z.infer<typeof hostCenterSlotViewSchema>;

export const dealerCenterSlotViewSchema = z
  .object({ key: dealerCenterSlotKeySchema, ...slotViewShape })
  .strict();
export type DealerCenterSlotView = z.infer<typeof dealerCenterSlotViewSchema>;

/** 顶部状态条要用的成稿摘要：只读落库冻结值（§57 / §62-15）。 */
const deliverySummaryShape = {
  copy_record_id: z.string().uuid().nullable(),
  copy_version: z.number().int().positive().nullable(),
  copy_created_at: z.string().nullable(),
  intensity: copyIntensitySchema.nullable(),
  impact_score: z.number().int().nonnegative().nullable(),
  impact_band: impactScoreBandSchema.nullable(),
  impact_band_label: z.string().nullable(),
  level5_passed: z.boolean(),
  compliance_risk: riskLevelSchema.nullable(),
  gate: deliveryGateSchema,
  /** 只有闸门通过时才为 true；前端据此决定是否展示正文 */
  ready: z.boolean()
};

export const hostCenterViewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    ...deliverySummaryShape,
    slots: z.array(hostCenterSlotViewSchema).length(hostCenterSlotKeys.length),
    spec_ref: z.literal(HOST_CENTER_SPEC_REF)
  })
  .strict()
  .refine((view) => view.ready === view.gate.ready, {
    message: "页面的可交付状态必须与发布闸门同源（§53 / §57）",
    path: ["ready"]
  })
  .refine((view) => view.slots.map((slot) => slot.key).join(",") === hostCenterSlotKeys.join(","), {
    message: "主播中心必须按 §51 十项原文顺序输出，不能缺项也不能改顺序",
    path: ["slots"]
  })
  .refine((view) => view.ready || view.slots.every((slot) => !slot.present), {
    message: "闸门未通过时不得展示任何正文（上一版通过不等于当前版通过，§53 / §62-14）",
    path: ["slots"]
  })
  .refine((view) => view.copy_record_id === view.gate.copy_record_id, {
    message: "页面摘要必须来自闸门指向的那一版成稿（§57 / §62-15）",
    path: ["copy_record_id"]
  });
export type HostCenterView = z.infer<typeof hostCenterViewSchema>;

export const dealerCenterViewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    ...deliverySummaryShape,
    slots: z.array(dealerCenterSlotViewSchema).length(dealerCenterSlotKeys.length),
    spec_ref: z.literal(DEALER_CENTER_SPEC_REF)
  })
  .strict()
  .refine((view) => view.ready === view.gate.ready, {
    message: "页面的可交付状态必须与发布闸门同源（§53 / §57）",
    path: ["ready"]
  })
  .refine((view) => view.slots.map((slot) => slot.key).join(",") === dealerCenterSlotKeys.join(","), {
    message: "经销商中心必须按 §52 十项原文顺序输出，不能缺项也不能改顺序",
    path: ["slots"]
  })
  .refine((view) => view.ready || view.slots.every((slot) => !slot.present), {
    message: "闸门未通过时不得展示任何正文（§53 / §62-14）",
    path: ["slots"]
  })
  .refine((view) => view.copy_record_id === view.gate.copy_record_id, {
    message: "页面摘要必须来自闸门指向的那一版成稿（§57 / §62-15）",
    path: ["copy_record_id"]
  });
export type DealerCenterView = z.infer<typeof dealerCenterViewSchema>;

/* --------------------------------------------------- 派生：成稿 → 十项 */

/** 一格的可读内容：`text` 是单段正文，`items` 是要按顺序念的条目，二者可以并存。 */
export interface DeliverySlotContent {
  text: string | null;
  lines: string[];
  items: DeliverySlotItem[];
}

const EMPTY_SLOT_CONTENT: DeliverySlotContent = { text: null, lines: [], items: [] };

function textSlot(text: string | null | undefined, lines: string[] = []): DeliverySlotContent {
  const value = (text ?? "").trim();
  return {
    text: value.length > 0 ? value : null,
    lines: [...(value.length > 0 ? [value] : []), ...lines],
    items: []
  };
}

function itemSlot(items: DeliverySlotItem[], text: string | null = null): DeliverySlotContent {
  return { text, lines: items.map((item) => item.text), items };
}

/** 字数按**去重后的文本**统计：`lines` 是给复制用的纯文本视图，不能把同一句话算两遍。 */
function charsOf(content: DeliverySlotContent): number {
  const seen = new Set<string>();
  let total = 0;
  const add = (value: string | null | undefined): void => {
    const text = (value ?? "").trim();
    if (text.length > 0 && !seen.has(text)) {
      seen.add(text);
      total += text.length;
    }
  };
  add(content.text);
  content.lines.forEach(add);
  content.items.forEach((item) => {
    add(item.text);
    add(item.detail);
  });
  return total;
}

/**
 * §52「同赛道市场认知」：**只讲这条赛道的价格高度标准**。
 *
 * 这句话由成稿冻结的锚点结论（有没有可靠锚点 / 主要锚点叫什么 / 共几条）机械拼出，
 * 不含任何对标产品的原料、树龄、山头、年份、配方——那些是对标产品的事实，
 * 搬过来就变成我们自己的虚假事实（§44 / §62-5）。
 */
export function marketCognitionText(anchor: SalesCopyRecordView["anchor"]): string {
  if (!anchor.has_reliable_price_anchor) {
    return `这条赛道目前没有可靠价格锚点（Similarity ≥ 70 且 PriceEvidence ≥ 75 一条都没达标），价格高度标准只能由我们自己的产品标准来立：${NO_ANCHOR_STANDARD_SENTENCE}`;
  }
  const name = anchor.primary_anchor_name ?? "主要锚点";
  return `这条赛道的价格高度标准由「${name}」这类产品立住：我们手上有 ${anchor.anchor_count} 条可靠价格锚点，只引用它们的价格高度，不引用它们的原料、树龄、山头与配方。`;
}

/** §52「主要锚点」：如实说清楚主要参照是谁，没有就明确说没有（§17 / §62-10）。 */
export function primaryAnchorText(anchor: SalesCopyRecordView["anchor"]): string {
  if (anchor.has_reliable_price_anchor && anchor.primary_anchor_name) {
    return `主要价格高度参照：${anchor.primary_anchor_name}（可靠价格锚点共 ${anchor.anchor_count} 条，只用于价格高度对照）。`;
  }
  return "主要价格高度参照：没有。可靠锚点不达标时不硬凑竞品、不降低阈值、不编造对标，改用自建标准讲价格高度（§17 / §62-10）。";
}

/** §51 十项中「有锚点 / 没锚点」两种口径：前者讲赛道价格高度，后者逐字讲 §22 标准句。 */
function valueTrackLine(anchor: SalesCopyRecordView["anchor"]): string {
  return anchor.has_reliable_price_anchor
    ? `有可靠价格锚点（共 ${anchor.anchor_count} 条）：讲这条赛道的价格高度，不拿别人的产品事实给自己贴金。`
    : `没有可靠价格锚点：逐字讲 §22 标准句立自己的标准——${NO_ANCHOR_STANDARD_SENTENCE}`;
}

/** §51 十项 → 每格可读内容；缺哪一格就如实空着，绝不替上游补内容（§60 / §62-7）。 */
export function hostCenterSlotContent(
  key: HostCenterSlotKey,
  record: SalesCopyRecordView
): DeliverySlotContent {
  const headline = record.headline;
  switch (key) {
    case "product_identity":
      return textSlot(headline.identity_definition, [`记忆点：${headline.memory_point}`]);
    case "one_liner":
      return textSlot(headline.one_liner, [`开场钩子：${headline.opening_hook}`]);
    case "must_say_three":
      return itemSlot(
        record.selling_points.slice(0, 3).map((point, index) => ({
          index: index + 1,
          label: `必讲 ${index + 1}`,
          text: point,
          detail: null
        })),
        "今天这场直播必须讲到的三件事（取成稿前三条核心卖点）："
      );
    case "value_track":
      return textSlot(headline.price_or_standard_story, [
        valueTrackLine(record.anchor),
        `价值故事：${headline.value_story}`
      ]);
    case "product_structure":
      return textSlot(headline.product_architecture_story);
    case "formula_philosophy":
      return textSlot(headline.formula_philosophy_story);
    case "core_quotes":
      return itemSlot(
        record.quotes.core_quotes.map((quote, index) => ({
          index: index + 1,
          label: `金句 ${index + 1}`,
          text: quote,
          detail: null
        })),
        "五句可以单独剪成短视频的核心金句："
      );
    case "sec60":
      return textSlot(record.scripts.sec60, [`30 秒版（备选）：${record.scripts.sec30}`]);
    case "min3":
      return itemSlot(
        record.scripts.min3.segments.map((segment, index) => ({
          index: index + 1,
          label: `${segment.time_range} ${segment.label}`,
          text: segment.text,
          detail: segment.requirement
        })),
        record.scripts.min3.text
      );
    case "objections":
      return itemSlot(
        record.objections.map((objection, index) => ({
          index: index + 1,
          label: `异议 ${index + 1}`,
          text: objection.objection,
          detail: objection.response
        })),
        "把「凭什么这么贵 / 没有对标凭什么 / 是不是在讲故事」逐条接住："
      );
    default:
      return EMPTY_SLOT_CONTENT;
  }
}

/** §52 十项 → 每格可读内容。 */
export function dealerCenterSlotContent(
  key: DealerCenterSlotKey,
  record: SalesCopyRecordView
): DeliverySlotContent {
  const headline = record.headline;
  switch (key) {
    case "positioning":
      return textSlot(headline.one_liner, [`身份定义：${headline.identity_definition}`]);
    case "selling_points":
      return itemSlot(
        record.selling_points.map((point, index) => ({
          index: index + 1,
          label: `卖点 ${index + 1}`,
          text: point,
          detail: null
        })),
        "七大卖点逐条讲清，可以直接照着讲给终端："
      );
    case "why_this_price":
      return textSlot(headline.price_or_standard_story, [valueTrackLine(record.anchor)]);
    case "market_cognition":
      return textSlot(marketCognitionText(record.anchor), [
        primaryAnchorText(record.anchor),
        "使用纪律：只引用价格高度标准，不搬运对标产品的任何产品事实（§44 / §62-5）。"
      ]);
    case "primary_anchor":
      return textSlot(primaryAnchorText(record.anchor), [marketCognitionText(record.anchor)]);
    case "product_structure":
      return textSlot(headline.product_architecture_story);
    case "formula_philosophy":
      return textSlot(headline.formula_philosophy_story);
    case "consumer":
      return textSlot(headline.who_for, [`差异化：${headline.differentiation}`]);
    case "how_to_introduce":
      return textSlot(record.dealer_copy);
    case "faq":
      return itemSlot(
        record.objections.map((objection, index) => ({
          index: index + 1,
          label: `常见问题 ${index + 1}`,
          text: objection.objection,
          detail: objection.response
        })),
        "终端最常问的几个问题与标准回答："
      );
    default:
      return EMPTY_SLOT_CONTENT;
  }
}

/** 顶部状态条摘要一律读**落库冻结值**，不按今天的锚点或事实重算（§57 / §62-15）。 */
function deliverySummaryOf(record: SalesCopyRecordView | null) {
  if (!record) {
    return {
      copy_record_id: null,
      copy_version: null,
      copy_created_at: null,
      intensity: null,
      impact_score: null,
      impact_band: null,
      impact_band_label: null,
      level5_passed: false,
      compliance_risk: null
    };
  }
  return {
    copy_record_id: record.id,
    copy_version: record.version,
    copy_created_at: record.created_at,
    intensity: record.intensity,
    impact_score: record.impact_score.total,
    impact_band: record.impact_score.band,
    impact_band_label: record.impact_score.band_label,
    level5_passed: record.level5.satisfied,
    compliance_risk: record.compliance.risk
  };
}

export interface DeliveryViewInput {
  product_id: string;
  product_name: string;
  /** 最新一版成稿的冻结记录；还没有成稿时传 null */
  record: SalesCopyRecordView | null;
  gate: DeliveryGate;
}

/**
 * 主播中心视图（§51 十项）。
 *
 * 闸门未通过时**十格全部留空**：上一版被审批通过、当前版还没审，是最容易出假绿灯的场景，
 * 因此宁可只显示 `label / requirement` 与「去哪里解决」，也不让任何未审批正文出现在页面上（§53 / §62-14）。
 */
export function buildHostCenterView(input: DeliveryViewInput): HostCenterView {
  const slots = HOST_CENTER_SLOT_META.map((meta) => {
    const content =
      input.gate.ready && input.record ? hostCenterSlotContent(meta.key, input.record) : EMPTY_SLOT_CONTENT;
    const chars = charsOf(content);
    const present = input.gate.ready && chars > 0;
    return hostCenterSlotViewSchema.parse({
      key: meta.key,
      label: meta.label,
      requirement: meta.requirement,
      source: meta.source,
      spec_ref: meta.spec_ref,
      tone: !input.gate.ready ? "outline" : present ? "ok" : "warn",
      text: content.text,
      lines: content.lines,
      items: content.items,
      chars,
      present
    });
  });

  return hostCenterViewSchema.parse({
    product_id: input.product_id,
    product_name: input.product_name,
    ...deliverySummaryOf(input.record),
    gate: input.gate,
    ready: input.gate.ready,
    slots,
    spec_ref: HOST_CENTER_SPEC_REF
  });
}

/** 经销商中心视图（§52 十项）；与主播中心同一套闸门与同一份成稿（§53）。 */
export function buildDealerCenterView(input: DeliveryViewInput): DealerCenterView {
  const slots = DEALER_CENTER_SLOT_META.map((meta) => {
    const content =
      input.gate.ready && input.record ? dealerCenterSlotContent(meta.key, input.record) : EMPTY_SLOT_CONTENT;
    const chars = charsOf(content);
    const present = input.gate.ready && chars > 0;
    return dealerCenterSlotViewSchema.parse({
      key: meta.key,
      label: meta.label,
      requirement: meta.requirement,
      source: meta.source,
      spec_ref: meta.spec_ref,
      tone: !input.gate.ready ? "outline" : present ? "ok" : "warn",
      text: content.text,
      lines: content.lines,
      items: content.items,
      chars,
      present
    });
  });

  return dealerCenterViewSchema.parse({
    product_id: input.product_id,
    product_name: input.product_name,
    ...deliverySummaryOf(input.record),
    gate: input.gate,
    ready: input.gate.ready,
    slots,
    spec_ref: DEALER_CENTER_SPEC_REF
  });
}

/* --------------------------------------------------------- 导出文档 */

/** 一段正文的渲染：`items` 优先（要按顺序念），否则按单段正文 + 附加行渲染。 */
function renderSlotBlock(slot: HostCenterSlotView | DealerCenterSlotView, markdown: boolean): string[] {
  const lines: string[] = [markdown ? `### ${slot.label}` : slot.label];
  if (slot.items.length > 0) {
    if (slot.text) {
      lines.push(slot.text);
    }
    for (const item of slot.items) {
      const prefix = markdown ? `${item.index}. **${item.label ?? `第 ${item.index} 条`}**：` : `${item.index}. ${item.label ?? ""}：`;
      lines.push(`${prefix}${item.text}`);
      if (item.detail) {
        lines.push(markdown ? `   - ${item.detail}` : `   ${item.detail}`);
      }
    }
    return lines;
  }
  if (slot.text) {
    lines.push(slot.text);
  }
  for (const line of slot.lines) {
    if (line !== slot.text) {
      lines.push(line);
    }
  }
  if (lines.length === 1) {
    lines.push("（这一格没有内容：上游成稿或已录入事实里没有可用的原文，请回上游补齐，不要自己编。）");
  }
  return lines;
}

export interface DeliveryExportInput {
  product_id: string;
  product_name: string;
  format: DeliveryExportFormat;
  scope: DeliveryExportScope;
  host: HostCenterView;
  dealer: DealerCenterView;
  generated_at: string;
  /** 卖点一页纸的素材；只有 `format === "HANDCARD"` 时必填（其它格式不读它）。 */
  handcard?: HandcardView | null;
}

/**
 * 把两个中心渲染成一份文件（§60「导出」）。
 *
 * 纯函数、无副作用、**不含任何新内容**：正文逐字来自两个中心，两个中心的正文逐字来自那一版成稿。
 * 闸门未通过时调用方必须直接拒绝（409），本函数不做「先导出再提示」这种半成品。
 */
export function renderDeliveryExport(input: DeliveryExportInput): DeliveryExportView {
  const meta = DELIVERY_EXPORT_FORMAT_META_BY_KEY[input.format];
  if (input.format === "HANDCARD") {
    if (!input.handcard) {
      throw new Error("卖点一页纸缺少 handcard 视图：调用方必须先 buildHandcardView()（§60）");
    }
    const html = renderHandcardHtml({
      view: input.handcard,
      generated_at: input.generated_at,
      gate_label: deliveryGateLabel(input.host.gate)
    });
    return deliveryExportViewSchema.parse({
      product_id: input.product_id,
      product_name: input.product_name,
      format: input.format,
      scope: input.scope,
      filename: `${sanitizeFileName(input.product_name)}_卖点一页纸_v${input.host.copy_version ?? 0}${meta.extension}`,
      content_type: meta.content_type,
      content: html,
      chars: html.length,
      copy_record_id: input.host.copy_record_id,
      copy_version: input.host.copy_version,
      review_version: input.host.gate.review_version,
      gate: input.host.gate,
      generated_at: input.generated_at,
      spec_ref: DELIVERY_SPEC_REF
    });
  }

  const markdown = input.format === "MARKDOWN";
  const gate = input.host.gate;
  const title = input.scope === "HOST" ? "主播中心" : input.scope === "DEALER" ? "经销商中心" : "最终资料包";
  const lines: string[] = [];
  const push = (line = ""): void => {
    lines.push(line);
  };

  push(markdown ? `# ${input.product_name} · ${title}` : `${input.product_name} · ${title}`);
  push();
  push(`成稿版本：v${input.host.copy_version ?? "—"}`);
  push(`事实审核：第 ${input.host.gate.review_version ?? "—"} 次 · ${deliveryGateLabel(gate)}`);
  push(`导出时间：${input.generated_at}`);
  push(
    "本文件由系统按上述成稿重排生成，不含任何新事实；要改稿请回系统重新生成版本并重新送审（§53 / §57 / §62-15）。"
  );
  if (markdown) {
    push();
    push(`> 格式：${meta.label}｜范围：${DELIVERY_EXPORT_SCOPE_META.find((item) => item.key === input.scope)?.label ?? input.scope}`);
  }
  push();

  const sections: { heading: string; spec_ref: string; slots: (HostCenterSlotView | DealerCenterSlotView)[] }[] = [];
  if (input.scope !== "DEALER") {
    sections.push({ heading: "主播中心（§51 十项）", spec_ref: HOST_CENTER_SPEC_REF, slots: input.host.slots });
  }
  if (input.scope !== "HOST") {
    sections.push({ heading: "经销商中心（§52 十项）", spec_ref: DEALER_CENTER_SPEC_REF, slots: input.dealer.slots });
  }

  for (const section of sections) {
    push(markdown ? `## ${section.heading}` : `【${section.heading}】`);
    push();
    for (const slot of section.slots) {
      lines.push(...renderSlotBlock(slot, markdown));
      push();
    }
  }

  push(`—— 数据来源：成稿 v${input.host.copy_version ?? "—"} ｜ ${DELIVERY_SPEC_REF}`);
  const content = lines.join("\n");

  return deliveryExportViewSchema.parse({
    product_id: input.product_id,
    product_name: input.product_name,
    format: input.format,
    scope: input.scope,
    filename: `${sanitizeFileName(input.product_name)}_${title}_v${input.host.copy_version ?? 0}${meta.extension}`,
    content_type: meta.content_type,
    content,
    chars: content.length,
    copy_record_id: input.host.copy_record_id,
    copy_version: input.host.copy_version,
    review_version: input.host.gate.review_version,
    gate,
    generated_at: input.generated_at,
    spec_ref: DELIVERY_SPEC_REF
  });
}

/** 文件名只做最小净化：去掉路径分隔符与控制字符，避免导出名变成路径（§60）。 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "longdeji-delivery";
}

export const deliveryExportViewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    format: deliveryExportFormatSchema,
    scope: deliveryExportScopeSchema,
    filename: z.string(),
    content_type: z.string(),
    /** 文件正文：逐字来自两个中心，不含任何新内容（§62-15） */
    content: z.string(),
    chars: z.number().int().nonnegative(),
    copy_record_id: z.string().uuid().nullable(),
    copy_version: z.number().int().positive().nullable(),
    review_version: z.number().int().positive().nullable(),
    gate: deliveryGateSchema,
    generated_at: z.string(),
    spec_ref: z.literal(DELIVERY_SPEC_REF)
  })
  .strict()
  .refine((view) => view.chars === view.content.length, {
    message: "导出字数必须与正文一致（前端据此提示是否超出上限）",
    path: ["chars"]
  })
  .refine((view) => view.gate.ready, {
    message: "闸门未通过时不得产生任何导出文件（§53 / §57 / §62-14）",
    path: ["gate"]
  });
export type DeliveryExportView = z.infer<typeof deliveryExportViewSchema>;

/* --------------------------------------------- §60 卖点一页纸（一页纸） */

/**
 * 卖点一页纸：客户 2026-09-26 追加需求（**基线之外**，登记在 `agent_memory/`）。
 *
 * 客户要的东西很具体：**输入产品名 → 输出一张「产品卖点介绍」的纸**，像参考的《八角亭卖点手卡》那样
 * 一页摆完四段。因此这一层只做排版，四段正文的来源与纪律全部照搬既有规则：
 *
 * 1. 01 产品介绍 / 02 核心卖点：逐字来自那一版已审批成稿（§22 / §47）；
 * 2. 03 口感特点：逐字来自 §10.4 已录入的感官记录，按「香气 / 滋味 / 汤感 / 前中尾 / 收口」分组，
 *    没录的项不出现，**不替产品补写任何一口味道**（§24）；
 * 3. 04 补充清单：逐条来自 §10.1–10.3 已录入的原料 / 工艺 / 仓储 / 规格字段（§10 / §11）；
 * 4. 页面本身只读：没有可写表、页面上改不动任何一个字，改稿只能回上游重新生成版本并重新送审（§62-15）。
 *
 * 「把卖点讲大」在这一层是**修辞与价值高度**的事，由上游的成交强度（Level 4 / Level 5）与
 * 高价值锚点决定；本层不新增事实，也不会把对标产品的原料、树龄、山头写成自己的（§44 / §62-5）。
 */
export const handcardSectionKeys = ["intro", "selling_points", "taste", "facts"] as const;
export const handcardSectionKeySchema = z.enum(handcardSectionKeys);
export type HandcardSectionKey = z.infer<typeof handcardSectionKeySchema>;

export interface HandcardSectionMeta {
  key: HandcardSectionKey;
  /** 页面上的编号徽标（01–04），与参考手卡一致 */
  index: number;
  label: string;
  /** 这一段必须交代什么 */
  requirement: string;
  /** 派生的唯一来源 */
  source: string;
  spec_ref: string;
}

export const HANDCARD_SECTION_META: readonly HandcardSectionMeta[] = [
  {
    key: "intro",
    index: 1,
    label: "产品介绍",
    requirement: "一句话说清它是谁、凭什么、记在哪一点上",
    source: "headline.identity_definition / one_liner / memory_point / opening_hook",
    spec_ref: "§22 / §47"
  },
  {
    key: "selling_points",
    index: 2,
    label: "核心卖点",
    requirement: "§47 七条卖点逐条摆出来，一条不删、不合并",
    source: "selling_points（§47 七条）",
    spec_ref: "§47"
  },
  {
    key: "taste",
    index: 3,
    label: "口感特点",
    requirement: "逐字取 §10.4 已录入的感官记录，按香气 / 滋味 / 汤感 / 前中尾 / 收口分组",
    source: "products 的 §10.4 二十项感官",
    spec_ref: "§10.4 / §24"
  },
  {
    key: "facts",
    index: 4,
    label: "补充清单",
    requirement: "原料 / 工艺 / 仓储 / 规格等已录入字段，逐条列清，没录的不补",
    source: "products 的 §10.1–10.3 已录入字段",
    spec_ref: "§10 / §11"
  }
];

export const HANDCARD_SECTION_META_BY_KEY: Record<HandcardSectionKey, HandcardSectionMeta> = Object.fromEntries(
  HANDCARD_SECTION_META.map((meta) => [meta.key, meta] as const)
) as Record<HandcardSectionKey, HandcardSectionMeta>;

export const handcardSectionViewSchema = z
  .object({
    key: handcardSectionKeySchema,
    index: z.number().int().positive(),
    label: z.string(),
    requirement: z.string(),
    source: z.string(),
    spec_ref: z.string(),
    tone: deliveryToneSchema,
    /** 这一段的开场正文（可直接念）；没有内容时为 null */
    text: z.string().nullable(),
    items: z.array(deliverySlotItemSchema),
    chars: z.number().int().nonnegative(),
    present: z.boolean()
  })
  .strict();
export type HandcardSectionView = z.infer<typeof handcardSectionViewSchema>;

export const handcardViewSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    brand_name: z.string().nullable(),
    /** 规格行：净重 × 每盒饼数 × 每件盒数（只拼已录入的段） */
    spec_text: z.string().nullable(),
    /** 产品主图（`data:` URL 或普通 URL）；没有图时页面留占位框 */
    image_url: z.string().nullable(),
    image_alt: z.string(),
    sections: z.array(handcardSectionViewSchema).length(handcardSectionKeys.length),
    ...deliverySummaryShape,
    spec_ref: z.literal(HANDCARD_SPEC_REF)
  })
  .strict()
  .refine((view) => view.ready === view.gate.ready, {
    message: "页面的可交付状态必须与发布闸门同源（§53 / §57）",
    path: ["ready"]
  })
  .refine((view) => view.sections.map((section) => section.key).join(",") === handcardSectionKeys.join(","), {
    message: "卖点一页纸必须按 01–04 顺序输出，不能缺段也不能改顺序",
    path: ["sections"]
  })
  .refine((view) => view.ready || view.sections.every((section) => !section.present), {
    message: "闸门未通过时不得展示任何正文（上一版通过不等于当前版通过，§53 / §62-14）",
    path: ["sections"]
  });
export type HandcardView = z.infer<typeof handcardViewSchema>;

/** §10.4 二十项感官在页面上按「怎么喝出来」分组，而不是按数据库顺序平铺。 */
const HANDCARD_TASTE_GROUPS: readonly { label: string; keys: readonly SensoryFieldKey[] }[] = [
  { label: "香气", keys: ["dry_leaf_aroma", "hot_cup_aroma", "liquor_aroma", "cold_cup_aroma"] },
  { label: "滋味", keys: ["entry_taste", "bitterness", "astringency", "sweetness"] },
  { label: "汤感", keys: ["thickness", "viscosity", "water_texture", "cha_qi"] },
  { label: "前段 / 中段 / 尾段", keys: ["early_stage", "middle_stage", "late_stage", "finish"] },
  { label: "回甘生津与收口", keys: ["huigan", "salivation", "endurance", "leaf_bottom"] }
];

const SENSORY_LABEL_BY_KEY = new Map<string, string>(
  SENSORY_FIELDS.map((field) => [field.key as string, field.label as string] as const)
);

/** 一页纸里的一段正文素材；与 §51 / §52 一样，缺就空着，绝不替上游补写。 */
interface HandcardSectionContent {
  text: string | null;
  items: DeliverySlotItem[];
}

const EMPTY_HANDCARD_SECTION: HandcardSectionContent = { text: null, items: [] };

/**
 * 「04 补充清单」要摆的字段：**顺序即页面顺序**，标签只在这里写一次（§10 字段目录的展示口径）。
 *
 * 这些字段来自产品主档案（§10.1–10.3）已录入的值，页面只做「标签：值」的平铺；
 * 没有录入的字段整行不出现，不会出现「未知 / 待补充」这类占位（§11 未确认即不编造）。
 */
export const HANDCARD_FACT_FIELDS: readonly { key: string; label: string }[] = [
  { key: "series_name", label: "系列" },
  { key: "origin", label: "产地" },
  { key: "mountain", label: "山头" },
  { key: "village", label: "村寨" },
  { key: "weight_g", label: "净重" },
  { key: "pieces_per_box", label: "每盒" },
  { key: "boxes_per_case", label: "每件" },
  { key: "suggested_retail_price", label: "建议零售价" },
  { key: "raw_material", label: "原料" },
  { key: "tree_type", label: "树型" },
  { key: "tree_age", label: "树龄" },
  { key: "season", label: "季节" },
  { key: "harvest_standard", label: "采摘标准" },
  { key: "grade", label: "等级" },
  { key: "blend_description", label: "拼配" },
  { key: "material_notes", label: "原料备注" },
  { key: "kill_green_method", label: "杀青" },
  { key: "rolling_method", label: "揉捻" },
  { key: "drying_method", label: "干燥" },
  { key: "pressing_method", label: "压制" },
  { key: "fermentation_degree", label: "发酵程度" },
  { key: "fermentation_method", label: "发酵方式" },
  { key: "storage", label: "仓储" },
  { key: "processing_notes", label: "工艺备注" }
];

/** 卖点一页纸的入参：闸门与成稿来自交付层，感官与规格来自产品主档案（§10）。 */
export interface HandcardInput extends DeliveryViewInput {
  brand_name: string | null;
  spec_text: string | null;
  image_url: string | null;
  image_alt: string;
  /** §10.4 已录入的感官项（只传有值的项） */
  sensory: readonly { key: SensoryFieldKey; value: string }[];
  /** §10.1–10.3 已录入字段的值，键名见 `HANDCARD_FACT_FIELDS`（只传有值的项） */
  fact_values: Readonly<Record<string, string>>;
}

/** 04 补充清单的行：按 `HANDCARD_FACT_FIELDS` 顺序取有值的字段。 */
export function handcardFactRows(factValues: Readonly<Record<string, string>>): { label: string; value: string }[] {
  return HANDCARD_FACT_FIELDS.map((field) => ({
    label: field.label,
    value: (factValues[field.key] ?? "").trim()
  })).filter((row) => row.value.length > 0);
}

function handcardTasteContent(input: HandcardInput): HandcardSectionContent {
  const valueOf = new Map<SensoryFieldKey, string>();
  for (const item of input.sensory) {
    const value = item.value.trim();
    if (value.length > 0) {
      valueOf.set(item.key, value);
    }
  }
  const items: DeliverySlotItem[] = [];
  const parts: string[] = [];
  for (const group of HANDCARD_TASTE_GROUPS) {
    const pairs = group.keys
      .map((key) => ({ label: SENSORY_LABEL_BY_KEY.get(key) ?? key, value: valueOf.get(key) }))
      .filter((pair): pair is { label: string; value: string } => Boolean(pair.value));
    if (pairs.length === 0) {
      continue;
    }
    items.push({
      index: items.length + 1,
      label: group.label,
      text: pairs.map((pair) => `${pair.label}：${pair.value}`).join("　｜　"),
      detail: null
    });
    parts.push(`${group.label}这一层是 ${pairs.map((pair) => pair.value).join("、")}`);
  }
  return {
    text: parts.length > 0 ? `${parts.join("；")}。` : null,
    items
  };
}

function handcardSectionContent(key: HandcardSectionKey, input: HandcardInput): HandcardSectionContent {
  const record = input.record;
  if (!record) {
    return EMPTY_HANDCARD_SECTION;
  }
  const headline = record.headline;
  switch (key) {
    case "intro":
      return {
        text: headline.identity_definition,
        items: [
          { index: 1, label: "一句话定位", text: headline.one_liner, detail: null },
          { index: 2, label: "开场钩子", text: headline.opening_hook, detail: null },
          { index: 3, label: "记忆点", text: headline.memory_point, detail: null },
          { index: 4, label: "差异化", text: headline.differentiation, detail: null }
        ].filter((item) => item.text.trim().length > 0) as DeliverySlotItem[]
      };
    case "selling_points":
      return {
        text: headline.value_story,
        items: record.selling_points.map((point, index) => ({
          index: index + 1,
          label: `卖点 ${index + 1}`,
          text: point,
          detail: null
        }))
      };
    case "taste":
      return handcardTasteContent(input);
    case "facts":
      return {
        text: headline.product_architecture_story,
        items: handcardFactRows(input.fact_values).map((fact, index) => ({
          index: index + 1,
          label: fact.label,
          text: fact.value,
          detail: null
        }))
      };
    default:
      return EMPTY_HANDCARD_SECTION;
  }
}

/**
 * 把「一版已审批成稿 + 产品主档案」排成卖点一页纸的只读视图。
 *
 * 与两个中心同一套闸门：闸门未通过时四段全部留空（`text=null` / `items=[]` / `present=false`），
 * 页面只显示「卡在哪一步、下一步去哪」，不给任何半成品正文（§53 / §57 / §62-14）。
 */
export function buildHandcardView(input: HandcardInput): HandcardView {
  const sections = HANDCARD_SECTION_META.map((meta) => {
    const content = input.gate.ready && input.record ? handcardSectionContent(meta.key, input) : EMPTY_HANDCARD_SECTION;
    const chars = charsOf({ text: content.text, lines: [], items: content.items });
    return handcardSectionViewSchema.parse({
      key: meta.key,
      index: meta.index,
      label: meta.label,
      requirement: meta.requirement,
      source: meta.source,
      spec_ref: meta.spec_ref,
      tone: !input.gate.ready ? "outline" : chars > 0 ? "ok" : "warn",
      text: content.text,
      items: content.items,
      chars,
      present: input.gate.ready && chars > 0
    });
  });

  return handcardViewSchema.parse({
    product_id: input.product_id,
    product_name: input.product_name,
    brand_name: input.brand_name,
    spec_text: input.spec_text,
    image_url: input.image_url,
    image_alt: input.image_alt,
    sections,
    ...deliverySummaryOf(input.record),
    gate: input.gate,
    ready: input.gate.ready,
    spec_ref: HANDCARD_SPEC_REF
  });
}

/** HTML 转义：页面正文里任何来自数据库的字符都不能当标记解析（§24 之外的纯工程防呆）。 */
export function escapeHandcardHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface HandcardHtmlInput {
  view: HandcardView;
  generated_at: string;
  /** 六态闸门的中文标签（由 `deliveryGateLabel()` 给出，不在这里另写一套） */
  gate_label: string;
  /** 产品主图的 `data:` URL；缺省时页面显示占位框（产品图上传在 Phase B 交付） */
  image_data_url?: string | null;
}

/**
 * 卖点一页纸 → 单文件 HTML（客户 2026-09-26 追加需求）。
 *
 * 单文件、无外部依赖、无脚本：样式全部内联，图片用 `data:` URL，因此**另存下来就是一张能直接打印的纸**，
 * 浏览器「打印 → 另存为 PDF」即得到 A4 横版。页面本身不接收任何输入，也就改不动任何一个字（§62-15）。
 */
export function renderHandcardHtml(input: HandcardHtmlInput): string {
  const view = input.view;
  const esc = escapeHandcardHtml;
  const metaLine = [view.brand_name, view.spec_text].filter((item) => Boolean(item && item.trim())).join("　·　");
  const image = (input.image_data_url ?? view.image_url)?.trim();

  const renderItems = (section: HandcardSectionView): string => {
    if (section.items.length === 0) {
      return `<p class="empty">这一段还没有可用内容：${esc(section.requirement)}。请回上游补齐后重新生成版本，本页不补写。</p>`;
    }
    const rows = section.items
      .map((item) => {
        const label = item.label ? `<span class="lbl">${esc(item.label)}</span>` : "";
        const detail = item.detail ? `<span class="detail">${esc(item.detail)}</span>` : "";
        return `<li><span class="idx">${String(item.index).padStart(2, "0")}</span><span class="txt">${label}${esc(item.text)}${detail}</span></li>`;
      })
      .join("");
    return `<ul class="list">${rows}</ul>`;
  };

  const sections = view.sections
    .map((section) => {
      const lead = section.text && section.text.trim().length > 0 ? `<p class="lead">${esc(section.text)}</p>` : "";
      return `<section class="sec">
        <div class="badge">${String(section.index).padStart(2, "0")}</div>
        <div class="sec-body">
          <h2>${esc(section.label)}<span class="ref">${esc(section.spec_ref)}</span></h2>
          ${lead}
          ${renderItems(section)}
        </div>
      </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1122" />
<title>${esc(view.product_name)} · 卖点一页纸</title>
<style>
:root{--gold:#c9a227;--gold-soft:#e2c477;--ink:#f3efe7;--muted:#a9a49b;--line:rgba(201,162,39,.26)}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#0b0c0f}
body{color:var(--ink);font-family:"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Source Han Sans SC","Noto Sans CJK SC",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;width:1122px;min-height:794px;margin:0 auto;padding:34px 40px 24px;overflow:hidden;background:radial-gradient(120% 95% at 6% -10%,#232831 0%,#171a1f 44%,#0f1114 100%);box-shadow:0 28px 70px rgba(0,0,0,.6)}
.page::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px);background-size:100% 34px;pointer-events:none}
.page::after{content:"";position:absolute;top:-140px;right:-110px;width:440px;height:440px;border-radius:50%;background:radial-gradient(circle,rgba(201,162,39,.22),transparent 68%);pointer-events:none}
.head{position:relative;z-index:1;padding-bottom:14px;border-bottom:1px solid var(--line)}
.brandline{display:flex;align-items:center;gap:10px;font-size:11.5px;letter-spacing:.2em;color:var(--gold-soft)}
.brandline .bar{width:46px;height:1px;background:var(--gold)}
h1{margin:9px 0 6px;font-size:31px;font-weight:700;letter-spacing:.01em}
.spec{margin:0;font-size:12.5px;color:var(--muted)}
.grid{position:relative;z-index:1;display:grid;grid-template-columns:296px 1fr;gap:26px;margin-top:18px}
.shot{margin:0;display:flex;flex-direction:column;gap:10px}
.frame{position:relative;width:100%;aspect-ratio:1/1;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:linear-gradient(160deg,#23272f,#14161a)}
.frame img{width:100%;height:100%;object-fit:cover;display:block}
.noimg{position:absolute;inset:12px;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(201,162,39,.42);border-radius:6px;font-size:12px;color:var(--muted);text-align:center;line-height:1.8}
.shot figcaption{font-size:11.5px;line-height:1.75;color:var(--muted)}
.cols{display:flex;flex-direction:column;gap:14px}
.sec{display:grid;grid-template-columns:46px 1fr;gap:12px;break-inside:avoid;page-break-inside:avoid}
.badge{width:44px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13.5px;font-weight:700;color:#141518;background:linear-gradient(160deg,var(--gold-soft),var(--gold));clip-path:polygon(0 0,100% 0,100% 70%,50% 100%,0 70%)}
.sec-body h2{margin:3px 0 7px;font-size:14.5px;letter-spacing:.06em}
.sec-body h2 .ref{margin-left:8px;font-size:10.5px;font-weight:400;color:var(--muted);letter-spacing:0}
.lead{margin:0 0 7px;font-size:12.5px;line-height:1.85;color:#efe9dc}
.list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px}
.list li{display:grid;grid-template-columns:22px 1fr;gap:8px;font-size:12.5px;line-height:1.75}
.list .idx{font-size:10.5px;color:var(--gold-soft);padding-top:3px}
.list .lbl{color:var(--gold-soft);margin-right:8px}
.list .detail{display:block;font-size:11.5px;color:var(--muted);margin-top:2px}
.empty{margin:0;font-size:12px;line-height:1.8;color:var(--muted)}
.foot{position:relative;z-index:1;margin-top:18px;padding-top:12px;border-top:1px solid var(--line);font-size:10.5px;line-height:1.75;color:var(--muted)}
.foot strong{color:var(--gold-soft);font-weight:600}
@media print{@page{size:A4 landscape;margin:0}.page{box-shadow:none;min-height:auto}}
@media screen and (max-width:1180px){body{zoom:.74}}
</style>
</head>
<body>
<article class="page">
  <header class="head">
    <div class="brandline"><span>${esc(view.brand_name ?? "产品卖点")}</span><span class="bar"></span><span>PRODUCT SELLING CARD</span></div>
    <h1>${esc(view.product_name)}</h1>
    <p class="spec">${esc(metaLine || "规格待录入")}</p>
  </header>
  <div class="grid">
    <figure class="shot">
      <div class="frame">${
        image
          ? `<img src="${esc(image)}" alt="${esc(view.image_alt)}" />`
          : `<div class="noimg">产品主图待上传<br />在「产品图」里传一张实拍图，这张纸就自动带上</div>`
      }</div>
      <figcaption>${esc(metaLine || "")}</figcaption>
    </figure>
    <div class="cols">${sections}</div>
  </div>
  <footer class="foot">
    <div><strong>成稿 v${view.copy_version ?? "—"}</strong>　｜　第 ${view.gate.review_version ?? "—"} 次事实审核　｜　${esc(input.gate_label)}　｜　生成于 ${esc(input.generated_at)}</div>
    <div>本页为只读派生排版：每一句正文逐字来自系统内已审批成稿与已录入事实，页面不可编辑、不新增事实；改稿请回系统重新生成版本并重新送审（§53 / §57 / §62-15）。</div>
  </footer>
</article>
</body>
</html>`;
}

/* --------------------------------------------- §51 跨产品列表（排产） */

/**
 * 「主播中心」跨产品列表一行（§31 一级导航）。
 *
 * 这一行回答的是运营每天真正要问的问题：**哪几款茶今天能上播、哪几款卡在审核**。
 * 因此一行里既有成稿与分数的摘要，也有闸门状态与「卡在哪一步」的原因。
 */
export const hostCenterRowSchema = z
  .object({
    product_id: z.string().uuid(),
    product_name: z.string(),
    year: z.number().int(),
    tea_type: z.string(),
    mountain: z.string().nullable(),
    copy_record_id: z.string().uuid().nullable(),
    copy_version: z.number().int().positive().nullable(),
    one_liner: z.string().nullable(),
    intensity: copyIntensitySchema.nullable(),
    impact_score: z.number().int().nonnegative().nullable(),
    impact_band: impactScoreBandSchema.nullable(),
    level5_passed: z.boolean(),
    compliance_passed: z.boolean(),
    generated_at: z.string().nullable(),
    review_version: z.number().int().positive().nullable(),
    approval_status: factReviewStatusSchema,
    publishable: z.boolean().nullable(),
    red_count: z.number().int().nonnegative(),
    ready: z.boolean(),
    gate_reason: z.string().nullable(),
    spec_ref: z.literal(HOST_CENTER_SPEC_REF)
  })
  .strict()
  .refine((row) => row.ready === (row.copy_record_id !== null && row.publishable === true && row.approval_status === "APPROVED"), {
    message: "列表里的可交付状态必须与发布闸门同源（§53 / §57）",
    path: ["ready"]
  })
  .refine((row) => row.ready || row.gate_reason !== null, {
    message: "不可交付的行必须说明卡在哪一步（§64）",
    path: ["gate_reason"]
  });
export type HostCenterRow = z.infer<typeof hostCenterRowSchema>;

export const hostCenterListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(DELIVERY_LIMITS.maxPageSize).optional(),
    q: z.string().trim().max(DELIVERY_LIMITS.maxQueryLength).optional(),
    /**
     * 三态筛选：不传 = 全部，`true` = 只看可交付，`false` = 只看还不能交付的。
     *
     * 必须显式分支处理 `false`（见 agent_memory/bugs.md）：`z.coerce.boolean()` 会把 `"false"`
     * 解析成 true，让筛选整体反过来。
     */
    ready: z.stringbool().optional()
  })
  .strict();
export type HostCenterListQuery = z.infer<typeof hostCenterListQuerySchema>;

const EXPORT_FORMAT_BY_QUERY: Record<"markdown" | "text" | "handcard", DeliveryExportFormat> = {
  markdown: "MARKDOWN",
  text: "TEXT",
  handcard: "HANDCARD"
};
const EXPORT_SCOPE_BY_QUERY: Record<"host" | "dealer" | "all", DeliveryExportScope> = {
  host: "HOST",
  dealer: "DEALER",
  all: "ALL"
};

/**
 * 导出查询串：URL 里用小写（`?format=markdown&scope=all`），进服务层前就转成枚举，
 * 避免整条链路上出现两种写法（Phase 12 的教训：口径只能有一份）。
 */
export const deliveryExportQuerySchema = z
  .object({
    format: z
      .enum(["markdown", "text", "handcard"])
      .default("markdown")
      .transform((value) => EXPORT_FORMAT_BY_QUERY[value]),
    scope: z
      .enum(["host", "dealer", "all"])
      .default("all")
      .transform((value) => EXPORT_SCOPE_BY_QUERY[value])
  })
  .strict();
export type DeliveryExportQuery = z.infer<typeof deliveryExportQuerySchema>;

/* ------------------------------------------------------------- 合同 */

/**
 * 交付层合同（供 `/api/delivery/contract` 自检）：十项、导出格式、发布闸门与全部铁律。
 *
 * 与其它阶段一致：前端与运维不另写文案，一切口径从这里读（§51 / §52 / §53 / §57 / §60）。
 */
export const DELIVERY_CONTRACT = {
  spec_ref: DELIVERY_SPEC_REF,
  host_center: {
    spec_ref: HOST_CENTER_SPEC_REF,
    slot_count: hostCenterSlotKeys.length,
    slots: HOST_CENTER_SLOT_META
  },
  dealer_center: {
    spec_ref: DEALER_CENTER_SPEC_REF,
    slot_count: dealerCenterSlotKeys.length,
    slots: DEALER_CENTER_SLOT_META
  },
  export: {
    spec_ref: "§60",
    formats: DELIVERY_EXPORT_FORMAT_META,
    scopes: DELIVERY_EXPORT_SCOPE_META,
    /** 卖点一页纸（`HANDCARD`）的四段：客户追加需求，四段正文来源与两个中心同源 */
    handcard_sections: HANDCARD_SECTION_META
  },
  publish_gate: {
    spec_ref: DELIVERY_GATE_SPEC_REF,
    /** 只交付「已人工审批通过 + 属于当前最新一版成稿」的内容 */
    requires_approved: true,
    requires_latest_copy: true,
    /** 存在 RED 阻断句一律不给最终资料 */
    red_blocks_publish: true,
    /** 没有成稿就没有资料；页面给引导，导出一律拒绝 */
    no_copy_no_material: true,
    blocking_states: [
      "还没有强成交话术成稿：先生成一版主播稿",
      "最新一版成稿还没有做过逐句事实审核",
      "审核存在 RED 阻断句：必须改写或删除后重新送审",
      "审核已被人工否决：按备注修正后重新送审",
      "审核通过但没有人工审批：等审批通过才出最终资料"
    ]
  },
  /** 派生视图：主播中心 / 经销商中心 / 导出都不新增表、不改写正文（§62-15） */
  derived_view: true,
  /** 所有版本必须保留：导出永远标注它来自哪一版成稿与第几次审核 */
  keep_all_versions: true,
  limits: DELIVERY_LIMITS,
  rules: [
    "§51 主播中心十项：产品身份 / 一句话定位 / 今天必讲 3 点 / 价值赛道 / 产品结构 / 配方哲学 / 5 句金句 / 60 秒稿 / 3 分钟稿 / 异议回答",
    "§52 经销商中心十项：产品定位 / 核心卖点 / 为什么值这个价 / 同赛道市场认知 / 主要锚点 / 产品结构 / 配方哲学 / 消费人群 / 如何介绍 / 常见问题",
    "§53 / §62-14 发布闸门：必须属于当前最新一版成稿，且这一版已人工审批通过、逐句无 RED，才允许出最终资料",
    "§53 上一版审批通过不算当前版通过：新生成一版就要重新送审，页面不许出现假绿灯",
    "§62-15 派生视图不落库：导出与两个中心都是对某一版成稿的只读重排，重新生成只新增版本",
    "§62-5 不移植竞品事实：同赛道市场认知 / 主要锚点只引用价格高度标准，不引用对标产品的原料 / 树龄 / 山头 / 配方",
    "§64 主播不用自己琢磨：十项每一格都给可直接念的原文，缺口如实留空并指向上游补齐",
    "§60 卖点一页纸：01 介绍 / 02 卖点逐字来自已审批成稿，03 口感特点逐字来自已录入感官，04 补充清单逐字来自已录入字段，页面只读不可编辑"
  ]
} as const;
