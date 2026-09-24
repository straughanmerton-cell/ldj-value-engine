import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockAiProvider } from "@ldj/ai";
import { VALUE_DNA_DIMENSIONS } from "@ldj/schemas";
import {
  SIX_STAR_PEACOCK_FIXTURE,
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

/**
 * Phase 3（规格 §9 Value DNA / §39 Agent 1 事实归一 / §50 Prompt 管理输入侧）。
 *
 * 这里集中验证基线 §58-1/2/3/5 的「不自动生成」红线：
 * 300 年古树 / 班章 / 复刻 2003 六星孔雀 / 同款配方 / 研发关系，未录入就必须为空。
 */

/**
 * 规则化 Mock：
 * - Value DNA 调用带「11 个维度」约束，返回一段可回溯内容 + 一段凭空捏造的硬事实；
 * - 其余调用按事实归一输出，其中夹带一条输入里不存在的树龄，用于验证禁止虚构拦截。
 */
function buildTestAiProvider(): MockAiProvider {
  return new MockAiProvider([
    {
      match: /11 个维度/,
      text: JSON.stringify({ dna: { identity: ["布朗山"], material: ["300 年古树"] } })
    },
    {
      match: /[\s\S]*/,
      text: JSON.stringify({
        confirmed_facts: [
          {
            field: "mountain",
            value: "布朗山",
            evidence_note: "产品录入",
            source_text: "product.mountain"
          },
          {
            field: "tree_age",
            value: "300 年古树",
            evidence_note: null,
            source_text: null
          }
        ],
        missing: [{ field: "tree_age", reason: "输入未提供" }]
      })
    }
  ]);
}

let context: TestContext;
let admin: BootstrapResult;
let productId: string;

beforeAll(async () => {
  context = await createTestContext({ aiProvider: buildTestAiProvider() });
});

beforeEach(async () => {
  await context.reset();
  admin = await bootstrapAdmin(context.app, {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  });
  productId = await createProduct({ ...SIX_STAR_PEACOCK_FIXTURE });
});

afterAll(async () => {
  await context.close();
});

async function createProduct(payload: Record<string, unknown>): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: { brand_id: null, ...payload }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function roleToken(role: "RESEARCHER" | "VIEWER" | "COPYWRITER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: `${role.toLowerCase()}-dna@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

function flatten(dna: Record<string, string[]>): string {
  return Object.values(dna).flat().join(" | ");
}

describe("Value DNA（规格 §9）", () => {
  it("产品创建后自动生成 11 维度 DNA，并标注缺失维度", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/value-dna`,
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      stored: boolean;
      value_dna: Record<string, string[]>;
      meta: { generator: string; version: number; product_version: number } | null;
      missing_dimensions: string[];
      current: { fact_count: number };
    };

    expect(body.stored).toBe(true);
    expect(Object.keys(body.value_dna).sort()).toEqual([...VALUE_DNA_DIMENSIONS].sort());
    for (const dimension of VALUE_DNA_DIMENSIONS) {
      expect(Array.isArray(body.value_dna[dimension])).toBe(true);
    }
    // 创建时只跑规则引擎，不联网、不调模型。
    expect(body.meta).toMatchObject({ generator: "RULE_BASED", version: 1 });
    expect(body.current.fact_count).toBe(0);
    // fixture 已提供布朗山与大树春茶：origin / material 必须有值，process 为空。
    expect(body.value_dna.origin).toContain("布朗山");
    expect(body.value_dna.material).toContain("大树春茶");
    expect(body.missing_dimensions).toContain("process");
  });

  it("§58-1/2/3：绝不自动生成 300 年古树 / 班章 / 复刻 2003 六星孔雀", async () => {
    const bare = await createProduct({
      product_name: "龙德记测试饼",
      year: 2026,
      tea_type: "普洱生茶",
      weight_g: 357,
      benchmark_mode_preference: "AUTO",
      copy_intensity_default: 3
    });

    const response = await context.app.inject({
      method: "GET",
      url: `/api/products/${bare}/value-dna`,
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      value_dna: Record<string, string[]>;
      missing_dimensions: string[];
    };
    const text = flatten(body.value_dna);

    for (const forbidden of ["300", "古树", "班章", "2003", "复刻", "同款配方", "六星孔雀"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(body.value_dna.origin).toEqual([]);
    expect(body.value_dna.material).toEqual([]);
    expect(body.missing_dimensions).toEqual(
      expect.arrayContaining(["origin", "material", "process", "flavor", "taste"])
    );
  });

  it("只做登录与角色校验：未登录 401，VIEWER 无写权限 403", async () => {
    const anonymous = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/value-dna`
    });
    expect(anonymous.statusCode).toBe(401);

    const viewer = await roleToken("VIEWER");
    const generate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/value-dna/generate`,
      headers: authHeader(viewer),
      payload: {}
    });
    expect(generate.statusCode).toBe(403);

    const normalize = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts/normalize`,
      headers: authHeader(viewer),
      payload: {}
    });
    expect(normalize.statusCode).toBe(403);

    const researcher = await roleToken("RESEARCHER");
    const allowed = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/value-dna/generate`,
      headers: authHeader(researcher),
      payload: { use_ai: false }
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("重新生成：版本递增、不改变产品版本号，并清除过期标记", async () => {
    const first = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/value-dna/generate`,
      headers: authHeader(admin.accessToken),
      payload: { use_ai: false }
    });
    expect(first.statusCode).toBe(200);
    const generated = first.json() as {
      meta: { generator: string; version: number; product_version: number };
      stale: boolean;
    };
    expect(generated.meta).toMatchObject({ generator: "RULE_BASED", version: 2, product_version: 1 });
    expect(generated.stale).toBe(false);

    // §9 设计：重新生成 DNA 不属于产品资料修改，产品 version 必须保持 1。
    const product = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}`,
      headers: authHeader(admin.accessToken)
    });
    expect((product.json() as { version: number }).version).toBe(1);
  });

  it("上游事实变化后判定为过期（stale），并给出当前计数", async () => {
    const fact = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken),
      payload: { fact_key: "tree_age", fact_value: "树龄 300 年" }
    });
    expect(fact.statusCode).toBe(201);

    const response = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/value-dna`,
      headers: authHeader(admin.accessToken)
    });
    const body = response.json() as {
      stale: boolean;
      current: { fact_count: number };
      value_dna: Record<string, string[]>;
      warnings: string[];
    };
    expect(body.stale).toBe(true);
    expect(body.current.fact_count).toBe(1);
    // 过期不影响读取；重新生成后才把事实并入 DNA。
    expect(body.value_dna.material).not.toContain("树龄 300 年");

    const regenerated = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/value-dna/generate`,
      headers: authHeader(admin.accessToken),
      payload: { use_ai: false }
    });
    const after = regenerated.json() as {
      stale: boolean;
      current: { fact_count: number };
      value_dna: Record<string, string[]>;
      warnings: string[];
    };
    expect(after.stale).toBe(false);
    expect(after.current.fact_count).toBe(1);
    expect(after.value_dna.material).toContain("树龄 300 年");
    // 未确认事实必须显式提示下游不得当作已确认事实使用（§11 / §39）。
    expect(after.warnings.join()).toContain("UNCONFIRMED");
  });

  it("§62-8：AI 补充的条目必须逐字可回溯，捏造的硬事实被丢弃并记入 warnings", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/value-dna/generate`,
      headers: authHeader(admin.accessToken),
      payload: { use_ai: true }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      meta: { generator: string; prompt_key: string | null };
      value_dna: Record<string, string[]>;
      warnings: string[];
    };

    expect(body.meta).toMatchObject({ generator: "AI_ASSISTED", prompt_key: "FACT_NORMALIZER" });
    // 源文本里存在「布朗山」，因此被接受。
    expect(body.value_dna.identity).toContain("布朗山");
    // 源文本里没有「300 年古树」，因此被丢弃。
    expect(flatten(body.value_dna)).not.toContain("300 年古树");
    expect(body.warnings.join()).toContain("无法在源文本中回溯");
    expect(body.warnings.join()).toContain("material:300 年古树");
  });
});

describe("Agent 1 事实归一（规格 §39）", () => {
  it("按六分类整理已录入内容，未提供的硬事实只进 missing，且不写库", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts/normalize`,
      headers: authHeader(admin.accessToken),
      payload: { use_ai: false }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      persisted: false;
      ai_used: boolean;
      candidates: { category: string; field: string; value: string }[];
      output: {
        confirmed_facts: { field: string; value: string }[];
        tasting_facts: { field: string; value: string }[];
        rnd_facts: unknown[];
        user_opinions: unknown[];
        inferences: unknown[];
        missing: { field: string }[];
      };
    };

    expect(body.persisted).toBe(false);
    expect(body.ai_used).toBe(false);
    expect(body.output.confirmed_facts.some((item) => item.field === "mountain")).toBe(true);
    expect(body.output.tasting_facts.some((item) => item.field === "entry_taste")).toBe(true);
    expect(body.output.rnd_facts).toEqual([]);
    // 未提供树龄：只能出现在 missing，绝不允许自动补全。
    expect(body.output.missing.map((item) => item.field)).toContain("tree_age");
    expect(body.candidates.every((item) => item.category !== "missing")).toBe(true);
    expect(body.candidates.map((item) => item.category)).toContain("confirmed_fact");

    // §39：试跑不落库，事实清单保持为空。
    const facts = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken)
    });
    expect(facts.json()).toMatchObject({ total: 0 });
  });

  it("AI 输出的虚构硬事实被识别为 FORBIDDEN_FABRICATION 并丢弃", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts/normalize`,
      headers: authHeader(admin.accessToken),
      payload: { use_ai: true }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      ai_used: boolean;
      dropped: { reason: string; field: string; value: string; details: string[] }[];
      warnings: string[];
      candidates: { category: string; field: string; value: string }[];
    };
    expect(body.ai_used).toBe(true);
    const fabricated = body.dropped.find((item) => item.value === "300 年古树");
    expect(fabricated).toBeDefined();
    expect(fabricated?.reason).toBe("FORBIDDEN_FABRICATION");
    expect(fabricated?.details).toContain("树龄");
    expect(body.warnings.join()).toContain("硬事实");
    // 可回溯的「布朗山」被保留为候选，捏造条目没有进入任何分类。
    expect(body.candidates.some((item) => item.field === "mountain" && item.value === "布朗山")).toBe(true);
    expect(body.candidates.some((item) => item.value === "300 年古树")).toBe(false);
  });
});
