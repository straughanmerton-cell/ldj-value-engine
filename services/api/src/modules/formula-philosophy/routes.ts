import type { FastifyInstance } from "fastify";
import {
  FORMULA_COMPONENT_STATUS_LABELS,
  FORMULA_COMPONENT_STATUS_TONES,
  formulaPhilosophyGenerateSchema,
  formulaPhilosophyListQuerySchema,
  formulaPhilosophyUpdateSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { FormulaPhilosophyService } from "./formula-philosophy.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface FormulaPhilosophyServices {
  formulaPhilosophy: FormulaPhilosophyService;
}

/**
 * Phase 11 路由（规格 §6 配方哲学 / §46 Agent 8 / §37 API / §31 一级导航）。
 *
 * - GET   /api/formula-philosophy/contract                              合同自检（五分量 + §46 五项输出 + 红线）
 * - GET   /api/formula-philosophy/labels                                前端标签文案（分量 / §46 输出 / 验收）
 * - GET   /api/formula-philosophy                                       跨产品「配方哲学」库（筛选排序分页）
 * - GET   /api/products/{id}/formula-philosophy                         总览：模式 + 最新一版 + 版本列表
 * - GET   /api/products/{id}/formula-philosophy/versions                版本列表（所有版本必须保留 §62-15）
 * - POST  /api/products/{id}/formula-philosophy/generate                生成一版配方哲学（201）
 * - GET   /api/products/{id}/formula-philosophy/{recordId}              单版配方哲学
 * - PATCH /api/products/{id}/formula-philosophy/{recordId}              人工确认 / 备注
 *
 * 读需登录，写限 ADMIN / RESEARCHER：配方哲学是成交话术（Phase 12）的输入，
 * 不能让只读账号改写「这款茶为什么这么设计」。
 */
export function registerFormulaPhilosophyRoutes(
  app: FastifyInstance,
  services: FormulaPhilosophyServices
): void {
  /** 合同自检：前端据此展示五分量、§46 五项输出与「不编比例 / 不新增原料」等红线。 */
  app.get("/api/formula-philosophy/contract", { preHandler: [app.requireAuth] }, async () =>
    services.formulaPhilosophy.contractBody()
  );

  /** 标签与口径全部从 schema 层读，避免前端另写一套文案。 */
  app.get("/api/formula-philosophy/labels", { preHandler: [app.requireAuth] }, async () => ({
    ...services.formulaPhilosophy.labelsBody(),
    component_status_labels: FORMULA_COMPONENT_STATUS_LABELS,
    component_status_tones: FORMULA_COMPONENT_STATUS_TONES
  }));

  /** 「配方哲学」库：跨产品只读总览（一行 = 一款产品最新一版配方哲学，未生成的也会出现）。 */
  app.get("/api/formula-philosophy", { preHandler: [app.requireAuth] }, async (request) => {
    const query = formulaPhilosophyListQuerySchema.parse(request.query ?? {});
    return services.formulaPhilosophy.listMatrix(query);
  });

  app.get(
    "/api/products/:id/formula-philosophy",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return services.formulaPhilosophy.overview(id);
    }
  );

  app.get(
    "/api/products/:id/formula-philosophy/versions",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return { items: await services.formulaPhilosophy.listVersions(id) };
    }
  );

  app.post(
    "/api/products/:id/formula-philosophy/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = formulaPhilosophyGenerateSchema.parse(request.body ?? {});
      return reply
        .code(201)
        .send(await services.formulaPhilosophy.generate(id, input, actor.id));
    }
  );

  app.get(
    "/api/products/:id/formula-philosophy/:recordId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, recordId } = request.params as { id: string; recordId: string };
      return services.formulaPhilosophy.getRecord(id, recordId);
    }
  );

  app.patch(
    "/api/products/:id/formula-philosophy/:recordId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, recordId } = request.params as { id: string; recordId: string };
      const input = formulaPhilosophyUpdateSchema.parse(request.body ?? {});
      return services.formulaPhilosophy.update(id, recordId, input, actor.id);
    }
  );
}
