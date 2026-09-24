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
import type { ProductArchitecture } from "@ldj/schemas";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * product_architectures（规格 §35.3 / §5 / §45：产品结构叙事）。
 *
 * 一行 = 一版「这款茶的九个角色各自承担什么任务」（§5 固定字段与顺序）。
 *
 * 四条规则直接落在列上：
 * 1. 九个角色字段由 §35.3 固定；没有事实的角色存空串，**不留弱化版文案**（§11 / §45 / §62-7）；
 * 2. `evidence_ids` 存这一版用到的字段级证据引用（product.* / dna.*）：
 *    产品结构只允许引用本产品已录入字段，所以这里存的是字段路径而不是外部来源 id（§45 / §62-5）；
 * 3. `narrative` 是 §5 要求的「结构叙事」正文（各角色分工串成一段），事实不足时为空串；
 * 4. 所有版本必须保留（§62-15）：重新生成只新增 `version`，人工确认写在 `is_confirmed` 上。
 */
export const productArchitectures = pgTable(
  "product_architectures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** §5 / §35.3 的九个角色字段 */
    backbone: text("backbone").notNull().default(""),
    identity: text("identity").notNull().default(""),
    aromaRole: text("aroma_role").notNull().default(""),
    bodyRole: text("body_role").notNull().default(""),
    frontStageRole: text("front_stage_role").notNull().default(""),
    middleStageRole: text("middle_stage_role").notNull().default(""),
    finishRole: text("finish_role").notNull().default(""),
    memoryPoint: text("memory_point").notNull().default(""),
    valueRole: text("value_role").notNull().default(""),

    /** §5 的结构叙事段落（= value_role 成稿；不足 3 个写实角色时为空串） */
    narrative: text("narrative").notNull().default(""),
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
    uniqueIndex("product_architectures_product_version_idx").on(table.productId, table.version),
    index("product_architectures_product_idx").on(table.productId),
    index("product_architectures_confirmed_idx").on(table.productId, table.isConfirmed)
  ]
);

export type ProductArchitectureRow = typeof productArchitectures.$inferSelect;
export type NewProductArchitectureRow = typeof productArchitectures.$inferInsert;
export type { ProductArchitecture };
