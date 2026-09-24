import type { FastifyInstance } from "fastify";
import {
  MARKET_OFFER_ATTRIBUTION_LABELS,
  PRICE_CONTRACT,
  marketOfferCreateSchema,
  marketOfferListQuerySchema,
  marketOfferRebuildRequestSchema,
  marketOfferUpdateSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import { MARKET_PRICE_ENGINE_INFO, type MarketPricesService } from "./market-prices.service.js";

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

export interface PriceServices {
  prices: MarketPricesService;
}

/**
 * Phase 6 路由（规格 §14 市场价格系统 / §15 Price Evidence Score / §16.1 锚点价格条件）。
 *
 * - GET    /api/prices/contract                              价格合同自检（三条红线 + 五项权重）
 * - GET    /api/market-offers                                跨产品价格列表（市场价格中心）
 * - GET    /api/products/{id}/market-offers                   产品价格证据列表
 * - POST   /api/products/{id}/market-offers                   人工登记价格证据
 * - POST   /api/products/{id}/market-offers/rebuild           由来源抽取结果重建价格证据
 * - GET    /api/products/{id}/price-summary                   价格汇总（Phase 7 锚点取用）
 * - GET    /api/products/{id}/market-offers/{offerId}         单条价格证据
 * - PATCH  /api/products/{id}/market-offers/{offerId}         人工修正（补规格 / 改单位 / 排除）
 * - DELETE /api/products/{id}/market-offers/{offerId}         删除价格证据（仅 ADMIN）
 *
 * 读需登录，写限 ADMIN / RESEARCHER：价格证据直接影响对外的成交表达，
 * 不能让只读账号或文案账号改口径。
 */
export function registerMarketPriceRoutes(app: FastifyInstance, services: PriceServices): void {
  /** 价格合同：前端据此展示四项权重、分档与「挂牌 ≠ 成交」等红线文案。 */
  app.get("/api/prices/contract", { preHandler: [app.requireAuth] }, async () => ({
    contract: PRICE_CONTRACT,
    engine: MARKET_PRICE_ENGINE_INFO,
    attribution_labels: MARKET_OFFER_ATTRIBUTION_LABELS
  }));

  app.get("/api/market-offers", { preHandler: [app.requireAuth] }, async (request) => {
    const query = marketOfferListQuerySchema.parse(request.query ?? {});
    return services.prices.list(query);
  });

  app.get("/api/products/:id/market-offers", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    const query = marketOfferListQuerySchema.parse(request.query ?? {});
    return services.prices.list({ ...query, product_id: id });
  });

  app.post(
    "/api/products/:id/market-offers",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = marketOfferCreateSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.prices.create(id, input, actor.id));
    }
  );

  app.post(
    "/api/products/:id/market-offers/rebuild",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = marketOfferRebuildRequestSchema.parse(request.body ?? {});
      return reply.code(201).send(await services.prices.rebuild(id, input, actor.id));
    }
  );

  app.get("/api/products/:id/price-summary", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.prices.summary(id);
  });

  app.get(
    "/api/products/:id/market-offers/:offerId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, offerId } = request.params as { id: string; offerId: string };
      return services.prices.get(id, offerId);
    }
  );

  app.patch(
    "/api/products/:id/market-offers/:offerId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const { id, offerId } = request.params as { id: string; offerId: string };
      const input = marketOfferUpdateSchema.parse(request.body ?? {});
      return services.prices.update(id, offerId, input);
    }
  );

  app.delete(
    "/api/products/:id/market-offers/:offerId",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id, offerId } = request.params as { id: string; offerId: string };
      await services.prices.remove(id, offerId);
      return reply.code(204).send();
    }
  );
}
