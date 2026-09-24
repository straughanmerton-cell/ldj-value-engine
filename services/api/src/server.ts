import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { createDb, type DbHandle } from "@ldj/database";
import { isAppError } from "@ldj/shared";
import type { AppConfig } from "./config.js";
import { registerAuth } from "./plugins/auth.js";
import { registerDb } from "./plugins/db.js";
import { isSpaFallbackRequest, registerWebStatic } from "./plugins/web-static.js";
import { registerRoutes } from "./routes.js";

export interface BuildServerOptions {
  config: AppConfig;
  dbHandle?: DbHandle;
  logger?: boolean;
}

/**
 * 顺着 cause 链找 Postgres 的错误码。
 *
 * drizzle 会把驱动错误包一层 `DrizzleQueryError`，原始 pg 错误挂在 `cause` 上，
 * 所以只看最外层 `error.code` 会漏掉。
 */
function postgresCodeOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { config } = options;
  const app = Fastify({
    logger: options.logger ?? config.env.NODE_ENV !== "test"
  });

  const dbHandle = options.dbHandle ?? createDb({ connectionString: config.databaseUrl });

  app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
    credentials: true
  });

  registerDb(app, dbHandle);
  registerAuth(app, config.jwtSecret);

  // 生产形态下由本服务一并托管前端产物；关闭时（本地开发 / 单测）行为与之前完全一致。
  const servesWeb = registerWebStatic(app, { enabled: config.serveWeb });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      return reply.code(error.httpStatus).send({
        error: { code: error.code, message: error.message, details: error.details ?? undefined }
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "请求参数不合法",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        }
      });
    }
    if (error instanceof Error && "validation" in error && error.validation) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: error.message }
      });
    }
    // Fastify 自身的 4xx（空 JSON body、超出体积、不支持的类型等）属于客户端问题，
    // 必须保持 4xx 返回，否则前端无法区分「请求写错」与「服务出错」。
    const errorLike = error as { statusCode?: unknown; code?: unknown; message?: unknown };
    // Postgres 22P02 = invalid_text_representation：路径里的 id 不是 UUID 时数据库先报错。
    // 这类错误一定是「客户端给了一个不存在的标识」，按 404 回，别把参数问题报成 500。
    if (postgresCodeOf(error) === "22P02") {
      request.log.warn({ err: error }, "invalid identifier rejected");
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "未找到目标资源" }
      });
    }
    const clientStatus = typeof errorLike.statusCode === "number" ? errorLike.statusCode : undefined;
    if (clientStatus !== undefined && clientStatus >= 400 && clientStatus < 500) {
      request.log.warn({ err: error }, "client request rejected");
      return reply.code(clientStatus).send({
        error: {
          code: typeof errorLike.code === "string" ? errorLike.code : "BAD_REQUEST",
          message: typeof errorLike.message === "string" ? errorLike.message : "请求不合法"
        }
      });
    }

    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "服务器内部错误" }
    });
  });

  app.setNotFoundHandler((request, reply) => {
    // 只有「托管了前端」且「不是 /api 请求」时才回前端外壳，交给前端路由自己处理。
    if (servesWeb && isSpaFallbackRequest(request.method, request.url)) {
      return reply.type("text/html; charset=utf-8").sendFile("index.html");
    }
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: `未找到路由 ${request.method} ${request.url}` }
    });
  });

  registerRoutes(app, config);

  return app;
}
