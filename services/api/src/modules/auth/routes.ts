import type { FastifyInstance } from "fastify";
import { loginSchema, refreshSchema, registerSchema } from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import { currentUser } from "../../plugins/auth.js";
import type { AuthService } from "./service.js";

export interface AuthRoutesDeps {
  authService: AuthService;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const { authService } = deps;

  app.post("/api/auth/register", { preHandler: [app.optionalAuth] }, async (request, reply) => {
    const input = registerSchema.parse(request.body ?? {});
    const actor = request.authUser ? { role: request.authUser.role } : undefined;
    const result = await authService.register(input, actor);
    return reply.code(201).send(result);
  });

  app.post("/api/auth/login", async (request) => {
    const input = loginSchema.parse(request.body ?? {});
    return authService.login(input, {
      userAgent: request.headers["user-agent"],
      ip: request.ip
    });
  });

  app.post("/api/auth/refresh", async (request) => {
    const input = refreshSchema.parse(request.body ?? {});
    return authService.refresh(input.refresh_token, {
      userAgent: request.headers["user-agent"],
      ip: request.ip
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const body = (request.body ?? {}) as { refresh_token?: string };
    if (typeof body.refresh_token !== "string" || body.refresh_token.length < 10) {
      throw AppError.validation("refresh_token 必填");
    }
    await authService.logout(body.refresh_token);
    return reply.code(204).send();
  });

  app.get("/api/auth/me", { preHandler: [app.requireAuth] }, async (request, reply) => {
    const actor = currentUser(request);
    const user = await authService.findUserById(actor.id);
    if (!user) {
      throw AppError.unauthorized();
    }
    return reply.send({ user });
  });
}
