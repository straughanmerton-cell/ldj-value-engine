import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { promptKeyEnum } from "./enums.js";
import { users } from "./users.js";

/**
 * prompt_versions（规格 §50 / §54 保留表）。
 *
 * 11 个 Prompt Key 的每一个版本都整行保留（§62-15「所有版本必须保留」）：
 * - 编辑（edit）不修改历史行，而是派生出一个新版本；
 * - 启用（active）与回滚（rollback）都只是把 is_active 重新指向某个历史版本；
 * - 试跑（test run）只读取当前启用版本，不写业务数据。
 */
export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptKey: promptKeyEnum("prompt_key").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(false),
    /** 派生来源版本（edit 能力），首个版本为 null */
    basedOnVersion: integer("based_on_version"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("prompt_versions_key_version_idx").on(table.promptKey, table.version),
    index("prompt_versions_key_active_idx").on(table.promptKey, table.isActive)
  ]
);

export type PromptVersion = typeof promptVersions.$inferSelect;
export type NewPromptVersion = typeof promptVersions.$inferInsert;
