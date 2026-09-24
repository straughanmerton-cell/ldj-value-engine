import { describe, expect, it } from "vitest";
import {
  CANDIDATE_LIMITS,
  COMPARABLE_CONTRACT,
  SIMILARITY_DIMENSION_WEIGHTS,
  candidateIdentityKey,
  evidenceFromExtraction,
  facetFromExtraction,
  facetFromProductInput,
  normalizeComparableText,
  priceObservationsFromExtraction,
  scoreSimilarity,
  similarityBandForScore,
  similarityDimensions,
  similarityFacetSchema,
  webExtractionAiOutputSchema
} from "../src/index.js";

/** 规格 §58 固定 fixture：龙德记六星孔雀（与 services/api/tests/helpers/app.ts 保持一致）。 */
const TARGET = facetFromProductInput({
  product_name: "龙德记六星孔雀",
  series_name: "六星孔雀",
  tea_type: "普洱生茶",
  tea_subtype: "生茶",
  origin_province: "云南",
  origin_city: "西双版纳",
  origin_region: "勐海",
  mountain: "布朗山",
  raw_material: "大树春茶",
  tree_type: "大树",
  season: "春茶",
  aromas: ["烟香明显"],
  tastes: ["浓强", "回甘快", "生津强"],
  positionings: ["高端收藏"],
  crafts: ["传统石磨压制"],
  weight_g: 357,
  pieces_per_box: 7,
  year: 2026
});

function dimensionScore(similarity: ReturnType<typeof scoreSimilarity>, dimension: string): number {
  const item = similarity.dimensions.find((entry) => entry.dimension === dimension);
  return item?.score ?? -1;
}

describe("§13 可比性评分常量", () => {
  it("十个维度权重合计 100，且顺序与规格表格一致", () => {
    expect(similarityDimensions).toEqual([
      "tea_category",
      "concept",
      "origin",
      "material",
      "aroma",
      "taste",
      "positioning",
      "craft",
      "specification",
      "era"
    ]);
    const total = similarityDimensions.reduce(
      (sum, dimension) => sum + SIMILARITY_DIMENSION_WEIGHTS[dimension],
      0
    );
    expect(total).toBe(100);
    expect(COMPARABLE_CONTRACT.weight_total).toBe(100);
    expect(COMPARABLE_CONTRACT.price_in_similarity).toBe(false);
  });

  it("分档边界与 §13 一致（55 / 70 / 85）", () => {
    expect(similarityBandForScore(54)).toBe("REJECT");
    expect(similarityBandForScore(55)).toBe("PERIPHERAL_REFERENCE");
    expect(similarityBandForScore(69)).toBe("PERIPHERAL_REFERENCE");
    expect(similarityBandForScore(70)).toBe("VALID_COMPARABLE");
    expect(similarityBandForScore(84)).toBe("VALID_COMPARABLE");
    expect(similarityBandForScore(85)).toBe("CORE_COMPARABLE");
    expect(similarityBandForScore(100)).toBe("CORE_COMPARABLE");
  });

  it("候选池上限与 §13 拒绝线绑定", () => {
    expect(CANDIDATE_LIMITS.minScoreToStore).toBe(55);
    expect(CANDIDATE_LIMITS.maxCandidatesPerProduct).toBe(400);
    expect(CANDIDATE_LIMITS.defaultPageSize).toBe(20);
    expect(CANDIDATE_LIMITS.maxPageSize).toBe(100);
  });
});

describe("相似度面不含价格", () => {
  it("相似度面 schema 拒绝任何价格字段（价格不参与相似度）", () => {
    expect(() => similarityFacetSchema.parse({ ...TARGET, price: 480000 })).toThrow();
    expect(() => similarityFacetSchema.parse({ ...TARGET, price_value: 12000 })).toThrow();
    const keys = JSON.stringify(TARGET).toLowerCase();
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("cost");
  });

  it("从网页抽取结果构建的相似度面不携带价格，但价格原话保留为观察价证据", () => {
    const extraction = webExtractionAiOutputSchema.parse({
      product_name: "某某号 六星孔雀",
      brand_name: "某某号",
      year: 2026,
      tea_type: "普洱生茶",
      origin_region: "勐海",
      mountain: "布朗山",
      weight_g: 357,
      prices: [
        {
          value: 480000,
          currency: "CNY",
          quote: "挂牌价 480000 元/件",
          price_type: "LISTING",
          unit_scope: "CASE"
        }
      ],
      facts: [{ field: "原料", value: "大树春茶", quote: "选用布朗山大树春茶" }]
    });
    const facet = facetFromExtraction(extraction);
    expect(JSON.stringify(facet)).not.toContain("480000");
    expect(Object.keys(facet)).not.toContain("price");

    const observations = priceObservationsFromExtraction(extraction, { source_id: null });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.value).toBe(480000);
    expect(observations[0]?.unit_scope).toBe("CASE");
    expect(observations[0]?.price_type).toBe("LISTING");

    const evidence = evidenceFromExtraction(extraction);
    expect(evidence.some((item) => item.kind === "PRICE_QUOTE")).toBe(true);
    expect(evidence.some((item) => item.kind === "EXTRACTED_FACT" && item.field === "原料")).toBe(true);
  });
});

describe("§13 相似度评分", () => {
  it("六星孔雀自比 = 100 核心对标，且没有未知维度", () => {
    const similarity = scoreSimilarity(TARGET, TARGET);
    expect(similarity.total).toBe(100);
    expect(similarity.band).toBe("CORE_COMPARABLE");
    expect(similarity.unknown_dimensions).toEqual([]);
    expect(similarity.matched_dimensions).toHaveLength(10);
  });

  it("山头不同 → 产地维度 0 分，总分落到有效对标分档", () => {
    const candidate = facetFromProductInput({
      product_name: "某某记六星孔雀 冰岛",
      tea_type: "普洱生茶",
      tea_subtype: "生茶",
      origin_province: "云南",
      origin_city: "临沧",
      origin_region: "双江",
      mountain: "冰岛",
      raw_material: "大树春茶",
      tree_type: "大树",
      season: "春茶",
      aromas: ["烟香明显"],
      tastes: ["浓强", "回甘快", "生津强"],
      positionings: ["高端收藏"],
      crafts: ["传统石磨压制"],
      weight_g: 357,
      year: 2026
    });
    const similarity = scoreSimilarity(TARGET, candidate);
    expect(dimensionScore(similarity, "origin")).toBe(0);
    expect(similarity.total).toBe(85);
    expect(similarity.band).toBe("CORE_COMPARABLE");
    expect(similarity.unknown_dimensions).toEqual([]);
  });

  it("缺少山头 → 产地维度进 unknown_dimensions 并按可用茶区层级打折", () => {
    const candidate = facetFromProductInput({
      product_name: "某某记六星孔雀",
      tea_type: "普洱生茶",
      origin_region: "勐海",
      raw_material: "大树春茶",
      aromas: ["烟香明显"],
      weight_g: 357,
      year: 2026
    });
    const similarity = scoreSimilarity(TARGET, candidate);
    expect(similarity.unknown_dimensions).toContain("origin");
    expect(similarity.unknown_dimensions).toContain("craft");
    expect(dimensionScore(similarity, "origin")).toBeCloseTo(10.5, 5);
    expect(dimensionScore(similarity, "craft")).toBe(0);
    expect(similarity.total).toBe(76);
    expect(similarity.band).toBe("VALID_COMPARABLE");
    expect(similarity.warnings.some((warning) => warning.includes("未知不等于相似"))).toBe(true);
  });

  it("生熟相反 → 茶类维度 0 分", () => {
    const candidate = facetFromProductInput({
      product_name: "龙德记六星孔雀熟茶",
      tea_type: "普洱熟茶",
      origin_province: "云南",
      origin_region: "勐海",
      mountain: "布朗山",
      raw_material: "大树春茶",
      aromas: ["烟香明显"],
      tastes: ["浓强", "回甘快", "生津强"],
      weight_g: 357,
      year: 2026
    });
    const similarity = scoreSimilarity(TARGET, candidate);
    expect(dimensionScore(similarity, "tea_category")).toBe(0);
    const teaCategory = similarity.dimensions.find((item) => item.dimension === "tea_category");
    expect(teaCategory?.note).toContain("生熟相反");
  });

  it("任一维度缺失都按 0 分并记录未知维度（不猜测补齐）", () => {
    const candidate = facetFromProductInput({
      tea_type: "普洱生茶",
      origin_region: "勐海",
      mountain: "布朗山",
      weight_g: 357
    });
    const similarity = scoreSimilarity(TARGET, candidate);
    expect(similarity.unknown_dimensions).toContain("concept");
    expect(similarity.unknown_dimensions).toContain("material");
    expect(similarity.unknown_dimensions).toContain("aroma");
    expect(similarity.unknown_dimensions).toContain("era");
    expect(dimensionScore(similarity, "concept")).toBe(0);
    expect(dimensionScore(similarity, "era")).toBe(0);
    expect(similarity.total).toBe(36);
    expect(similarity.band).toBe("REJECT");
  });

  it("价格不同的两个候选，只要相似度面相同，得分完全相同", () => {
    const facetA = facetFromProductInput({ tea_type: "普洱生茶", mountain: "布朗山", weight_g: 357, year: 2026 });
    const facetB = facetFromProductInput({ tea_type: "普洱生茶", mountain: "布朗山", weight_g: 357, year: 2026 });
    const scoreA = scoreSimilarity(TARGET, facetA);
    const scoreB = scoreSimilarity(TARGET, facetB);
    expect(scoreA.total).toBe(scoreB.total);
  });
});

describe("候选去重键与文本归一化", () => {
  it("品牌 + 名称 + 年份 + 规格 相同的候选归为同一条", () => {
    const base = candidateIdentityKey({
      name: "六星孔雀·2026",
      brand_name: "龙德记 ",
      year: 2026,
      weight_g: 357
    });
    const variant = candidateIdentityKey({
      name: "六星孔雀2026",
      brand_name: "龙德记",
      year: 2026,
      weight_g: 357
    });
    const otherYear = candidateIdentityKey({
      name: "六星孔雀·2026",
      brand_name: "龙德记",
      year: 2025,
      weight_g: 357
    });
    expect(base).toBe(variant);
    expect(base).not.toBe(otherYear);
  });

  it("归一化处理全角字符、空白与标点", () => {
    expect(normalizeComparableText("　ＡＢＣ１２３　")).toBe("abc123");
    expect(normalizeComparableText("（大树·春茶）")).toBe("大树春茶");
    expect(normalizeComparableText("布朗山，勐海")).toBe(normalizeComparableText("布朗山 勐海"));
  });
});
