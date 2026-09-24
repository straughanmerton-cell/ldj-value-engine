import "dotenv/config";
import type { AiProvider } from "@ldj/ai";
import type { SearchProvider } from "@ldj/search";
import { loadServerEnv, parseCorsOrigins, type ServerEnv } from "@ldj/shared";
import { resolveDatabaseUrl } from "@ldj/database";
import type { CrawlerService } from "./modules/research/crawler.service.js";

export interface AppConfig {
  env: ServerEnv;
  databaseUrl: string;
  corsOrigins: string[];
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  jwtSecret: string;
  /**
   * 是否由本服务托管前端构建产物（单网址部署形态）。
   *
   * 默认：`NODE_ENV=production` 开启，本地开发 / 单测关闭 —— 这样现有行为零变化，
   * 需要时可用 `SERVE_WEB=true|false` 显式覆盖。
   */
  serveWeb: boolean;
  /**
   * AI Provider 注入点（规格 §63-7：缺少第三方 Key 时回退 Mock）。
   * 默认按环境变量创建；测试可注入规则化 Mock 以验证 §62-13 的 schema 校验与事实拦截。
   */
  aiProvider?: AiProvider;
  /**
   * 搜索 Provider 注入点（规格 §12 / §62-1：搜索必须走真实检索，不得用模型记忆替代）。
   * 默认按环境变量创建；测试可注入带 fixture 的 MockSearchProvider，全程不联网。
   */
  searchProvider?: SearchProvider;
  /** Crawler 注入点：测试可放开内网限制并注入假 fetch，验证抓取与失败分支。 */
  crawler?: CrawlerService;
}

export function resolveServeWeb(source: NodeJS.ProcessEnv = process.env): boolean {
  const raw = source.SERVE_WEB?.trim().toLowerCase();
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return source.NODE_ENV === "production";
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = loadServerEnv(source);
  return {
    env,
    databaseUrl: resolveDatabaseUrl(source),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    jwtSecret: env.JWT_SECRET,
    serveWeb: resolveServeWeb(source)
  };
}
