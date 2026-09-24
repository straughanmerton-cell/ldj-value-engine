import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, resolveDatabaseUrl } from "./client.js";
import { loadRepoEnv } from "./env.js";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../database/migrations"
);

export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDb({ connectionString, max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  loadRepoEnv();
  const url = resolveDatabaseUrl();
  await runMigrations(url);
  // eslint-disable-next-line no-console
  console.log(`[db] migrations applied: ${url.replace(/:[^:@/]+@/, ":***@")}`);
}

const invokedDirectly = process.argv[1] ? path.resolve(process.argv[1]).startsWith(path.resolve(path.dirname(fileURLToPath(import.meta.url)))) : false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error("[db] migration failed", error);
    process.exitCode = 1;
  });
}
