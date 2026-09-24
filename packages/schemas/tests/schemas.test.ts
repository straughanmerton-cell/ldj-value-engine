import { describe, expect, it } from "vitest";
import {
  ANCHOR_REQUIREMENTS,
  COPY_INTENSITY_LEVELS,
  CORE_FEATURES,
  DEFAULT_COPY_INTENSITY,
  IMPACT_SCORE_TOTAL,
  INTENSIFY_LEVEL_TO_COPY_INTENSITY,
  MIN_IMPACT_SCORE_BY_INTENSITY,
  SIMILARITY_WEIGHT_TOTAL,
  createProductSchema,
  formulaPhilosophySchema,
  productArchitectureSchema,
  registerSchema,
  updateProductSchema
} from "../src/index.js";

const minimalProduct = {
  product_name: "龙德记六星孔雀",
  year: 2026,
  tea_type: "普洱生茶",
  weight_g: 357
};

describe("核心功能锁定清单", () => {
  it("必含六大核心功能，不得被裁剪", () => {
    const keys = CORE_FEATURES.map((feature) => feature.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "BENCHMARK_MODE",
        "CATEGORY_CREATOR_MODE",
        "PRODUCT_ARCHITECTURE",
        "FORMULA_PHILOSOPHY",
        "INTENSIFY_BUTTON",
        "LEVEL5_KING_COPY"
      ])
    );
  });
});

describe("产品录入 schema（规格 §10）", () => {
  it("最小必填字段即可创建，且不会自动补出未提供的事实", () => {
    const parsed = createProductSchema.parse(minimalProduct);
    expect(parsed.tree_age).toBeUndefined();
    expect(parsed.mountain).toBeUndefined();
    expect(parsed.raw_material).toBeUndefined();
    expect(parsed.r_and_d_reference_enabled).toBe(false);
    expect(parsed.copy_intensity_default).toBe(DEFAULT_COPY_INTENSITY);
    expect(parsed.benchmark_mode_preference).toBe("AUTO");
  });

  it("缺少 year / tea_type / weight_g 时拒绝", () => {
    expect(createProductSchema.safeParse({ product_name: "六星孔雀" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...minimalProduct, tea_type: "" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...minimalProduct, weight_g: 0 }).success).toBe(false);
  });

  it("更新 schema 允许部分字段", () => {
    const parsed = updateProductSchema.parse({ mountain: "布朗山" });
    expect(parsed).toEqual({ mountain: "布朗山" });
  });
});

describe("产品结构 / 配方哲学（规格 §5、§6）", () => {
  it("产品结构九个角色字段齐备", () => {
    const architecture = productArchitectureSchema.parse({
      backbone: "布朗山",
      identity: "孔雀",
      aroma_role: "烟香",
      body_role: "大树春料",
      front_stage_role: "浓强茶汤",
      middle_stage_role: "厚度",
      finish_role: "回甘生津",
      memory_point: "烟香身份证",
      value_role: "高价值骨架"
    });
    expect(Object.keys(architecture)).toHaveLength(9);
  });

  it("未确认比例时禁止携带比例数据", () => {
    const result = formulaPhilosophySchema.safeParse({
      formula_strategy: "先定骨架再定香气",
      known_ratio: false,
      ratio_data: { 布朗山: "60%" }
    });
    expect(result.success).toBe(false);
  });

  it("确认比例时允许携带比例数据", () => {
    const result = formulaPhilosophySchema.safeParse({
      formula_strategy: "布朗山骨架 + 易武柔甜",
      known_ratio: true,
      ratio_data: { 布朗山: "60%", 易武: "40%" }
    });
    expect(result.success).toBe(true);
  });
});

describe("阈值常量（规格 §13、§15、§23）", () => {
  it("相似度权重合计 100，价格不参与", () => {
    expect(SIMILARITY_WEIGHT_TOTAL).toBe(100);
  });

  it("冲击力权重合计 100", () => {
    expect(IMPACT_SCORE_TOTAL).toBe(100);
  });

  it("锚点触发线保持 70 / 75", () => {
    expect(ANCHOR_REQUIREMENTS).toEqual({ minSimilarity: 70, minPriceEvidence: 75 });
  });

  it("Level 4 >= 85，Level 5 >= 90", () => {
    expect(MIN_IMPACT_SCORE_BY_INTENSITY[4]).toBe(85);
    expect(MIN_IMPACT_SCORE_BY_INTENSITY[5]).toBe(90);
  });
});

describe("强度映射（规格 §7、§21）", () => {
  it("牛逼化按钮映射到 Level 2/3/4/5", () => {
    expect(INTENSIFY_LEVEL_TO_COPY_INTENSITY).toEqual({
      NORMAL: 2,
      STRONG: 3,
      VIRAL: 4,
      KING: 5
    });
    expect(COPY_INTENSITY_LEVELS.KING).toBe(5);
  });
});

describe("Auth schema", () => {
  it("弱密码被拒绝", () => {
    const result = registerSchema.safeParse({
      email: "a@b.com",
      password: "1234567890",
      name: "研究员"
    });
    expect(result.success).toBe(false);
  });

  it("邮箱统一小写", () => {
    const result = registerSchema.parse({
      email: "Admin@LongDeJi.COM",
      password: "Longdeji2026",
      name: "管理员"
    });
    expect(result.email).toBe("admin@longdeji.com");
  });
});
