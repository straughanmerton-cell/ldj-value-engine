import type { FastifyInstance } from "fastify";
import {
  SALES_COPY_INTENSITY_SHORT_LABELS,
  IMPACT_SCORE_BAND_META,
  LEVEL5_REQUIREMENT_META_BY_KEY,
  salesCopyGenerateSchema,
  salesCopyIntensifySchema,
  salesCopyListQuerySchema,
  salesCopyUpdateSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { SalesCopyService } from "./sales-copy.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface SalesCopyServices {
  salesCopy: SalesCopyService;
}

/**
 * Phase 12 / 13 路由（规格 §7 牛逼化按钮 / §21 强成交话术 / §22 Level 5 / §23 成交冲击力 /
 * §26 九种输出 / §31 一级导航 / §34「再狠一点」/ §37 API / §47 输出清单 / §48 八项自检）。
 *
 * - GET   /api/sales-copy/contract                       合同自检（§21–§27 红线与强度画像）
 * - GET   /api/sales-copy/labels                         前端标签文案（五档 / 九种输出 / 八项评分 / Level 5 七项）
 * - GET   /api/sales-copy                                跨产品「强成交话术库」（筛选排序分页）
 * - GET   /api/products/{id}/copy                        总览：模式 + 最新一版 + 版本列表 + 上游到位情况
 * - GET   /api/products/{id}/copy/versions               版本列表（所有版本必须保留 §62-15）
 * - POST  /api/products/{id}/copy/generate               生成一版强成交话术（201）
 * - POST  /api/products/{id}/copy/intensify              §34「再狠一点」：按更高档位强化成新版本（201）
 * - GET   /api/products/{id}/copy/{recordId}             单版强成交话术
 * - PATCH /api/products/{id}/copy/{recordId}             人工确认 / 备注
 *
 * 读需登录，写限 ADMIN / RESEARCHER：强成交话术是主播 / 经销商直接拿去用的成稿，
 * 不能让只读账号改写「这款茶对外怎么讲」。
 */
export function registerSalesCopyRoutes(app: FastifyInstance, services: SalesCopyServices): void {
  /** 合同自检：前端据此展示五档强度、九种输出、Level 5 七项与「不编事实 / 不承诺收益」等红线。 */
  app.get("/api/sales-copy/contract", { preHandler: [app.requireAuth] }, async () =>
    services.salesCopy.contractBody()
  );

  /** 标签与口径全部从 schema 层读，避免前端另写一套文案。 */
  app.get("/api/sales-copy/labels", { preHandler: [app.requireAuth] }, async () => ({
    ...services.salesCopy.labelsBody(),
    intensity_short_labels: SALES_COPY_INTENSITY_SHORT_LABELS,
    impact_score_band_meta: IMPACT_SCORE_BAND_META,
    level5_requirement_meta: LEVEL5_REQUIREMENT_META_BY_KEY
  }));

  /** 「强成交话术库」：跨产品只读总览（一行 = 一款产品最新一版，未生成的也会出现）。 */
  app.get("/api/sales-copy", { preHandler: [app.requireAuth] }, async (request) => {
    const query = salesCopyListQuerySchema.parse(request.query ?? {});
    return services.salesCopy.listMatrix(query);
  });

  app.get("/api/products/:id/copy", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.salesCopy.overview(id);
  });

  app.get("/api/products/:id/copy/versions", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return { items: await services.salesCopy.listVersions(id) };
  });

  app.post(
    "/api/products/:id/copy/generate",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = salesCopyGenerateSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.salesCopy.generate(id, input, actor.id));
    }
  );

  /**
   * §34「再狠一点」：按四档按钮（普通 / 强势 / 爆款 / 王者）把指定版本强化成**新版本**。
   * 不传 `record_id` 就强化最新一版；源版本原封不动保留（§62-15）。
   */
  app.post(
    "/api/products/:id/copy/intensify",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = salesCopyIntensifySchema.parse(request.body ?? {});
      return reply.code(201).send(await services.salesCopy.intensify(id, input, actor.id));
    }
  );

  app.get(
    "/api/products/:id/copy/:recordId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, recordId } = request.params as { id: string; recordId: string };
      return services.salesCopy.getRecord(id, recordId);
    }
  );

  app.patch(
    "/api/products/:id/copy/:recordId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, recordId } = request.params as { id: string; recordId: string };
      const input = salesCopyUpdateSchema.parse(request.body ?? {});
      return services.salesCopy.update(id, recordId, input, actor.id);
    }
  );
}
