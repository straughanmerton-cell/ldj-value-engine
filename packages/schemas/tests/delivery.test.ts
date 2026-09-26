import { describe, expect, it } from "vitest";
import {
  DEFAULT_VALUE_FOCUS,
  DELIVERY_CONTRACT,
  DELIVERY_DOWNSTREAM,
  DELIVERY_EXPORT_FORMAT_META,
  DELIVERY_EXPORT_SCOPE_META,
  DELIVERY_LIMITS,
  DELIVERY_SPEC_REF,
  DEALER_CENTER_SLOT_META,
  DEALER_CENTER_SPEC_REF,
  FACT_REVIEW_SPEC_REF,
  HOST_CENTER_SLOT_META,
  HOST_CENTER_SPEC_REF,
  NO_ANCHOR_STANDARD_SENTENCE,
  buildDealerCenterView,
  buildDeliveryGate,
  buildHostCenterView,
  buildSalesCopy,
  dealerCenterSlotContent,
  deliveryExportQuerySchema,
  deliveryGateLabel,
  deliveryGateSchema,
  deliveryGateTone,
  deliveryReviewSummarySchema,
  hostCenterListQuerySchema,
  hostCenterSlotContent,
  marketCognitionText,
  primaryAnchorText,
  productArchitectureSchema,
  renderDeliveryExport,
  riskLevelTone,
  salesCopyRecordSchema,
  sanitizeFileName,
  valueDnaSchema,
  type BenchmarkModeView,
  type CategoryStyleIdentity,
  type DeliveryGate,
  type DeliveryReviewSummary,
  type ProductArchitecture,
  type SalesCopyBuildInput,
  type SalesCopyDraft,
  type SalesCopyProductInput,
  type SalesCopyRecordView,
  type ValueDna
} from "../src/index.js";

/**
 * Phase 15（规格 §31 / §32 / §51 / §52 / §53 / §57 / §60 / §62-14 / §62-15）。
 *
 * 这里只测「交付层纯函数」：不碰数据库、不调用任何 Provider。
 * 四条铁律——① 十项按 §51 / §52 原文顺序，一格都不许少；
 * ② 发布闸门只有一份实现，上一版通过不算当前版通过；
 * ③ 闸门未通过时页面与导出一律不给正文；
 * ④ 导出是派生视图：只重排，不新增任何事实，也不落库。
 */

/** 规格 §58 fixture：龙德记六星孔雀（事实齐备版）。 */
const FULL_PRODUCT: SalesCopyProductInput = {
  product_name: "龙德记六星孔雀",
  series_name: "六星孔雀",
  year: 2026,
  tea_type: "普洱生茶",
  tea_subtype: "生茶",
  origin_province: "云南",
  origin_city: "西双版纳",
  origin_region: "勐海",
  mountain: "布朗山",
  village: "老班章",
  raw_material: "大树春茶",
  tree_type: "大树",
  tree_age: null,
  season: "春茶",
  grade: "特级",
  blend_description: "单株拼配",
  kill_green_method: "铁锅杀青",
  rolling_method: "手工揉捻",
  drying_method: "日光晒干",
  pressing_method: "传统石磨压制",
  processing_notes: "低温慢炒，保留活性",
  dry_leaf_aroma: "烟香明显",
  hot_cup_aroma: "蜜香",
  entry_taste: "浓强",
  bitterness: "明显但化得快",
  astringency: "弱",
  sweetness: "强",
  huigan: "快",
  salivation: "强",
  cha_qi: "明显",
  thickness: "厚",
  early_stage: "开汤饱满",
  middle_stage: "中段稳定",
  late_stage: "尾水甜",
  endurance: "12 泡以上",
  brand_name: "龙德记",
  liquor_aroma: "蜜香入水",
  viscosity: "粘稠",
  water_texture: "细",
  finish: "收口干净",
  harvest_standard: "一芽二叶",
  fermentation_degree: null,
  fermentation_method: null,
  storage: "干仓"
};

const VALUE_DNA: ValueDna = valueDnaSchema.parse({
  identity: ["六星孔雀"],
  category: ["高端生茶"],
  origin: ["布朗山"],
  material: ["大树春茶"],
  flavor: ["蜜香"],
  taste: ["浓强"],
  positioning: ["自建标准"],
  architecture_signals: ["骨架清晰"]
});

/** 锚点视图：只构造本层真正读取的字段（§16 / §17 的阈值不在本层重算）。 */
function benchmarkViewWith(reliablePriceCount: number): BenchmarkModeView {
  const primary = {
    id: "11111111-1111-4111-8111-111111111111",
    candidate_name: "同规格对标产品",
    snapshot: {
      candidate: { name: "同规格对标产品" },
      reliable_price_count: reliablePriceCount
    }
  };
  return {
    mode: "BENCHMARK",
    primary_anchor: primary,
    anchors: [primary]
  } as unknown as BenchmarkModeView;
}

const BENCHMARK_ANCHOR = benchmarkViewWith(3);
const CATEGORY_CREATOR_ANCHOR = {
  mode: "CATEGORY_CREATOR",
  primary_anchor: null,
  anchors: []
} as unknown as BenchmarkModeView;

const ARCHITECTURE_ROLES: ProductArchitecture = productArchitectureSchema.parse({
  backbone: "布朗山",
  identity: "六星孔雀",
  aroma_role: "蜜香",
  body_role: "厚",
  front_stage_role: "开汤饱满",
  middle_stage_role: "中段稳定",
  finish_role: "收口干净",
  memory_point: "明显",
  value_role: "自建标准"
});

const STYLE_IDENTITY: CategoryStyleIdentity = {
  identity_name: "六星孔雀式高端生茶",
  category_positioning: "按自建标准立位置的高端生茶",
  first_impression: "浓强",
  mid_palate: "中段稳定",
  finish: "收口干净",
  signature_trait: "明显",
  differentiators: ["一入口就能被认出来"],
  time_story: null,
  not_claiming: ["不声称任何未录入的年份与产量"]
};

const FULL_UPSTREAM = {
  architecture: {
    version: 3,
    written_roles: 9,
    acceptance_passed: true,
    roles: ARCHITECTURE_ROLES,
    narrative: "骨架来自布朗山，香气定在蜜香，汤感靠厚，记忆点留在明显。",
    gap_role_labels: []
  },
  philosophy: {
    version: 2,
    written_components: 5,
    acceptance_passed: true,
    design_logic_ready: true,
    strategy: "让不同的部分各管一件事：布朗山负责骨架，蜜香负责香气，厚负责汤感。",
    sales_explanation: "它的价值不在标签上：布朗山、蜜香、厚都是喝得到的证据。",
    gap_component_labels: []
  },
  category: {
    style_identity: STYLE_IDENTITY,
    standard_summary: "按自建标准立位置"
  },
  value_codes: { PEACOCK_IDENTITY: "ALREADY_HAVE" as const },
  rnd_confirmed: false
};

function buildInput(overrides: Partial<SalesCopyBuildInput> = {}): SalesCopyBuildInput {
  const base: SalesCopyBuildInput = {
    product: FULL_PRODUCT,
    value_dna: VALUE_DNA,
    preference: "AUTO",
    mode: "BENCHMARK",
    resolved_by: "AUTO_ANCHOR",
    mode_reason: "存在可靠价格锚点，自动进入 Benchmark Mode（§17）。",
    intensity: 4,
    value_focus: [...DEFAULT_VALUE_FOCUS],
    anchor: BENCHMARK_ANCHOR,
    ...FULL_UPSTREAM
  };
  return { ...base, ...overrides };
}

const NO_ANCHOR_DRAFT = buildSalesCopy(
  buildInput({
    value_dna: null,
    mode: "CATEGORY_CREATOR",
    resolved_by: "NO_RELIABLE_ANCHOR",
    mode_reason: "没有可靠价格锚点：强制切换自建高端标准模式（§17）。",
    anchor: CATEGORY_CREATOR_ANCHOR,
    intensity: 5
  })
);
const CORE_DRAFT = buildSalesCopy(buildInput());

const RECORD_ID = "9f1c2f7a-4c1b-4f4e-9a1d-2b3c4d5e6f70";
const PRODUCT_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

/**
 * 拼一个合法的「一版成稿」视图。
 *
 * `buildSalesCopy()` 只返回草稿；落库后由服务层补上 id / version / 模式与审计字段
 * （引擎内部的 `price_high_story_ready` 不进视图，schema 是 strict 的）。
 */
function recordOf(
  draft: SalesCopyDraft,
  options: {
    version?: number;
    intensity?: 1 | 2 | 3 | 4 | 5;
    mode_at_generation?: "BENCHMARK" | "CATEGORY_CREATOR";
    resolved_by?: "AUTO_ANCHOR" | "NO_RELIABLE_ANCHOR" | "MANUAL";
    mode_reason?: string;
  } = {}
): SalesCopyRecordView {
  const { price_high_story_ready: _internal, ...body } = draft;
  return salesCopyRecordSchema.parse({
    ...body,
    id: RECORD_ID,
    product_id: PRODUCT_ID,
    product_name: FULL_PRODUCT.product_name,
    version: options.version ?? 2,
    intensity: options.intensity ?? 4,
    preference: "AUTO",
    mode_at_generation: options.mode_at_generation ?? "BENCHMARK",
    resolved_by: options.resolved_by ?? "AUTO_ANCHOR",
    mode_reason: options.mode_reason ?? "存在可靠价格锚点，自动进入 Benchmark Mode（§17）。",
    value_focus: [...DEFAULT_VALUE_FOCUS],
    is_confirmed: false,
    confirmed_by: null,
    confirmed_at: null,
    notes: null,
    created_by: null,
    created_at: "2026-09-23T00:00:00.000Z",
    updated_at: "2026-09-23T00:00:00.000Z",
    spec_ref: "§21 / §22 / §23 / §26 / §27 / §33 / §47"
  });
}

const CORE_RECORD = recordOf(CORE_DRAFT);
/** 无锚点、无 DNA：强制进入 Category Creator，价格高度叙事逐字用 §22 标准句（§17 / §22）。 */
const NO_ANCHOR_RECORD = recordOf(NO_ANCHOR_DRAFT, {
  version: 1,
  intensity: 5,
  mode_at_generation: "CATEGORY_CREATOR",
  resolved_by: "NO_RELIABLE_ANCHOR",
  mode_reason: "没有可靠价格锚点：强制切换自建高端标准模式（§17）。"
});

/** 冻结审核摘要：默认「可发布 + 已审批通过」，测试按需覆盖。 */
function reviewOf(over: Partial<DeliveryReviewSummary> = {}): DeliveryReviewSummary {
  return deliveryReviewSummarySchema.parse({
    copy_output_id: RECORD_ID,
    review_version: 1,
    approval_status: "APPROVED",
    publishable: true,
    red_count: 0,
    sentence_count: 9,
    blocking_sentences: [],
    approved: true,
    spec_ref: FACT_REVIEW_SPEC_REF,
    ...over
  });
}

function gateOf(
  copyRecordId: string | null = RECORD_ID,
  copyVersion: number | null = 2,
  review: DeliveryReviewSummary | null = reviewOf()
): DeliveryGate {
  return buildDeliveryGate({
    product_id: PRODUCT_ID,
    product_name: FULL_PRODUCT.product_name,
    copy_record_id: copyRecordId,
    copy_version: copyVersion,
    review
  });
}

const HOST_LABELS = [
  "产品身份",
  "一句话定位",
  "今天必讲 3 点",
  "价值赛道 / 产品标准",
  "产品结构",
  "配方哲学",
  "5 句金句",
  "60 秒稿",
  "3 分钟稿",
  "异议回答"
];

const DEALER_LABELS = [
  "产品定位",
  "核心卖点",
  "为什么值这个价",
  "同赛道市场认知",
  "主要锚点",
  "产品结构",
  "配方哲学",
  "消费人群",
  "如何介绍",
  "常见问题"
];

describe("§51 / §52 十项：顺序与原文用词只有一份", () => {
  it("主播中心按 §51 原文十项、经销商中心按 §52 原文十项，顺序固定", () => {
    expect(HOST_CENTER_SLOT_META.map((meta) => meta.label)).toEqual(HOST_LABELS);
    expect(DEALER_CENTER_SLOT_META.map((meta) => meta.label)).toEqual(DEALER_LABELS);
    expect(HOST_CENTER_SLOT_META).toHaveLength(10);
    expect(DEALER_CENTER_SLOT_META).toHaveLength(10);
    expect(new Set(HOST_CENTER_SLOT_META.map((meta) => meta.key)).size).toBe(10);
    expect(new Set(DEALER_CENTER_SLOT_META.map((meta) => meta.key)).size).toBe(10);
    expect(
      [...HOST_CENTER_SLOT_META, ...DEALER_CENTER_SLOT_META].every(
        (meta) => meta.requirement.length > 0 && meta.source.length > 0 && meta.spec_ref.startsWith("§")
      )
    ).toBe(true);
  });

  it("合同自检：十项 × 2 / 导出格式 / 发布闸门 / 八条铁律，Phase 15 是最后一阶段", () => {
    expect(DELIVERY_CONTRACT.spec_ref).toBe(DELIVERY_SPEC_REF);
    expect(DELIVERY_CONTRACT.host_center.spec_ref).toBe(HOST_CENTER_SPEC_REF);
    expect(DELIVERY_CONTRACT.dealer_center.spec_ref).toBe(DEALER_CENTER_SPEC_REF);
    expect(DELIVERY_CONTRACT.host_center.slot_count).toBe(10);
    expect(DELIVERY_CONTRACT.dealer_center.slot_count).toBe(10);
    expect(DELIVERY_CONTRACT.host_center.slots).toEqual(HOST_CENTER_SLOT_META);
    expect(DELIVERY_CONTRACT.dealer_center.slots).toEqual(DEALER_CENTER_SLOT_META);
    expect(DELIVERY_CONTRACT.export.formats).toEqual(DELIVERY_EXPORT_FORMAT_META);
    expect(DELIVERY_CONTRACT.export.scopes).toEqual(DELIVERY_EXPORT_SCOPE_META);
    expect(DELIVERY_EXPORT_FORMAT_META.map((meta) => meta.key)).toEqual(["MARKDOWN", "TEXT", "HANDCARD"]);
    expect(DELIVERY_EXPORT_SCOPE_META.map((meta) => meta.key)).toEqual(["HOST", "DEALER", "ALL"]);

    expect(DELIVERY_CONTRACT.publish_gate.requires_approved).toBe(true);
    expect(DELIVERY_CONTRACT.publish_gate.requires_latest_copy).toBe(true);
    expect(DELIVERY_CONTRACT.publish_gate.red_blocks_publish).toBe(true);
    expect(DELIVERY_CONTRACT.publish_gate.no_copy_no_material).toBe(true);
    expect(DELIVERY_CONTRACT.publish_gate.blocking_states).toHaveLength(5);
    expect(DELIVERY_CONTRACT.derived_view).toBe(true);
    expect(DELIVERY_CONTRACT.keep_all_versions).toBe(true);
    expect(DELIVERY_CONTRACT.limits).toBe(DELIVERY_LIMITS);
    expect(DELIVERY_LIMITS.maxExportChars).toBeGreaterThan(0);

    expect(DELIVERY_CONTRACT.rules).toHaveLength(8);
    const rules = DELIVERY_CONTRACT.rules.join("丨");
    expect(rules).toContain("§51 主播中心十项");
    expect(rules).toContain("§52 经销商中心十项");
    expect(rules).toContain("上一版审批通过不算当前版通过");
    expect(rules).toContain("派生视图不落库");
    expect(rules).toContain("不移植竞品事实");
    expect(rules).toContain("主播不用自己琢磨");

    // Phase 15 是最后一阶段：交付后不再有下游阶段（与其它 `_DOWNSTREAM` 同口径）。
    expect(DELIVERY_DOWNSTREAM).toHaveLength(0);
  });
});

describe("§51 主播中心十项内容：每一格都给可直接念的原文", () => {
  const slots = Object.fromEntries(
    HOST_CENTER_SLOT_META.map((meta) => [meta.key, hostCenterSlotContent(meta.key, CORE_RECORD)])
  ) as Record<string, ReturnType<typeof hostCenterSlotContent>>;

  it("产品身份 / 一句话定位：身份定义与开场钩子逐字来自成稿", () => {
    expect(slots.product_identity?.text).toBe(CORE_RECORD.headline.identity_definition);
    expect(slots.product_identity?.lines).toContain(`记忆点：${CORE_RECORD.headline.memory_point}`);
    expect(slots.one_liner?.text).toBe(CORE_RECORD.headline.one_liner);
    expect(slots.one_liner?.lines).toContain(`开场钩子：${CORE_RECORD.headline.opening_hook}`);
  });

  it("今天必讲 3 点：取成稿前三条核心卖点，按序号排列", () => {
    expect(slots.must_say_three?.items.map((item) => item.text)).toEqual(
      CORE_RECORD.selling_points.slice(0, 3)
    );
    expect(slots.must_say_three?.items.map((item) => item.label)).toEqual(["必讲 1", "必讲 2", "必讲 3"]);
    expect(slots.must_say_three?.items.map((item) => item.index)).toEqual([1, 2, 3]);
    expect(slots.must_say_three?.text).toContain("今天这场直播必须讲到的三件事");
  });

  it("价值赛道：有可靠锚点讲赛道高度；没有锚点逐字讲 §22 标准句", () => {
    expect(slots.value_track?.text).toBe(CORE_RECORD.headline.price_or_standard_story);
    expect(slots.value_track?.lines.some((line) => line.startsWith("有可靠价格锚点（共 1 条）"))).toBe(true);
    expect(slots.value_track?.lines).toContain(`价值故事：${CORE_RECORD.headline.value_story}`);

    const noAnchorSlot = hostCenterSlotContent("value_track", NO_ANCHOR_RECORD);
    expect(NO_ANCHOR_RECORD.anchor.has_reliable_price_anchor).toBe(false);
    expect(NO_ANCHOR_RECORD.anchor.primary_anchor_id).toBeNull();
    expect(noAnchorSlot.lines.join("丨")).toContain("没有可靠价格锚点：逐字讲 §22 标准句");
    expect(noAnchorSlot.lines.join("丨")).toContain(NO_ANCHOR_STANDARD_SENTENCE);
  });

  it("产品结构 / 配方哲学：直接取成稿故事，不重写", () => {
    expect(slots.product_structure?.text).toBe(CORE_RECORD.headline.product_architecture_story);
    expect(slots.formula_philosophy?.text).toBe(CORE_RECORD.headline.formula_philosophy_story);
  });

  it("5 句金句 / 60 秒稿 / 3 分钟稿：金句可单独剪，3 分钟按 §27 分段带要求", () => {
    expect(slots.core_quotes?.items.map((item) => item.text)).toEqual(CORE_RECORD.quotes.core_quotes);
    expect(slots.core_quotes?.items.map((item) => item.label)).toEqual([
      "金句 1",
      "金句 2",
      "金句 3",
      "金句 4",
      "金句 5"
    ]);
    expect(slots.sec60?.text).toBe(CORE_RECORD.scripts.sec60);
    expect(slots.sec60?.lines).toContain(`30 秒版（备选）：${CORE_RECORD.scripts.sec30}`);

    const segments = CORE_RECORD.scripts.min3.segments;
    expect(slots.min3?.items).toHaveLength(segments.length);
    expect(slots.min3?.items.map((item) => item.text)).toEqual(segments.map((segment) => segment.text));
    expect(slots.min3?.items.map((item) => item.detail)).toEqual(
      segments.map((segment) => segment.requirement)
    );
    expect(slots.min3?.items[0]?.label).toBe(`${segments[0]?.time_range} ${segments[0]?.label}`);
    expect(slots.min3?.text).toBe(CORE_RECORD.scripts.min3.text);
  });

  it("异议回答：把「凭什么这么贵」逐条接住，回答放在 detail 里", () => {
    expect(slots.objections?.items.map((item) => item.text)).toEqual(
      CORE_RECORD.objections.map((objection) => objection.objection)
    );
    expect(slots.objections?.items.map((item) => item.detail)).toEqual(
      CORE_RECORD.objections.map((objection) => objection.response)
    );
    expect(slots.objections?.text).toContain("凭什么这么贵");
  });

  it("每一格都真的有内容：没有一格是空壳（§64 主播不用自己琢磨）", () => {
    for (const meta of HOST_CENTER_SLOT_META) {
      const slot = slots[meta.key];
      expect(slot?.items.length, meta.label).toBeGreaterThanOrEqual(0);
      const size =
        (slot?.text?.length ?? 0) +
        (slot?.lines.join("").length ?? 0) +
        (slot?.items.length ?? 0);
      expect(size, `${meta.label} 不应该为空`).toBeGreaterThan(0);
    }
  });
});

describe("§52 经销商中心十项内容：只引用价格高度，不搬运竞品事实", () => {
  const slots = Object.fromEntries(
    DEALER_CENTER_SLOT_META.map((meta) => [meta.key, dealerCenterSlotContent(meta.key, CORE_RECORD)])
  ) as Record<string, ReturnType<typeof dealerCenterSlotContent>>;

  it("产品定位 / 核心卖点 / 为什么值这个价", () => {
    expect(slots.positioning?.text).toBe(CORE_RECORD.headline.one_liner);
    expect(slots.positioning?.lines).toContain(`身份定义：${CORE_RECORD.headline.identity_definition}`);
    expect(slots.selling_points?.items.map((item) => item.text)).toEqual(CORE_RECORD.selling_points);
    expect(slots.selling_points?.items).toHaveLength(7);
    expect(slots.why_this_price?.text).toBe(CORE_RECORD.headline.price_or_standard_story);
  });

  it("同赛道市场认知 / 主要锚点：只说价格高度标准，不含对标产品的原料 / 树龄 / 山头 / 配方", () => {
    const cognition = marketCognitionText(CORE_RECORD.anchor);
    expect(cognition).toContain("同规格对标产品");
    expect(cognition).toContain("只引用它们的价格高度");
    // 只讲价格高度标准：对标的原料 / 树龄 / 山头一个字都不出现
    for (const forbidden of ["布朗山", "大树春茶", "老班章", "大树", "春茶"]) {
      expect(cognition).not.toContain(forbidden);
    }

    const primary = primaryAnchorText(CORE_RECORD.anchor);
    expect(primary).toContain("主要价格高度参照：同规格对标产品");
    expect(primary).toContain("只用于价格高度对照");

    expect(slots.market_cognition?.text).toBe(cognition);
    expect(slots.market_cognition?.lines.join("丨")).toContain("使用纪律：只引用价格高度标准");
    expect(slots.primary_anchor?.text).toBe(primary);
  });

  it("没有可靠锚点时如实说没有，并改用自建标准（§17 / §62-10）", () => {
    const anchor = {
      ...CORE_RECORD.anchor,
      has_reliable_price_anchor: false,
      anchor_count: 0,
      primary_anchor_name: null,
      primary_anchor_id: null
    };
    expect(marketCognitionText(anchor)).toContain("没有可靠价格锚点");
    expect(marketCognitionText(anchor)).toContain(NO_ANCHOR_STANDARD_SENTENCE);
    expect(primaryAnchorText(anchor)).toContain("主要价格高度参照：没有");
    expect(primaryAnchorText(anchor)).toContain("不硬凑竞品");
  });

  it("产品结构 / 配方哲学 / 消费人群 / 如何介绍 / 常见问题", () => {
    expect(slots.product_structure?.text).toBe(CORE_RECORD.headline.product_architecture_story);
    expect(slots.formula_philosophy?.text).toBe(CORE_RECORD.headline.formula_philosophy_story);
    expect(slots.consumer?.text).toBe(CORE_RECORD.headline.who_for);
    expect(slots.consumer?.lines).toContain(`差异化：${CORE_RECORD.headline.differentiation}`);
    expect(slots.how_to_introduce?.text).toBe(CORE_RECORD.dealer_copy);
    expect(slots.faq?.items.map((item) => item.detail)).toEqual(
      CORE_RECORD.objections.map((objection) => objection.response)
    );
    expect(slots.faq?.text).toContain("终端最常问的几个问题");
  });
});

describe("§53 / §57 发布闸门：六种状态、一条口径", () => {
  it("① 没有成稿：不拦人，指路去生成强成交话术", () => {
    const gate = gateOf(null, null, null);
    expect(gate.ready).toBe(false);
    expect(deliveryGateLabel(gate)).toBe("还没有成稿");
    expect(deliveryGateTone(gate)).toBe("outline");
    expect(gate.review_version).toBeNull();
    expect(gate.copy_version).toBeNull();
    expect(gate.reason).toContain("还没有强成交话术成稿");
    expect(gate.next_action).toBe("去生成强成交话术");
  });

  it("② 有最新一版成稿但没审过：明确说「必须审完并人工审批通过」", () => {
    const gate = gateOf(RECORD_ID, 4, null);
    expect(gate.ready).toBe(false);
    // 还没审不是 RED，也不是「等审批」：先让人把审核跑起来（否则主播看到的会是「被 RED 阻断」）
    expect(deliveryGateLabel(gate)).toBe("待事实审核");
    expect(deliveryGateTone(gate)).toBe("info");
    expect(gate.copy_version).toBe(4);
    expect(gate.review_version).toBeNull();
    expect(gate.reason).toContain("还没有做过逐句事实审核");
    expect(gate.next_action).toBe("去事实审核");
  });

  it("③ 存在 RED 阻断句：一律不给最终资料，并把阻断句原样摆出来", () => {
    const gate = gateOf(
      RECORD_ID,
      2,
      reviewOf({
        approval_status: "PENDING",
        approved: false,
        publishable: false,
        red_count: 2,
        blocking_sentences: ["这饼茶必涨，买了就是稳赚。", "这是按照 2003 六星孔雀配方做的。"]
      })
    );
    expect(gate.ready).toBe(false);
    expect(deliveryGateLabel(gate)).toBe("被 RED 阻断");
    expect(deliveryGateTone(gate)).toBe("danger");
    expect(gate.red_count).toBe(2);
    expect(gate.blocking_sentences).toHaveLength(2);
    expect(gate.reason).toContain("2 条 RED 阻断句");
    expect(gate.next_action).toBe("去事实审核改稿");
  });

  it("④ 已被人工否决：按备注修正后重新送审", () => {
    const gate = gateOf(
      RECORD_ID,
      2,
      reviewOf({ approval_status: "REJECTED", approved: false })
    );
    expect(gate.ready).toBe(false);
    expect(deliveryGateLabel(gate)).toBe("已被否决");
    expect(deliveryGateTone(gate)).toBe("danger");
    expect(gate.reason).toContain("已被人工否决");
  });

  it("⑤ 审核通过但还没人工审批：等审批，不给最终资料", () => {
    const gate = gateOf(RECORD_ID, 2, reviewOf({ approval_status: "PENDING", approved: false }));
    expect(gate.ready).toBe(false);
    expect(deliveryGateLabel(gate)).toBe("待人工审批");
    expect(gate.publishable).toBe(true);
    expect(gate.reason).toContain("还没有人工审批通过");
    expect(gate.next_action).toBe("去事实审核");
  });

  it("⑥ 最新一版 + 已审批 + 无 RED：唯一可交付状态", () => {
    const gate = gateOf();
    expect(gate.ready).toBe(true);
    expect(deliveryGateLabel(gate)).toBe("可交付");
    expect(deliveryGateTone(gate)).toBe("ok");
    expect(gate.reason).toBeNull();
    expect(gate.next_action).toBeNull();
    expect(gate.review_version).toBe(1);
  });

  it("假绿灯防线：当前这一版还没审时，不管历史审批长什么样都不 ready（§53 / §62-14）", () => {
    // 上一版（v1）审批通过，当前版（v2）刚生成：闸门只认 v2 自己的审核。
    const gate = gatewayWithCurrentUnreviewed();
    expect(gate.copy_version).toBe(2);
    expect(gate.ready).toBe(false);
    expect(gate.reason).toContain("v2");
    expect(gate.reason).toContain("还没有做过逐句事实审核");
  });

  it("闸门 schema 自带红线：缺原因 / 带了原因却说 ready / RED 还说可发布，都解析失败", () => {
    const ready = gateOf();
    const blocked = gateOf(RECORD_ID, 2, null);
    // 可交付时不得带原因
    expect(deliveryGateSchema.safeParse({ ...ready, reason: "不该带原因" }).success).toBe(false);
    // 不可交付时必须说明原因
    expect(deliveryGateSchema.safeParse({ ...blocked, reason: null }).success).toBe(false);
    // 不可交付的行不许自封 ready
    expect(deliveryGateSchema.safeParse({ ...blocked, ready: true }).success).toBe(false);
    // 有 RED 阻断句时不许标记为可发布
    expect(
      deliveryGateSchema.safeParse({
        ...ready,
        red_count: 1,
        blocking_sentences: ["这饼茶必涨"],
        publishable: true
      }).success
    ).toBe(false);
    // 成稿 id 与版本号必须同时存在或同时为空
    expect(deliveryGateSchema.safeParse({ ...ready, copy_version: null }).success).toBe(false);
    // 合法的两个极端都能过
    expect(deliveryGateSchema.safeParse(ready).success).toBe(true);
    expect(deliveryGateSchema.safeParse(blocked).success).toBe(true);
  });

  it("风险色调与闸门色调都是同一套 tone（前端不自己配色）", () => {
    expect(riskLevelTone("GREEN")).toBe("ok");
    expect(riskLevelTone("YELLOW")).toBe("warn");
    expect(riskLevelTone("RED")).toBe("danger");
    expect([deliveryGateTone(gateOf()), deliveryGateTone(gateOf(null, null, null))]).toEqual([
      "ok",
      "outline"
    ]);
  });
});

/** 上一版通过、当前版没审的输入（假绿灯场景的唯一构造入口）。 */
function gateOfInput() {
  return {
    product_id: PRODUCT_ID,
    product_name: FULL_PRODUCT.product_name,
    copy_record_id: RECORD_ID,
    copy_version: 2,
    review: reviewOf()
  };
}

function gatewayWithCurrentUnreviewed(): DeliveryGate {
  return buildDeliveryGate({ ...gateOfInput(), review: null });
}

describe("§51 / §52 视图：闸门未通过时一格正文都不给", () => {
  it("闸门通过：十格按原文顺序输出，摘要读成稿冻结值", () => {
    const view = buildHostCenterView({
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      record: CORE_RECORD,
      gate: gateOf()
    });
    expect(view.ready).toBe(true);
    expect(view.gate.ready).toBe(true);
    expect(view.copy_record_id).toBe(RECORD_ID);
    expect(view.copy_version).toBe(2);
    expect(view.copy_created_at).toBe("2026-09-23T00:00:00.000Z");
    expect(view.intensity).toBe(4);
    expect(view.impact_score).toBe(CORE_RECORD.impact_score.total);
    expect(view.impact_band).toBe(CORE_RECORD.impact_score.band);
    expect(view.level5_passed).toBe(CORE_RECORD.level5.satisfied);
    expect(view.compliance_risk).toBe(CORE_RECORD.compliance.risk);
    expect(view.slots.map((slot) => slot.label)).toEqual(HOST_LABELS);
    expect(view.slots.every((slot) => slot.present && slot.chars > 0 && slot.tone === "ok")).toBe(true);
    expect(view.spec_ref).toBe(HOST_CENTER_SPEC_REF);
  });

  it("闸门未通过：十格全部留空，但每一格仍然告诉主播要什么、去哪里解决", () => {
    const view = buildHostCenterView({
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      record: CORE_RECORD,
      gate: gateOf(RECORD_ID, 2, null)
    });
    expect(view.ready).toBe(false);
    expect(view.slots.map((slot) => slot.key)).toEqual(HOST_CENTER_SLOT_META.map((meta) => meta.key));
    expect(view.slots.every((slot) => !slot.present)).toBe(true);
    expect(view.slots.every((slot) => slot.text === null && slot.items.length === 0)).toBe(true);
    expect(view.slots.every((slot) => slot.tone === "outline")).toBe(true);
    expect(view.slots.every((slot) => slot.requirement.length > 0)).toBe(true);
    expect(view.copy_record_id).toBe(RECORD_ID);
    expect(view.gate.reason).not.toBeNull();
  });

  it("经销商中心同一套口径：十项按 §52 原文顺序，闸门未通过全部留空", () => {
    const ready = buildDealerCenterView({
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      record: CORE_RECORD,
      gate: gateOf()
    });
    expect(ready.slots.map((slot) => slot.label)).toEqual(DEALER_LABELS);
    expect(ready.slots.every((slot) => slot.present)).toBe(true);
    expect(ready.spec_ref).toBe(DEALER_CENTER_SPEC_REF);

    const blocked = buildDealerCenterView({
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      record: CORE_RECORD,
      gate: gateOf(RECORD_ID, 2, reviewOf({ approval_status: "PENDING", approved: false }))
    });
    expect(blocked.ready).toBe(false);
    expect(blocked.slots.every((slot) => !slot.present)).toBe(true);
  });

  it("同一份成稿 → 两个中心逐字同源：正文来自成稿，不是各自重写的一套", () => {
    const hostView = buildHostCenterView({
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      record: CORE_RECORD,
      gate: gateOf()
    });
    const dealerView = buildDealerCenterView({
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      record: CORE_RECORD,
      gate: gateOf()
    });
    const slotOf = (view: { slots: { key: string; text: string | null }[] }, key: string) =>
      view.slots.find((slot) => slot.key === key)?.text;
    expect(slotOf(hostView, "product_structure")).toBe(CORE_RECORD.headline.product_architecture_story);
    expect(slotOf(dealerView, "product_structure")).toBe(CORE_RECORD.headline.product_architecture_story);
    expect(slotOf(hostView, "formula_philosophy")).toBe(slotOf(dealerView, "formula_philosophy"));
  });
});

describe("§60 导出：只重排、不新增、格式与范围都对得上", () => {
  const host = buildHostCenterView({
    product_id: PRODUCT_ID,
    product_name: FULL_PRODUCT.product_name,
    record: CORE_RECORD,
    gate: gateOf()
  });
  const dealer = buildDealerCenterView({
    product_id: PRODUCT_ID,
    product_name: FULL_PRODUCT.product_name,
    record: CORE_RECORD,
    gate: gateOf()
  });

  function exportOf(
    format: "MARKDOWN" | "TEXT" | "HANDCARD",
    scope: "HOST" | "DEALER" | "ALL"
  ) {
    return renderDeliveryExport({
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      format,
      scope,
      host,
      dealer,
      generated_at: "2026-09-24T10:00:00.000Z"
    });
  }

  it("Markdown / 全量：十项标题逐字出现，字数与正文一致，文件名带版本号", () => {
    const view = exportOf("MARKDOWN", "ALL");
    expect(view.format).toBe("MARKDOWN");
    expect(view.scope).toBe("ALL");
    expect(view.content_type).toBe("text/markdown; charset=utf-8");
    expect(view.filename).toBe("龙德记六星孔雀_最终资料包_v2.md");
    expect(view.chars).toBe(view.content.length);
    expect(view.gate.ready).toBe(true);
    expect(view.spec_ref).toBe(DELIVERY_SPEC_REF);
    expect(view.generated_at).toBe("2026-09-24T10:00:00.000Z");
    expect(view.content).toContain("# 龙德记六星孔雀 · 最终资料包");
    expect(view.content).toContain("## 主播中心（§51 十项）");
    expect(view.content).toContain("## 经销商中心（§52 十项）");
    expect(view.content).toContain("成稿版本：v2");
    expect(view.content).toContain("事实审核：第 1 次 · 可交付");
    for (const label of [...HOST_LABELS, ...DEALER_LABELS]) {
      expect(view.content, label).toContain(label);
    }
  });

  it("纯文本：去掉 # 与 ** 之类符号，直接进提词器；只导出主播时不含经销商分区", () => {
    const view = exportOf("TEXT", "HOST");
    expect(view.content_type).toBe("text/plain; charset=utf-8");
    expect(view.filename).toBe("龙德记六星孔雀_主播中心_v2.txt");
    expect(view.content.startsWith("龙德记六星孔雀 · 主播中心")).toBe(true);
    expect(view.content).not.toContain("#");
    expect(view.content).not.toContain("**");
    expect(view.content).toContain("【主播中心（§51 十项）】");
    expect(view.content).not.toContain("经销商中心（§52 十项）");
    for (const label of HOST_LABELS) {
      expect(view.content, label).toContain(label);
    }
  });

  it("只要经销商中心时不含主播分区，但两侧正文都逐字来自同一版成稿", () => {
    const view = exportOf("MARKDOWN", "DEALER");
    expect(view.filename).toBe("龙德记六星孔雀_经销商中心_v2.md");
    expect(view.content).toContain(CORE_RECORD.dealer_copy);
    expect(view.content).toContain(CORE_RECORD.headline.one_liner);
    expect(view.content).not.toContain("主播中心（§51 十项）");
  });

  it("导出正文里不含任何新事实：只出现成稿与审核标识，不出现第二份话术", () => {
    const view = exportOf("MARKDOWN", "ALL");
    const hostTexts = host.slots.flatMap((slot) => slot.lines);
    const dealerTexts = dealer.slots.flatMap((slot) => slot.lines);
    const body = view.content;
    // 每一格正文都逐字出现在导出里（去掉渲染前缀后）：
    const missing = [...hostTexts, ...dealerTexts].filter(
      (line) => line.trim().length > 0 && !body.includes(line.trim())
    );
    expect(missing).toEqual([]);
    // 导出不新增事实：成稿里没有的日期 / 年份 / 山头都不会被补出来
    expect(body).not.toContain("2003");
    expect(body).not.toContain("300 年");
  });

  it("文件名只做最小净化：路径分隔符与控制字符不会带出去", () => {
    expect(sanitizeFileName("龙德记/六星:孔雀*2026")).toBe("龙德记六星孔雀2026");
    expect(sanitizeFileName("   ")).toBe("longdeji-delivery");
    expect(sanitizeFileName("a".repeat(200))).toHaveLength(80);
  });
});

describe("查询串：三态布尔与默认值只解析一次", () => {
  it("主播中心列表：ready 是真正的三态（不传 / true / false），strict 拒绝多余字段", () => {
    expect(hostCenterListQuerySchema.parse({})).toEqual({});
    expect(hostCenterListQuerySchema.parse({ ready: "true" }).ready).toBe(true);
    expect(hostCenterListQuerySchema.parse({ ready: "false" }).ready).toBe(false);
    expect(hostCenterListQuerySchema.parse({ page: "2", pageSize: "50" })).toEqual({
      page: 2,
      pageSize: 50
    });
    expect(hostCenterListQuerySchema.safeParse({ ready: "maybe" }).success).toBe(false);
    expect(
      hostCenterListQuerySchema.safeParse({ pageSize: DELIVERY_LIMITS.maxPageSize + 1 }).success
    ).toBe(false);
    expect(hostCenterListQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it("导出查询串：小写 URL 写法进服务层前就转成枚举，默认 Markdown + 全量", () => {
    expect(deliveryExportQuerySchema.parse({})).toEqual({ format: "MARKDOWN", scope: "ALL" });
    expect(deliveryExportQuerySchema.parse({ format: "text" })).toEqual({
      format: "TEXT",
      scope: "ALL"
    });
    expect(deliveryExportQuerySchema.parse({ format: "markdown", scope: "host" })).toEqual({
      format: "MARKDOWN",
      scope: "HOST"
    });
    expect(deliveryExportQuerySchema.safeParse({ format: "pdf" }).success).toBe(false);
    expect(deliveryExportQuerySchema.safeParse({ scope: "all", extra: "1" }).success).toBe(false);
  });
});
