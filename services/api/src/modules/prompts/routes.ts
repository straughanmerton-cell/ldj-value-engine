import type { FastifyInstance } from "fastify";
import {
  activatePromptVersionSchema,
  createPromptVersionSchema,
  promptKeyParamSchema,
  promptTestRunSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { PromptManagerService } from "./service.js";

/**
 * Prompt 管理后台路由（规格 §50）。
 * 五项能力对应关系：
 * - version   → GET  /api/prompts/{key}/versions
 * - edit      → POST /api/prompts/{key}/versions（派生新版本，历史版本保留）
 * - active    → POST /api/prompts/{key}/activate
 * - rollback  → POST /api/prompts/{key}/activate（指向任一历史版本）
 * - test run  → POST /api/prompts/{key}/test-run
 */
export function registerPromptRoutes(app: FastifyInstance, service: PromptManagerService): void {
  app.get("/api/prompts", { preHandler: [app.requireAuth] }, async () => service.list());

  app.get("/api/prompts/:key", { preHandler: [app.requireAuth] }, async (request) => {
    const { key } = promptKeyParamSchema.parse(request.params ?? {});
    return service.getByKey(key);
  });

  app.get("/api/prompts/:key/versions", { preHandler: [app.requireAuth] }, async (request) => {
    const { key } = promptKeyParamSchema.parse(request.params ?? {});
    return { items: await service.listVersions(key) };
  });

  app.post(
    "/api/prompts/:key/versions",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { key } = promptKeyParamSchema.parse(request.params ?? {});
      const input = createPromptVersionSchema.parse(request.body ?? {});
      const version = await service.createVersion(key, input, actor.id);
      return reply.code(201).send(version);
    }
  );

  app.post(
    "/api/prompts/:key/activate",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request) => {
      const { key } = promptKeyParamSchema.parse(request.params ?? {});
      const input = activatePromptVersionSchema.parse(request.body ?? {});
      return service.activate(key, input);
    }
  );

  app.post(
    "/api/prompts/:key/test-run",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN", "RESEARCHER", "COPYWRITER"])] },
    async (request) => {
      const { key } = promptKeyParamSchema.parse(request.params ?? {});
      const input = promptTestRunSchema.parse(request.body ?? {});
      return service.testRun(key, input);
    }
  );
}
