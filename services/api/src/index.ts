import { loadRepoEnv } from "@ldj/database";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  loadRepoEnv();
  const config = loadConfig();
  const app = buildServer({ config });
  const address = await app.listen({ host: config.env.API_HOST, port: config.env.API_PORT });
  app.log.info(`龙德记 AI 高价值锚点与强成交话术系统 V2 API 已启动：${address}`);
}

main().catch((error: unknown) => {
  console.error("[api] 启动失败", error);
  process.exitCode = 1;
});
