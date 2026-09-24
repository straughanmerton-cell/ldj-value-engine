import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { factStatusEnum, rndReferenceTypeEnum } from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * r_and_d_references（规格 §35.2 列定义 + §54 新增表）。
 *
 * 严格按 §35.2 建列：
 * id / product_id / reference_product_id / reference_product_name / reference_type /
 * description / verification_status / evidence_source_id / created_at / updated_at。
 *
 * 两点补充说明（不改变 §35.2 语义）：
 * - evidence_source_id 指向 sources（Phase 4 建表），Phase 2 允许先用 evidence_note 记录证据文字；
 * - verification_status 使用 §11 的六态事实状态，只有 RND_CONFIRMED 允许声明研发/对标关系（§25）。
 */
export const rAndDReferences = pgTable(
  "r_and_d_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    referenceProductId: uuid("reference_product_id").references(() => products.id, {
      onDelete: "set null"
    }),
    referenceProductName: text("reference_product_name").notNull(),
    referenceType: rndReferenceTypeEnum("reference_type").notNull(),
    description: text("description").notNull(),

    verificationStatus: factStatusEnum("verification_status").notNull().default("UNCONFIRMED"),
    evidenceSourceId: uuid("evidence_source_id"),
    evidenceNote: text("evidence_note"),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("r_and_d_references_product_id_idx").on(table.productId),
    index("r_and_d_references_reference_product_id_idx").on(table.referenceProductId),
    index("r_and_d_references_verification_status_idx").on(table.verificationStatus)
  ]
);

export type RndReference = typeof rAndDReferences.$inferSelect;
export type NewRndReference = typeof rAndDReferences.$inferInsert;
