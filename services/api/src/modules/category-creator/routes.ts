import type { FastifyInstance } from "fastify";
import {
  CATEGORY_AXIS_STATUS_LABELS,
  CATEGORY_CREATOR_CONTRACT,
  CATEGORY_READINESS_LABELS,
  CATEGORY_STANDARD_AXIS_LABELS,
  CATEGORY_CREATOR_TRIGGER_META,
  categoryCreatorGenerateSchema,
  categoryCreatorListQuerySchema,
  categoryCreatorUpdateSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { CategoryCreatorService } from "./category-creator.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface CategoryCreatorServices {
  categoryCreator: CategoryCreatorService;
}

/**
 * Phase 8 路由（规格 §4.2 自建高端标准模式 / §17 无锚点强制逻辑 / §29 成交表达口径）。
 *
 * - GET   /api/category-creator/contract                       合同自检（触发条件 + 六标准轴 + 红线）
 * - GET   /api/products/{id}/category-creator                   总览：模式判定 + 最新标准 + 版本列表
 * - POST  /api/products/{id}/category-creator/generate          生成一版自建标准（201）
 * - GET   /api/products/{id}/category-creator/versions          版本列表（所有版本必须保留）
 * - GET   /api/products/{id}/category-creator/{profileId}       单版自建标准
 * - PATCH /api/products/{id}/category-creator/{profileId}       人工确认 / 备注
 *
 * 读需登录，写限 ADMIN / RESEARCHER：自建标准是后续产品结构、配方哲学与成交话术的输入，
 * 不能让只读账号改写「这款茶按什么标准成立」。
 */
export function registerCategoryCreatorRoutes(
  app: FastifyInstance,
  services: CategoryCreatorServices
): void {
  /** 合同自检：前端据此展示两触发条件、六标准轴、三层标记与「无对标不降级」红线。 */
  app.get("/api/category-creator/contract", { preHandler: [app.requireAuth] }, async () =>
    services.categoryCreator.contractBody()
  );

  app.get(
    "/api/products/:id/category-creator",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return services.categoryCreator.overview(id);
    }
  );

  app.get(
    "/api/products/:id/category-creator/versions",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      categoryCreatorListQuerySchema.parse(request.query ?? {});
      return { items: await services.categoryCreator.listVersions(id) };
    }
  );

  app.post(
    "/api/products/:id/category-creator/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = categoryCreatorGenerateSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.categoryCreator.generate(id, input, actor.id));
    }
  );

  app.get(
    "/api/products/:id/category-creator/:profileId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, profileId } = request.params as { id: string; profileId: string };
      return services.categoryCreator.getProfile(id, profileId);
    }
  );

  app.patch(
    "/api/products/:id/category-creator/:profileId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, profileId } = request.params as { id: string; profileId: string };
      const input = categoryCreatorUpdateSchema.parse(request.body ?? {});
      return services.categoryCreator.update(id, profileId, input, actor.id);
    }
  );

  /** 前端标签文案与合同规则都从 schema 层读，避免前端另写一套口径。 */
  app.get("/api/category-creator/labels", { preHandler: [app.requireAuth] }, async () => ({
    axis_labels: CATEGORY_STANDARD_AXIS_LABELS,
    axis_status_labels: CATEGORY_AXIS_STATUS_LABELS,
    readiness_labels: CATEGORY_READINESS_LABELS,
    triggers: CATEGORY_CREATOR_TRIGGER_META,
    rules: CATEGORY_CREATOR_CONTRACT.rules
  }));
}
