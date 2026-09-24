import { describe, expect, it } from "vitest";
import {
  TIME_DEPENDENT_FORBIDDEN_EXPRESSION,
  TIME_DEPENDENT_SAFE_EXPRESSION,
  VALUE_CODES_CONTRACT,
  VALUE_CODES_DOWNSTREAM,
  VALUE_CODE_COUNT,
  VALUE_CODE_META,
  VALUE_CODE_META_BY_KEY,
  VALUE_CODE_STATUS_ORDER,
  VALUE_CODE_TIME_DEPENDENT_KEYS,
  VALUE_DNA_DIMENSIONS,
  VALUE_STORY_HANDOFF_PHASES,
  buildValueCodeDraft,
  valueCodeCountsSchema,
  valueCodeGenerateSchema,
  valueCodeKeySchema,
  valueCodeProfileSchema,
  valueDnaSchema,
  valueStoryKeys,
  type ValueCodeBuildInput,
  type ValueCodeProductInput
} from "../src/index.js";

/**
 * Phase 9（规格 §18 Value Codes / §19 状态判定 / §20 价值故事 / §44 不移植竞品事实）。
 *
 * 这里只测「纯函数价值映射引擎」：不碰数据库、不调用 AI。
 * 关键红线——没录入就是 UNKNOWN（不补全）；明确排除才允许 NOT_HAVE；
 * TIME_DEPENDENT 的成交层表达只能是 §19 的固定安全句式。
 */

/** 规格 §58 fixture：龙德记六星孔雀（事实齐备版，用于验证 ALREADY_HAVE 路径）。 */
const FULL_PRODUCT: ValueCodeProductInput = {
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
  tree_age: "百年以上",
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
  middle_stage: "稳定",
  late_stage: "回甘持续",
  endurance: "12 泡以上",
  brand_name: "龙德记",
  liquor_aroma: "烟香入水",
  viscosity: "稠",
  water_texture: "细腻",
  finish: "尾水甜",
  harvest_standard: "一芽两叶",
  fermentation_degree: null,
  fermentation_method: null,
  storage: "昆明干仓"
};

/** 只录入基础资料的产品：没有任何可用于判断价值 Code 的事实。 */
function emptyProduct(name: string): ValueCodeProductInput {
  return {
    ...FULL_PRODUCT,
    product_name: name,
    series_name: null,
    tea_type: "普洱生茶",
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
}

function build(overrides: Partial<ValueCodeBuildInput> = {}) {
  return buildValueCodeDraft({
    product: FULL_PRODUCT,
    value_dna: null,
    mode: "BENCHMARK",
    resolved_by: "AUTO_ANCHOR",
    ...overrides
  });
}

describe("Value Codes 合同（§18 / §19 / §20）", () => {
  it("锁定 16 个 Code 与顺序，不得增删或重排", () => {
    expect(VALUE_CODE_COUNT).toBe(16);
    expect(VALUE_CODE_META).toHaveLength(16);
    expect(VALUE_CODES_CONTRACT.codes.map((item) => item.code)).toEqual(
      VALUE_CODE_META.map((meta) => meta.code)
    );
    expect(VALUE_CODES_CONTRACT.codes).toHaveLength(16);
    expect(VALUE_CODE_META.every((meta) => valueCodeKeySchema.safeParse(meta.code).success)).toBe(true);
  });

  it("锁定 5 种状态与顺序：ALREADY_HAVE / PARTIAL / TIME_DEPENDENT / NOT_HAVE / UNKNOWN", () => {
    expect(VALUE_CODE_STATUS_ORDER).toEqual([
      "ALREADY_HAVE",
      "PARTIAL",
      "TIME_DEPENDENT",
      "NOT_HAVE",
      "UNKNOWN"
    ]);
    expect(VALUE_CODES_CONTRACT.statuses.map((item) => item.status)).toEqual([...VALUE_CODE_STATUS_ORDER]);
  });

  it("红线开关必须全部为真，并且钉死 §19 的安全句与禁止写法", () => {
    expect(VALUE_CODES_CONTRACT.time_dependent_safe_expression).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(VALUE_CODES_CONTRACT.time_dependent_forbidden_expression).toBe(
      TIME_DEPENDENT_FORBIDDEN_EXPRESSION
    );
    expect(VALUE_CODES_CONTRACT.time_dependent_not_promise).toBe(true);
    expect(VALUE_CODES_CONTRACT.no_competitor_fact_transplant).toBe(true);
    expect(VALUE_CODES_CONTRACT.unknown_is_written_as_unknown).toBe(true);
    expect(VALUE_CODES_CONTRACT.not_have_requires_recorded_fact).toBe(true);
    expect(VALUE_CODES_CONTRACT.evidence_only_from_own_product).toBe(true);
    expect(VALUE_CODES_CONTRACT.rules).toHaveLength(7);
  });

  it("下游交接已全部交付：不得把已交付阶段留在交接清单里（§60）", () => {
    expect(VALUE_CODES_DOWNSTREAM.map((item) => item.phase)).toEqual([]);
    expect(VALUE_CODES_DOWNSTREAM.every((item) => item.status === "PENDING")).toBe(true);
    expect(VALUE_CODES_CONTRACT.stories.map((item) => item.key)).toEqual([...valueStoryKeys]);
  });

  it("证据白名单只允许 product.* 与 §9 的 dna.* 维度", () => {
    for (const meta of VALUE_CODE_META) {
      expect(meta.evidence_refs.length).toBeGreaterThan(1);
      for (const ref of meta.evidence_refs) {
        expect(ref.startsWith("product.") || ref.startsWith("dna.")).toBe(true);
        if (ref.startsWith("dna.")) {
          expect(VALUE_DNA_DIMENSIONS).toContain(ref.slice(4));
        }
      }
    }
  });

  it("时间依赖型 Code 固定为陈化 / 收藏 / 流通，且 contribution 就是安全句", () => {
    expect([...VALUE_CODE_TIME_DEPENDENT_KEYS]).toEqual([
      "AGE_VALUE",
      "COLLECTION_RECOGNITION",
      "MARKET_LIQUIDITY"
    ]);
    for (const code of VALUE_CODE_TIME_DEPENDENT_KEYS) {
      expect(VALUE_CODE_META_BY_KEY[code].contribution).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
    }
  });

  it("入参 schema 严格：生成只接受备注，状态不允许前端自填", () => {
    expect(valueCodeGenerateSchema.safeParse({}).success).toBe(true);
    expect(valueCodeGenerateSchema.safeParse({ notes: "人工复核" }).success).toBe(true);
    expect(valueCodeGenerateSchema.safeParse({ codes: [] }).success).toBe(false);
  });
});

describe("16 个 Code 的状态判定（§18 / §19 / §11）", () => {
  it("事实齐备时绝大多数 Code 为 ALREADY_HAVE，并且每条证据都能回指已录入字段", () => {
    const draft = build();

    expect(draft.codes).toHaveLength(16);
    expect(draft.code_counts.ALREADY_HAVE).toBeGreaterThanOrEqual(12);
    expect(draft.code_counts.UNKNOWN).toBe(0);
    expect(draft.code_counts.TIME_DEPENDENT).toBe(3);
    expect(valueCodeCountsSchema.safeParse(draft.code_counts).success).toBe(true);

    const coded = VALUE_CODE_META_BY_KEY.CORE_ORIGIN;
    const item = draft.codes.find((entry) => entry.code === "CORE_ORIGIN");
    expect(item?.status).toBe("ALREADY_HAVE");
    expect(item?.requirement).toBe(coded.requirement);
    expect(item?.contribution).toBe(coded.contribution);
    expect(item?.evidence.some((entry) => entry.includes("布朗山"))).toBe(true);
    expect(item?.evidence_refs.every((ref) => ref.startsWith("product.") || ref.startsWith("dna."))).toBe(
      true
    );
    expect(item?.layer).toBe("INTERPRETATION");
    expect(item?.gap).toBeNull();
    expect(draft.fact_refs).toContain("product.mountain");
  });

  it("没有任何录入事实时一律 UNKNOWN，statement 必须为 null（§11 / §62-7）", () => {
    const draft = build({ product: emptyProduct("龙德记试样茶") });

    expect(draft.code_counts.UNKNOWN).toBe(16);
    expect(draft.codes.every((item) => item.statement === null)).toBe(true);
    expect(draft.codes.every((item) => item.gap !== null)).toBe(true);
    expect(draft.evidence_gaps.length).toBeGreaterThanOrEqual(16);
    expect(draft.evidence_gaps.some((line) => line.includes("尚未生成价值 DNA"))).toBe(true);
    expect(draft.stories.identity_story.status).toBe("GAP");
    expect(draft.stories.identity_story.text).toBeNull();
  });

  it("只有一条事实时是 PARTIAL，不给成交表达，只给补录方向", () => {
    const draft = build({
      product: { ...emptyProduct("龙德记单点事实茶"), mountain: "布朗山" }
    });
    const item = draft.codes.find((entry) => entry.code === "CORE_ORIGIN");

    expect(item?.status).toBe("PARTIAL");
    expect(item?.statement).toContain("还只有单点事实");
    expect(item?.gap).toContain("交叉印证");
  });

  it("已录入事实明确排除时才允许 NOT_HAVE，并写清是哪条事实排除的（§44）", () => {
    const draft = build({ product: { ...FULL_PRODUCT, tree_type: "台地小树" } });
    const item = draft.codes.find((entry) => entry.code === "PREMIUM_MATERIAL");

    expect(item?.status).toBe("NOT_HAVE");
    expect(item?.status_reason).toContain("product.tree_type=台地小树");
    expect(item?.statement).toContain("已录入事实不支持这一项");
    expect(draft.evidence_gaps.some((line) => line.includes("已录入事实明确排除"))).toBe(true);
  });

  it("时间依赖型 Code：今天不成立但有底子时输出固定安全句，绝不承诺未来（§19）", () => {
    const draft = build();
    const age = draft.codes.find((entry) => entry.code === "AGE_VALUE");

    expect(age?.status).toBe("TIME_DEPENDENT");
    expect(age?.statement).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(age?.safe_expression).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(age?.statement).not.toContain(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
    expect(
      draft.codes.every(
        (item) =>
          !(item.statement ?? "").includes(TIME_DEPENDENT_FORBIDDEN_EXPRESSION) &&
          !(item.contribution ?? "").includes(TIME_DEPENDENT_FORBIDDEN_EXPRESSION)
      )
    ).toBe(true);
  });

  it("时间依赖型 Code 连底子都没有时同样是 UNKNOWN，不是 NOT_HAVE", () => {
    const draft = build({ product: emptyProduct("龙德记试样茶") });
    const age = draft.codes.find((entry) => entry.code === "AGE_VALUE");

    expect(age?.status).toBe("UNKNOWN");
    expect(age?.statement).toBeNull();
  });

  it("绿茶 / 黄茶明确排除陈化价值：NOT_HAVE 而不是 UNKNOWN", () => {
    const draft = build({ product: { ...FULL_PRODUCT, tea_type: "绿茶" } });
    const age = draft.codes.find((entry) => entry.code === "AGE_VALUE");

    expect(age?.status).toBe("NOT_HAVE");
    expect(age?.status_reason).toContain("不具备长期陈化的底子");
  });
});

describe("证据来源与 Value DNA（§44 / §62-5 / §9）", () => {
  it("对标只提供标准：传入锚点上下文后证据里不得出现任何竞品事实", () => {
    const draft = build({
      anchor_context: {
        anchor_id: "00000000-0000-4000-8000-000000000001",
        name: "某竞品高价茶",
        similarity_score: 82,
        price_evidence_score: 88,
        usage: "STANDARD_ONLY"
      }
    });

    const allEvidence = draft.codes.flatMap((item) => item.evidence);
    expect(allEvidence.some((entry) => entry.includes("某竞品高价茶"))).toBe(false);
    expect(draft.fact_refs.every((ref) => ref.startsWith("product.") || ref.startsWith("dna."))).toBe(true);
    const priceStory = draft.stories.price_ceiling_story;
    expect(priceStory.note).toContain("对标");
    expect(priceStory.note).toContain("本产品的事实全部来自自身录入");
  });

  it("自建高端标准模式下价格上限由自身结构决定，不得照抄竞品", () => {
    const draft = build({
      mode: "CATEGORY_CREATOR",
      resolved_by: "NO_RELIABLE_ANCHOR",
      anchor_context: null
    });

    expect(draft.stories.price_ceiling_story.note).toContain("自建高端标准");
    expect(draft.stories.price_ceiling_story.note).toContain("不得照抄任何竞品");
  });

  it("Value DNA 生成的证据按维度白名单收录，并写入 value_dna_refs", () => {
    const draft = build({
      value_dna: valueDnaSchema.parse({
        identity: ["六星孔雀IP"],
        flavor: ["烟香入水"],
        taste: ["浓强回甘"]
      })
    });

    expect(draft.value_dna_refs).toEqual(["dna.identity", "dna.flavor", "dna.taste"]);
    const identity = draft.codes.find((entry) => entry.code === "PEACOCK_IDENTITY");
    expect(identity?.evidence_refs).toContain("dna.identity");
    expect(identity?.evidence.some((entry) => entry.includes("六星孔雀IP"))).toBe(true);
  });

  it("11 维全空的 DNA 视同未生成：不给证据、并在缺口清单里提示（§9）", () => {
    const draft = build({ value_dna: valueDnaSchema.parse({}) });

    expect(draft.value_dna_refs).toEqual([]);
    expect(draft.fact_refs.every((ref) => !ref.startsWith("dna."))).toBe(true);
    expect(draft.evidence_gaps.some((line) => line.includes("尚未生成价值 DNA"))).toBe(true);
  });
});

describe("六类价值故事（§20 / §60）", () => {
  it("产品结构故事与配方哲学故事都不再交接：没生成就留空写缺口（§60）", () => {
    const draft = build();

    // Phase 10 已交付：产品结构故事改为直接引用产品结构正文，没有结构时是 GAP 而不是 HANDOFF。
    expect(draft.stories.product_architecture_story.status).toBe("GAP");
    expect(draft.stories.product_architecture_story.text).toBeNull();
    expect(draft.stories.product_architecture_story.handoff_phase).toBeNull();
    expect(draft.stories.product_architecture_story.gap).toContain("尚未生成产品结构");

    // Phase 11 已交付：配方哲学故事直接引用设计逻辑正文，没有配方哲学时同样是 GAP。
    expect(draft.stories.formula_philosophy_story.status).toBe("GAP");
    expect(draft.stories.formula_philosophy_story.handoff_phase).toBeNull();
    expect(draft.stories.formula_philosophy_story.text).toBeNull();
    expect(draft.stories.formula_philosophy_story.gap).toContain("尚未生成配方哲学");

    // 六类故事已无任何交接：HANDOFF 状态不应再出现。
    Object.values(draft.stories).forEach((story) => {
      expect(story.status).not.toBe("HANDOFF");
      expect(story.handoff_phase).toBeNull();
    });
    expect(VALUE_STORY_HANDOFF_PHASES).toEqual({});
  });

  it("有配方哲学时故事取它的设计逻辑：§57 通过 = READY，分量不足 = GAP（§6 / §57）", () => {
    const passed = build({
      formula_philosophy: {
        version: 2,
        written_components: 4,
        acceptance_passed: true,
        design_logic_ready: true,
        strategy: "这款茶不是靠堆原料成立的，而是靠分工：布朗山承担骨架、易武承担回甘。",
        gap_component_labels: []
      }
    });
    expect(passed.stories.formula_philosophy_story.status).toBe("READY");
    expect(passed.stories.formula_philosophy_story.text).toContain("布朗山承担骨架");
    expect(passed.stories.formula_philosophy_story.gap).toBeNull();
    expect(passed.stories.formula_philosophy_story.note).toContain("第 2 版");

    const partial = build({
      formula_philosophy: {
        version: 1,
        written_components: 3,
        acceptance_passed: false,
        design_logic_ready: true,
        strategy: "这款茶不是靠堆原料成立的，而是靠分工：布朗山承担骨架。",
        gap_component_labels: ["收口"]
      }
    });
    expect(partial.stories.formula_philosophy_story.status).toBe("PARTIAL");
    expect(partial.stories.formula_philosophy_story.text).toContain("布朗山承担骨架");
    expect(partial.stories.formula_philosophy_story.gap).toContain("收口");

    const short = build({
      formula_philosophy: {
        version: 1,
        written_components: 1,
        acceptance_passed: false,
        design_logic_ready: false,
        strategy: "",
        gap_component_labels: ["香气", "回甘", "汤感", "收口"]
      }
    });
    expect(short.stories.formula_philosophy_story.status).toBe("GAP");
    expect(short.stories.formula_philosophy_story.text).toBeNull();
    expect(short.stories.formula_philosophy_story.gap).toContain("不足 2 个");
  });

  it("有产品结构时结构故事取它的正文：验收通过 = READY，角色不足 = GAP（§5 / §57）", () => {
    const passed = build({
      product_architecture: {
        version: 3,
        written_roles: 9,
        acceptance_passed: true,
        narrative: "它不是把卖点堆在一起，而是每一部分都有自己的任务：布朗山负责骨架。",
        gap_role_labels: []
      }
    });
    expect(passed.stories.product_architecture_story.status).toBe("READY");
    expect(passed.stories.product_architecture_story.text).toContain("布朗山负责骨架");
    expect(passed.stories.product_architecture_story.gap).toBeNull();
    expect(passed.stories.product_architecture_story.note).toContain("第 3 版");

    const short = build({
      product_architecture: {
        version: 1,
        written_roles: 5,
        acceptance_passed: false,
        narrative: "它不是把卖点堆在一起，而是每一部分都有自己的任务：布朗山负责骨架。",
        gap_role_labels: ["中段", "记忆点"]
      }
    });
    expect(short.stories.product_architecture_story.status).toBe("PARTIAL");
    expect(short.stories.product_architecture_story.text).not.toBeNull();
    expect(short.stories.product_architecture_story.gap).toContain("中段");

    const empty = build({
      product_architecture: {
        version: 2,
        written_roles: 2,
        acceptance_passed: false,
        narrative: "",
        gap_role_labels: ["骨架"]
      }
    });
    expect(empty.stories.product_architecture_story.status).toBe("GAP");
    expect(empty.stories.product_architecture_story.text).toBeNull();
    expect(empty.stories.product_architecture_story.gap).toContain("不足 3 个");
  });

  it("事实齐备时身份 / 价格上限 / 风味故事为 READY，且引用同一批 Code", () => {
    const draft = build();

    expect(draft.stories.identity_story.status).toBe("READY");
    expect(draft.stories.identity_story.text).toContain("六星孔雀");
    expect(draft.stories.identity_story.based_on).toEqual([
      "PEACOCK_IDENTITY",
      "STYLE_RECOGNITION",
      "BRAND_PREMIUM"
    ]);
    expect(draft.stories.price_ceiling_story.status).toBe("READY");
    expect(draft.stories.flavor_identity_story.status).toBe("READY");
    expect(draft.stories.identity_story.layer).toBe("INTERPRETATION");
  });

  it("时间故事只能说底子：text 用 §19 安全句，绝不出现「以后一定会有。」", () => {
    const draft = build();
    const time = draft.stories.time_story;

    expect(time.status).toBe("READY");
    expect(time.text).toContain(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(time.text).not.toContain(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
    expect(time.note).toContain(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
    expect(time.handoff_phase).toBeNull();
  });

  it("事实不足时故事是 GAP 且 text 为 null，缺口清单指出要先补哪一层录入", () => {
    const draft = build({ product: emptyProduct("龙德记试样茶") });

    expect(draft.stories.time_story.status).toBe("GAP");
    expect(draft.stories.time_story.text).toBeNull();
    expect(draft.stories.flavor_identity_story.gap).toContain("先补 §10 / §9 录入");
  });

  it("输出对象通过 profile schema 校验（16 条 Code + 六类故事 + 版本字段）", () => {
    const draft = build();
    const parsed = valueCodeProfileSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000002",
      product_id: "00000000-0000-4000-8000-000000000003",
      product_name: "龙德记六星孔雀",
      version: 1,
      preference: "AUTO",
      mode_at_generation: "BENCHMARK",
      resolved_by: "AUTO_ANCHOR",
      mode_reason: "自动锚点成立",
      anchor_context: null,
      codes: draft.codes,
      code_counts: draft.code_counts,
      stories: draft.stories,
      evidence_gaps: draft.evidence_gaps,
      fact_refs: draft.fact_refs,
      value_dna_refs: draft.value_dna_refs,
      downstream: [...VALUE_CODES_DOWNSTREAM],
      is_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
      notes: null,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      spec_ref: "§18 / §19 / §20"
    });

    expect(parsed.success).toBe(true);
    expect(VALUE_CODES_CONTRACT.stories).toHaveLength(Object.keys(draft.stories).length);
  });
});
