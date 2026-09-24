import { boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ChatReply, ChatRole } from "@ldj/schemas";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * AI 对话工作台（规格 §0 总执行说明 / §21–§27 成交文案 / §31 页面信息架构 / §33 强成交页面 /
 * §62 十五条铁律 / §64 项目最终目标）。
 *
 * 规格 §36 的表清单里没有这两张表：对话工作台是**既有能力的新入口**，不是新的研究能力，
 * 因此只新增「会话」与「消息」两张**记录表**，不复制任何业务表：
 *
 * 1. **一行业务口径仍只有一个权威来源**：工作台产出的 `payload` 是 `chatReplySchema` 校验过的
 *    草稿（§62-13），真正对外发布的成稿仍然只能来自 `copy_outputs` + 逐句事实审核（§53 / §57 /
 *    §62-14），对话服务不写 `copy_outputs`、不改任何既有表；
 * 2. **只记已录事实的追溯**：assistant 消息的 `provider` / `model` / `product_id` / `product_name`
 *    一并落库，事后能回答「这条话术当时是用哪家模型、基于哪款产品生成的」；
 * 3. **消息只增不改**：用户需求与 AI 成稿按时间追加，编辑会话不产生新版本（会话标题 / 强度 /
 *    绑定产品是可改的会话属性，话术正文不可回改——要改就发下一条需求，§62-15）。
 */
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** 绑定产品是会话属性：换产品就是换一件事，供后续消息组 Prompt 用（可为空 = 还没选产品） */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** §21 成交强度 1–5（会话默认档，默认 Level 4） */
    intensity: smallint("intensity").notNull().default(4),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("chat_sessions_user_idx").on(table.userId),
    index("chat_sessions_user_updated_idx").on(table.userId, table.updatedAt)
  ]
);

export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type NewChatSessionRow = typeof chatSessions.$inferInsert;

/**
 * chat_messages：一行 = 一条用户需求或一条 AI 成稿。
 *
 * `payload` 只在 assistant 消息上写入，且**必须**是 `chatReplySchema` 的解析结果（校验失败不落库，
 * 由服务层返回 502 `AI_UNAVAILABLE`），`schema_valid` 因此恒为 true —— 保留该列是为了让「历史数据
 * 口径变更」可被识别，而不是允许写入未校验内容。
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").$type<ChatRole>().notNull(),
    content: text("content").notNull(),
    payload: jsonb("payload").$type<ChatReply | null>(),
    /** 生成本条话术的 Provider 名称（mock / deepseek / openai），用户需求行为 null */
    provider: text("provider"),
    model: text("model"),
    /** 生成当时绑定的产品快照：产品被改名或删除后，历史消息仍然说得出「这是哪款茶的稿」 */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name"),
    schemaValid: boolean("schema_valid").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("chat_messages_session_idx").on(table.sessionId),
    index("chat_messages_session_created_idx").on(table.sessionId, table.createdAt)
  ]
);

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessageRow = typeof chatMessages.$inferInsert;
