import type { FastifyInstance } from "fastify";
import {
  CANDIDATE_STATUS_LABELS,
  COMPARABLE_CONTRACT,
  SIMILARITY_ENGINE_INFO,
  candidateBuildRequestSchema,
  candidateCreateSchema,
  candidateListQuerySchema,
  candidateReviewSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { CandidatesService } from "./candidates.service.js";
import { CANDIDATE_POOL_CONTRACT } from "./similarity.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface CandidateServices {
  candidates: CandidatesService;
}

/**
 * Phase 5 路由（规格 §13 可比性评分 / §36 高价值茶数据库 / §42 Agent 4）。
 *
 * - GET    /api/products/{id}/candidates                 产品候选池（分档 / 状态 / 关键词 / 最低分）
 * - POST   /api/products/{id}/candidates                 手工登记候选
 * - POST   /api/products/{id}/candidates/rebuild         由来源抽取结果重建候选池
 * - GET    /api/products/{id}/candidates/{candidateId}   单条候选（十维明细）
 * - PATCH  /api/products/{id}/candidates/{candidateId}   人工评审（确认 / 拒绝 / 归档）
 * - DELETE /api/products/{id}/candidates/{candidateId}   删除候选（仅 ADMIN）
 * - GET    /api/candidates                               跨产品候选池（高价值茶数据库）
 * - GET    /api/candidates/contract                      §13 合同自检（价格不参与相似度）
 */
export function registerCandidateRoutes(app: FastifyInstance, services: CandidateServices): void {
  /** 合同自检：前端据此展示十维权重与分档，运维据此确认价格没有混进相似度。 */
  app.get("/api/candidates/contract", { preHandler: [app.requireAuth] }, async () => ({
    comparable: COMPARABLE_CONTRACT,
    pool: CANDIDATE_POOL_CONTRACT,
    engine: SIMILARITY_ENGINE_INFO,
    status_labels: CANDIDATE_STATUS_LABELS
  }));

  app.get("/api/candidates", { preHandler: [app.requireAuth] }, async (request) => {
    const query = candidateListQuerySchema.parse(request.query ?? {});
    return services.candidates.list(query);
  });

  app.get("/api/products/:id/candidates", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    const query = candidateListQuerySchema.parse(request.query ?? {});
    return services.candidates.list({ ...query, product_id: id });
  });

  app.post(
    "/api/products/:id/candidates",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = candidateCreateSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.candidates.create(id, input, actor.id));
    }
  );

  app.post(
    "/api/products/:id/candidates/rebuild",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = candidateBuildRequestSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.candidates.rebuild(id, input, actor.id));
    }
  );

  app.get(
    "/api/products/:id/candidates/:candidateId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, candidateId } = request.params as { id: string; candidateId: string };
      return services.candidates.get(id, candidateId);
    }
  );

  app.patch(
    "/api/products/:id/candidates/:candidateId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, candidateId } = request.params as { id: string; candidateId: string };
      const input = candidateReviewSchema.parse(request.body ?? {});
      return services.candidates.review(id, candidateId, input, actor.id);
    }
  );

  app.delete(
    "/api/products/:id/candidates/:candidateId",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id, candidateId } = request.params as { id: string; candidateId: string };
      await services.candidates.remove(id, candidateId);
      return reply.code(204).send();
    }
  );
}
