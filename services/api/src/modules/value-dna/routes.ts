import type { FastifyInstance } from "fastify";
import { factNormalizeRequestSchema, valueDnaGenerateRequestSchema } from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { ValueDnaService } from "./service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

/**
 * Phase 3 路由（规格 §9 / §39）：
 * - GET  /api/products/{id}/value-dna           读取 11 维度 DNA 与过期状态
 * - POST /api/products/{id}/value-dna/generate  重新生成（规则引擎 / AI 辅助）
 * - POST /api/products/{id}/facts/normalize     Agent 1 事实归一试跑（不写库）
 */
export function registerValueDnaRoutes(app: FastifyInstance, service: ValueDnaService): void {
  app.get("/api/products/:id/value-dna", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return service.get(id);
  });

  app.post(
    "/api/products/:id/value-dna/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = valueDnaGenerateRequestSchema.parse(request.body ?? {});
      return service.generate(id, input, actor.id);
    }
  );

  app.post(
    "/api/products/:id/facts/normalize",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const { id } = request.params as { id: string };
      const input = factNormalizeRequestSchema.parse(request.body ?? {});
      return service.normalizeFacts(id, input);
    }
  );
}
