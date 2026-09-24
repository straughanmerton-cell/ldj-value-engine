import { describe, expect, it } from "vitest";
import {
  DEFAULT_VALUE_FOCUS,
  FACT_REVIEW_CONTRACT,
  FACT_REVIEW_DOWNSTREAM,
  FACT_REVIEW_ENGINE_INFO,
  FACT_REVIEW_FOCUS_LABELS,
  FACT_REVIEW_SENTENCE_COLUMNS,
  buildFactReview,
  buildSalesCopy,
  factReviewApprovalSchema,
  factReviewOverviewSchema,
  factReviewRecord,
  factReviewSentenceSchema,
  factReviewSentences,
  factReviewVersionSummarySchema,
  mergeFactReviewAi,
  productArchitectureSchema,
  salesCopyAnchorRefOf,
  salesCopyBodyOf,
  valueDnaSchema,
  type BenchmarkModeView,
  type CategoryStyleIdentity,
  type FactReview,
  type FactReviewAiOutput,
  type FactReviewBuildInput,
  type FactReviewDraft,
  type FactReviewSentence,
  type ProductArchitecture,
  type SalesCopyBuildInput,
  type SalesCopyProductInput,
  type ValueDna
} from "../src/index.js";

/**
 * Phase 14（规格 §24 / §25 / §49 / §53 / §57 / §58 / §62-14）。
 *
 * 这里只测「纯规则事实审核引擎 + AI 合并口径」：不碰数据库、不调用任何 Provider。
 * 四条铁律——① 修辞不是事实造假（比喻 / 反问 / 身份句不得判 RED）；
 * ② 无 RND 证据的配方 / 研发关系、禁止承诺与无据绝对化断言必判 RED；
 * ③ RED 一律阻断审批（`publishable = false`）；
 * ④ AI 只能加严，规则判出的红线不能被洗白。
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
    anchor: benchmarkViewWith(3),
    ...FULL_UPSTREAM
  };
  return { ...base, ...overrides };
}

function reviewInput(overrides: Partial<SalesCopyBuildInput> = {}): FactReviewBuildInput {
  const input = buildInput(overrides);
  const draft = buildSalesCopy(input);
  return {
    product: input.product,
    value_dna: input.value_dna,
    architecture: input.architecture ?? null,
    philosophy: input.philosophy ?? null,
    category: input.category ?? null,
    body: salesCopyBodyOf(draft),
    anchor: salesCopyAnchorRefOf(input.anchor),
    price_high_story_ready: draft.price_high_story_ready,
    rnd_confirmed: input.rnd_confirmed
  };
}

const REVIEW_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const COPY_OUTPUT_ID = "44444444-4444-4444-8444-444444444444";

function draftOf(overrides: Partial<SalesCopyBuildInput> = {}): FactReviewDraft {
  return buildFactReview(reviewInput(overrides));
}

/** 把一句话注入「画面感」格，再跑一次审核：逐句判定用真实成稿的其他句子作背景。 */
function draftWithText(text: string, overrides: Partial<SalesCopyBuildInput> = {}): FactReviewDraft {
  const input = buildInput(overrides);
  const draft = buildSalesCopy(input);
  const body = salesCopyBodyOf(draft);
  return buildFactReview({
    product: input.product,
    value_dna: input.value_dna,
    architecture: input.architecture ?? null,
    philosophy: input.philosophy ?? null,
    category: input.category ?? null,
    body: { ...body, headline: { ...body.headline, imagery: text } },
    anchor: salesCopyAnchorRefOf(input.anchor),
    price_high_story_ready: draft.price_high_story_ready,
    rnd_confirmed: input.rnd_confirmed
  });
}

function sentenceWith(review: FactReviewDraft, text: string): FactReviewSentence {
  const found = review.sentences.find((sentence) => sentence.text === text);
  if (!found) {
    throw new Error(`审核结果里找不到这句话：${text}`);
  }
  return found;
}

function asAiOutput(draft: FactReviewDraft): FactReviewAiOutput {
  return {
    sentences: draft.sentences.map((sentence) => ({
      text: sentence.text,
      claim_type: sentence.claim_type,
      risk: sentence.risk,
      evidence_refs: [...sentence.evidence_refs],
      issue: sentence.issue,
      suggestion: sentence.suggestion
    })),
    summary: { ...draft.summary },
    publishable: draft.publishable,
    blocking_sentences: [...draft.blocking_sentences]
  };
}

function recordOf(draft: FactReviewDraft, overrides: Partial<Parameters<typeof factReviewRecord>[1]> = {}): FactReview {
  return factReviewRecord(draft, {
    id: REVIEW_ID,
    product_id: PRODUCT_ID,
    product_name: FULL_PRODUCT.product_name,
    copy_output_id: COPY_OUTPUT_ID,
    copy_version: 1,
    version: 1,
    rnd_confirmed: false,
    has_reliable_price_anchor: true,
    price_high_story_ready: true,
    created_at: "2026-09-24T00:00:00.000Z",
    ...overrides
  });
}

/** 事实不足版：只剩名字与年份，用来验证「没有可靠价格锚点时不许讲价格高度」。 */
const THIN_OVERRIDES: Partial<SalesCopyBuildInput> = {
  product: {
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
    storage: null
  },
  value_dna: null,
  mode: "CATEGORY_CREATOR",
  resolved_by: "NO_RELIABLE_ANCHOR",
  mode_reason: "没有可靠价格锚点，按 §62-10 自动进入 Category Creator Mode。",
  anchor: CATEGORY_CREATOR_ANCHOR,
  architecture: null,
  philosophy: null,
  category: null,
  value_codes: null
};

describe("事实审核合同（§24 / §25 / §49 / §53）", () => {
  it("三层标记逐字为事实 / 解释 / 修辞，全部指向 §24", () => {
    expect(FACT_REVIEW_CONTRACT.claim_types.map((item) => item.key)).toEqual([
      "FACT",
      "INTERPRETATION",
      "RHETORIC"
    ]);
    expect(FACT_REVIEW_CONTRACT.claim_types.map((item) => item.label)).toEqual(["事实", "解释", "修辞"]);
    expect(FACT_REVIEW_CONTRACT.claim_types.every((item) => item.spec_ref === "§24")).toBe(true);
  });

  it("三档风险从低到高为 GREEN / YELLOW / RED，来源 §49", () => {
    expect(FACT_REVIEW_CONTRACT.risk_levels.map((item) => item.key)).toEqual(["GREEN", "YELLOW", "RED"]);
    expect(FACT_REVIEW_CONTRACT.risk_levels.map((item) => item.label)).toEqual([
      "可发布",
      "需人工确认",
      "禁止发布"
    ]);
    expect(FACT_REVIEW_CONTRACT.risk_levels.every((item) => item.spec_ref === "§49")).toBe(true);
  });

  it("§53 的五列逐句表格与 §49 十三项重点审核项一字不少", () => {
    expect(FACT_REVIEW_SENTENCE_COLUMNS).toEqual(["句子", "Claim Type", "Risk", "Evidence", "修改建议"]);
    expect(FACT_REVIEW_FOCUS_LABELS).toEqual([
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
    ]);
  });

  it("四条硬口径固定在合同里：修辞不算造假 / RED 阻断审批 / 修辞可保留 / 版本只增不删", () => {
    expect(FACT_REVIEW_CONTRACT.rhetoric_not_fraud).toBe(true);
    expect(FACT_REVIEW_CONTRACT.red_blocks_approval).toBe(true);
    expect(FACT_REVIEW_CONTRACT.rhetoric_kept).toBe(true);
    expect(FACT_REVIEW_CONTRACT.keep_all_versions).toBe(true);
    expect(FACT_REVIEW_CONTRACT.rnd_requires_confirmation).toBe(true);
    expect(FACT_REVIEW_CONTRACT.ai_can_only_tighten).toBe(true);
  });

  it("引擎信息标注 Agent 11 已接线且纯规则始终是权威闸门", () => {
    expect(FACT_REVIEW_ENGINE_INFO.prompt_key).toBe("FACT_REVIEWER");
    expect(FACT_REVIEW_ENGINE_INFO.ai_wired).toBe(true);
    expect(FACT_REVIEW_ENGINE_INFO.rule_engine_authoritative).toBe(true);
    expect(FACT_REVIEW_ENGINE_INFO.spec_ref).toBe(FACT_REVIEW_CONTRACT.spec_ref);
  });

  it("Phase 15 交付后不再登记下游交接（已交付阶段的 `_DOWNSTREAM` 一律为空数组）", () => {
    expect(FACT_REVIEW_DOWNSTREAM).toHaveLength(0);
  });

  it("规则清单覆盖 §24 / §25 / §49 / §53 / §57 / §58 / §62-15 的关键词", () => {
    const rules = FACT_REVIEW_CONTRACT.rules.join("\n");
    for (const keyword of [
      "FACT / INTERPRETATION / RHETORIC",
      "风格参考",
      "市场第一",
      "RED 禁止审批",
      "修辞可以保留",
      "300 年古树",
      "所有版本必须保留"
    ]) {
      expect(rules).toContain(keyword);
    }
  });
});

describe("逐句切分与计数（§53）", () => {
  it("切分结果与成稿句数一致，index 从 1 连续编号", () => {
    const input = buildInput();
    const body = salesCopyBodyOf(buildSalesCopy(input));
    const review = buildFactReview(reviewInput());
    expect(review.sentences.length).toBe(factReviewSentences(body).length);
    expect(review.sentences.map((sentence) => sentence.index)).toEqual(
      review.sentences.map((_, position) => position + 1)
    );
  });

  it("三档风险计数覆盖全部句子，三层标记计数同样合计等于句数", () => {
    const review = draftOf();
    const { green, yellow, red } = review.summary;
    expect(green + yellow + red).toBe(review.sentences.length);
    const { FACT, INTERPRETATION, RHETORIC } = review.claim_counts;
    expect(FACT + INTERPRETATION + RHETORIC).toBe(review.sentences.length);
  });

  it("事实齐备产品：逐句全部落在可发布区，且每条 FACT 都能点回原句出处", () => {
    const review = draftOf();
    expect(review.summary.red).toBe(0);
    expect(review.overall_risk).not.toBe("RED");
    expect(review.publishable).toBe(true);
    expect(review.blocking_sentences).toEqual([]);
    expect(review.evidence_gaps).toEqual([]);
    expect(review.facts_used).toBeGreaterThan(0);
    expect(review.compliance.risk).not.toBe("RED");
    for (const sentence of review.sentences.filter((item) => item.claim_type === "FACT")) {
      expect(sentence.evidence_refs.length).toBeGreaterThan(0);
      expect(sentence.evidence_refs.every((ref) => ref.includes("="))).toBe(true);
    }
  });

  it("只有 RED 才是阻断句，其余句子都不带阻断标记", () => {
    const review = draftOf();
    for (const sentence of review.sentences) {
      expect(sentence.is_blocking).toBe(sentence.risk === "RED");
    }
  });

  it("非 RED 却标记为阻断句会被 schema 拒绝（§53）", () => {
    const parsed = factReviewSentenceSchema.safeParse({
      index: 1,
      text: "这饼茶的烟香很明显。",
      claim_type: "FACT",
      risk: "GREEN",
      evidence_refs: [],
      issue: null,
      suggestion: null,
      is_blocking: true
    });
    expect(parsed.success).toBe(false);
  });
});

describe("修辞不是事实造假（§24）", () => {
  it("身份句按 RHETORIC 处理且不判 RED", () => {
    const review = draftWithText("烟香就是它的身份证。");
    const sentence = sentenceWith(review, "烟香就是它的身份证。");
    expect(sentence.claim_type).toBe("RHETORIC");
    expect(sentence.risk).toBe("GREEN");
    expect(sentence.is_blocking).toBe(false);
    expect(review.publishable).toBe(true);
  });

  it("反问句按 RHETORIC 处理且不判 RED", () => {
    const review = draftWithText("这样的汤感，多久没遇到了？");
    const sentence = sentenceWith(review, "这样的汤感，多久没遇到了？");
    expect(sentence.claim_type).toBe("RHETORIC");
    expect(sentence.risk).toBe("GREEN");
  });

  it("「第一口」不是「市场第一」：修辞里的第一口不触发无据绝对化断言", () => {
    const review = draftWithText("第一口就很像样，这是它自己的名片。");
    const sentence = sentenceWith(review, "第一口就很像样，这是它自己的名片。");
    expect(sentence.risk).toBe("GREEN");
    expect(sentence.issue).toBeNull();
  });

  it("极强修辞（排比 + 断言式收口）仍然可发布，不因为「不是字面事实」被判 RED", () => {
    const review = draftWithText("它要让所有人闭嘴：一口下去，骗不了人。");
    const sentence = sentenceWith(review, "它要让所有人闭嘴：一口下去，骗不了人。");
    expect(sentence.claim_type).toBe("RHETORIC");
    expect(sentence.risk).toBe("GREEN");
    expect(review.publishable).toBe(true);
  });
});

describe("研发关系与配方关系（§25）", () => {
  it("没有 RND 证据却写「按某款配方做的」直接判 RED 并阻断审批", () => {
    const text = "我们就是按 2003 六星孔雀的配方做的。";
    const review = draftWithText(text);
    const sentence = sentenceWith(review, text);
    expect(sentence.risk).toBe("RED");
    expect(sentence.is_blocking).toBe(true);
    expect(review.publishable).toBe(false);
    expect(review.overall_risk).toBe("RED");
    expect(review.blocking_sentences).toContain(text);
    expect(sentence.suggestion).not.toBeNull();
  });

  it("没有 RND 证据却写「复刻」同样判 RED", () => {
    const review = draftWithText("这一饼是按当年那款经典的味道复刻出来的。");
    const sentence = sentenceWith(review, "这一饼是按当年那款经典的味道复刻出来的。");
    expect(sentence.risk).toBe("RED");
    expect(review.publishable).toBe(false);
  });

  it("有 RND 证据时「团队拆解过」不再判 RED，但需人工确认", () => {
    const text = "研发阶段我们团队拆解过那款茶的香气与结构。";
    const allowed = draftWithText(text, { rnd_confirmed: true });
    const allowedSentence = sentenceWith(allowed, text);
    expect(allowedSentence.risk).not.toBe("RED");
    expect(allowedSentence.is_blocking).toBe(false);

    const blocked = draftWithText(text);
    expect(sentenceWith(blocked, text).risk).toBe("RED");
  });

  it("受限措辞（复刻 / 同款配方）在任何情况下都判 RED：没有内部证据就不许暗示一条不存在的研发关系", () => {
    const text = "它跟那款名品是同款配方。";
    const review = draftWithText(text, { rnd_confirmed: true });
    const sentence = sentenceWith(review, text);
    expect(sentence.risk).toBe("RED");
    expect(review.publishable).toBe(false);
  });
});

describe("禁止承诺与无据断言（§49）", () => {
  it("必涨 / 稳赚 / 保值一律判 RED，且整份结论不可发布", () => {
    const review = draftWithText("这饼茶必涨，买了就是稳赚。");
    const sentence = sentenceWith(review, "这饼茶必涨，买了就是稳赚。");
    expect(sentence.risk).toBe("RED");
    expect(review.publishable).toBe(false);
    expect(review.summary.red).toBeGreaterThan(0);
  });

  it("无据的「市场第一 / 最贵 / 唯一」判 RED", () => {
    const review = draftWithText("这款茶是全国第一。");
    const sentence = sentenceWith(review, "这款茶是全国第一。");
    expect(sentence.risk).toBe("RED");
    expect(sentence.issue).toContain("绝对化断言");
  });

  it("没有可靠价格锚点却讲价格高度：判 YELLOW 并指向 §22 标准句", () => {
    const text = "它就是站上高价带的那一类茶。";
    const review = draftWithText(text, THIN_OVERRIDES);
    const sentence = sentenceWith(review, text);
    expect(sentence.risk).toBe("YELLOW");
    expect(sentence.suggestion).toContain("§22 标准句");
    expect(review.overall_risk).toBe("YELLOW");
  });

  it("找不到逐字出处的硬事实断言进 evidence_gaps，且只算 YELLOW 不算 RED", () => {
    const text = "它的汤色在第 12 泡仍然稳定。";
    const review = draftWithText(text);
    const sentence = sentenceWith(review, text);
    expect(sentence.risk).toBe("YELLOW");
    expect(review.evidence_gaps.some((gap) => gap.includes(text))).toBe(true);
    expect(review.publishable).toBe(true);
  });

  it("凭空出现的价格数字判 RED（价格只能来自已录入字段或可靠锚点）", () => {
    const review = draftWithText("这一饼现在已经卖到 3880 元。");
    const sentence = sentenceWith(review, "这一饼现在已经卖到 3880 元。");
    expect(sentence.risk).toBe("RED");
    expect(review.publishable).toBe(false);
  });
});

describe("Agent 11 合并只能加严（§53 / §62-14）", () => {
  it("AI 句数与切分结果不一致时整份回落纯规则结论", () => {
    const draft = draftOf();
    const ai = asAiOutput(draft);
    const merged = mergeFactReviewAi(draft, { ...ai, sentences: ai.sentences.slice(0, 3) });
    expect(merged.draft.engine).toBe("RULE");
    expect(merged.draft.sentences).toEqual(draft.sentences);
    expect(merged.warnings.join("")).toContain("整份忽略 AI 标注");
  });

  it("AI 把 GREEN 标成 RED 会被采纳（只能加严）", () => {
    const draft = draftOf();
    const ai = asAiOutput(draft);
    const target = ai.sentences[0];
    if (!target) {
      throw new Error("样本不足");
    }
    target.risk = "RED";
    target.suggestion = "这句必须改写。";
    const merged = mergeFactReviewAi(draft, ai);
    expect(merged.draft.engine).toBe("RULE_AI");
    expect(merged.draft.sentences[0]?.risk).toBe("RED");
    expect(merged.draft.sentences[0]?.is_blocking).toBe(true);
    expect(merged.draft.publishable).toBe(false);
    expect(merged.draft.blocking_sentences).toContain(target.text);
  });

  it("规则判出的 RED 不能被 AI 的 GREEN 洗白", () => {
    const text = "这饼茶必涨，买了就是稳赚。";
    const draft = draftWithText(text);
    const ai = asAiOutput(draft);
    const index = draft.sentences.findIndex((sentence) => sentence.text === text);
    const target = ai.sentences[index];
    if (!target) {
      throw new Error("找不到注入句");
    }
    target.risk = "GREEN";
    target.claim_type = "RHETORIC";
    const merged = mergeFactReviewAi(draft, ai);
    const sentence = sentenceWith(merged.draft, text);
    expect(sentence.risk).toBe("RED");
    expect(merged.draft.publishable).toBe(false);
  });

  it("AI 标注与原文对不上的那一句回落规则结论并留下 warning", () => {
    const draft = draftOf();
    const ai = asAiOutput(draft);
    const target = ai.sentences[2];
    if (!target) {
      throw new Error("样本不足");
    }
    target.text = "这句话根本不在成稿里。";
    target.risk = "RED";
    const merged = mergeFactReviewAi(draft, ai);
    expect(merged.draft.sentences[2]).toEqual(draft.sentences[2]);
    expect(merged.warnings.join("")).toContain("AI 标注与原文对不上");
  });

  it("Evidence 永远取机械逐字回查结果，AI 不能改写证据", () => {
    const draft = draftOf();
    const ai = asAiOutput(draft);
    const target = ai.sentences.find((sentence) => sentence.evidence_refs.length > 0);
    if (!target) {
      throw new Error("样本不足");
    }
    target.evidence_refs = ["ai.hallucinated=某条不存在的证据"];
    const merged = mergeFactReviewAi(draft, ai);
    const sentence = sentenceWith(merged.draft, target.text);
    expect(sentence.evidence_refs).not.toContain("ai.hallucinated=某条不存在的证据");
    expect(sentence.evidence_refs.length).toBeGreaterThan(0);
  });

  it("AI 留空的修改建议不会把规则文案清掉", () => {
    const text = "这款茶是全国第一。";
    const draft = draftWithText(text);
    const ai = asAiOutput(draft);
    const index = draft.sentences.findIndex((sentence) => sentence.text === text);
    const target = ai.sentences[index];
    if (!target) {
      throw new Error("找不到注入句");
    }
    target.issue = null;
    target.suggestion = null;
    const merged = mergeFactReviewAi(draft, ai);
    const sentence = sentenceWith(merged.draft, text);
    expect(sentence.issue).not.toBeNull();
    expect(sentence.suggestion).not.toBeNull();
  });
});

describe("审核版本与人工审批（§53 / §57 / §62-15）", () => {
  it("审核结论 + 落库身份字段组装成完整视图", () => {
    const record = recordOf(draftOf());
    expect(record.id).toBe(REVIEW_ID);
    expect(record.copy_version).toBe(1);
    expect(record.version).toBe(1);
    expect(record.spec_ref).toBe(FACT_REVIEW_CONTRACT.spec_ref);
    expect(record.rnd_confirmed).toBe(false);
    expect(record.created_at).toBe("2026-09-24T00:00:00.000Z");
  });

  it("版本摘要的发布结论必须由 RED 计数推导", () => {
    const base = {
      id: REVIEW_ID,
      version: 1,
      copy_version: 1,
      engine: "RULE" as const,
      overall_risk: "RED" as const,
      green: 5,
      yellow: 0,
      red: 1,
      facts_used: 4,
      created_at: "2026-09-24T00:00:00.000Z"
    };
    expect(factReviewVersionSummarySchema.safeParse({ ...base, publishable: false }).success).toBe(true);
    expect(factReviewVersionSummarySchema.safeParse({ ...base, publishable: true }).success).toBe(false);
  });

  it("待审批允许没有指向具体版本，审批 / 否决必须指向一次具体审核", () => {
    expect(
      factReviewApprovalSchema.safeParse({
        status: "PENDING",
        reviewed_version: null,
        note: null,
        reviewed_by: null,
        reviewed_at: null
      }).success
    ).toBe(true);
    expect(
      factReviewApprovalSchema.safeParse({
        status: "APPROVED",
        reviewed_version: null,
        note: null,
        reviewed_by: REVIEW_ID,
        reviewed_at: "2026-09-24T00:00:00.000Z"
      }).success
    ).toBe(false);
  });

  it("产品级总览：没有可审的成稿就不允许运行事实审核", () => {
    const base = {
      product_id: PRODUCT_ID,
      product_name: FULL_PRODUCT.product_name,
      copy_version: null,
      block_reason: "还没有可审核的强成交话术版本",
      review: null,
      versions: [],
      approval: {
        status: "PENDING" as const,
        reviewed_version: null,
        note: null,
        reviewed_by: null,
        reviewed_at: null
      },
      spec_ref: "§24 / §49 / §53" as const
    };
    expect(
      factReviewOverviewSchema.safeParse({ ...base, copy_record_id: null, can_review: false }).success
    ).toBe(true);
    expect(
      factReviewOverviewSchema.safeParse({ ...base, copy_record_id: null, can_review: true }).success
    ).toBe(false);
  });

  it("RED 存在的审核结论不允许标记为可发布", () => {
    const record = recordOf(draftWithText("这饼茶必涨，买了就是稳赚。"));
    expect(record.publishable).toBe(false);
    expect(record.summary.red).toBeGreaterThan(0);
    expect(record.blocking_sentences.length).toBe(record.sentences.filter((s) => s.is_blocking).length);
  });
});
