import type { FastifyInstance } from "fastify";
import {
  createProductSchema,
  productListQuerySchema,
  updateProductSchema
} from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import { currentUser } from "../../plugins/auth.js";
import type { ProductService } from "./service.js";

export function registerProductRoutes(app: FastifyInstance, productService: ProductService): void {
  app.get("/api/products", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = currentUser(request);
    const query = productListQuerySchema.parse(request.query ?? {});
    return productService.list(query, actor.role);
  });

  app.get("/api/products/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const actor = currentUser(request);
    const { id } = request.params as { id: string };
    return productService.getById(id, actor.role);
  });

  app.post(
    "/api/products",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN", "RESEARCHER"])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const input = createProductSchema.parse(request.body ?? {});
      const product = await productService.create(input, actor.id, actor.role);
      return reply.code(201).send(product);
    }
  );

  app.patch(
    "/api/products/:id",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN", "RESEARCHER"])] },
    async (request) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = updateProductSchema.parse(request.body ?? {});
      return productService.update(id, input, actor.role);
    }
  );

  app.delete(
    "/api/products/:id",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await productService.remove(id);
      return reply.code(204).send();
    }
  );

  /**
   * 规格 §37 已规划的成交增强接口。Phase 1 起保留路由与明确状态，
   * 避免前端与外部集成方误以为能力缺失；实现随各 Phase 逐个接线。
   * （Phase 2 的 facts / tasting-profiles / rnd-references 已实现，见 modules/product-records。）
   * （Phase 10 的产品结构已实现，见 modules/product-architecture。）
   * （Phase 11 的配方哲学已实现，见 modules/formula-philosophy。）
   * （Phase 12 的强成交话术、Phase 13 的「再狠一点」已实现，见 modules/sales-copy。）
   * 至此 §37 规划的核心成交接口全部接线，剩下的是 Phase 14 的事实审核与人工审批。
   */
  const planned: Array<{ method: "GET" | "POST" | "PUT"; url: string; phase: number; name: string }> = [];

  for (const route of planned) {
    app.route({
      method: route.method,
      url: route.url,
      preHandler: [app.requireAuth],
      handler: async () => {
        throw AppError.notImplemented(`${route.name}接口将在 Phase ${route.phase} 实现`, {
          phase: route.phase,
          capability: route.name
        });
      }
    });
  }
}
