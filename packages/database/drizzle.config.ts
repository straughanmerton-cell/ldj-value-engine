import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// 与 migrate/seed 保持一致：显式加载仓库根目录 .env（不覆盖已有变量）。
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "../../database/migrations",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://ldj:ldj_dev_password@127.0.0.1:55433/ldj_dev"
  }
});
