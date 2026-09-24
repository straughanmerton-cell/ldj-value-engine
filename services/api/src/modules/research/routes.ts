import type { FastifyInstance } from "fastify";
import {
  createSourceSchema,
  researchRunRequestSchema,
  searchPlanGenerateRequestSchema,
  sourceExtractRequestSchema,
  sourceFetchRequestSchema,
  sourceListQuerySchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { ResearchService } from "./research.service.js";
import type { SearchPlanService } from "./search-plan.service.js";
import type { SourceService } from "./source.service.js";

export interface ResearchServices {
  research: ResearchService;
  sources: SourceService;
  /** Agent 2｜搜索策略专家（§12 / §40）：策略要能被人工查看与重新生成。 */
  searchPlans: SearchPlanService;
}

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

/**
 * Phase 4 路由（规格 §12 / §40 / §41 / §55 / §56）。
 *
 * 全部挂在 /api/products/{id} 下：研究、来源、抽取都是产品级资产。
 * 读取需登录，写操作限 ADMIN / RESEARCHER，删除限 ADMIN。
 */
export function registerResearchRoutes(app: FastifyInstance, services: ResearchServices): void {
  // ---- 搜索策略（§12 / §40 Agent 2）----
  app.get("/api/products/:id/search-plan", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.searchPlans.get(id);
  });

  app.post(
    "/api/products/:id/search-plan/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = searchPlanGenerateRequestSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.searchPlans.generate(id, input, actor.id));
    }
  );

  // ---- 研究流水线 ----
  app.get(
    "/api/products/:id/research/progress",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return services.research.getProgress(id);
    }
  );

  app.get(
    "/api/products/:id/research/runs",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      const { limit } = request.query as { limit?: string };
      const parsed = limit ? Number.parseInt(limit, 10) : 20;
      return {
        items: await services.research.listJobs(id, Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20)
      };
    }
  );

  app.post(
    "/api/products/:id/research/runs",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = researchRunRequestSchema.parse(request.body ?? {});
      const result = await services.research.run(id, input, actor.id);
      return reply.code(201).send(result);
    }
  );

  app.get(
    "/api/products/:id/research/runs/:jobId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, jobId } = request.params as { id: string; jobId: string };
      return services.research.getJob(id, jobId);
    }
  );

  // ---- 来源 ——
  app.get("/api/products/:id/sources", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.sources.list(id, sourceListQuerySchema.parse(request.query ?? {}));
  });

  app.post(
    "/api/products/:id/sources",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = createSourceSchema.parse(request.body ?? {});
      const result = await services.sources.create(id, input, { id: actor.id });
      return reply.code(result.created ? 201 : 200).send(result);
    }
  );

  app.get(
    "/api/products/:id/sources/:sourceId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, sourceId } = request.params as { id: string; sourceId: string };
      return services.sources.getById(id, sourceId);
    }
  );

  app.delete(
    "/api/products/:id/sources/:sourceId",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id, sourceId } = request.params as { id: string; sourceId: string };
      await services.sources.remove(id, sourceId);
      return reply.code(204).send();
    }
  );

  app.post(
    "/api/products/:id/sources/:sourceId/fetch",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const { id, sourceId } = request.params as { id: string; sourceId: string };
      const input = sourceFetchRequestSchema.parse(request.body ?? {});
      return services.sources.fetch(id, sourceId, input);
    }
  );

  app.post(
    "/api/products/:id/sources/:sourceId/extract",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id, sourceId } = request.params as { id: string; sourceId: string };
      const input = sourceExtractRequestSchema.parse(request.body ?? {});
      const result = await services.sources.extract(id, sourceId, input, { id: actor.id });
      return reply.code(201).send(result);
    }
  );

  app.get(
    "/api/products/:id/sources/:sourceId/extractions",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, sourceId } = request.params as { id: string; sourceId: string };
      return { items: await services.sources.listExtractions(id, sourceId) };
    }
  );
}
