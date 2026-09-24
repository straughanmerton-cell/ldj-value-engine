import type { FastifyInstance } from "fastify";
import { factReviewDecisionSchema, factReviewGenerateSchema } from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { FactReviewService } from "./fact-review.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface FactReviewServices {
  factReview: FactReviewService;
}

/**
 * Phase 14 路由（规格 §24 三重标记 / §25 研发证据 / §36 工作台 / §49 十三项审核焦点 /
 * §53 逐句标注页 / §57 版本冻结 / §62-14 AI 只加严）。
 *
 * - GET  /api/fact-review/contract                     合同自检（三层标记 / 三档风险 / 五列 / 全部规则）
 * - GET  /api/fact-review/labels                       前端标签文案（三层 / 三档 / 审批状态 / 证据类型）
 * - GET  /api/products/{id}/fact-review                总览：可审成稿 + 最新一次审核 + 审批状态
 * - GET  /api/products/{id}/fact-review/versions       审核版本列表（只增不删 §62-15）
 * - POST /api/products/{id}/fact-review/generate       运行一次事实审核（201）
 * - POST /api/products/{id}/fact-review/approve        人工审批通过（有 RED 阻断句 → 400）
 * - POST /api/products/{id}/fact-review/reject         人工否决
 * - GET  /api/products/{id}/fact-review/{reviewId}     单次审核的逐句结论 + 逐条证据
 *
 * 读需登录，写限 ADMIN / RESEARCHER：事实审核决定「这一版话术能不能对外讲」，
 * 审批权不能落到只读账号（§53 / §57）。
 */
export function registerFactReviewRoutes(app: FastifyInstance, services: FactReviewServices): void {
  /** 合同自检：前端据此展示三层标记、三档风险、§53 五列与「不编事实 / 不承诺收益」等红线。 */
  app.get("/api/fact-review/contract", { preHandler: [app.requireAuth] }, async () =>
    services.factReview.contractBody()
  );

  /** 标签与口径全部从 schema 层读，避免前端另写一套文案。 */
  app.get("/api/fact-review/labels", { preHandler: [app.requireAuth] }, async () =>
    services.factReview.labelsBody()
  );

  app.get("/api/products/:id/fact-review", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.factReview.overview(id);
  });

  /**
   * 审核版本列表。注册顺序必须在 `/:reviewId` 之前，否则 `versions` 会被当成 reviewId。
   */
  app.get(
    "/api/products/:id/fact-review/versions",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return { items: await services.factReview.listVersions(id) };
    }
  );

  /**
   * 运行一次事实审核。不传 `record_id` 就审核**最新一版**成稿：
   * 生成新版话术之后必须重新审，因为「一句话有没有证据」与「它在哪一版里」是同一件事（§57）。
   */
  app.post(
    "/api/products/:id/fact-review/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = factReviewGenerateSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.factReview.generate(id, input, actor.id));
    }
  );

  /** 人工审批通过；存在 RED 阻断句或 §24 合规 RED 时返回 400 并在 `details` 里回阻断句（§53 / §57）。 */
  app.post(
    "/api/products/:id/fact-review/approve",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = factReviewDecisionSchema.parse(request.body ?? {});
      return services.factReview.approve(id, input, actor.id);
    }
  );

  /** 人工否决：不改任何判定结论，只记录「这一版没通过」（§62-15）。 */
  app.post(
    "/api/products/:id/fact-review/reject",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = factReviewDecisionSchema.parse(request.body ?? {});
      return services.factReview.reject(id, input, actor.id);
    }
  );

  app.get(
    "/api/products/:id/fact-review/:reviewId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, reviewId } = request.params as { id: string; reviewId: string };
      return services.factReview.getReview(id, reviewId);
    }
  );
}
