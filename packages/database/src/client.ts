import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type Database = NodePgDatabase<typeof schema>;

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
}

export interface DbHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDb(options: CreateDbOptions): DbHandle {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 5
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    }
  };
}

export function resolveDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const url = source.NODE_ENV === "test" ? source.TEST_DATABASE_URL ?? source.DATABASE_URL : source.DATABASE_URL;
  if (!url) {
    throw new Error("缺少 DATABASE_URL（测试环境可设置 TEST_DATABASE_URL）");
  }
  return url;
}
