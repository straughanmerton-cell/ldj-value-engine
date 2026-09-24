import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SIX_STAR_PEACOCK_FIXTURE,
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

let context: TestContext;
let admin: BootstrapResult;

beforeAll(async () => {
  context = await createTestContext();
});

beforeEach(async () => {
  await context.reset();
  admin = await bootstrapAdmin(context.app, { email: "admin@longdeji.local", password: "AdminPass1234" });
});

afterAll(async () => {
  await context.close();
});

async function createViewerToken(): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: "viewer@longdeji.local",
      password: "ViewerPass1234",
      name: "只读用户",
      role: "VIEWER"
    }
  });
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

describe("Product CRUD（Phase 1）", () => {
  it("创建六星孔雀产品：只保存录入事实，不自动补出树龄/山头以外的信息", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
    });
    expect(response.statusCode).toBe(201);
    const product = response.json() as Record<string, unknown>;
    expect(product.product_name).toBe("龙德记六星孔雀");
    expect(product.mountain).toBe("布朗山");
    expect(product.raw_material).toBe("大树春茶");
    expect(product.tree_age).toBeNull();
    expect(product.blend_description).toBeNull();
    expect(product.r_and_d_reference_enabled).toBe(false);
    expect(product.copy_intensity_default).toBe(4);
    expect(product.benchmark_mode_preference).toBe("AUTO");
    expect(product.product_architecture).toBeNull();
    expect(product.formula_philosophy).toBeNull();
  });

  it("最小字段创建成功后可按名称检索", async () => {
    await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { product_name: "龙德记五星孔雀", year: 2025, tea_type: "普洱生茶", weight_g: 357 }
    });
    await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
    });

    const list = await context.app.inject({
      method: "GET",
      url: "/api/products?q=六星&page=1&pageSize=10",
      headers: authHeader(admin.accessToken)
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { items: Array<{ product_name: string }>; total: number; totalPages: number };
    expect(body.total).toBe(1);
    expect(body.items[0]?.product_name).toBe("龙德记六星孔雀");
    expect(body.totalPages).toBe(1);
  });

  it("更新产品会递增版本号并保留未修改字段", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
    });
    const product = created.json() as { id: string; version: number };

    const updated = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${product.id}`,
      headers: authHeader(admin.accessToken),
      payload: { processing_notes: "手工石磨压制" }
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as Record<string, unknown>;
    expect(body.version).toBe(product.version + 1);
    expect(body.processing_notes).toBe("手工石磨压制");
    expect(body.mountain).toBe("布朗山");
  });

  it("PATCH 只写提交字段：未提交的默认字段不会被静默重置（回归）", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: {
        ...SIX_STAR_PEACOCK_FIXTURE,
        brand_id: null,
        benchmark_mode_preference: "BENCHMARK",
        copy_intensity_default: 5,
        r_and_d_reference_enabled: true
      }
    });
    expect(created.statusCode).toBe(201);
    const product = created.json() as { id: string };

    const patched = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${product.id}`,
      headers: authHeader(admin.accessToken),
      payload: { mountain: "班章" }
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as Record<string, unknown>;
    expect(body.mountain).toBe("班章");
    expect(body.benchmark_mode_preference).toBe("BENCHMARK");
    expect(body.copy_intensity_default).toBe(5);
    expect(body.r_and_d_reference_enabled).toBe(true);
    expect(body.year).toBe(2026);
  });

  it("VIEWER 只能读：写操作 403，且看不到内部成本", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null, internal_cost: 1200 }
    });
    const product = created.json() as { id: string; internal_cost: number };
    expect(product.internal_cost).toBe(1200);

    const viewerToken = await createViewerToken();

    const read = await context.app.inject({
      method: "GET",
      url: `/api/products/${product.id}`,
      headers: authHeader(viewerToken)
    });
    expect(read.statusCode).toBe(200);
    expect((read.json() as { internal_cost: number | null }).internal_cost).toBeNull();

    const write = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${product.id}`,
      headers: authHeader(viewerToken),
      payload: { mountain: "班章" }
    });
    expect(write.statusCode).toBe(403);
  });

  it("未登录访问产品接口返回 401", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/products" });
    expect(response.statusCode).toBe(401);
  });

  it("必填字段缺失或类型非法时返回 VALIDATION_ERROR", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { product_name: "无年份产品", tea_type: "普洱生茶", weight_g: 357 }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("删除产品需要 ADMIN 权限", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
    });
    const product = created.json() as { id: string };

    const viewerToken = await createViewerToken();
    const forbidden = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${product.id}`,
      headers: authHeader(viewerToken)
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${product.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(deleted.statusCode).toBe(204);

    const missing = await context.app.inject({
      method: "GET",
      url: `/api/products/${product.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(missing.statusCode).toBe(404);
  });

  it("§37 规划的核心成交接口已全部接线：清单清空后不再有任何 501 占位", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
    });
    const product = created.json() as { id: string };

    /**
     * Phase 13 交付后，§37 里规划的成交增强接口（含 §34「再狠一点」）全部实现，
     * 因此这里断言的是**相反的一面**：占位清单为空，且强化接口不再是 501，
     * 而是走真实业务（没有版本时明确 400 提示先生成一版）。
     */
    const cases: Array<[string, string, number]> = [];

    for (const [method, url, phase] of cases) {
      const response = await context.app.inject({
        method: method as "GET" | "POST",
        url,
        headers: authHeader(admin.accessToken)
      });
      expect(response.statusCode, `${method} ${url}`).toBe(501);
      expect(response.json()).toMatchObject({ error: { code: "NOT_IMPLEMENTED", details: { phase } } });
    }

    const intensified = await context.app.inject({
      method: "POST",
      url: `/api/products/${product.id}/copy/intensify`,
      headers: authHeader(admin.accessToken),
      payload: { level: "KING" }
    });
    expect(intensified.statusCode).toBe(400);
    expect(intensified.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("/api/meta/core-features 暴露六大核心功能与信息架构（防止功能被裁剪）", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/meta/core-features",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      core_features: Array<{ key: string }>;
      navigation: string[];
      prompts: Array<{ key: string }>;
    };
    const keys = body.core_features.map((feature) => feature.key);
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
    expect(body.navigation).toContain("强成交文案");
    expect(body.prompts).toHaveLength(11);
  });
});
