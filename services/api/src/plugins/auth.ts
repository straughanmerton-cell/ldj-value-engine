import type { FastifyInstance, FastifyRequest } from "fastify";
import type { UserRole } from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import { verifyAccessToken } from "../lib/tokens.js";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export function registerAuth(app: FastifyInstance, jwtSecret: string): void {
  app.decorateRequest("authUser", undefined);

  app.decorate("requireAuth", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw AppError.unauthorized();
    }
    const token = header.slice("Bearer ".length).trim();
    const payload = await verifyAccessToken(token, jwtSecret);
    request.authUser = { id: payload.sub, email: payload.email, role: payload.role };
  });

  /**
   * 可选鉴权：带令牌时解析出身份，不带（或令牌无效）时按匿名处理。
   * 用于「首个用户自助注册成为 ADMIN、之后仅 ADMIN 可创建用户」这类同一路由双语义的场景。
   */
  app.decorate("optionalAuth", async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    try {
      const payload = await verifyAccessToken(token, jwtSecret);
      request.authUser = { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      request.authUser = undefined;
    }
  });

  app.decorate("requireRole", (roles: UserRole[]) => async (request: FastifyRequest) => {
    const user = request.authUser;
    if (!user) {
      throw AppError.unauthorized();
    }
    if (!roles.includes(user.role)) {
      throw AppError.forbidden(`需要权限：${roles.join(" / ")}`);
    }
  });
}

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<void>;
    optionalAuth: (request: FastifyRequest) => Promise<void>;
    requireRole: (roles: UserRole[]) => (request: FastifyRequest) => Promise<void>;
  }
}

export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw AppError.unauthorized();
  }
  return request.authUser;
}
