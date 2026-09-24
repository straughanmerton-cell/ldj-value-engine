import type { FastifyInstance } from "fastify";
import type { DbHandle } from "@ldj/database";

declare module "fastify" {
  interface FastifyInstance {
    dbHandle: DbHandle;
  }
}

export function registerDb(app: FastifyInstance, handle: DbHandle): void {
  app.decorate("dbHandle", handle);
  app.addHook("onClose", async () => {
    await handle.close();
  });
}
