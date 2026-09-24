import type { FastifyInstance } from "fastify";
import {
  createProductFactSchema,
  createRndReferenceSchema,
  createTastingProfileSchema,
  productFactListQuerySchema,
  rndReferenceListQuerySchema,
  tastingProfileListQuerySchema,
  updateProductFactSchema,
  updateRndReferenceSchema,
  updateTastingProfileSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { ProductFactService } from "./facts.service.js";
import type { RndReferenceService } from "./rnd.service.js";
import type { TastingProfileService } from "./tasting.service.js";

export interface ProductRecordServices {
  facts: ProductFactService;
  tasting: TastingProfileService;
  rnd: RndReferenceService;
}

const WRITE_ROLES = ["ADMIN", "RESEARCHER"] as const;

/**
 * Phase 2 子资源路由：产品事实（§11）、品饮档案（§10.4）、研发参考（§35.2 / §37）。
 * 全部挂在 /api/products/{id} 下，读取需登录，写入限 ADMIN / RESEARCHER，删除限 ADMIN。
 */
export function registerProductRecordRoutes(
  app: FastifyInstance,
  services: ProductRecordServices
): void {
  // ---- 产品事实清单 ----
  app.get("/api/products/:id/facts", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return services.facts.list(id, productFactListQuerySchema.parse(request.query ?? {}));
  });

  app.post(
    "/api/products/:id/facts",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = createProductFactSchema.parse(request.body ?? {});
      const fact = await services.facts.create(id, input, actor);
      return reply.code(201).send(fact);
    }
  );

  app.get(
    "/api/products/:id/facts/:factId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, factId } = request.params as { id: string; factId: string };
      return services.facts.getById(id, factId);
    }
  );

  app.patch(
    "/api/products/:id/facts/:factId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, factId } = request.params as { id: string; factId: string };
      const input = updateProductFactSchema.parse(request.body ?? {});
      return services.facts.update(id, factId, input, actor);
    }
  );

  app.delete(
    "/api/products/:id/facts/:factId",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id, factId } = request.params as { id: string; factId: string };
      await services.facts.remove(id, factId);
      return reply.code(204).send();
    }
  );

  // ---- 品饮档案 ----
  app.get(
    "/api/products/:id/tasting-profiles",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return services.tasting.list(id, tastingProfileListQuerySchema.parse(request.query ?? {}));
    }
  );

  app.post(
    "/api/products/:id/tasting-profiles",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = createTastingProfileSchema.parse(request.body ?? {});
      const profile = await services.tasting.create(id, input, actor);
      return reply.code(201).send(profile);
    }
  );

  app.get(
    "/api/products/:id/tasting-profiles/:profileId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, profileId } = request.params as { id: string; profileId: string };
      return services.tasting.getById(id, profileId);
    }
  );

  app.patch(
    "/api/products/:id/tasting-profiles/:profileId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, profileId } = request.params as { id: string; profileId: string };
      const input = updateTastingProfileSchema.parse(request.body ?? {});
      return services.tasting.update(id, profileId, input, actor);
    }
  );

  app.delete(
    "/api/products/:id/tasting-profiles/:profileId",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id, profileId } = request.params as { id: string; profileId: string };
      await services.tasting.remove(id, profileId);
      return reply.code(204).send();
    }
  );

  // ---- 研发参考（规格 §37：GET / POST / PUT）----
  app.get(
    "/api/products/:id/rnd-references",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      return services.rnd.list(id, rndReferenceListQuerySchema.parse(request.query ?? {}));
    }
  );

  app.post(
    "/api/products/:id/rnd-references",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const actor = currentUser(request);
      const { id } = request.params as { id: string };
      const input = createRndReferenceSchema.parse(request.body ?? {});
      const reference = await services.rnd.create(id, input, actor);
      return reply.code(201).send(reference);
    }
  );

  app.get(
    "/api/products/:id/rnd-references/:referenceId",
    { preHandler: [app.requireAuth] },
    async (request) => {
      const { id, referenceId } = request.params as { id: string; referenceId: string };
      return services.rnd.getById(id, referenceId);
    }
  );

  app.put(
    "/api/products/:id/rnd-references/:referenceId",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const actor = currentUser(request);
      const { id, referenceId } = request.params as { id: string; referenceId: string };
      const input = updateRndReferenceSchema.parse(request.body ?? {});
      return services.rnd.update(id, referenceId, input, actor);
    }
  );

  app.delete(
    "/api/products/:id/rnd-references/:referenceId",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id, referenceId } = request.params as { id: string; referenceId: string };
      await services.rnd.remove(id, referenceId);
      return reply.code(204).send();
    }
  );
}
