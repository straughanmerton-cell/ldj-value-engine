import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { factStatusEnum, productFactGroupEnum } from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * product_facts（规格 §11 事实状态 / §36 保留表）。
 *
 * 每条事实独立存储状态与证据指向：
 * - 事实状态六态：OFFICIAL_CONFIRMED / INTERNAL_CONFIRMED / TASTING_CONFIRMED /
 *   RND_CONFIRMED / SUPPLIER_PROVIDED / UNCONFIRMED；
 * - evidence_source_id 指向 sources（Phase 4 建表），Phase 2 先允许用 evidence_note 记录证据；
 * - 未确认即不编造：状态非 UNCONFIRMED 时必须带证据（schema 与 service 双层校验）。
 */
export const productFacts = pgTable(
  "product_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    factKey: text("fact_key").notNull(),
    factLabel: text("fact_label"),
    factGroup: productFactGroupEnum("fact_group").notNull().default("OTHER"),
    factValue: text("fact_value").notNull(),
    factStatus: factStatusEnum("fact_status").notNull().default("UNCONFIRMED"),

    evidenceNote: text("evidence_note"),
    evidenceSourceId: uuid("evidence_source_id"),

    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("product_facts_product_id_idx").on(table.productId),
    index("product_facts_fact_status_idx").on(table.factStatus),
    index("product_facts_fact_key_idx").on(table.factKey)
  ]
);

export type ProductFact = typeof productFacts.$inferSelect;
export type NewProductFact = typeof productFacts.$inferInsert;
