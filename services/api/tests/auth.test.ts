import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authHeader, bootstrapAdmin, createTestContext, type TestContext } from "./helpers/app.js";

let context: TestContext;

beforeAll(async () => {
  context = await createTestContext();
});

beforeEach(async () => {
  await context.reset();
});

afterAll(async () => {
  await context.close();
});

describe("Auth（Phase 1）", () => {
  it("第一个注册用户自动成为 ADMIN（bootstrap）", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "owner@longdeji.local", password: "OwnerPass1234", name: "老板" }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { user: { role: string }; tokens: { access_token: string } };
    expect(body.user.role).toBe("ADMIN");
    expect(body.tokens.access_token).toBeTruthy();
  });

  it("已有用户后未登录注册被拒绝，管理员可以创建指定角色用户", async () => {
    const admin = await bootstrapAdmin(context.app);

    const anonymous = await context.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "stranger@longdeji.local", password: "StrangerPass1234", name: "陌生人" }
    });
    expect(anonymous.statusCode).toBe(403);

    const created = await context.app.inject({
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
    expect(created.statusCode).toBe(201);
    expect((created.json() as { user: { role: string } }).user.role).toBe("VIEWER");
  });

  it("密码错误返回 401，登录成功后可以访问 /api/auth/me", async () => {
    await bootstrapAdmin(context.app, { email: "r@longdeji.local", password: "Researcher1234" });

    const failed = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "r@longdeji.local", password: "WrongPass1234" }
    });
    expect(failed.statusCode).toBe(401);
    expect(failed.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });

    const login = await context.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "r@longdeji.local", password: "Researcher1234" }
    });
    expect(login.statusCode).toBe(200);
    const tokens = (login.json() as { tokens: { access_token: string } }).tokens;

    const me = await context.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: authHeader(tokens.access_token)
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { user: { email: string } }).user.email).toBe("r@longdeji.local");
  });

  it("未携带令牌访问受保护接口返回 401", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/auth/me" });
    expect(response.statusCode).toBe(401);
  });

  it("刷新令牌轮换：旧 refresh token 失效，新令牌可用", async () => {
    const admin = await bootstrapAdmin(context.app);

    const refreshed = await context.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refresh_token: admin.refreshToken }
    });
    expect(refreshed.statusCode).toBe(200);
    const newTokens = (refreshed.json() as { tokens: { access_token: string; refresh_token: string } }).tokens;
    expect(newTokens.refresh_token).not.toBe(admin.refreshToken);

    const reused = await context.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refresh_token: admin.refreshToken }
    });
    expect(reused.statusCode).toBe(401);

    const me = await context.app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: authHeader(newTokens.access_token)
    });
    expect(me.statusCode).toBe(200);
  });

  it("登出后 refresh token 立即失效", async () => {
    const admin = await bootstrapAdmin(context.app);
    const logout = await context.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      payload: { refresh_token: admin.refreshToken }
    });
    expect(logout.statusCode).toBe(204);

    const refreshed = await context.app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refresh_token: admin.refreshToken }
    });
    expect(refreshed.statusCode).toBe(401);
  });

  it("密码校验失败返回统一 VALIDATION_ERROR 结构", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "weak@longdeji.local", password: "1234567890", name: "弱密码" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
