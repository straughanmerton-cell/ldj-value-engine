import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { SearchPlan } from "@ldj/schemas";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * search_plans（规格 §12 / §40 Agent 2）。
 *
 * 每次生成都新增一行（历史保留，§62-15），API 读取最新一条作为当前策略；
 * dna_version 指向生成时使用的 products.value_dna_meta.version，用于判定策略是否过期。
 */
export const searchPlans = pgTable(
  "search_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    dnaVersion: integer("dna_version"),
    plan: jsonb("plan").$type<SearchPlan>().notNull(),
    queryCount: integer("query_count").notNull().default(0),
    generator: text("generator").notNull().default("RULE_BASED"),
    dropped: jsonb("dropped").$type<unknown[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),

    promptVersion: integer("prompt_version"),
    provider: text("provider"),
    model: text("model"),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("search_plans_product_idx").on(table.productId),
    index("search_plans_created_at_idx").on(table.createdAt)
  ]
);

export type SearchPlanRow = typeof searchPlans.$inferSelect;
export type NewSearchPlanRow = typeof searchPlans.$inferInsert;
