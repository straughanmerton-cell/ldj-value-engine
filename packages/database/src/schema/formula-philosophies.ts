import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { FormulaIngredientRole, FormulaTasteRole } from "@ldj/schemas";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * formula_philosophies（规格 §35.4 / §6 / §46：配方哲学）。
 *
 * 一行 = 一版「这款茶为什么这么设计」（§6.3 的五个分量 + 设计逻辑 + 比例口径）。
 *
 * 五条规则直接落在列上：
 * 1. 五个分量字段由 §6.3 固定（backbone / aroma / sweetness / body / finish），
 *    分别存 JSONB 字符串数组；没有事实的分量存空数组，**不留弱化版文案**（§11 / §46）；
 * 2. `formula_strategy` / `design_goal` / `sales_explanation` 是 §46 Agent 8 的三段成稿正文：
 *    前两段属于 INTERPRETATION，`sales_explanation` 属于 RHETORIC（§24），都不新增任何事实；
 * 3. `known_ratio=false` 时 `ratio_data` 必须为 NULL —— 「不得自动编比例」在存储层就成立（§6.1）；
 *    确认比例时用 `ratio_evidence` / `ratio_source` 保留逐字证据与来源（§35.4 的 ratio_data 之外，
 *    本阶段补两列，避免「比例说得出来、来源说不出来」）；
 * 4. `evidence_ids` 存这一版用到的字段级证据引用（product.* / dna.*）：
 *    配方哲学只允许引用本产品已录入字段，所以这里存的是字段路径而不是外部来源 id（§62-5）；
 * 5. 所有版本必须保留（§62-15）：重新生成只新增 `version`，人工确认写在 `is_confirmed` 上。
 */
export const formulaPhilosophies = pgTable(
  "formula_philosophies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** §6.3 / §35.4 的五个分量（JSONB 字符串数组） */
    backboneComponent: jsonb("backbone_component").$type<string[]>().notNull(),
    aromaComponent: jsonb("aroma_component").$type<string[]>().notNull(),
    sweetnessComponent: jsonb("sweetness_component").$type<string[]>().notNull(),
    bodyComponent: jsonb("body_component").$type<string[]>().notNull(),
    finishComponent: jsonb("finish_component").$type<string[]>().notNull(),

    /** §46 的三段成稿正文（设计逻辑 / 设计目标 / 成交层解释） */
    formulaStrategy: text("formula_strategy").notNull().default(""),
    designGoal: text("design_goal").notNull().default(""),
    salesExplanation: text("sales_explanation").notNull().default(""),

    /** §46 的 ingredient_roles / taste_roles：由分量引用反推，可逐条回查 */
    ingredientRoles: jsonb("ingredient_roles").$type<FormulaIngredientRole[]>().notNull(),
    tasteRoles: jsonb("taste_roles").$type<FormulaTasteRole[]>().notNull(),

    /** §6.1 比例口径：没有确认比例时 known_ratio=false 且 ratio_data 为 NULL */
    knownRatio: boolean("known_ratio").notNull().default(false),
    ratioData: jsonb("ratio_data").$type<Record<string, string> | null>(),
    ratioEvidence: jsonb("ratio_evidence").$type<string[]>().notNull(),
    ratioSource: text("ratio_source"),

    /** 引用到的字段级证据（product.* / dna.*），可逐条回查 */
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    version: integer("version").notNull(),

    isConfirmed: boolean("is_confirmed").notNull().default(false),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("formula_philosophies_product_version_idx").on(table.productId, table.version),
    index("formula_philosophies_product_idx").on(table.productId),
    index("formula_philosophies_confirmed_idx").on(table.productId, table.isConfirmed)
  ]
);

export type FormulaPhilosophyRow = typeof formulaPhilosophies.$inferSelect;
export type NewFormulaPhilosophyRow = typeof formulaPhilosophies.$inferInsert;
