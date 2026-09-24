import { describe, expect, it } from "vitest";
import {
  FACT_NORMALIZER_CONTRACT,
  PROMPT_MANAGEMENT_CAPABILITIES,
  VALUE_DNA_DIMENSIONS,
  activatePromptVersionSchema,
  buildValueDnaFromProduct,
  createPromptVersionSchema,
  emptyValueDna,
  factNormalizationCandidates,
  factNormalizerAiOutputSchema,
  filterValueDnaTraceability,
  findForbiddenFabrications,
  isValueDnaStale,
  mergeValueDna,
  promptKeys,
  sanitizeFactNormalization,
  valueDnaSchema,
  valueDnaToCorpus,
  type ValueDnaInput,
  type ValueDnaMeta
} from "../src/index.js";

/** 规格 §58 固定 fixture：龙德记六星孔雀（与 services/api/tests/helpers/app.ts 保持一致）。 */
const SIX_STAR_PEACOCK: Record<string, unknown> = {
  product_name: "龙德记六星孔雀",
  year: 2026,
  tea_type: "普洱生茶",
  tea_subtype: "生茶",
  origin_province: "云南",
  origin_city: "西双版纳",
  origin_region: "勐海",
  mountain: "布朗山",
  weight_g: 357,
  raw_material: "大树春茶",
  season: "春茶",
  dry_leaf_aroma: "烟香明显",
  entry_taste: "浓强",
  huigan: "快",
  salivation: "强",
  cha_qi: "明显",
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

function fixtureInput(): ValueDnaInput {
  return { product: { ...SIX_STAR_PEACOCK } };
}

describe("产品价值 DNA（规格 §9）", () => {
  it("按 §9 的 11 个维度输出，顺序与基线一致", () => {
    expect(VALUE_DNA_DIMENSIONS).toEqual([
      "identity",
      "category",
      "origin",
      "material",
      "process",
      "flavor",
      "taste",
      "positioning",
      "collection",
      "naming_concepts",
      "architecture_signals"
    ]);
    expect(Object.keys(emptyValueDna())).toEqual([...VALUE_DNA_DIMENSIONS]);
  });

  it("六星孔雀 fixture 能整理出身份、感官与结构信号", () => {
    const result = buildValueDnaFromProduct(fixtureInput());

    expect(result.dna.identity).toEqual(expect.arrayContaining(["六星", "孔雀"]));
    expect(result.dna.category).toContain("普洱生茶");
    expect(result.dna.origin).toEqual(expect.arrayContaining(["勐海", "布朗山"]));
    expect(result.dna.material).toContain("大树春茶");
    expect(result.dna.flavor).toContain("烟香明显");
    expect(result.dna.taste).toEqual(expect.arrayContaining(["浓强", "回甘快", "生津强", "茶气明显"]));
    expect(result.dna.naming_concepts).toEqual(expect.arrayContaining(["星级", "图腾命名"]));
    expect(result.dna.architecture_signals).toEqual(
      expect.arrayContaining(["强骨架", "前段冲击", "后段回甜"])
    );
  });

  it("规则引擎不推导输入里没有的定位与收藏结论", () => {
    const result = buildValueDnaFromProduct(fixtureInput());
    // 定位只能来自已录入字段：fixture 里没有对标模式 / 定价 / 研发参考，因此必须为空。
    expect(result.dna.positioning).toEqual([]);
    expect(sanitizeForbidden(result.dna.positioning)).toEqual([]);
    expect(result.dna.collection).toEqual(["具备长期陈化基础"]);
  });

  it("每条 DNA 条目都带来源，结构信号全部标记为 DERIVED", () => {
    const result = buildValueDnaFromProduct(fixtureInput());
    for (const dimension of VALUE_DNA_DIMENSIONS) {
      for (const value of result.dna[dimension]) {
        const entry = result.provenance[dimension]?.find((item) => item.value === value);
        expect(entry, `${dimension} 缺少来源记录`).toBeDefined();
      }
    }
    for (const entry of result.provenance["architecture_signals"] ?? []) {
      expect(entry.kind).toBe("DERIVED");
      expect(entry.source.startsWith("derived:")).toBe(true);
    }
  });

  it("无输入时不生成任何硬事实，并列出缺失维度", () => {
    const result = buildValueDnaFromProduct({ product: {} });
    expect(result.dna).toEqual(emptyValueDna());
    expect(result.missingDimensions).toHaveLength(VALUE_DNA_DIMENSIONS.length);
    expect(valueDnaSchema.safeParse(result.dna).success).toBe(true);
  });

  it("规格 §58-1 / §58-2 / §58-3：不自动生成 300 年古树、班章、复刻 2003 六星孔雀", () => {
    const result = buildValueDnaFromProduct(fixtureInput());
    const text = JSON.stringify(result.dna);
    expect(text).not.toContain("300");
    expect(text).not.toContain("古树");
    expect(text).not.toContain("班章");
    expect(text).not.toContain("复刻");
    expect(text).not.toContain("同款配方");
    expect(result.warnings).toEqual([]);
  });

  it("只有录入的研发参考才会进入定位，并保留证据状态", () => {
    const result = buildValueDnaFromProduct({
      ...fixtureInput(),
      rndReferences: [
        {
          id: "0f1b5f6e-2a2b-4a1f-9bcd-1f2a3b4c5d6e",
          reference_product_name: "2003 六星孔雀",
          verification_status: "RND_CONFIRMED",
          description: "研发阶段参考其风格"
        }
      ]
    });
    const entry = (result.provenance["positioning"] ?? []).find((item) =>
      item.value.includes("2003 六星孔雀")
    );
    expect(entry?.fact_status).toBe("RND_CONFIRMED");
    expect(result.sourceFactIds).toEqual([]);
  });

  it("未确认事实会带出警告，但不会阻止 DNA 生成", () => {
    const result = buildValueDnaFromProduct({
      ...fixtureInput(),
      facts: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          fact_key: "material_notes",
          fact_value: "据说拼配有老料",
          fact_group: "MATERIAL",
          fact_status: "UNCONFIRMED"
        }
      ]
    });
    expect(result.warnings[0]).toContain("UNCONFIRMED");
    expect(result.sourceFactIds).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("AI 补充条目必须能在源文本逐字回溯（§62-8）", () => {
    const corpus = valueDnaToCorpus(fixtureInput());
    const { dna, rejected } = filterValueDnaTraceability(
      valueDnaSchema.parse({
        material: ["300年古树", "大树春茶"],
        origin: ["班章"]
      }),
      corpus
    );
    expect(dna.material).toEqual(["大树春茶"]);
    expect(dna.origin).toEqual([]);
    expect(rejected.map((item) => item.value)).toEqual(["班章", "300年古树"]);
  });

  it("合并与过期判定按产品版本与上游记录数量计算", () => {
    const merged = mergeValueDna(emptyValueDna(), valueDnaSchema.parse({ identity: ["六星"] }));
    expect(merged.identity).toEqual(["六星"]);
    expect(mergeValueDna(merged, merged).identity).toEqual(["六星"]);

    const meta = valueDnaMeta({ product_version: 1, fact_count: 0, tasting_count: 0, rnd_count: 0 });
    expect(isValueDnaStale(meta, { product_version: 1, fact_count: 0, tasting_count: 0, rnd_count: 0 })).toBe(false);
    expect(isValueDnaStale(meta, { product_version: 2, fact_count: 0, tasting_count: 0, rnd_count: 0 })).toBe(true);
    expect(isValueDnaStale(meta, { product_version: 1, fact_count: 1, tasting_count: 0, rnd_count: 0 })).toBe(true);
  });
});

describe("Agent 1 事实归一（规格 §39 / §58-1～5）", () => {
  const corpus = valueDnaToCorpus(fixtureInput());

  it("§39 六个分类完整登记，研发事实必须自带证据", () => {
    expect([...FACT_NORMALIZER_CONTRACT.categories]).toEqual([
      "confirmed_fact",
      "tasting_fact",
      "rnd_fact",
      "user_opinion",
      "inference",
      "missing"
    ]);
    expect([...FACT_NORMALIZER_CONTRACT.needs_evidence]).toEqual(["rnd_fact"]);
  });

  it("丢弃 AI 自动补出的树龄、山头、复刻与无证据研发关系", () => {
    const corpusWithRnd = `${corpus}\n研发阶段曾参考 2003 六星孔雀`;
    const aiOutput = factNormalizerAiOutputSchema.parse({
      confirmed_facts: [
        { field: "tree_age", value: "300年古树" },
        { field: "mountain", value: "班章" },
        { field: "raw_material", value: "大树春茶" }
      ],
      tasting_facts: [{ field: "entry_taste", value: "浓强" }],
      rnd_facts: [
        { field: "rnd_relationship", value: "复刻 2003 六星孔雀" },
        { field: "rnd_relationship", value: "同款配方" },
        { field: "rnd_relationship", value: "研发阶段曾参考 2003 六星孔雀" }
      ],
      user_opinions: [],
      inferences: [{ field: "tree_age", value: "推测为百年古树" }],
      missing: [{ field: "tree_age", reason: "未提供" }]
    });

    const result = sanitizeFactNormalization(aiOutput, corpusWithRnd);

    expect(result.output.confirmed_facts.map((item) => item.value)).toEqual(["大树春茶"]);
    expect(result.output.tasting_facts.map((item) => item.value)).toEqual(["浓强"]);
    expect(result.output.rnd_facts).toEqual([]);
    expect(result.output.inferences).toEqual([]);
    expect(result.output.missing).toHaveLength(1);
    expect(result.dropped.map((drop) => drop.reason)).toEqual(
      expect.arrayContaining(["FORBIDDEN_FABRICATION", "RND_REQUIRES_EVIDENCE"])
    );
    expect(result.warnings.join("\n")).toContain("硬事实");
  });

  it("输入里本来就有的内容不会被误杀", () => {
    const aiOutput = factNormalizerAiOutputSchema.parse({
      confirmed_facts: [{ field: "mountain", value: "布朗山" }],
      rnd_facts: [
        {
          field: "rnd_relationship",
          value: "研发阶段曾参考 2003 六星孔雀",
          evidence_note: "内部研发记录 R-2026-01"
        }
      ]
    });
    const result = sanitizeFactNormalization(aiOutput, `${corpus}\n研发阶段曾参考 2003 六星孔雀`);
    expect(result.output.confirmed_facts.map((item) => item.value)).toEqual(["布朗山"]);
    expect(result.output.rnd_facts).toHaveLength(1);
    expect(result.dropped).toEqual([]);
  });

  it("候选事实映射到 §11 状态：推理只能停留在 UNCONFIRMED", () => {
    const aiOutput = factNormalizerAiOutputSchema.parse({
      confirmed_facts: [{ field: "raw_material", value: "大树春茶" }],
      tasting_facts: [{ field: "entry_taste", value: "浓强" }],
      inferences: [{ field: "positioning", value: "浓强" }]
    });
    const candidates = factNormalizationCandidates(aiOutput);
    const byCategory = Object.fromEntries(candidates.map((item) => [item.category, item.fact_status]));
    expect(byCategory["confirmed_fact"]).toBe("INTERNAL_CONFIRMED");
    expect(byCategory["tasting_fact"]).toBe("TASTING_CONFIRMED");
    expect(byCategory["inference"]).toBe("UNCONFIRMED");
  });

  it("禁止虚构类型检测会把源文本中没有的硬事实点出来", () => {
    expect(findForbiddenFabrications("300年古树", corpus)).toContain("tree_age");
    expect(findForbiddenFabrications("布朗山", corpus)).toEqual([]);
    expect(findForbiddenFabrications("班章", corpus)).toContain("mountain");
  });
});

describe("Prompt 管理后台契约（规格 §50）", () => {
  it("锁定 §50 的五项能力与 11 个 Prompt Key", () => {
    expect([...PROMPT_MANAGEMENT_CAPABILITIES]).toEqual(["version", "active", "rollback", "edit", "test_run"]);
    expect(promptKeys).toHaveLength(11);
  });

  it("新建版本：内容必填、默认启用、可指定派生版本", () => {
    const parsed = createPromptVersionSchema.parse({ content: "system prompt" });
    expect(parsed.activate).toBe(true);
    expect(parsed.based_on_version).toBeUndefined();
    expect(createPromptVersionSchema.safeParse({ content: "" }).success).toBe(false);
    expect(activatePromptVersionSchema.safeParse({ version: 3 }).success).toBe(true);
    expect(activatePromptVersionSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

function valueDnaMeta(current: {
  product_version: number;
  fact_count: number;
  tasting_count: number;
  rnd_count: number;
}): ValueDnaMeta {
  return {
    generator: "RULE_BASED",
    prompt_key: null,
    prompt_version: null,
    provider: null,
    model: null,
    generated_at: new Date(0).toISOString(),
    version: 1,
    product_version: current.product_version,
    fact_count: current.fact_count,
    tasting_count: current.tasting_count,
    rnd_count: current.rnd_count,
    source_fact_ids: [],
    provenance: {},
    missing_dimensions: [],
    warnings: []
  };
}

function sanitizeForbidden(values: readonly string[]): string[] {
  const forbidden = ["高端", "收藏型", "强风格"];
  return values.filter((value) => forbidden.includes(value));
}
