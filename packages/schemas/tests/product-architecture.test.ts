import { describe, expect, it } from "vitest";
import {
  PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS,
  PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS,
  PRODUCT_ARCHITECTURE_CONTRACT,
  PRODUCT_ARCHITECTURE_DOWNSTREAM,
  PRODUCT_ARCHITECTURE_LIMITS,
  PRODUCT_ARCHITECTURE_ROLE_META,
  PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS,
  buildProductArchitecture,
  emptyValueDna,
  productArchitectureCitations,
  productArchitectureFactValue,
  productArchitectureGapReason,
  productArchitectureListQuerySchema,
  productArchitectureRoleKeys,
  productArchitectureSchema,
  productArchitectureSummary,
  productArchitectureUpdateSchema,
  valueDnaSchema,
  type ProductArchitectureProductInput
} from "../src/index.js";

/**
 * Phase 10（规格 §5 产品结构叙事 / §45 Agent 7 / §57 验收 / §62-15 版本与确认）。
 *
 * 这里只测「纯函数结构引擎」：不碰数据库、不调用 AI。
 * 关键红线——角色只能引用本产品已录入事实，事实不足一律留空写缺口；
 * 九个角色顺序固定，不得增删或重排。
 */

/** 与 services/api/tests/helpers/app.ts 的 §58 fixture 同口径（龙德记六星孔雀）。 */
const FULL_PRODUCT: ProductArchitectureProductInput = {
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

/** 只录入身份与规格：除身份外的角色都必须留空。 */
const THIN_PRODUCT: ProductArchitectureProductInput = {
  product_name: "龙德记试样茶",
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

function withFacts(partial: Partial<ProductArchitectureProductInput>): ProductArchitectureProductInput {
  return { ...THIN_PRODUCT, ...partial };
}

/** 事实齐备产品的 Value DNA（§9）：与 API 侧自动生成的口径一致，只承载已录入事实的抽象。 */
const FULL_DNA = valueDnaSchema.parse({
  identity: ["六星孔雀"],
  origin: ["布朗山"],
  material: ["大树春茶"],
  flavor: ["烟香明显"],
  taste: ["浓强", "厚度"],
  positioning: ["高端收藏级"],
  architecture_signals: ["强骨架"]
});

describe("§5 / §45 合同自检", () => {
  it("九个角色顺序固定，不得增删或重排", () => {
    expect(productArchitectureRoleKeys).toEqual([
      "backbone",
      "identity",
      "aroma_role",
      "body_role",
      "front_stage_role",
      "middle_stage_role",
      "finish_role",
      "memory_point",
      "value_role"
    ]);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.roles.map((role) => role.key)).toEqual([
      ...productArchitectureRoleKeys
    ]);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.role_count).toBe(9);
  });

  it("每个角色都写明提问口径 / 定义 / 最少事实 / 允许引用的字段", () => {
    for (const meta of PRODUCT_ARCHITECTURE_ROLE_META) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.short_label.length).toBeGreaterThan(0);
      expect(meta.question.length).toBeGreaterThan(0);
      expect(meta.definition.length).toBeGreaterThan(0);
      expect(meta.requirement.length).toBeGreaterThan(0);
      // value_role 不直接挂字段（它由其它角色的分工串起来）
      if (meta.key !== "value_role") {
        expect(meta.evidence_refs.length).toBeGreaterThan(0);
      }
      for (const ref of meta.evidence_refs) {
        expect(ref.startsWith("product.") || ref.startsWith("dna.")).toBe(true);
      }
    }
  });

  it("§45 的 8 个问题逐条落到角色上，第 6 问是 finish_role 的延伸", () => {
    expect(PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS).toHaveLength(8);
    expect(PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS.map((item) => item.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8
    ]);
    for (const question of PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS) {
      expect(productArchitectureRoleKeys).toContain(question.role);
    }
    const tail = PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS[5];
    expect(tail?.question).toBe("什么负责尾韵？");
    expect(tail?.role).toBe("finish_role");
    expect(tail?.note).toContain("不单独设字段");
    expect(PRODUCT_ARCHITECTURE_AGENT7_QUESTIONS[7]?.role).toBe("value_role");
  });

  it("§57 验收必答五项固定，红线全部成立，下游只登记 Phase 11 / 12 / 14", () => {
    expect(PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS).toEqual([
      "backbone",
      "aroma_role",
      "middle_stage_role",
      "finish_role",
      "memory_point"
    ]);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.no_new_facts).toBe(true);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.no_fabricated_relation).toBe(true);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.gap_stays_empty).toBe(true);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.evidence_only_from_own_product).toBe(true);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.rhetoric_allowed_for_structure_only).toBe(true);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.structure_not_parameter_list).toBe(true);
    expect(PRODUCT_ARCHITECTURE_CONTRACT.rules).toHaveLength(7);
    expect(PRODUCT_ARCHITECTURE_DOWNSTREAM.map((item) => item.phase)).toEqual([]);
    for (const item of PRODUCT_ARCHITECTURE_DOWNSTREAM) {
      expect(item.status).toBe("PENDING");
    }
    expect(PRODUCT_ARCHITECTURE_LIMITS.maxDnaRefsPerRole).toBe(3);
    expect(PRODUCT_ARCHITECTURE_LIMITS.minWrittenRolesForValueRole).toBe(3);
  });
});

describe("§5 / §45 结构生成", () => {
  it("事实齐备：九个角色全部写实，§57 验收通过，价值位叙事成型", () => {
    const draft = buildProductArchitecture({ product: FULL_PRODUCT, value_dna: FULL_DNA });

    expect(draft.roles.map((role) => role.key)).toEqual([...productArchitectureRoleKeys]);
    expect(draft.roles.every((role) => role.status === "WRITTEN")).toBe(true);
    expect(draft.role_counts).toEqual({ written: 9, gap: 0 });
    expect(draft.acceptance.passed).toBe(true);
    expect(draft.acceptance.missing_keys).toEqual([]);
    expect(draft.evidence_gaps).toEqual([]);
    expect(draft.narrative).toContain("它不是把卖点堆在一起");

    const backbone = draft.roles.find((role) => role.key === "backbone");
    expect(backbone?.text.startsWith("布朗山负责骨架")).toBe(true);
    // 证据逐字可回查：引用值必须原样出现在正文里
    for (const role of draft.roles) {
      expect(role.citations.length).toBeGreaterThan(0);
      for (const citation of role.citations) {
        const [ref, value] = [citation.slice(0, citation.indexOf("=")), citation.slice(citation.indexOf("=") + 1)];
        expect(ref.startsWith("product.") || ref.startsWith("dna.")).toBe(true);
        expect(role.text.includes(value)).toBe(true);
      }
      expect(new Set(role.evidence_refs).size).toBe(role.evidence_refs.length);
      expect(role.evidence_refs.every((ref) => role.citations.some((item) => item.startsWith(`${ref}=`)))).toBe(
        true
      );
    }
  });

  it("事实不足：角色留空写缺口，§57 验收不通过，价值位不成立且正文为空（§11 / §62-7）", () => {
    const draft = buildProductArchitecture({ product: THIN_PRODUCT, value_dna: null });

    expect(draft.role_counts).toEqual({ written: 1, gap: 8 });
    // 只有身份靠产品名与茶类立得住，其余一律空字符串——不得用形容词补圆
    const written = draft.roles.filter((role) => role.status === "WRITTEN").map((role) => role.key);
    expect(written).toEqual(["identity"]);
    for (const role of draft.roles.filter((item) => item.status === "GAP")) {
      expect(role.text).toBe("");
      expect(role.citations).toEqual([]);
      expect(role.evidence_refs).toEqual([]);
      // value_role 不是「缺某个字段」，而是「写实的结构角色还不够」，缺口文案另算（见下）
      if (role.key !== "value_role") {
        expect(role.gap).toContain("未录入相关事实，先补");
      }
    }
    expect(draft.roles.find((role) => role.key === "backbone")?.gap).toContain("product.mountain");
    expect(draft.roles.find((role) => role.key === "value_role")?.gap).toContain("3 个");
    expect(draft.narrative).toBe("");
    expect(draft.acceptance.passed).toBe(false);
    expect(draft.acceptance.missing_keys).toEqual([...PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS]);
    expect(draft.evidence_gaps.length).toBeGreaterThan(0);
    expect(draft.evidence_gaps.some((gap) => gap.includes("价值 DNA"))).toBe(true);
    expect(draft.evidence_refs).toEqual(["product.product_name", "product.tea_type"]);
  });

  it("价值位门槛：少于 3 个写实角色不成立，达到 3 个才成立（§11 / §62-7）", () => {
    // 身份永远成立（产品名 + 茶类）；中段与回甘各只撑起一个角色，因此写实数可控。
    const twoRoles = buildProductArchitecture({
      product: withFacts({ product_name: "试样 A", middle_stage: "中段稳定" }),
      value_dna: null
    });
    expect(twoRoles.role_counts.written).toBe(2);
    expect(twoRoles.roles.find((role) => role.key === "value_role")?.status).toBe("GAP");
    expect(twoRoles.narrative).toBe("");

    const threeRoles = buildProductArchitecture({
      product: withFacts({ product_name: "试样 B", middle_stage: "中段稳定", huigan: "快" }),
      value_dna: null
    });
    // 身份 + 中段 + 后半程 3 个结构角色立住后，价值位本身也算一个写实角色（§5 的叙事收口）。
    const structuralWritten = threeRoles.roles
      .filter((role) => role.status === "WRITTEN" && role.key !== "value_role")
      .map((role) => role.key);
    expect(structuralWritten).toEqual(["identity", "middle_stage_role", "finish_role"]);
    expect(threeRoles.role_counts.written).toBe(4);
    expect(threeRoles.roles.find((role) => role.key === "value_role")?.status).toBe("WRITTEN");
    expect(threeRoles.narrative).toContain("它不是把卖点堆在一起");
  });

  it("单角色最多引用 3 条 Value DNA（避免一个角色被 DNA 刷满）", () => {
    const dna = valueDnaSchema.parse({
      material: ["大树春茶", "古树料", "单株", "春料"],
      taste: ["浓强", "厚重", "饱满", "持久"]
    });
    const draft = buildProductArchitecture({ product: FULL_PRODUCT, value_dna: dna });

    for (const role of draft.roles) {
      const dnaCitations = role.citations.filter((citation) => citation.startsWith("dna."));
      expect(dnaCitations.length).toBeLessThanOrEqual(PRODUCT_ARCHITECTURE_LIMITS.maxDnaRefsPerRole);
    }
  });

  it("11 维全空的 DNA 视同「尚未生成」：不给证据，并提示补 DNA（§9 / §11）", () => {
    const draft = buildProductArchitecture({ product: FULL_PRODUCT, value_dna: emptyValueDna() });

    expect(draft.value_dna_refs).toEqual([]);
    expect(draft.evidence_gaps.some((gap) => gap.includes("价值 DNA"))).toBe(true);
  });
});

describe("§45 / §62-5 事实回查", () => {
  it("productArchitectureFactValue 只回查已录入字段，空串一律视为未录入", () => {
    expect(productArchitectureFactValue(FULL_PRODUCT, "product.mountain")).toBe("布朗山");
    expect(productArchitectureFactValue(FULL_PRODUCT, "product.tree_age")).toBeNull();
    expect(productArchitectureFactValue(FULL_PRODUCT, "product.not_a_field")).toBeNull();
    expect(productArchitectureFactValue(withFacts({ mountain: "   " }), "product.mountain")).toBeNull();
  });

  it("citations 只在正文逐字包含该事实时才产生引用", () => {
    const meta = PRODUCT_ARCHITECTURE_ROLE_META.find((item) => item.key === "backbone");
    expect(meta).toBeDefined();
    if (!meta) {
      return;
    }
    expect(productArchitectureCitations(FULL_PRODUCT, null, meta, "布朗山负责骨架。")).toEqual([
      "product.mountain=布朗山"
    ]);
    expect(productArchitectureCitations(FULL_PRODUCT, null, meta, "它负责骨架。")).toEqual([]);
    expect(productArchitectureCitations(FULL_PRODUCT, null, meta, "   ")).toEqual([]);
  });

  it("缺口文案区分「缺具体事实」与「写实角色不足」两种原因", () => {
    const backbone = PRODUCT_ARCHITECTURE_ROLE_META.find((item) => item.key === "backbone");
    const valueRole = PRODUCT_ARCHITECTURE_ROLE_META.find((item) => item.key === "value_role");
    expect(backbone && valueRole).toBeTruthy();
    if (!backbone || !valueRole) {
      return;
    }
    expect(productArchitectureGapReason(backbone)).toContain("未录入相关事实，先补");
    expect(productArchitectureGapReason(valueRole, 1)).toContain("只有 1 个");
    expect(productArchitectureGapReason(valueRole, 1)).toContain("不足 3 个");
  });

  it("productArchitectureSummary 与生成口径同源（谁写实 / 谁留空 / §57 缺哪几项）", () => {
    const draft = buildProductArchitecture({ product: THIN_PRODUCT, value_dna: null });
    const summary = productArchitectureSummary(draft.architecture);

    expect(summary.written_roles).toBe(1);
    expect(summary.gap_role_keys).toHaveLength(8);
    expect(summary.gap_role_labels).toContain("骨架");
    expect(summary.missing_acceptance_keys).toEqual([...PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS]);
    expect(summary.acceptance_passed).toBe(false);

    const full = productArchitectureSummary(
      buildProductArchitecture({ product: FULL_PRODUCT, value_dna: null }).architecture
    );
    expect(full.written_roles).toBe(9);
    expect(full.gap_role_keys).toEqual([]);
    expect(full.acceptance_passed).toBe(true);
  });
});

describe("§5 / §62-15 输入校验与状态口径", () => {
  it("角色状态只有两种，GAP 文案明确写「留空」", () => {
    expect(PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS.WRITTEN).toBe("已写实");
    expect(PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS.GAP).toContain("留空");
  });

  it("九个角色键永远齐全：正文允许为空串，缺键补成空串，未知字段不入结构", () => {
    const nine = {
      backbone: "布朗山负责骨架。",
      identity: "",
      aroma_role: "",
      body_role: "",
      front_stage_role: "",
      middle_stage_role: "",
      finish_role: "",
      memory_point: "",
      value_role: ""
    };
    const parsed = productArchitectureSchema.parse(nine);
    // 读到的结构永远是九个键都在（缺的补空字符串），读取侧不必判空。
    expect(Object.keys(parsed)).toEqual([...productArchitectureRoleKeys]);
    expect(parsed.backbone).toBe("布朗山负责骨架。");
    expect(parsed.memory_point).toBe("");

    const partial = productArchitectureSchema.parse({ backbone: "布朗山负责骨架。" });
    expect(Object.keys(partial)).toEqual([...productArchitectureRoleKeys]);
    expect(partial.value_role).toBe("");

    // 正文只接受字符串：数字之类的脏数据不成立。
    expect(productArchitectureSchema.safeParse({ ...nine, memory_point: 123 }).success).toBe(false);
    expect(productArchitectureSchema.parse({ ...nine, extra_role: "x" })).not.toHaveProperty("extra_role");
  });

  it("列表查询不接受未知参数，排序与角色都走白名单（§5 / §17）", () => {
    expect(productArchitectureListQuerySchema.safeParse({ sort: "-written_roles" }).success).toBe(true);
    expect(productArchitectureListQuerySchema.safeParse({ sort: "-gap_roles" }).success).toBe(true);
    expect(productArchitectureListQuerySchema.safeParse({ role: "backbone" }).success).toBe(true);
    expect(productArchitectureListQuerySchema.safeParse({ mode: "BENCHMARK" }).success).toBe(true);
    expect(productArchitectureListQuerySchema.safeParse({ mode: "CATEGORY_CREATOR" }).success).toBe(true);
    expect(productArchitectureListQuerySchema.safeParse({ mode: "GUESS" }).success).toBe(false);
    expect(productArchitectureListQuerySchema.safeParse({ role: "color" }).success).toBe(false);
    expect(productArchitectureListQuerySchema.safeParse({ sort: "price_desc" }).success).toBe(false);
    expect(productArchitectureListQuerySchema.safeParse({ unknown: "1" }).success).toBe(false);
    expect(
      productArchitectureListQuerySchema.safeParse({ pageSize: PRODUCT_ARCHITECTURE_LIMITS.maxPageSize + 1 })
        .success
    ).toBe(false);
  });

  it("人工确认只接受确认与备注两个字段（多余字段直接拒绝）", () => {
    expect(productArchitectureUpdateSchema.safeParse({ is_confirmed: true }).success).toBe(true);
    expect(productArchitectureUpdateSchema.safeParse({ notes: null }).success).toBe(true);
    expect(productArchitectureUpdateSchema.safeParse({}).success).toBe(true);
    expect(productArchitectureUpdateSchema.safeParse({ is_confirmed: true, status: "WRITTEN" }).success).toBe(false);
    expect(productArchitectureUpdateSchema.safeParse({ notes: "长".repeat(2001) }).success).toBe(false);
  });
});
