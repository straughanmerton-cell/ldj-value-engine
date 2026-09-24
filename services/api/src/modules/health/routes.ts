import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/api/health", async () => {
    let database = "down";
    try {
      await app.dbHandle.db.execute(sql`select 1`);
      database = "up";
    } catch {
      database = "down";
    }
    return {
      status: database === "up" ? "ok" : "degraded",
      database,
      version: "0.1.0",
      phase: "Phase 15｜主播中心 / 经销商中心与导出（Phase 1–15 已交付）",
      timestamp: new Date().toISOString()
    };
  });
}
