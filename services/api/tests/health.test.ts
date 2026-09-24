import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers/app.js";

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext();
});

afterAll(async () => {
  await context.close();
});

describe("GET /api/health", () => {
  it("返回服务与数据库状态", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; database: string; phase: string };
    expect(body.status).toBe("ok");
    expect(body.database).toBe("up");
    expect(body.phase).toContain("Phase 1");
  });

  it("未知路由返回统一错误结构", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/not-exists" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
