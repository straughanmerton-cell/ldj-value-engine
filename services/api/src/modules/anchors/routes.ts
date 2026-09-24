import type { FastifyInstance } from "fastify";
import {
  ANCHOR_CONTRACT,
  ANCHOR_TYPE_LABELS,
  RESOLVED_MODE_LABELS,
  anchorBuildRequestSchema,
  anchorListQuerySchema,
  anchorUpdateSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import { ANCHOR_ENGINE_INFO, type AnchorsService } from "./anchors.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface AnchorServices {
  anchors: AnchorsService;
}

/**
 * Phase 7 路由（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §55 Build Anchors / §56 进度 UI）。
 *
 * - GET    /api/anchors/contract                              锚点合同自检（阈值 + 三种锚点 + 红线）
 * - GET    /api/anchors                                       跨产品锚点列表（高价值锚点库）
 * - GET    /api/products/{id}/anchors                          产品锚点列表
 * - POST   /api/products/{id}/anchors/rebuild                  由候选池 + 价格证据重算三种锚点
 * - GET    /api/products/{id}/benchmark-mode                   模式判定（Benchmark / Category Creator）
 * - GET    /api/products/{id}/anchors/{anchorId}               单条锚点
 * - PATCH  /api/products/{id}/anchors/{anchorId}               人工选定主锚点 / 追加理由
 * - DELETE /api/products/{id}/anchors/{anchorId}               删除锚点（仅 ADMIN）
 *
 * 读需登录，写限 ADMIN / RESEARCHER：锚点直接决定产品进入哪种模式，
 * 不能让只读账号或文案账号改判定结论。
 */
export function registerAnchorRoutes(app: FastifyInstance, services: AnchorServices): void {
  /** 锚点合同：前端据此展示三种锚点门槛、六项权重与「无锚点不降级」等红线文案。 */
  app.get("/api/anchors/contract", { preHandler: [app.requireAuth] }, async () => ({
    contract: ANCHOR_CONTRACT,
    engine: ANCHOR_ENGINE_INFO,
    type_labels: ANCHOR_TYPE_LABELS,
    mode_labels: RESOLVED_MODE_LABELS
  }));

  app.get("/api/anchors", { preHandler: [app.requireAuth] }, async (request) => {
    const query = anchorListQuerySchema.parse(request.query ?? {});
    return services.anchors.list(query);
  });

  app.get("/api/products/:id/anchors", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    const query = anchorListQuerySchema.parse(request.query ?? {});
    return services.anchors.list({ ...query, product_id: id });
  });

  app.post(
    "/api/products/:id/anchors/rebuild",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = anchorBuildRequestSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.anchors.rebuild(id, input, actor.id));
    }
  );

  app.get("/api/products/:id/benchmark-mode", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.anchors.benchmarkMode(id);
  });

  app.get(
    "/api/products/:id/anchors/:anchorId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, anchorId } = request.params as { id: string; anchorId: string };
      return services.anchors.get(id, anchorId);
    }
  );

  app.patch(
    "/api/products/:id/anchors/:anchorId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, anchorId } = request.params as { id: string; anchorId: string };
      const input = anchorUpdateSchema.parse(request.body ?? {});
      return services.anchors.update(id, anchorId, input, actor.id);
    }
  );

  app.delete(
    "/api/products/:id/anchors/:anchorId",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id, anchorId } = request.params as { id: string; anchorId: string };
      await services.anchors.remove(id, anchorId);
      return reply.code(204).send();
    }
  );
}
