import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPrompt } from "@ldj/prompts";
import {
  PROMPT_MANAGEMENT_CAPABILITIES,
  promptKeys
} from "@ldj/schemas";
import {
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

/**
 * Phase 3（规格 §50 Prompt 管理 / §62-15 所有版本必须保留）。
 *
 * 五项能力逐项验证：version / edit / active / rollback / test run。
 */

interface PromptVersionShape {
  key: string;
  version: number;
  content: string;
  is_active: boolean;
  based_on_version: number | null;
}

let context: TestContext;
let admin: BootstrapResult;

beforeAll(async () => {
  context = await createTestContext();
});

beforeEach(async () => {
  await context.reset();
  admin = await bootstrapAdmin(context.app, {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  });
});

afterAll(async () => {
  await context.close();
});

async function roleToken(role: "RESEARCHER" | "VIEWER" | "COPYWRITER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: `${role.toLowerCase()}-prompt@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

async function versionsOf(key: string): Promise<PromptVersionShape[]> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/prompts/${key}/versions`,
    headers: authHeader(admin.accessToken)
  });
  return (response.json() as { items: PromptVersionShape[] }).items;
}

describe("Prompt 管理（规格 §50）", () => {
  it("列出 11 个 Prompt Key，并注册五项管理能力", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/prompts",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      spec_ref: string;
      capabilities: string[];
      items: { key: string; agent: string; active_version: number | null; version_count: number }[];
    };
    expect(body.spec_ref).toBe("§50");
    expect(body.capabilities).toEqual([...PROMPT_MANAGEMENT_CAPABILITIES]);
    expect(body.items).toHaveLength(promptKeys.length);
    expect(body.items.map((item) => item.key).sort()).toEqual([...promptKeys].sort());
    // 首次访问即把 prompts/*.md 落成 version 1 并启用（所有版本必须保留的起点）。
    for (const item of body.items) {
      expect(item.active_version).toBe(1);
      expect(item.version_count).toBe(1);
    }
  });

  it("未登录 401；非 ADMIN 不能新建版本；试跑对研究/文案角色开放", async () => {
    const anonymous = await context.app.inject({ method: "GET", url: "/api/prompts" });
    expect(anonymous.statusCode).toBe(401);

    const researcher = await roleToken("RESEARCHER");
    const create = await context.app.inject({
      method: "POST",
      url: "/api/prompts/FACT_NORMALIZER/versions",
      headers: authHeader(researcher),
      payload: { content: "试图越权修改" }
    });
    expect(create.statusCode).toBe(403);

    const testRun = await context.app.inject({
      method: "POST",
      url: "/api/prompts/FACT_NORMALIZER/test-run",
      headers: authHeader(researcher),
      payload: { input: "测试输入" }
    });
    expect(testRun.statusCode).toBe(200);

    const viewer = await roleToken("VIEWER");
    const denied = await context.app.inject({
      method: "POST",
      url: "/api/prompts/FACT_NORMALIZER/test-run",
      headers: authHeader(viewer),
      payload: { input: "测试输入" }
    });
    expect(denied.statusCode).toBe(403);
  });

  it("edit 派生新版本且不覆盖历史版本（§62-15）", async () => {
    const original = await versionsOf("FACT_NORMALIZER");
    expect(original).toHaveLength(1);
    expect(original[0]?.content).toBe(loadPrompt("FACT_NORMALIZER"));

    const created = await context.app.inject({
      method: "POST",
      url: "/api/prompts/FACT_NORMALIZER/versions",
      headers: authHeader(admin.accessToken),
      payload: { content: "第二版：更严格的事实整理规则", notes: "收紧树龄表述" }
    });
    expect(created.statusCode).toBe(201);
    const version2 = created.json() as PromptVersionShape;
    expect(version2).toMatchObject({ version: 2, is_active: true, based_on_version: 1 });

    const after = await versionsOf("FACT_NORMALIZER");
    expect(after.map((item) => item.version).sort()).toEqual([1, 2]);
    const v1 = after.find((item) => item.version === 1);
    expect(v1?.content).toBe(loadPrompt("FACT_NORMALIZER"));
    expect(v1?.is_active).toBe(false);
  });

  it("active / rollback：可把启用指针指回任意历史版本，历史仍保留", async () => {
    await context.app.inject({
      method: "POST",
      url: "/api/prompts/SALES_COPYWRITER/versions",
      headers: authHeader(admin.accessToken),
      payload: { content: "第二版成交话术规则" }
    });

    const rollback = await context.app.inject({
      method: "POST",
      url: "/api/prompts/SALES_COPYWRITER/activate",
      headers: authHeader(admin.accessToken),
      payload: { version: 1 }
    });
    expect(rollback.statusCode).toBe(200);
    expect((rollback.json() as PromptVersionShape).version).toBe(1);

    const detail = await context.app.inject({
      method: "GET",
      url: "/api/prompts/SALES_COPYWRITER",
      headers: authHeader(admin.accessToken)
    });
    const body = detail.json() as {
      active_version: number | null;
      version_count: number;
      versions: PromptVersionShape[];
    };
    expect(body.active_version).toBe(1);
    expect(body.version_count).toBe(2);
    expect(body.versions.filter((item) => item.is_active)).toHaveLength(1);

    const unknown = await context.app.inject({
      method: "POST",
      url: "/api/prompts/SALES_COPYWRITER/activate",
      headers: authHeader(admin.accessToken),
      payload: { version: 99 }
    });
    expect(unknown.statusCode).toBe(400);
  });

  it("test run 只读当前启用版本，不落任何业务数据（§50 / §62-13）", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/prompts/FACT_NORMALIZER/test-run",
      headers: authHeader(admin.accessToken),
      payload: { input: "龙德记六星孔雀，布朗山，大树春茶", variables: { brand: "龙德记" } }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      key: string;
      prompt_version: number | null;
      prompt_source: string;
      provider: string;
      output: string;
      schema_valid: boolean | null;
      test_run: boolean;
      persisted: boolean;
    };
    expect(body).toMatchObject({
      key: "FACT_NORMALIZER",
      prompt_version: 1,
      test_run: true,
      persisted: false
    });
    // 无真实 Key 时走 Mock：输出带 MOCK 标记，且 schema 校验结果必须显式返回。
    expect(body.provider).toBe("mock");
    expect(body.output).toContain("[MOCK]");
    expect(body.schema_valid).toBe(false);

    const unknownKey = await context.app.inject({
      method: "POST",
      url: "/api/prompts/NOT_A_PROMPT/test-run",
      headers: authHeader(admin.accessToken),
      payload: { input: "x" }
    });
    expect(unknownKey.statusCode).toBe(400);
  });
});
