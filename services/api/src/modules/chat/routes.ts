import type { FastifyInstance } from "fastify";
import {
  chatMessageListQuerySchema,
  chatSessionListQuerySchema,
  createChatSessionSchema,
  sendChatMessageSchema,
  updateChatSessionSchema
} from "@ldj/schemas";
import { currentUser } from "../../plugins/auth.js";
import type { ChatService } from "./chat.service.js";

/** 工作台产出的是**草稿**（不写 copy_outputs），所以主播 / 文案也能用，不必等管理员。 */
const WRITE_ROLES = ["ADMIN", "RESEARCHER", "COPYWRITER"] as const;

export interface ChatServices {
  chat: ChatService;
}

/**
 * AI 对话工作台路由（规格 §0 总执行说明 / §21–§27 / §31 / §33 / §62 / §64）。
 *
 * - GET    /api/chat/contract                     合同自检（输入 / 输出 / 上限 / 15 条铁律）
 * - GET    /api/chat/labels                       前端标签文案（五档强度 / 九种输出 / 禁用事实清单 / 当前 Provider）
 * - GET    /api/chat/sessions                     我的会话列表（分页 + 关键字 / 是否绑产品 / 是否归档）
 * - POST   /api/chat/sessions                     新建会话（201）
 * - PATCH  /api/chat/sessions/{id}                改标题 / 换产品 / 改强度
 * - DELETE /api/chat/sessions/{id}                删除会话（消息级联删除，204）
 * - GET    /api/chat/sessions/{id}/messages       会话消息（第 1 页 = 最新一段，返回升序）
 * - POST   /api/chat/sessions/{id}/messages       发一条需求，返回 AI 结构化话术（201）
 *
 * 会话**只属于创建者**：所有读写都按当前用户过滤，越权一律 404。
 */
export function registerChatRoutes(app: FastifyInstance, services: ChatServices): void {
  /** 合同自检：前端「这个工作台凭什么可信」面板直接读这里。 */
  app.get("/api/chat/contract", { preHandler: [app.requireAuth] }, async () =>
    services.chat.contractBody()
  );

  /** 标签与口径全部从 schema 层读，前端不另写一套文案。 */
  app.get("/api/chat/labels", { preHandler: [app.requireAuth] }, async () =>
    services.chat.labelsBody()
  );

  app.get("/api/chat/sessions", { preHandler: [app.requireAuth] }, async (request) => {
    const user = currentUser(request);
    return services.chat.listSessions(user.id, chatSessionListQuerySchema.parse(request.query ?? {}));
  });

  app.post(
    "/api/chat/sessions",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const user = currentUser(request);
      const session = await services.chat.createSession(
        user.id,
        createChatSessionSchema.parse(request.body ?? {})
      );
      return reply.code(201).send(session);
    }
  );

  app.patch(
    "/api/chat/sessions/:id",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request) => {
      const user = currentUser(request);
      const { id } = request.params as { id: string };
      return services.chat.updateSession(user.id, id, updateChatSessionSchema.parse(request.body ?? {}));
    }
  );

  app.delete(
    "/api/chat/sessions/:id",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const user = currentUser(request);
      const { id } = request.params as { id: string };
      await services.chat.deleteSession(user.id, id);
      return reply.code(204).send();
    }
  );

  app.get("/api/chat/sessions/:id/messages", { preHandler: [app.requireAuth] }, async (request) => {
    const user = currentUser(request);
    const { id } = request.params as { id: string };
    return services.chat.listMessages(
      user.id,
      id,
      chatMessageListQuerySchema.parse(request.query ?? {})
    );
  });

  /**
   * 发一条需求：AI 生成失败时**用户消息保留、AI 消息不落库**，
   * 返回 502 `AI_UNAVAILABLE` + `details.session_id` / `details.user_message_id`。
   */
  app.post(
    "/api/chat/sessions/:id/messages",
    { preHandler: [app.requireAuth, app.requireRole([...WRITE_ROLES])] },
    async (request, reply) => {
      const user = currentUser(request);
      const { id } = request.params as { id: string };
      const result = await services.chat.sendMessage(
        user.id,
        id,
        sendChatMessageSchema.parse(request.body ?? {})
      );
      return reply.code(201).send(result);
    }
  );
}
