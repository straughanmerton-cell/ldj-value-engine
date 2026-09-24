import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

/**
 * 仓库内前端构建产物目录。
 *
 * 本服务用 `tsx` 直接跑 TS 源码（不做打包），所以可以从源码位置反推仓库根：
 * services/api/src/plugins -> services/api/src -> services/api -> services -> <repo>
 */
const DIST_DIR_FROM_SOURCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/web/dist"
);

export interface WebStaticOptions {
  /** 是否托管前端产物。默认由 config 决定（生产形态开启，本地开发与单测关闭）。 */
  enabled: boolean;
  /** 覆盖产物目录，便于部署时把静态文件放到别处。 */
  distDir?: string;
}

/**
 * 生产部署形态：**同一个服务既出 API 也出前端产物**。
 *
 * 这样对外只有一个网址（免 CORS、免第二个平台的冷启动、前端不用在构建期写死 API 地址）。
 * 未开启或产物不存在时返回 `false`，此时服务行为与改动前**完全一致**，所以单测与本地开发不受影响。
 */
export function registerWebStatic(app: FastifyInstance, options: WebStaticOptions): boolean {
  if (!options.enabled) {
    return false;
  }

  const distDir = path.resolve(options.distDir ?? process.env.WEB_DIST_DIR ?? DIST_DIR_FROM_SOURCE);
  if (!existsSync(path.join(distDir, "index.html"))) {
    app.log.warn({ distDir }, "未找到前端构建产物，本次只提供 API（请先执行 pnpm --filter @ldj/web build）");
    return false;
  }

  app.register(fastifyStatic, {
    root: distDir,
    index: ["index.html"],
    /**
     * 必须关掉内置 cache-control：@fastify/send 会用 `maxAge` 拼一个统一的
     * `public, max-age=<maxAge>` 并在 setHeaders 之后再写一次头，把这里设的值盖掉
     * （实测：产物名带 hash 的资源也变成 `max-age=0`）。关掉后由下面按文件分别设置。
     */
    cacheControl: false,
    // 参数类型由 FastifyStaticOptions 推导（该回调拿到的是响应对象，不是 FastifyReply）。
    setHeaders(response, filePath) {
      if (filePath.endsWith("index.html")) {
        // 外壳必须每次回源，否则发版后用户会拿到旧壳 + 已失效的资源名。
        response.setHeader("cache-control", "no-cache");
        return;
      }
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // Vite 产物名带内容 hash，可以放心长缓存。
        response.setHeader("cache-control", "public, max-age=31536000, immutable");
        return;
      }
      response.setHeader("cache-control", "public, max-age=3600");
    }
  });

  app.log.info({ distDir }, "已开启前端静态托管（单服务同源形态）");
  return true;
}

/**
 * 前端用 BrowserRouter，直接访问 `/chat` 这类深链必须回 `index.html`。
 *
 * 但 `/api/**` 必须保持 JSON 404：前端靠状态码区分「接口不存在」与「路由不存在」，
 * 单测也断言了这一点（`tests/health.test.ts`）。
 */
export function isSpaFallbackRequest(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }
  const pathname = url.split("?")[0] ?? "";
  return pathname !== "/api" && !pathname.startsWith("/api/");
}
