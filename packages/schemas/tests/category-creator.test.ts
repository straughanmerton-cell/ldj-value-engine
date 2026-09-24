import { describe, expect, it } from "vitest";
import {
  CATEGORY_CREATOR_CONTRACT,
  CATEGORY_CREATOR_DOWNSTREAM,
  CATEGORY_CREATOR_LIMITS,
  CATEGORY_CREATOR_TRIGGER_META,
  buildCategoryCreatorDraft,
  categoryCreatorGenerateSchema,
  categoryCreatorProfileSchema,
  categoryCreatorUpdateSchema,
  categoryReadinesses,
  categoryStandardAxes,
  inferCategoryTrigger,
  valueDnaSchema,
  type CategoryStandardInput
} from "../src/index.js";

/**
 * Phase 8（规格 §4.2 / §17 / §29 / §24）：自建高端标准模式 Category Creator Mode。
 *
 * 这里只测「纯函数自建标准引擎」：不碰数据库、不调用 AI。
 * 关键红线——事实不够时必须输出缺口清单，而不是弱化版文案；UNKNOWN 轴一律不写。
 */

/** 规格 §58 fixture：龙德记六星孔雀（与 services/api/tests/helpers/app.ts 一致）。 */
const FULL_FIXTURE: CategoryStandardInput = {
  trigger: "NO_RELIABLE_ANCHOR",
  value_dna: null,
  product: {
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
    middle_stage: "稳定",
    late_stage: "回甘持续",
    endurance: "12 泡以上"
  }
};

function emptyProduct(name: string): CategoryStandardInput["product"] {
  return {
    product_name: name,
    series_name: null,
    year: 2026,
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
    endurance: null
  };
}

describe("Category Creator 合同（§4.2 / §17 / §29）", () => {
  it("锁定两触发条件、六标准轴与六条规则", () => {
    expect(CATEGORY_CREATOR_CONTRACT.spec_ref).toBe("§4.2 / §17 / §29");
    expect(CATEGORY_CREATOR_TRIGGER_META.map((item) => item.trigger)).toEqual([
      "NO_RELIABLE_ANCHOR",
      "USER_OPT_OUT"
    ]);
    expect(CATEGORY_CREATOR_CONTRACT.axes.map((item) => item.axis)).toEqual([...categoryStandardAxes]);
    expect(CATEGORY_CREATOR_CONTRACT.axes).toHaveLength(6);
    expect(CATEGORY_CREATOR_CONTRACT.rules).toHaveLength(6);
  });

  it("红线开关必须全部为真：不写弱化文案、不编对标、未知就写未知", () => {
    expect(CATEGORY_CREATOR_CONTRACT.not_weak_copy).toBe(true);
    expect(CATEGORY_CREATOR_CONTRACT.no_fake_benchmark).toBe(true);
    expect(CATEGORY_CREATOR_CONTRACT.unknown_is_written_as_unknown).toBe(true);
    expect(CATEGORY_CREATOR_CONTRACT.layers).toEqual(["FACT", "INTERPRETATION", "RHETORIC"]);
  });

  it("下游交接已全部交付：不得把已交付阶段留在交接清单里（§60）", () => {
    expect(CATEGORY_CREATOR_DOWNSTREAM.map((item) => item.phase)).toEqual([]);
    expect(CATEGORY_CREATOR_DOWNSTREAM.every((item) => item.status === "PENDING")).toBe(true);
    expect(CATEGORY_CREATOR_CONTRACT.rules.some((rule) => rule.includes("Phase 10 / 11 / 12"))).toBe(true);
  });

  it("模式推断：强制进入走 NO_RELIABLE_ANCHOR，其余都是用户主动弃用对标", () => {
    expect(inferCategoryTrigger("NO_RELIABLE_ANCHOR")).toBe("NO_RELIABLE_ANCHOR");
    expect(inferCategoryTrigger("AUTO_ANCHOR")).toBe("USER_OPT_OUT");
    expect(inferCategoryTrigger("MANUAL_PREFERENCE")).toBe("USER_OPT_OUT");
  });
});

describe("自建标准六轴（§4.2 / §5）", () => {
  it("事实齐备时六轴全部 SUPPORTED，标准成立为 READY", () => {
    const draft = buildCategoryCreatorDraft(FULL_FIXTURE);

    expect(draft.total_axes).toBe(6);
    expect(draft.standard.items.map((item) => item.axis)).toEqual([...categoryStandardAxes]);
    expect(draft.standard.items.every((item) => item.status === "SUPPORTED")).toBe(true);
    expect(draft.standard.supported_count).toBe(6);
    expect(draft.standard.unknown_count).toBe(0);
    expect(draft.readiness).toBe("READY");
    expect(draft.supported_axes).toBe(6);
    // 六轴都不缺事实，只剩「价值 DNA 未生成」这一条提示（§9）。
    expect(draft.evidence_gaps).toEqual(["尚未生成价值 DNA（§9）：身份轴与价值逻辑的证据面会偏窄"]);

    const withDna = buildCategoryCreatorDraft({
      ...FULL_FIXTURE,
      value_dna: valueDnaSchema.parse({ identity: ["六星孔雀IP"] })
    });
    expect(withDna.evidence_gaps).toHaveLength(0);
  });

  it("每个标准轴都带 requirement / why_it_matters / 事实引用与 INTERPRETATION 标记", () => {
    const draft = buildCategoryCreatorDraft(FULL_FIXTURE);
    const frame = draft.standard.items.find((item) => item.axis === "FRAME");

    expect(frame).toBeDefined();
    expect(frame?.requirement).toContain("产区");
    expect(frame?.why_it_matters.length).toBeGreaterThan(0);
    expect(frame?.evidence_refs).toContain("product.mountain");
    expect(frame?.evidence_summary).toContain("布朗山");
    expect(frame?.statement).toContain("布朗山");
    expect(draft.standard.items.every((item) => item.layer === "INTERPRETATION")).toBe(true);
  });

  it("事实不足时缺口清单取代文案：UNKNOWN 轴 statement 必须为 null（§11 / §62-7）", () => {
    const draft = buildCategoryCreatorDraft({
      trigger: "NO_RELIABLE_ANCHOR",
      value_dna: null,
      product: emptyProduct("龙德记试样茶")
    });

    expect(draft.standard.unknown_count).toBe(6);
    expect(draft.readiness).toBe("INSUFFICIENT");
    expect(draft.supported_axes).toBe(0);
    expect(draft.standard.items.every((item) => item.statement === null)).toBe(true);
    expect(draft.standard.items.every((item) => item.gap !== null)).toBe(true);
    expect(draft.evidence_gaps.length).toBeGreaterThanOrEqual(6);
    expect(draft.evidence_gaps.some((gap) => gap.includes("价值 DNA"))).toBe(true);
  });

  it("只有单点事实时降级为 PARTIAL，而不是直接当标准成立", () => {
    const partialProduct = emptyProduct("龙德记半成品");
    partialProduct.mountain = "布朗山";
    partialProduct.entry_taste = "浓强";
    partialProduct.huigan = "快";

    const draft = buildCategoryCreatorDraft({
      trigger: "NO_RELIABLE_ANCHOR",
      value_dna: null,
      product: partialProduct
    });

    const frame = draft.standard.items.find((item) => item.axis === "FRAME");
    expect(frame?.status).toBe("PARTIAL");
    expect(frame?.statement).not.toBeNull();
    expect(frame?.gap).toContain("单点事实");
    expect(draft.readiness).toBe("PARTIAL");
  });

  it("Value DNA 进入身份轴与价值逻辑，并登记 dna.* 引用（§9）", () => {
    const dna = valueDnaSchema.parse({
      identity: ["六星孔雀IP"],
      naming_concepts: ["六星序列"],
      taste: ["浓强", "回甘快"]
    });
    const draft = buildCategoryCreatorDraft({ ...FULL_FIXTURE, value_dna: dna });
    const identity = draft.standard.items.find((item) => item.axis === "IDENTITY");

    expect(identity?.evidence_refs).toContain("dna.identity");
    expect(draft.value_dna_refs).toContain("dna.identity");
    expect(draft.value_dna_refs).toContain("dna.naming_concepts");
    expect(draft.value_dna_refs).not.toContain("dna.collection");
  });

  it("11 个维度全空的 DNA 视同尚未生成，缺口清单照实提示（不拿空对象充数）", () => {
    const draft = buildCategoryCreatorDraft({ ...FULL_FIXTURE, value_dna: valueDnaSchema.parse({}) });

    expect(draft.value_dna_refs).toEqual([]);
    expect(draft.evidence_gaps).toEqual(["尚未生成价值 DNA（§9）：身份轴与价值逻辑的证据面会偏窄"]);
  });
});

describe("风格身份证与价值逻辑（§4.2 / §24 / §29）", () => {
  it("READY 时输出身份名、定位与成交表达，且不点名竞品", () => {
    const draft = buildCategoryCreatorDraft(FULL_FIXTURE);

    expect(draft.style_identity.identity_name).toContain("布朗山");
    expect(draft.style_identity.category_positioning).toContain("普洱生茶");
    expect(draft.style_identity.first_impression).not.toBeNull();
    expect(draft.style_identity.mid_palate).not.toBeNull();
    expect(draft.style_identity.finish).not.toBeNull();
    expect(draft.style_identity.signature_trait).not.toBeNull();
    expect(draft.style_identity.differentiators.length).toBeGreaterThan(0);
    // §19 TIME_DEPENDENT 属于 Phase 9 Value Codes，本阶段只留位。
    expect(draft.style_identity.time_story).toBeNull();
    expect(draft.style_identity.not_claiming).toHaveLength(3);
    expect(draft.style_identity.not_claiming.join("丨")).toContain("不声称");
  });

  it("价值逻辑四段齐全：FACT → INTERPRETATION → VALUE → SALES_LINE 且层级标死", () => {
    const draft = buildCategoryCreatorDraft(FULL_FIXTURE);

    expect(draft.value_logic.sales_line_ready).toBe(true);
    expect(draft.value_logic.items.map((item) => item.stage)).toEqual([
      "FACT",
      "INTERPRETATION",
      "VALUE",
      "SALES_LINE"
    ]);
    expect(draft.value_logic.items.map((item) => item.layer)).toEqual([
      "FACT",
      "INTERPRETATION",
      "INTERPRETATION",
      "RHETORIC"
    ]);
    expect(draft.value_logic.mode_switch_note).toContain("没有现成对标");
  });

  it("事实不足时不出成交表达：sales_line_ready=false 且没有 SALES_LINE 段（§4.2）", () => {
    const draft = buildCategoryCreatorDraft({
      trigger: "NO_RELIABLE_ANCHOR",
      value_dna: null,
      product: emptyProduct("龙德记空白茶")
    });

    expect(draft.value_logic.sales_line_ready).toBe(false);
    expect(draft.value_logic.items.some((item) => item.stage === "SALES_LINE")).toBe(false);
    expect(draft.value_logic.items.some((item) => item.layer === "RHETORIC")).toBe(false);
    expect(draft.style_identity.first_impression).toBeNull();
    expect(draft.style_identity.signature_trait).toBeNull();
  });

  it("成交表达只引用已录入事实与「必须成立的标准」，不新增事实断言（§29 / §62-7）", () => {
    const draft = buildCategoryCreatorDraft(FULL_FIXTURE);
    const salesLine = draft.value_logic.items.find((item) => item.stage === "SALES_LINE");

    expect(salesLine?.text).toContain("市面上找不到完全一样的对标");
    expect(salesLine?.text).toContain("先定的是标准，不是故事");
    expect(salesLine?.text).toContain("布朗山");
    // 未录入的树龄一律不得出现在成交表达里。
    expect(salesLine?.text).not.toContain("树龄");
    expect(salesLine?.source_refs.length).toBeGreaterThan(0);
  });

  it("至少两个轴有事实支撑才允许写进成交表达（minSupportedAxes）", () => {
    const thinProduct = emptyProduct("龙德记单点事实茶");
    thinProduct.mountain = "布朗山";

    const draft = buildCategoryCreatorDraft({
      trigger: "USER_OPT_OUT",
      value_dna: null,
      product: thinProduct
    });

    expect(CATEGORY_CREATOR_LIMITS.minSupportedAxes).toBe(2);
    expect(draft.readiness).toBe("INSUFFICIENT");
    expect(draft.value_logic.sales_line_ready).toBe(false);
  });
});

describe("Category Creator API 对象", () => {
  it("读档 schema 接受完整自建标准，拒绝多余字段", () => {
    const draft = buildCategoryCreatorDraft(FULL_FIXTURE);
    const profile = {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      product_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
      product_name: "龙德记六星孔雀",
      version: 1,
      trigger: "NO_RELIABLE_ANCHOR",
      mode_at_generation: "CATEGORY_CREATOR",
      readiness: draft.readiness,
      supported_axes: draft.supported_axes,
      total_axes: draft.total_axes,
      standard: draft.standard,
      style_identity: draft.style_identity,
      value_logic: draft.value_logic,
      evidence_gaps: draft.evidence_gaps,
      fact_refs: draft.fact_refs,
      value_dna_refs: draft.value_dna_refs,
      downstream: [...CATEGORY_CREATOR_DOWNSTREAM],
      is_confirmed: false,
      confirmed_by: null,
      confirmed_at: null,
      notes: null,
      created_by: null,
      created_at: "2026-09-23T00:00:00.000Z",
      updated_at: "2026-09-23T00:00:00.000Z",
      spec_ref: "§4.2 / §17 / §29"
    };

    expect(categoryCreatorProfileSchema.parse(profile).readiness).toBe("READY");
    expect(() => categoryCreatorProfileSchema.parse({ ...profile, unexpected: true })).toThrow();
  });

  it("生成 / 更新入参只接受已定义的触发条件与非空备注", () => {
    expect(categoryCreatorGenerateSchema.parse({}).trigger).toBeUndefined();
    expect(categoryCreatorGenerateSchema.parse({ trigger: "USER_OPT_OUT" }).trigger).toBe("USER_OPT_OUT");
    expect(() => categoryCreatorGenerateSchema.parse({ trigger: "MAGIC" })).toThrow();
    expect(() => categoryCreatorGenerateSchema.parse({ notes: "x".repeat(2001) })).toThrow();
    expect(categoryCreatorUpdateSchema.parse({ is_confirmed: true }).is_confirmed).toBe(true);
    expect(categoryCreatorUpdateSchema.parse({ notes: null }).notes).toBeNull();
  });

  it("readiness 枚举与标准轴枚举被数据库枚举复用，必须保持字面量顺序", () => {
    expect([...categoryReadinesses]).toEqual(["READY", "PARTIAL", "INSUFFICIENT"]);
  });
});
