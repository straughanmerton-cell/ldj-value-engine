import type { FastifyInstance } from "fastify";
import { createBrandSchema, updateBrandSchema } from "@ldj/schemas";
import type { BrandService } from "./service.js";

export function registerBrandRoutes(app: FastifyInstance, brandService: BrandService): void {
  app.get("/api/brands", { preHandler: [app.requireAuth] }, async () => ({
    items: await brandService.list()
  }));

  app.get("/api/brands/:id", { preHandler: [app.requireAuth] }, async (request) => {
    const { id } = request.params as { id: string };
    return brandService.getById(id);
  });

  app.post(
    "/api/brands",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN", "RESEARCHER"])] },
    async (request, reply) => {
      const input = createBrandSchema.parse(request.body ?? {});
      const brand = await brandService.create(input);
      return reply.code(201).send(brand);
    }
  );

  app.patch(
    "/api/brands/:id",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN", "RESEARCHER"])] },
    async (request) => {
      const { id } = request.params as { id: string };
      const input = updateBrandSchema.parse(request.body ?? {});
      return brandService.update(id, input);
    }
  );

  app.delete(
    "/api/brands/:id",
    { preHandler: [app.requireAuth, app.requireRole(["ADMIN"])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await brandService.remove(id);
      return reply.code(204).send();
    }
  );
}
