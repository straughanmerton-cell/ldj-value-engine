import { describe, expect, it } from "vitest";
import {
  FORMULA_COMPONENT_COUNT,
  FORMULA_COMPONENT_META,
  FORMULA_COMPONENT_STATUS_LABELS,
  FORMULA_PHILOSOPHY_ACCEPTANCE_QUESTION,
  FORMULA_PHILOSOPHY_CONTRACT,
  FORMULA_PHILOSOPHY_DOWNSTREAM,
  FORMULA_PHILOSOPHY_LIMITS,
  buildFormulaPhilosophy,
  containsRatioExpression,
  emptyValueDna,
  extractRatioFromBlendDescription,
  formulaComponentKeys,
  formulaPhilosophyCitations,
  formulaPhilosophyFactValue,
  formulaPhilosophyGenerateSchema,
  formulaPhilosophyListQuerySchema,
  formulaPhilosophySummary,
  formulaPhilosophyUpdateSchema,
  formulaRatioSchema,
  resolveFormulaRatio,
  valueDnaSchema,
  type FormulaPhilosophyProductInput
} from "../src/index.js";

/**
 * Phase 11（规格 §6 Formula Philosophy / §46 Agent 8 / §57 验收 / §6.1 比例红线）。
 *
 * 这里只测「纯函数配方哲学引擎」：不碰数据库、不调用 AI。
 * 两条关键红线——没有确切比例绝不编比例；没有录入的原料绝不新增原料。
 */

const FULL_PRODUCT: FormulaPhilosophyProductInput = {
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

const THIN_PRODUCT: FormulaPhilosophyProductInput = {
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
  liquor_aroma: null,
  viscosity: null,
  water_texture: null,
  finish: null,
  harvest_standard: null,
  storage: null
};

const NO_RATIO = resolveFormulaRatio(FULL_PRODUCT).ratio;
const BLEND_RATIO_PRODUCT: FormulaPhilosophyProductInput = {
  ...FULL_PRODUCT,
  blend_description: "布朗山 60%，易武 40%"
};

describe("配方哲学合同（§6 / §46）", () => {
  it("五个分量与顺序固定，且各自落到 §6.3 的存储字段", () => {
    expect(formulaComponentKeys).toEqual(["backbone", "aroma", "sweetness", "body", "finish"]);
    expect(FORMULA_COMPONENT_COUNT).toBe(5);
    expect(FORMULA_COMPONENT_META.map((meta) => meta.storage_field)).toEqual([
      "backbone_component",
      "aroma_component",
      "sweetness_component",
      "body_component",
      "finish_component"
    ]);
    expect(FORMULA_PHILOSOPHY_CONTRACT.component_count).toBe(5);
  });

  it("合同登记 §46 五项输出、两条红线与下游 Phase", () => {
    expect(FORMULA_PHILOSOPHY_CONTRACT.agent8_outputs.map((output) => output.key)).toEqual([
      "formula_strategy",
      "ingredient_roles",
      "taste_roles",
      "design_goal",
      "sales_explanation"
    ]);
    expect(FORMULA_PHILOSOPHY_CONTRACT.no_fabricated_ratio).toBe(true);
    expect(FORMULA_PHILOSOPHY_CONTRACT.no_new_ingredient).toBe(true);
    expect(FORMULA_PHILOSOPHY_CONTRACT.design_logic_without_ratio).toBe(true);
    expect(FORMULA_PHILOSOPHY_CONTRACT.acceptance.question).toBe(
      FORMULA_PHILOSOPHY_ACCEPTANCE_QUESTION
    );
    expect(FORMULA_PHILOSOPHY_DOWNSTREAM.map((item) => [item.phase, item.status])).toEqual([]);
    expect(FORMULA_COMPONENT_STATUS_LABELS.GAP).toContain("留空");
  });

  it("请求 schema 是 strict 的：多余字段直接拒绝", () => {
    expect(formulaPhilosophyGenerateSchema.safeParse({ unknown: 1 }).success).toBe(false);
    expect(formulaPhilosophyGenerateSchema.safeParse({ notes: "第一版" }).success).toBe(true);
    expect(formulaPhilosophyUpdateSchema.safeParse({ is_confirmed: true }).success).toBe(true);
    expect(formulaPhilosophyUpdateSchema.safeParse({ ratio_data: {} }).success).toBe(false);
    expect(formulaPhilosophyListQuerySchema.safeParse({ component: "backbone" }).success).toBe(true);
    expect(formulaPhilosophyListQuerySchema.safeParse({ component: "nose" }).success).toBe(false);
  });

  it("列表查询的布尔筛选按字符串解析：`known_ratio=false` 不会被当成 true（§6.1）", () => {
    // 查询串永远是字符串：用 coerce.boolean() 的话 "false" 会变成 true，
    // 前端「只看未确认比例」就会返回相反的一批产品。
    const off = formulaPhilosophyListQuerySchema.parse({ known_ratio: "false", missing: "false" });
    expect(off.known_ratio).toBe(false);
    expect(off.missing).toBe(false);
    const on = formulaPhilosophyListQuerySchema.parse({ known_ratio: "true", missing: "true" });
    expect(on.known_ratio).toBe(true);
    expect(on.missing).toBe(true);
    expect(formulaPhilosophyListQuerySchema.safeParse({ known_ratio: "maybe" }).success).toBe(false);
  });
});

describe("没有比例时：不编比例，但仍然写得出设计逻辑（§6.1 / §6.2 / §57）", () => {
  it("极简产品（无原料无感官）：五个分量全留空 + 缺口清单", () => {
    const draft = buildFormulaPhilosophy({
      product: THIN_PRODUCT,
      value_dna: null,
      ratio: NO_RATIO,
      architecture: null
    });
    expect(draft.components.map((component) => component.status)).toEqual([
      "GAP",
      "GAP",
      "GAP",
      "GAP",
      "GAP"
    ]);
    expect(draft.components.every((component) => component.texts.length === 0)).toBe(true);
    expect(draft.formula_strategy).toBe("");
    expect(draft.design_goal).toBe("");
    expect(draft.sales_explanation).toBe("");
    expect(draft.design_logic_ready).toBe(false);
    expect(draft.acceptance.passed).toBe(false);
    expect(draft.evidence_gaps.some((gap) => gap.includes("未确认配方比例"))).toBe(true);
    expect(draft.evidence_gaps.some((gap) => gap.includes("尚未生成产品结构"))).toBe(true);
    expect(draft.evidence_gaps.some((gap) => gap.includes("尚未生成价值 DNA"))).toBe(true);
  });

  it("事实齐备产品：写出「不是把料混起来，而是让每一类原料承担自己的任务」", () => {
    const draft = buildFormulaPhilosophy({
      product: FULL_PRODUCT,
      value_dna: valueDnaSchema.parse({
        ...emptyValueDna(),
        origin: ["布朗山"],
        material: ["大树春茶"]
      }),
      ratio: NO_RATIO,
      architecture: { version: 1, written_roles: 7, acceptance_passed: false }
    });
    expect(draft.component_counts.written).toBe(5);
    expect(draft.design_logic_ready).toBe(true);
    expect(draft.formula_strategy).toContain("不是把几种料混在一起，而是让每一类原料承担自己的任务");
    expect(draft.design_goal).toContain("先定骨架、再定香气、再定回甘");
    expect(draft.sales_explanation).toContain("价值不在原料表，而在设计逻辑");
    expect(draft.acceptance.passed).toBe(true);
    expect(draft.acceptance.no_fabricated_ratio).toBe(true);
    expect(draft.acceptance.coverage_passed).toBe(true);
  });

  it("未确认比例时，正文里一个比例字样都不能出现（含已录入事实里的 60%）", () => {
    const ratio = resolveFormulaRatio(BLEND_RATIO_PRODUCT);
    // 拼配描述里写着完整配比 → 属于 §6.1 的「已知配方事实」，可以使用。
    expect(ratio.problems).toEqual([]);
    expect(ratio.ratio.known_ratio).toBe(true);

    const forcedUnknown = buildFormulaPhilosophy({
      product: BLEND_RATIO_PRODUCT,
      value_dna: null,
      ratio: { known_ratio: false, ratio_data: null, ratio_source: null, ratio_evidence: [] }
    });
    const allTexts = [
      ...forcedUnknown.components.flatMap((component) => component.texts),
      forcedUnknown.formula_strategy,
      forcedUnknown.design_goal,
      forcedUnknown.sales_explanation
    ];
    expect(allTexts.some((text) => containsRatioExpression(text))).toBe(false);
    expect(
      forcedUnknown.evidence_gaps.some((gap) => gap.includes("不足以构成完整配比"))
    ).toBe(true);
    // 骨架分量不得引用带比例字样的拼配描述，但仍可以从其它原料字段取值。
    const backbone = forcedUnknown.components.find((component) => component.key === "backbone");
    expect(backbone?.evidence_refs.includes("product.blend_description")).toBe(false);
    expect(backbone?.texts.join("")).not.toContain("60");
  });

  it("已确认比例：正文可以引用比例，并且写明来源与逐字证据", () => {
    const resolution = resolveFormulaRatio(BLEND_RATIO_PRODUCT);
    const draft = buildFormulaPhilosophy({
      product: BLEND_RATIO_PRODUCT,
      value_dna: null,
      ratio: resolution.ratio
    });
    expect(draft.ratio.known_ratio).toBe(true);
    expect(draft.ratio.ratio_data).toEqual({ 布朗山: "60%", 易武: "40%" });
    expect(draft.ratio.ratio_source).toBe("BLEND_DESCRIPTION");
    expect(draft.ratio.ratio_evidence.join("")).toContain("布朗山 60%");
    expect(draft.formula_strategy).toContain("布朗山 60%");
    expect(draft.formula_strategy).toContain("已确认的配方比例");
  });

  it("只有一处比例字样不算配比：按未知比例处理（§6.1）", () => {
    const single = { ...FULL_PRODUCT, blend_description: "布朗山 60%" };
    expect(extractRatioFromBlendDescription(single)).toBeNull();
    const resolution = resolveFormulaRatio(single);
    expect(resolution.ratio.known_ratio).toBe(false);
    expect(resolution.ratio.ratio_data).toBeNull();
  });
});

describe("没有录入的原料：绝不新增原料（§46 红线）", () => {
  it("登记的配比里出现未录入原料时直接报问题（服务层 400）", () => {
    const resolution = resolveFormulaRatio(FULL_PRODUCT, { 冰岛: "30%", 布朗山: "70%" });
    expect(resolution.ratio.known_ratio).toBe(false);
    expect(resolution.problems.join("")).toContain("冰岛");
    expect(resolution.problems.join("")).toContain("不得新增原料");
  });

  it("登记的配比全部可逐字回查时接受，并把数字规范成百分比", () => {
    const resolution = resolveFormulaRatio(FULL_PRODUCT, { 布朗山: 70, 老班章: "30%" });
    expect(resolution.problems).toEqual([]);
    expect(resolution.ratio.known_ratio).toBe(true);
    expect(resolution.ratio.ratio_data).toEqual({ 布朗山: "70%", 老班章: "30%" });
    expect(resolution.ratio.ratio_source).toBe("REQUEST");
    expect(resolution.ratio.ratio_evidence.length).toBeGreaterThan(0);
  });

  it("ingredient_roles / taste_roles 只包含本产品已录入事实", () => {
    const draft = buildFormulaPhilosophy({
      product: FULL_PRODUCT,
      value_dna: null,
      ratio: NO_RATIO
    });
    const ingredients = draft.ingredient_roles.map((role) => role.ingredient);
    expect(ingredients).toContain("布朗山");
    expect(ingredients).toContain("大树春茶");
    expect(ingredients).not.toContain("冰岛");
    expect(draft.taste_roles.map((role) => role.taste)).toContain("烟香明显");
    for (const role of [...draft.ingredient_roles, ...draft.taste_roles]) {
      expect(formulaPhilosophyFactValue(FULL_PRODUCT, role.evidence_ref)).not.toBeNull();
    }
  });

  it("分量正文的引用可以逐条回查到已录入事实", () => {
    const draft = buildFormulaPhilosophy({
      product: FULL_PRODUCT,
      value_dna: null,
      ratio: NO_RATIO
    });
    const backbone = draft.components.find((component) => component.key === "backbone");
    expect(backbone?.citations.length).toBeGreaterThan(0);
    for (const citation of backbone?.citations ?? []) {
      const index = citation.indexOf("=");
      const ref = citation.slice(0, index);
      const value = citation.slice(index + 1);
      expect(formulaPhilosophyFactValue(FULL_PRODUCT, ref)).toBe(value);
    }
    const rechecked = formulaPhilosophyCitations(
      FULL_PRODUCT,
      null,
      FORMULA_COMPONENT_META[0] as (typeof FORMULA_COMPONENT_META)[number],
      backbone?.texts ?? []
    );
    expect(rechecked).toEqual(backbone?.citations);
  });
});

describe("版本摘要与 §57 验收判定（生成与读取同一口径）", () => {
  it("summary 与 acceptance 由同一份扁平快照得出", () => {
    const draft = buildFormulaPhilosophy({
      product: FULL_PRODUCT,
      value_dna: null,
      ratio: NO_RATIO
    });
    const summary = formulaPhilosophySummary(draft.formula);
    expect(summary.written_components).toBe(draft.component_counts.written);
    expect(summary.gap_component_keys).toEqual([]);
    expect(summary.texts_total).toBeGreaterThanOrEqual(5);
    expect(summary.design_logic_ready).toBe(true);
    expect(draft.acceptance.written_components).toBe(summary.written_components);

    const thin = buildFormulaPhilosophy({
      product: THIN_PRODUCT,
      value_dna: null,
      ratio: NO_RATIO
    });
    expect(formulaPhilosophySummary(thin.formula).gap_component_labels).toEqual([
      "骨架",
      "香气",
      "回甘",
      "汤感",
      "收口"
    ]);
    expect(formulaPhilosophySummary(thin.formula).design_logic_ready).toBe(false);
  });

  it("比例 schema 守住「没有比例就不能有 ratio_data」（§6.1）", () => {
    expect(
      formulaRatioSchema.safeParse({
        known_ratio: false,
        ratio_data: { 布朗山: "60%" },
        ratio_evidence: [],
        ratio_source: null,
        spec_ref: "§6.1"
      }).success
    ).toBe(false);
    expect(
      formulaRatioSchema.safeParse({
        known_ratio: true,
        ratio_data: { 布朗山: "60%" },
        ratio_evidence: [],
        ratio_source: "REQUEST",
        spec_ref: "§6.1"
      }).success
    ).toBe(false);
    expect(
      formulaRatioSchema.safeParse({
        known_ratio: false,
        ratio_data: null,
        ratio_evidence: [],
        ratio_source: null,
        spec_ref: "§6.1"
      }).success
    ).toBe(true);
  });
});

describe("比例字样的识别口径（§6.1）", () => {
  it("认得百分比 / 百分之 / 占比三种写法", () => {
    expect(containsRatioExpression("布朗山 60%")).toBe(true);
    expect(containsRatioExpression("百分之六十的易武")).toBe(true);
    expect(containsRatioExpression("易武占比更高")).toBe(true);
    expect(containsRatioExpression("布朗山与易武拼配")).toBe(false);
  });

  it("名称在前的写法与百分比在前的写法都能识别", () => {
    const nameFirst = extractRatioFromBlendDescription({
      ...FULL_PRODUCT,
      blend_description: "布朗山 60%、易武 40%"
    });
    expect(nameFirst?.ratio_data).toEqual({ 布朗山: "60%", 易武: "40%" });
    const percentFirst = extractRatioFromBlendDescription({
      ...FULL_PRODUCT,
      blend_description: "60% 布朗山，40% 老班章"
    });
    expect(percentFirst?.ratio_data).toEqual({ 布朗山: "60%", 老班章: "40%" });
  });

  it("默认不把 DNA 里的比例字样当作引用（回查也不捡回来）", () => {
    const dna = valueDnaSchema.parse({ ...emptyValueDna(), origin: ["布朗山 60% 易武 40%"] });
    const meta = FORMULA_COMPONENT_META[0];
    if (!meta) {
      throw new Error("缺少骨架分量元数据");
    }
    expect(
      formulaPhilosophyCitations(FULL_PRODUCT, dna, meta, ["骨架由 布朗山 60% 易武 40% 定下来"], {
        known_ratio: true
      })
    ).toContain("dna.origin=布朗山 60% 易武 40%");
    expect(
      formulaPhilosophyCitations(FULL_PRODUCT, dna, meta, ["骨架由 布朗山 60% 易武 40% 定下来"])
    ).toEqual(["product.mountain=布朗山"]);
  });

  it("比例上限来自常量而不是散落的字面量", () => {
    expect(FORMULA_PHILOSOPHY_LIMITS.minWrittenComponentsForStrategy).toBe(2);
    expect(FORMULA_PHILOSOPHY_LIMITS.maxRatioEntries).toBeGreaterThan(0);
    expect(FORMULA_PHILOSOPHY_LIMITS.maxDnaRefsPerComponent).toBe(3);
  });
});
