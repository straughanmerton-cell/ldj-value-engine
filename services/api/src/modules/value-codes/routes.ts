import type { FastifyInstance } from "fastify";
import {
  TIME_DEPENDENT_FORBIDDEN_EXPRESSION,
  TIME_DEPENDENT_SAFE_EXPRESSION,
  VALUE_CODES_CONTRACT,
  VALUE_CODE_DIMENSION_LABELS,
  VALUE_CODE_STATUS_LABELS,
  VALUE_CODE_STATUS_META,
  VALUE_CODE_STATUS_SHORT_LABELS,
  VALUE_CODE_STATUS_TONES,
  VALUE_STORY_HANDOFF_PHASES,
  VALUE_STORY_LABELS,
  VALUE_STORY_STATUS_LABELS,
  valueCodeGenerateSchema,
  valueCodeListQuerySchema,
  valueCodeUpdateSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { ValueCodesService } from "./value-codes.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface ValueCodeServices {
  valueCodes: ValueCodesService;
}

/**
 * Phase 9 路由（规格 §18 Value Codes / §19 状态判定 / §20 价值故事 / §30 价值拆解）。
 *
 * - GET   /api/value-codes/contract                              合同自检（16 Code + 5 状态 + §19 表达规范）
 * - GET   /api/value-codes/labels                                前端标签文案（状态 / 维度 / 故事）
 * - GET   /api/value-codes                                       价值密码库（跨产品总览，可筛选排序分页）
 * - GET   /api/products/{id}/value-codes                         总览：模式判定 + 最新映射 + 版本列表
 * - GET   /api/products/{id}/value-codes/versions                版本列表（所有版本必须保留）
 * - POST  /api/products/{id}/value-codes/generate                生成一版价值映射（201）
 * - GET   /api/products/{id}/value-codes/{profileId}             单版价值映射
 * - PATCH /api/products/{id}/value-codes/{profileId}             人工确认 / 备注
 *
 * 读需登录，写限 ADMIN / RESEARCHER：价值映射是产品结构、配方哲学与成交话术的输入，
 * 不能让只读账号改写「这款茶的哪些价值点成立、哪些还不成立」。
 */
export function registerValueCodeRoutes(app: FastifyInstance, services: ValueCodeServices): void {
  /** 合同自检：前端据此展示 16 个 Code、5 种状态、六类故事与「不承诺未来」等红线。 */
  app.get("/api/value-codes/contract", { preHandler: [app.requireAuth] }, async () =>
    services.valueCodes.contractBody()
  );

  /** 标签与口径全部从 schema 层读，避免前端另写一套文案。 */
  app.get("/api/value-codes/labels", { preHandler: [app.requireAuth] }, async () => ({
    statuses: VALUE_CODE_STATUS_META,
    status_labels: VALUE_CODE_STATUS_LABELS,
    status_short_labels: VALUE_CODE_STATUS_SHORT_LABELS,
    status_tones: VALUE_CODE_STATUS_TONES,
    dimension_labels: VALUE_CODE_DIMENSION_LABELS,
    story_labels: VALUE_STORY_LABELS,
    story_status_labels: VALUE_STORY_STATUS_LABELS,
    story_handoff_phases: VALUE_STORY_HANDOFF_PHASES,
    time_dependent_safe_expression: TIME_DEPENDENT_SAFE_EXPRESSION,
    time_dependent_forbidden_expression: TIME_DEPENDENT_FORBIDDEN_EXPRESSION,
    rules: VALUE_CODES_CONTRACT.rules
  }));

  /** 价值密码库：跨产品只读总览（矩阵 + 筛选 + 排序 + 分页）。 */
  app.get("/api/value-codes", { preHandler: [app.requireAuth] }, async (request) => {
    const query = valueCodeListQuerySchema.parse(request.query ?? {});
    return services.valueCodes.listOverview(query);
  });

  app.get("/api/products/:id/value-codes", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.valueCodes.overview(id);
  });

  app.get(
    "/api/products/:id/value-codes/versions",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return { items: await services.valueCodes.listVersions(id) };
    }
  );

  app.post(
    "/api/products/:id/value-codes/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = valueCodeGenerateSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.valueCodes.generate(id, input, actor.id));
    }
  );

  app.get(
    "/api/products/:id/value-codes/:profileId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, profileId } = request.params as { id: string; profileId: string };
      return services.valueCodes.getProfile(id, profileId);
    }
  );

  app.patch(
    "/api/products/:id/value-codes/:profileId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, profileId } = request.params as { id: string; profileId: string };
      const input = valueCodeUpdateSchema.parse(request.body ?? {});
      return services.valueCodes.update(id, profileId, input, actor.id);
    }
  );
}
