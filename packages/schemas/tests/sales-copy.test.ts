import { describe, expect, it } from "vitest";
import {
  COPY_INTENSITY_META,
  DEFAULT_COPY_INTENSITY,
  DEFAULT_VALUE_FOCUS,
  IMPACT_SCORE_MAX,
  IMPACT_SCORE_META,
  INTENSIFY_ACTIONS_BY_LEVEL,
  INTENSIFY_BUTTON_META,
  INTENSIFY_SELF_CHECK_META,
  INTENSIFY_SELF_CHECK_META_BY_KEY,
  LEVEL5_REQUIREMENT_META,
  MIN3_TIMELINE,
  NO_ANCHOR_STANDARD_SENTENCE,
  SALES_COPY_AGENT9_OUTPUT_KEYS,
  SALES_COPY_CONTRACT,
  SALES_COPY_ENGINE_INFO,
  SALES_COPY_LIMITS,
  SALES_COPY_MAX_INTENSIFY_ROUNDS,
  SALES_COPY_OUTPUT_META,
  SALES_COPY_REQUIRED_SCORE,
  VALUE_FOCUS_META,
  buildSalesCopy,
  checkLevel5Requirements,
  changedElementsOf,
  impactScoreSchema,
  intensifyFactDiff,
  intensifyGuardReason,
  intensifySalesCopy,
  intensifySelfCheckOf,
  intensifySelfCheckKeys,
  intensifyTargetIntensity,
  min3SegmentKeys,
  productArchitectureSchema,
  salesCopyAnchorRefOf,
  salesCopyBodyOf,
  salesCopyCitations,
  salesCopyEvidenceGaps,
  salesCopyFactValue,
  salesCopyIntensifyResultSchema,
  salesCopyIntensifySchema,
  salesCopyOutputKeys,
  salesCopyOutputStatuses,
  salesCopyPriceStoryReady,
  salesCopyQuotableLines,
  salesCopyRefsOf,
  salesCopyTexts,
  scoreImpact,
  valueDnaSchema,
  type BenchmarkModeView,
  type CategoryStyleIdentity,
  type ImpactScore,
  type ProductArchitecture,
  type SalesCopyBuildInput,
  type SalesCopyDraft,
  type SalesCopyProductInput,
  type ValueDna
} from "../src/index.js";

/**
 * Phase 12（规格 §21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §48 / §57 / §58）。
 *
 * 这里只测「纯函数强成交话术引擎」：不碰数据库、不调用 AI
 * （Phase 12 生成 + Phase 13「再狠一点」强化都是机械规则，AI 只在 Phase 14 事实审核后接）。
 * 三条铁律——不许造事实、没有可靠价格锚点必须立标准且不许降级成平庸文案、
 * Level 5 王者稿必须过 90 分且至少 3 句可独立传播的金句。
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

/** 事实不足版：同一个产品只留名字与年份，用来验证「没录就不许把话说满」。 */
const THIN_PRODUCT: SalesCopyProductInput = {
  ...FULL_PRODUCT,
  product_name: "龙德记试样茶",
  series_name: null,
  tea_subtype: null,
  origin_province: null,
  origin_city: null,
  origin_region: null,
  mountain: null,
  village: null,
  raw_material: null,
  tree_type: null,
  tree_age: null,
  season: null,
  grade: null,
  blend_description: null,
  kill_green_method: null,
  rolling_method: null,
  drying_method: null,
  pressing_method: null,
  processing_notes: null,
  dry_leaf_aroma: null,
  hot_cup_aroma: null,
  entry_taste: null,
  bitterness: null,
  astringency: null,
  sweetness: null,
  huigan: null,
  salivation: null,
  cha_qi: null,
  thickness: null,
  early_stage: null,
  middle_stage: null,
  late_stage: null,
  endurance: null,
  brand_name: null,
  liquor_aroma: null,
  viscosity: null,
  water_texture: null,
  finish: null,
  harvest_standard: null,
  fermentation_degree: null,
  fermentation_method: null,
  storage: null
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

/**
 * 锚点视图：只构造本层真正读取的字段（mode / primary_anchor / snapshot.reliable_price_count），
 * 其余字段由锚点引擎负责，本层不重算任何阈值（§16 / §17）。
 */
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
const ANCHOR_WITHOUT_PRICE_EVIDENCE = benchmarkViewWith(0);

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

/** 上游成稿齐备版：产品结构（§5 / §45）与配方哲学（§6 / §46）都已通过验收。 */
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

const CORE_DRAFT = buildSalesCopy(buildInput());
const KING_DRAFT = buildSalesCopy(buildInput({ intensity: 5 }));

/** 无锚点、无 DNA、无上游成稿、事实不足的最坏情况：仍然不许变成说明书，也不许编事实。 */
const NO_ANCHOR_DRAFT = buildSalesCopy(
  buildInput({
    product: THIN_PRODUCT,
    value_dna: null,
    mode: "CATEGORY_CREATOR",
    resolved_by: "NO_RELIABLE_ANCHOR",
    mode_reason: "没有可靠价格锚点，按 §62-10 自动进入 Category Creator Mode。",
    anchor: CATEGORY_CREATOR_ANCHOR,
    architecture: null,
    philosophy: null,
    category: null,
    value_codes: null
  })
);

describe("强成交话术合同（§21 / §22 / §23 / §26 / §27 / §33 / §47）", () => {
  it("五档强度顺序固定，默认档位是 Level 4 直播爆款", () => {
    expect(COPY_INTENSITY_META.map((meta) => meta.level)).toEqual([1, 2, 3, 4, 5]);
    expect(COPY_INTENSITY_META.map((meta) => meta.short_label)).toEqual([
      "研究",
      "专业",
      "强势",
      "爆款",
      "王者"
    ]);
    expect(DEFAULT_COPY_INTENSITY).toBe(4);
    expect(SALES_COPY_CONTRACT.default_level).toBe(4);
    expect(COPY_INTENSITY_META.find((meta) => meta.is_king)?.level).toBe(5);
  });

  it("牛逼化按钮四档映射到 §21 强度，且最多自动增强 3 轮（§7 / §34）", () => {
    expect(INTENSIFY_BUTTON_META.map((meta) => meta.level)).toEqual(["NORMAL", "STRONG", "VIRAL", "KING"]);
    expect(INTENSIFY_BUTTON_META.map((meta) => meta.copy_intensity)).toEqual([2, 3, 4, 5]);
    expect(SALES_COPY_CONTRACT.intensify_button.max_auto_rounds).toBe(3);
    expect(SALES_COPY_CONTRACT.no_new_fact).toBe(true);
  });

  it("§23 八项权重合计 100，且只有 Level 4 / 5 有硬性门槛", () => {
    const weights = IMPACT_SCORE_META.map((meta) => meta.weight);
    expect(weights).toEqual([15, 15, 20, 15, 10, 10, 10, 5]);
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(IMPACT_SCORE_MAX);
    for (const meta of IMPACT_SCORE_META) {
      expect(meta.criteria.reduce((sum, criterion) => sum + criterion.points, 0)).toBe(meta.weight);
    }
    expect(SALES_COPY_REQUIRED_SCORE[4]).toBe(85);
    expect(SALES_COPY_REQUIRED_SCORE[5]).toBe(90);
    expect(SALES_COPY_REQUIRED_SCORE[3]).toBeUndefined();
  });

  it("§26 九种输出固定，缺一种都不算交付", () => {
    expect(salesCopyOutputKeys).toHaveLength(9);
    expect(SALES_COPY_OUTPUT_META.map((meta) => meta.key)).toEqual([...salesCopyOutputKeys]);
    expect(SALES_COPY_LIMITS.coreQuoteCount).toBe(5);
    expect(SALES_COPY_LIMITS.backupQuoteCount).toBe(20);
    expect(SALES_COPY_LIMITS.sellingPointCount).toBe(7);
  });

  it("§47 Agent 9 十五项输出顺序固定", () => {
    expect(SALES_COPY_AGENT9_OUTPUT_KEYS).toHaveLength(15);
    expect(new Set(SALES_COPY_AGENT9_OUTPUT_KEYS).size).toBe(15);
  });

  it("§27 3 分钟八段时间轴固定", () => {
    expect(min3SegmentKeys).toHaveLength(8);
    expect(MIN3_TIMELINE.map((meta) => meta.key)).toEqual([...min3SegmentKeys]);
    expect(MIN3_TIMELINE[0]?.time_range).toBe("00:00–00:15");
    expect(MIN3_TIMELINE[7]?.time_range).toBe("02:50–03:00");
  });

  it("§33 价值重点八项默认全开，§22 Level 5 七项固定", () => {
    expect(VALUE_FOCUS_META).toHaveLength(8);
    expect(DEFAULT_VALUE_FOCUS).toHaveLength(8);
    expect(LEVEL5_REQUIREMENT_META).toHaveLength(7);
    expect(LEVEL5_REQUIREMENT_META.map((meta) => meta.key)).toEqual([
      "rhetorical_question",
      "identity_definition",
      "price_height_story",
      "product_architecture_story",
      "style_identity",
      "quotable_lines",
      "closing"
    ]);
  });

  it("Phase 12 / 13 是纯规则引擎：三个 Prompt 已登记但未接线（§60）", () => {
    expect(SALES_COPY_ENGINE_INFO.ai_wired).toBe(false);
    expect(SALES_COPY_ENGINE_INFO.prompt_keys).toEqual([
      "SALES_COPYWRITER",
      "COPY_INTENSIFIER",
      "FACT_REVIEWER"
    ]);
    expect(SALES_COPY_CONTRACT.rhetoric_allowed).toBe(true);
    expect(SALES_COPY_CONTRACT.no_manual_style).toBe(true);
    expect(SALES_COPY_CONTRACT.keep_all_versions).toBe(true);
    expect(SALES_COPY_ENGINE_INFO.note).toContain("「再狠一点」（§34）已接线");
  });
});

describe("§58-8 / §58-9 / §58-10 强成交文案硬红线", () => {
  it("事实齐备 + 可靠价格锚点：Level 4 拿到满分，落在核心主播稿档（§23 / §57）", () => {
    expect(CORE_DRAFT.impact_score.total).toBe(IMPACT_SCORE_MAX);
    expect(CORE_DRAFT.impact_score.band).toBe("CORE");
    expect(CORE_DRAFT.impact_score.required).toBe(85);
    expect(CORE_DRAFT.impact_score.passed).toBe(true);
    expect(CORE_DRAFT.impact_score.facts_used).toBeGreaterThanOrEqual(SALES_COPY_LIMITS.minRecordedFacts);
    expect(CORE_DRAFT.anchor.has_reliable_price_anchor).toBe(true);
    expect(CORE_DRAFT.anchor.primary_anchor_name).toBe("同规格对标产品");
    expect(CORE_DRAFT.price_high_story_ready).toBe(true);
    expect(CORE_DRAFT.headline.price_or_standard_story).toContain("价格高度");
    expect(CORE_DRAFT.acceptance.passed).toBe(true);
    expect(CORE_DRAFT.acceptance.missing).toEqual([]);
    expect(CORE_DRAFT.compliance.risk).toBe("GREEN");
  });

  it("§22 Level 5 王者稿：七项强制全部落地且过 90 分", () => {
    expect(KING_DRAFT.impact_score.total).toBeGreaterThanOrEqual(90);
    expect(KING_DRAFT.impact_score.band).toBe("CORE");
    expect(KING_DRAFT.level5.required).toBe(true);
    expect(KING_DRAFT.level5.satisfied).toBe(true);
    expect(KING_DRAFT.level5.missing).toEqual([]);
    expect(KING_DRAFT.acceptance.level5_passed).toBe(true);
    expect(KING_DRAFT.acceptance.passed).toBe(true);
  });

  it("§58-10 至少 3 句可独立传播的金句，且金句本身不带任何硬事实负担", () => {
    const quotable = salesCopyQuotableLines([
      ...CORE_DRAFT.quotes.core_quotes,
      ...CORE_DRAFT.quotes.backup_quotes
    ]);
    expect(quotable.length).toBeGreaterThanOrEqual(SALES_COPY_LIMITS.minLevel5QuotableLines);
    expect(CORE_DRAFT.level5.requirements.find((item) => item.key === "quotable_lines")?.status).toBe("DONE");
    expect(KING_DRAFT.quotes.core_quotes).toHaveLength(SALES_COPY_LIMITS.coreQuoteCount);
    expect(KING_DRAFT.quotes.backup_quotes).toHaveLength(SALES_COPY_LIMITS.backupQuoteCount);
  });

  it("§58-9 没有可靠价格锚点：逐字改用 §22 标准句，且不许降级成平庸文案", () => {
    expect(NO_ANCHOR_DRAFT.anchor.has_reliable_price_anchor).toBe(false);
    expect(NO_ANCHOR_DRAFT.anchor.primary_anchor_id).toBeNull();
    expect(NO_ANCHOR_DRAFT.price_high_story_ready).toBe(false);
    expect(NO_ANCHOR_DRAFT.headline.price_or_standard_story).toBe(NO_ANCHOR_STANDARD_SENTENCE);
    // 标准句本身也是「价格高度叙事」这一项的合格交付（§22 允许的唯一替代）
    expect(NO_ANCHOR_DRAFT.level5.requirements.find((item) => item.key === "price_height_story")?.status).toBe(
      "DONE"
    );
    // 不降级：开场仍然是强反问，身份 / 结构 / 画面 / 记忆点 / 收口一格都不许空着
    expect(NO_ANCHOR_DRAFT.headline.opening_hook).toMatch(/[？?]/);
    expect(NO_ANCHOR_DRAFT.headline.opening_hook).not.toMatch(/(说明书|参数|规格如下|指标如下|本品)/);
    for (const field of [
      NO_ANCHOR_DRAFT.headline.one_liner,
      NO_ANCHOR_DRAFT.headline.identity_definition,
      NO_ANCHOR_DRAFT.headline.value_story,
      NO_ANCHOR_DRAFT.headline.product_architecture_story,
      NO_ANCHOR_DRAFT.headline.style_identity,
      NO_ANCHOR_DRAFT.headline.differentiation,
      NO_ANCHOR_DRAFT.headline.imagery,
      NO_ANCHOR_DRAFT.headline.memory_point,
      NO_ANCHOR_DRAFT.headline.who_for,
      NO_ANCHOR_DRAFT.headline.closing
    ]) {
      expect(field.trim().length).toBeGreaterThan(0);
    }
    // 事实不足只压分，不把文案退化成 REWRITE 档
    expect(NO_ANCHOR_DRAFT.impact_score.total).toBeGreaterThanOrEqual(70);
    expect(NO_ANCHOR_DRAFT.impact_score.band).not.toBe("REWRITE");
    expect(NO_ANCHOR_DRAFT.impact_score.note).toContain("硬性压到");
    expect(NO_ANCHOR_DRAFT.level5.satisfied).toBe(true);
  });

  it("锚点存在但没有可靠价格证据：仍然必须立标准，不许编价格高度（§16.1 / §22）", () => {
    const draft = buildSalesCopy(buildInput({ anchor: ANCHOR_WITHOUT_PRICE_EVIDENCE }));
    expect(draft.anchor.has_reliable_price_anchor).toBe(true);
    expect(draft.price_high_story_ready).toBe(false);
    expect(draft.headline.price_or_standard_story).toBe(NO_ANCHOR_STANDARD_SENTENCE);
    expect(draft.evidence_gaps.some((gap) => gap.includes("reliable_price_count"))).toBe(true);
  });

  it("没有 RND_CONFIRMED 时一个字都不许暗示研发关系（§25 / §62-8）", () => {
    const texts = salesCopyTexts(KING_DRAFT);
    expect(KING_DRAFT.compliance.rnd_confirmed).toBe(false);
    expect(KING_DRAFT.compliance.rnd_claimed).toBe(false);
    expect(KING_DRAFT.compliance.restricted_phrases).toEqual([]);
    expect(KING_DRAFT.compliance.fabricated_categories).toEqual([]);
    expect(texts.join("\n")).not.toMatch(/(复刻|同款配方|原配方再现|某大师配方|经典秘方|按照.*配方做)/);
  });

  it("允许极强修辞：反问 / 排比 / 身份塑造都不判红线（§47 / §24）", () => {
    const texts = salesCopyTexts(CORE_DRAFT).join("\n");
    expect(texts).toMatch(/[？?]/);
    expect(CORE_DRAFT.compliance.forbidden_promises).toEqual([]);
    expect(CORE_DRAFT.compliance.risk).toBe("GREEN");
    expect(CORE_DRAFT.headline.differentiation).toMatch(/不是/);
    expect(CORE_DRAFT.headline.differentiation).toMatch(/而是/);
  });
});

describe("§26 九种输出与 §27 3 分钟八段", () => {
  it("九种输出全部交付，且顺序与合同一致", () => {
    expect(CORE_DRAFT.output_statuses).toHaveLength(salesCopyOutputKeys.length);
    expect(CORE_DRAFT.output_statuses.map((item) => item.key)).toEqual([...salesCopyOutputKeys]);
    expect(CORE_DRAFT.output_statuses.map((item) => item.status)).toEqual(
      new Array(salesCopyOutputKeys.length).fill("DONE")
    );
    expect(CORE_DRAFT.output_statuses.every((item) => item.chars > 0)).toBe(true);
    expect(CORE_DRAFT.acceptance.outputs_complete).toBe(true);
    expect(CORE_DRAFT.acceptance.missing_outputs).toEqual([]);
  });

  it("生成侧与回看侧共用同一份输出状态实现（Phase 11 教训）", () => {
    expect(salesCopyOutputStatuses(CORE_DRAFT)).toEqual(CORE_DRAFT.output_statuses);
  });

  it("15s / 30s / 60s / 3 分钟 / 发布稿 / 经销商版 / 异议处理都拿到成稿", () => {
    expect(CORE_DRAFT.scripts.sec15.trim().length).toBeGreaterThan(0);
    expect(CORE_DRAFT.scripts.sec30).toContain(CORE_DRAFT.headline.price_or_standard_story);
    expect(CORE_DRAFT.scripts.sec60).toContain(CORE_DRAFT.headline.imagery);
    expect(CORE_DRAFT.scripts.min3.text).toContain(CORE_DRAFT.headline.imagery);
    expect(CORE_DRAFT.scripts.min3.text).toContain(CORE_DRAFT.headline.closing);
    expect(CORE_DRAFT.level5_release).toContain("【新品发布】");
    expect(CORE_DRAFT.dealer_copy).toContain("【经销商版】");
    expect(CORE_DRAFT.selling_points).toHaveLength(SALES_COPY_LIMITS.sellingPointCount);
    expect(CORE_DRAFT.objections.length).toBeGreaterThan(0);
    expect(CORE_DRAFT.objections.length).toBeLessThanOrEqual(SALES_COPY_LIMITS.maxObjections);
  });

  it("3 分钟八段时间轴顺序固定、每一段都有正文", () => {
    const segments = CORE_DRAFT.scripts.min3.segments;
    expect(segments.map((segment) => segment.key)).toEqual([...min3SegmentKeys]);
    for (const segment of segments) {
      expect(segment.text.trim().length).toBeGreaterThan(0);
      expect(CORE_DRAFT.scripts.min3.text).toContain(segment.text);
    }
    expect(segments.map((segment) => segment.time_range)).toEqual(
      MIN3_TIMELINE.map((meta) => meta.time_range)
    );
  });

  it("强度档位越低交付越少，但成交收口在任何档位都不许被省掉（§21 / §22）", () => {
    const research = buildSalesCopy(buildInput({ intensity: 1 }));
    expect(research.headline.closing.trim().length).toBeGreaterThan(0);
    expect(research.headline.price_or_standard_story).toBe(NO_ANCHOR_STANDARD_SENTENCE);
    expect(research.headline.identity_definition).toBe("");
    expect(research.headline.opening_hook).not.toMatch(/[？?]/);
    expect(research.level5_release).toBe("");
    expect(research.impact_score.required).toBeNull();
    expect(research.impact_score.passed).toBe(true);
  });
});

describe("§24 / §46 事实逐字回查与 §57 / §62-13 证据缺口", () => {
  it("只按白名单回查本产品已录入字段：没录的取不到，白名单外的取不到", () => {
    expect(salesCopyFactValue(FULL_PRODUCT, "product.mountain")).toBe("布朗山");
    expect(salesCopyFactValue(FULL_PRODUCT, "product.year")).toBe("2026");
    expect(salesCopyFactValue(THIN_PRODUCT, "product.mountain")).toBeNull();
    expect(salesCopyFactValue(FULL_PRODUCT, "anchor.primary_anchor")).toBeNull();
    expect(salesCopyFactValue(FULL_PRODUCT, "candidate.product_name")).toBeNull();
    expect(salesCopyFactValue(FULL_PRODUCT, "market_offer.price")).toBeNull();
  });

  it("回查清单只包含真正出现在正文里的已录入事实（§24 / §46）", () => {
    const pool = { product: FULL_PRODUCT, dna: VALUE_DNA };
    const texts = salesCopyTexts(CORE_DRAFT);
    const citations = salesCopyCitations(pool, texts);
    const refs = salesCopyRefsOf(citations);
    expect(citations.length).toBe(CORE_DRAFT.impact_score.facts_used);
    expect(refs.fact_refs.length + refs.value_dna_refs.length).toBe(citations.length);
    for (const ref of refs.fact_refs) {
      expect(ref.startsWith("product.")).toBe(true);
    }
    for (const ref of refs.value_dna_refs) {
      expect(ref.startsWith("dna.")).toBe(true);
    }
    expect(CORE_DRAFT.fact_refs).toEqual(refs.fact_refs);
    expect(CORE_DRAFT.value_dna_refs).toEqual(refs.value_dna_refs);
    expect(citations.length).toBeGreaterThanOrEqual(SALES_COPY_LIMITS.minRecordedFacts);
    // 对标产品的事实一个字都不许进正文（§44 / §62-5）
    expect(texts.join("\n")).not.toContain("同规格对标产品");
  });

  it("回查语料覆盖产品结构与配方哲学的上游成稿（§5 / §6）", () => {
    expect(CORE_DRAFT.upstream_refs).toEqual([
      "architecture:3",
      "formula_philosophy:2",
      "category_creator:1",
      "value_codes:1"
    ]);
    expect(CORE_DRAFT.upstream.architecture_acceptance_passed).toBe(true);
    expect(CORE_DRAFT.upstream.philosophy_acceptance_passed).toBe(true);
    expect(CORE_DRAFT.upstream.category_creator_ready).toBe(true);
    expect(CORE_DRAFT.upstream.value_codes_ready).toBe(true);
    expect(CORE_DRAFT.headline.formula_philosophy_story).toBe(FULL_UPSTREAM.philosophy.strategy);
    expect(CORE_DRAFT.headline.value_story).toBe(FULL_UPSTREAM.philosophy.sales_explanation);
  });

  it("上游没到位时逐条报缺口，顺序固定（事实 → 锚点 → Phase 10 → 11 → 8 → 9 → DNA）", () => {
    const draft = buildSalesCopy(
      buildInput({
        product: THIN_PRODUCT,
        value_dna: null,
        mode: "CATEGORY_CREATOR",
        resolved_by: "NO_RELIABLE_ANCHOR",
        mode_reason: "没有可靠价格锚点。",
        anchor: CATEGORY_CREATOR_ANCHOR,
        architecture: null,
        philosophy: null,
        category: null,
        value_codes: null,
        intensity: 5
      })
    );
    const joined = draft.evidence_gaps.join("｜");
    const markers = [
      "已录入事实只有",
      "没有可靠价格锚点",
      "Phase 10",
      "Phase 11",
      "Phase 8",
      "Phase 9",
      "Value DNA"
    ];
    const positions = markers.map((marker) => joined.indexOf(marker));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(draft.acceptance.passed).toBe(false);
    expect(draft.acceptance.missing.join("｜")).toContain("成交冲击力");
  });

  it("全部到位时缺口清单为空，缺 Level 5 项与缺输出时按 §22 → §26 顺序报（§62-13）", () => {
    expect(CORE_DRAFT.evidence_gaps).toEqual([]);
    const gaps = salesCopyEvidenceGaps({
      facts_used: 6,
      anchor: CORE_DRAFT.anchor,
      price_high_story_ready: true,
      upstream: CORE_DRAFT.upstream,
      value_dna_ready: true,
      level5: {
        ...KING_DRAFT.level5,
        satisfied: false,
        missing: ["closing"],
        requirements: KING_DRAFT.level5.requirements.map((item) =>
          item.key === "closing" ? { ...item, status: "MISSING" as const, evidence: null } : item
        )
      },
      outputs: KING_DRAFT.output_statuses.map((item) =>
        item.key === "dealer_copy" ? { ...item, status: "MISSING" as const, count: 0, chars: 0 } : item
      )
    });
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toContain("§22 Level 5");
    expect(gaps[1]).toContain("§26 还缺");
  });

  it("§23 评分 schema 与分档同源：满分固定 100，band 由总分推导", () => {
    expect(impactScoreSchema.safeParse({ ...CORE_DRAFT.impact_score, max: 120 }).success).toBe(false);
    expect(impactScoreSchema.safeParse({ ...CORE_DRAFT.impact_score, band: "REWRITE" }).success).toBe(false);
    expect(impactScoreSchema.safeParse({ ...CORE_DRAFT.impact_score, band: "CORE" }).success).toBe(true);
  });
});

describe("§7 / §34 / §48 牛逼化强化器（再狠一点）", () => {
  const SOURCE_BODY = salesCopyBodyOf(CORE_DRAFT);
  const KING_INPUT = buildInput({ intensity: 5 });
  const RECORD_ID = "9f1c2f7a-4c1b-4f4e-9a1d-2b3c4d5e6f70";
  const PRODUCT_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

  function intensify(
    overrides: Partial<{ level: "NORMAL" | "STRONG" | "VIRAL" | "KING"; rounds: number; intensity: 1 | 2 | 3 | 4 | 5 }> = {}
  ) {
    const level = overrides.level ?? "KING";
    const intensity = overrides.intensity ?? 5;
    return intensifySalesCopy({
      input: buildInput({ intensity }),
      source_body: SOURCE_BODY,
      level,
      source_intensity: 4,
      source_intensify_rounds: overrides.rounds ?? 0
    });
  }

  /**
   * 拼一个合法的「一版成稿」视图。
   *
   * `buildSalesCopy()` 只返回草稿：正文 + 派生结论 + 引擎内部上下文（`price_high_story_ready`）；
   * 落库后由服务层补上 id / version / 模式与审计字段，内部上下文字段不进视图（schema 是 strict 的）。
   */
  function recordOf(draft: SalesCopyDraft, intensity: 1 | 2 | 3 | 4 | 5): Record<string, unknown> {
    const { price_high_story_ready: _internal, ...body } = draft;
    return {
      ...body,
      id: RECORD_ID,
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      version: 2,
      intensity,
      preference: "AUTO",
      mode_at_generation: "BENCHMARK",
      resolved_by: "AUTO_ANCHOR",
      mode_reason: "存在可靠价格锚点，自动进入 Benchmark Mode（§17）。",
      value_focus: [...DEFAULT_VALUE_FOCUS],
      is_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
      notes: null,
      created_by: null,
      created_at: "2026-09-23T00:00:00.000Z",
      updated_at: "2026-09-23T00:00:00.000Z",
      spec_ref: "§21 / §22 / §23 / §26 / §27 / §33 / §47"
    };
  }

  /** 拼一个合法的一版强化结论，用来单独校验 §34 / §48 的 schema 红线。 */
  function buildResult(selfCheck: ReturnType<typeof intensifySelfCheckOf>) {
    const outcome = intensify();
    return {
      level: "KING" as const,
      intensity: 5 as const,
      source_intensity: 4 as const,
      round: 1,
      max_auto_rounds: SALES_COPY_MAX_INTENSIFY_ROUNDS,
      previous: {
        version: 1,
        intensity: 4 as const,
        impact_score: CORE_DRAFT.impact_score.total,
        band: CORE_DRAFT.impact_score.band,
        passed: CORE_DRAFT.impact_score.passed
      },
      changed_elements: outcome.changed_elements,
      added_facts: [] as string[],
      self_check: selfCheck,
      record: recordOf(outcome.draft, outcome.intensity),
      spec_ref: "§7 / §34 / §48" as const
    };
  }

  it("四档按钮按 §7 映射到五档强度，且只升不降", () => {
    expect(intensifyTargetIntensity("NORMAL", 1)).toBe(2);
    expect(intensifyTargetIntensity("STRONG", 1)).toBe(3);
    expect(intensifyTargetIntensity("VIRAL", 1)).toBe(4);
    expect(intensifyTargetIntensity("KING", 1)).toBe(5);
    // 只升不降：源版本已经比按钮档位更高时，目标强度维持源版本强度
    expect(intensifyTargetIntensity("VIRAL", 5)).toBe(5);
    expect(intensifyTargetIntensity("NORMAL", 4)).toBe(4);
  });

  it("四类前置闸门：轮次上限 / 版本上限 / 降档 / 同档（§48 / §62-15 / §7）", () => {
    expect(
      intensifyGuardReason({ level: "KING", source_intensity: 4, source_intensify_rounds: 0, total_versions: 3 })
    ).toBeNull();
    expect(
      intensifyGuardReason({
        level: "KING",
        source_intensity: 4,
        source_intensify_rounds: SALES_COPY_MAX_INTENSIFY_ROUNDS,
        total_versions: 3
      })
    ).toContain("人工处理");
    expect(
      intensifyGuardReason({
        level: "KING",
        source_intensity: 4,
        source_intensify_rounds: 0,
        total_versions: SALES_COPY_LIMITS.maxVersionsPerProduct
      })
    ).toContain("归档");
    expect(
      intensifyGuardReason({ level: "NORMAL", source_intensity: 4, source_intensify_rounds: 0, total_versions: 1 })
    ).toContain("不能把强度调低");
    expect(
      intensifyGuardReason({ level: "VIRAL", source_intensity: 4, source_intensify_rounds: 0, total_versions: 1 })
    ).toContain("请点更高的一档");
  });

  it("强化只换说法：同一份事实重跑总装，新版本不新增任何事实引用（§34）", () => {
    const outcome = intensify();
    expect(outcome.intensity).toBe(5);
    // §7.1：王者档必须在正文层面真的比爆款狠一层，而不是只把分数线抬上去
    expect(outcome.changed_elements).toContain("headline.opening_hook");
    expect(outcome.changed_elements).toContain("headline.memory_point");
    expect(outcome.source_intensity).toBe(4);
    expect(outcome.round).toBe(1);
    expect(outcome.added_facts).toEqual([]);
    expect(outcome.changed_elements.length).toBeGreaterThan(0);
    expect(outcome.draft.intensify_rounds).toBe(outcome.round);
    // 草稿本身不带 intensity（它落库时是独立列），由强化结论与 record 视图共同带上
    expect(recordOf(outcome.draft, outcome.intensity).intensity).toBe(outcome.intensity);
    expect(outcome.self_check.score).toBe(outcome.draft.impact_score.total);
    expect(outcome.draft.impact_score.required).toBe(SALES_COPY_REQUIRED_SCORE[5]);
    // 逐字回查口径下，新版本的引用清单必须是源版本的子集（一条都不新增）
    const diff = intensifyFactDiff(CORE_DRAFT.fact_refs, outcome.draft.fact_refs);
    expect(diff.added).toEqual([]);
  });

  it("§7.1 王者档加的是气势不是事实：开场 / 记忆点 / 金句被改写，引用清单一条都没多", () => {
    const diff = changedElementsOf(salesCopyBodyOf(CORE_DRAFT), salesCopyBodyOf(KING_DRAFT));
    expect(diff).toEqual(expect.arrayContaining(["headline.opening_hook", "headline.memory_point"]));
    expect(KING_DRAFT.headline.opening_hook).toContain("懂的人");
    expect(KING_DRAFT.headline.opening_hook).not.toBe(CORE_DRAFT.headline.opening_hook);
    // 仍然是强反问开场，且守住 §23 的 60 字上限（hook_short_and_clean 不许被气势突破）
    expect(/[？?]/.test(KING_DRAFT.headline.opening_hook)).toBe(true);
    expect(KING_DRAFT.headline.opening_hook.length).toBeLessThanOrEqual(60);
    expect(KING_DRAFT.headline.memory_point).toContain("懂的人才能看懂");
    expect(KING_DRAFT.quotes.core_quotes[0]).not.toBe(CORE_DRAFT.quotes.core_quotes[0]);
    // 王者档的三句新增全是纯修辞：不许因此多引出一条事实（§34 / §62-5）
    expect(intensifyFactDiff(CORE_DRAFT.fact_refs, KING_DRAFT.fact_refs)).toEqual({ added: [], lost: [] });
    expect(KING_DRAFT.level5.missing).toEqual([]);
    expect(KING_DRAFT.impact_score.total).toBeGreaterThanOrEqual(SALES_COPY_REQUIRED_SCORE[5] ?? 0);
  });

  it("轮次与源版本强度都取自源版本：第 2 轮强化得到 2，源版本强度更高时不降档", () => {
    const second = intensify({ rounds: 1, intensity: 5 });
    expect(second.round).toBe(2);
    expect(second.draft.intensify_rounds).toBe(2);
    // 源版本强度已经是 5（王者），VIRAL（映射到 4）不得把它写弱
    const kept = intensifySalesCopy({
      input: buildInput({ intensity: 5 }),
      source_body: salesCopyBodyOf(KING_DRAFT),
      level: "VIRAL",
      source_intensity: 5,
      source_intensify_rounds: 2
    });
    expect(kept.intensity).toBe(5);
    expect(kept.source_intensity).toBe(5);
    expect(kept.round).toBe(3);
  });

  it("事实不足的最坏情况也不会凭空造事实（§34 / §62-5）", () => {
    const outcome = intensifySalesCopy({
      input: buildInput({
        product: THIN_PRODUCT,
        value_dna: null,
        mode: "CATEGORY_CREATOR",
        resolved_by: "NO_RELIABLE_ANCHOR",
        mode_reason: "没有可靠价格锚点。",
        anchor: CATEGORY_CREATOR_ANCHOR,
        architecture: null,
        philosophy: null,
        category: null,
        value_codes: null,
        intensity: 5
      }),
      source_body: salesCopyBodyOf(NO_ANCHOR_DRAFT),
      level: "KING",
      source_intensity: 4,
      source_intensify_rounds: 0
    });
    expect(outcome.added_facts).toEqual([]);
    expect(outcome.draft.compliance.risk).toBe("YELLOW");
    expect(outcome.self_check.passed).toBe(false);
  });

  it("§48 八项自检齐全、复用 §23 判定，passed 由八项明细与分数阈值共同推导（§48）", () => {
    const check = intensifySelfCheckOf({
      level: "KING",
      intensity: 5,
      impact: KING_DRAFT.impact_score,
      body: salesCopyBodyOf(KING_DRAFT)
    });
    expect(INTENSIFY_SELF_CHECK_META.map((meta) => meta.key)).toEqual([...intensifySelfCheckKeys]);
    expect(check.items.map((item) => item.key)).toEqual([...intensifySelfCheckKeys]);
    expect(check.spec_ref).toBe("§48");
    expect(check.max_auto_rounds).toBe(SALES_COPY_MAX_INTENSIFY_ROUNDS);
    expect(check.score).toBe(KING_DRAFT.impact_score.total);
    expect(check.required_score).toBe(SALES_COPY_REQUIRED_SCORE[5]);
    expect(check.missing).toEqual(check.items.filter((item) => !item.passed).map((item) => item.key));
    expect(check.passed).toBe(check.missing.length === 0 && check.score_passed);
    // 八项必须直接复用 §23 的 criteria，不能另立一套主观标准
    expect(INTENSIFY_SELF_CHECK_META.every((meta) => meta.spec_ref.startsWith("§48"))).toBe(true);
  });

  it("「说明书味太重」是负向自检：十三格出现说明书腔调即判不通过（§48 / §62-11）", () => {
    expect(INTENSIFY_SELF_CHECK_META_BY_KEY.no_manual_tone.negative).toBe(true);
    expect(INTENSIFY_SELF_CHECK_META.filter((meta) => meta.negative).map((meta) => meta.key)).toEqual([
      "no_manual_tone"
    ]);
    const check = intensifySelfCheckOf({
      level: "KING",
      intensity: 5,
      impact: KING_DRAFT.impact_score,
      body: {
        ...SOURCE_BODY,
        headline: { ...SOURCE_BODY.headline, opening_hook: "本品规格如下，请对照产品参数查看。" }
      }
    });
    expect(check.missing).toContain("no_manual_tone");
    expect(check.passed).toBe(false);
    expect(check.items.find((item) => item.key === "no_manual_tone")?.passed).toBe(false);
    expect(check.note).toContain("说明书味太重");
  });

  it("分数不达档时如实标未达标：不阻断、不压分，最多自动强化 3 轮（§48）", () => {
    const lowScore: ImpactScore = {
      ...KING_DRAFT.impact_score,
      total: 80,
      band: "EXCELLENT",
      band_label: "优秀",
      passed: false
    };
    const check = intensifySelfCheckOf({
      level: "KING",
      intensity: 5,
      impact: lowScore,
      body: salesCopyBodyOf(KING_DRAFT)
    });
    expect(check.required_score).toBe(SALES_COPY_REQUIRED_SCORE[5]);
    expect(check.score_passed).toBe(false);
    expect(check.passed).toBe(false);
    expect(check.note).toContain("八项全过但分数不够");
    expect(check.note).toContain(`${SALES_COPY_MAX_INTENSIFY_ROUNDS} 轮`);
    // Level 4 的门槛是 85，Level 5 是 90，其余档位不设硬性分数线
    expect(SALES_COPY_REQUIRED_SCORE[3]).toBeUndefined();
    expect(SALES_COPY_REQUIRED_SCORE[4]).toBe(85);
    expect(SALES_COPY_REQUIRED_SCORE[5]).toBe(90);
  });

  it("§48 自检 schema 的 passed 只能由明细与分数推导，且条数固定为 8", () => {
    const check = intensifySelfCheckOf({
      level: "KING",
      intensity: 5,
      impact: KING_DRAFT.impact_score,
      body: salesCopyBodyOf(KING_DRAFT)
    });
    expect(salesCopyIntensifyResultSchema.safeParse(buildResult(check)).success).toBe(true);
    // 谎报 passed 会被 refine 拒绝；少一项自检同样不合法
    expect(
      salesCopyIntensifyResultSchema.safeParse({
        ...buildResult(check),
        self_check: { ...check, missing: ["quotes"], passed: true }
      }).success
    ).toBe(false);
    expect(
      salesCopyIntensifyResultSchema.safeParse({
        ...buildResult(check),
        self_check: { ...check, items: check.items.slice(0, 7) }
      }).success
    ).toBe(false);
  });

  it("强化结果 schema 卡死三处同源推导（强度 / 轮次 / 自检分数）", () => {
    const check = intensifySelfCheckOf({
      level: "KING",
      intensity: 5,
      impact: KING_DRAFT.impact_score,
      body: salesCopyBodyOf(KING_DRAFT)
    });
    const ok = buildResult(check);
    expect(salesCopyIntensifyResultSchema.safeParse(ok).success).toBe(true);
    expect(ok.added_facts).toEqual([]);
    // §34：任何「新增事实」都直接非法（max(0)）
    expect(salesCopyIntensifyResultSchema.safeParse({ ...ok, added_facts: ["product.mountain"] }).success).toBe(
      false
    );
    expect(salesCopyIntensifyResultSchema.safeParse({ ...ok, record: { ...ok.record, intensity: 4 } }).success).toBe(
      false
    );
    expect(
      salesCopyIntensifyResultSchema.safeParse({ ...ok, record: { ...ok.record, intensify_rounds: 2 } }).success
    ).toBe(false);
    expect(salesCopyIntensifyResultSchema.safeParse({ ...ok, round: SALES_COPY_MAX_INTENSIFY_ROUNDS + 1 }).success).toBe(
      false
    );
    expect(salesCopyIntensifyResultSchema.safeParse({ ...ok, spec_ref: "§34" }).success).toBe(false);
  });

  it("强化请求体：level 必填，record_id / notes 可选，多余字段拒绝（§34）", () => {
    expect(salesCopyIntensifySchema.safeParse({ level: "KING" }).success).toBe(true);
    expect(salesCopyIntensifySchema.safeParse({ level: "VIRAL", notes: "手动挑一版试试" }).success).toBe(true);
    expect(salesCopyIntensifySchema.safeParse({ level: "KING", intensity: 5 }).success).toBe(false);
    expect(salesCopyIntensifySchema.safeParse({ level: "SUPER" }).success).toBe(false);
    expect(salesCopyIntensifySchema.safeParse({}).success).toBe(false);
  });

  it("档位动作累计且只加不减：NORMAL ⊂ STRONG ⊂ VIRAL ⊂ KING（§7.1）", () => {
    expect(INTENSIFY_ACTIONS_BY_LEVEL.NORMAL).toEqual(["hook", "closing"]);
    expect(INTENSIFY_ACTIONS_BY_LEVEL.STRONG).toEqual(["hook", "closing", "identity", "standard"]);
    const levels = ["NORMAL", "STRONG", "VIRAL", "KING"] as const;
    for (const [index, level] of levels.entries()) {
      const actions = INTENSIFY_ACTIONS_BY_LEVEL[level];
      expect(actions).toContain("hook");
      expect(actions).toContain("closing");
      expect(new Set(actions).size).toBe(actions.length);
      if (index > 0) {
        const previous = INTENSIFY_ACTIONS_BY_LEVEL[levels[index - 1] as (typeof levels)[number]];
        expect(previous.every((action) => actions.includes(action))).toBe(true);
        expect(actions.length).toBeGreaterThan(previous.length);
      }
    }
    expect(INTENSIFY_ACTIONS_BY_LEVEL.KING).toHaveLength(9);
  });

  it("逐格对比与事实引用差集是纯函数：位置 key 稳定，不改变入参", () => {
    expect(changedElementsOf(SOURCE_BODY, SOURCE_BODY)).toEqual([]);
    const headlineChanged = changedElementsOf(SOURCE_BODY, {
      ...SOURCE_BODY,
      headline: { ...SOURCE_BODY.headline, opening_hook: "换一个开场。" }
    });
    expect(headlineChanged).toEqual(["headline.opening_hook"]);
    const quoteChanged = changedElementsOf(SOURCE_BODY, {
      ...SOURCE_BODY,
      quotes: { ...SOURCE_BODY.quotes, core_quotes: ["换一句金句。", ...SOURCE_BODY.quotes.core_quotes.slice(1)] }
    });
    expect(quoteChanged).toEqual(["quotes.core_quotes[0]"]);
    const snapshot = JSON.stringify(SOURCE_BODY);
    changedElementsOf(SOURCE_BODY, { ...SOURCE_BODY, level5_release: "换一版发布会稿。" });
    expect(JSON.stringify(SOURCE_BODY)).toBe(snapshot);

    expect(intensifyFactDiff(["product.mountain", "dna.origin"], ["dna.origin"])).toEqual({
      added: [],
      lost: ["product.mountain"]
    });
    expect(intensifyFactDiff(["dna.origin"], ["dna.origin", "product.village"])).toEqual({
      added: ["product.village"],
      lost: []
    });
    expect(intensifyFactDiff([], [])).toEqual({ added: [], lost: [] });
  });
});
