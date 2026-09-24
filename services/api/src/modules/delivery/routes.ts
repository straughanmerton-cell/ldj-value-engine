import type { FastifyInstance } from "fastify";
import { deliveryExportQuerySchema, hostCenterListQuerySchema } from "@ldj/schemas";
import type { DeliveryService } from "./delivery.service.js";

export interface DeliveryServices {
  delivery: DeliveryService;
}

/**
 * Phase 15 路由（规格 §31 一级导航 / §51 主播中心 / §52 经销商中心 / §53 / §57 / §60 导出）。
 *
 * - GET /api/delivery/contract                    合同自检（十项 × 2 / 导出格式 / 发布闸门 / 七条铁律）
 * - GET /api/delivery/labels                      前端标签文案（格子 / 格式 / 范围 / 六种闸门状态）
 * - GET /api/host-center                          跨产品排产列表（可交付优先，`ready` 三态筛选）
 * - GET /api/products/{id}/host-center            §51 主播中心十项
 * - GET /api/products/{id}/dealer-center          §52 经销商中心十项
 * - GET /api/products/{id}/delivery/export        导出最终资料包（Markdown / 纯文本）
 *
 * 全部只读：交付层是**派生视图**，不新增表、不改写正文、不生成第二份话术（§62-15）。
 * 因此不需要写权限——任何登录用户都可以看；导出的闸门由 §53 / §57 决定，与角色无关。
 * 路由注册顺序：`/api/delivery/*` 必须在 `/api/products/:id/*` 之前（静态段优先）。
 */
export function registerDeliveryRoutes(app: FastifyInstance, services: DeliveryServices): void {
  app.get("/api/delivery/contract", { preHandler: [app.requireAuth] }, async () =>
    services.delivery.contractBody()
  );

  app.get("/api/delivery/labels", { preHandler: [app.requireAuth] }, async () =>
    services.delivery.labelsBody()
  );

  /** 跨产品列表：主播每天问的是「今天哪几款能上播、哪几款卡在审核」，所以 `ready` 优先排前。 */
  app.get("/api/host-center", { preHandler: [app.requireAuth] }, async (request) =>
    services.delivery.listHostCenter(hostCenterListQuerySchema.parse(request.query ?? {}))
  );

  app.get("/api/products/:id/host-center", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.delivery.hostCenter(id);
  });

  app.get("/api/products/:id/dealer-center", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.delivery.dealerCenter(id);
  });

  /** 导出：闸门未通过时 409 + `details.gate` / `blocking_sentences` / `next_action`（§53 / §57）。 */
  app.get("/api/products/:id/delivery/export", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.delivery.export(id, deliveryExportQuerySchema.parse(request.query ?? {}));
  });
}
