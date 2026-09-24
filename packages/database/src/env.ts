import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * 加载仓库根目录下的 .env。
 * dotenv 默认不覆盖已存在的变量，因此测试环境（NODE_ENV=test + TEST_DATABASE_URL）不受影响。
 */
export function loadRepoEnv(): void {
  loadDotenv({ path: path.join(repoRoot, ".env") });
}
