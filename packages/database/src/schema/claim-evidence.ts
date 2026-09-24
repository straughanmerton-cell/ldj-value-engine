import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { FactEvidenceKind } from "@ldj/schemas";
import { generatedClaims } from "./generated-claims.js";

/**
 * claim_evidence（规格 §24 / §46 / §53）。
 *
 * 一行 = 一条**机械逐字回查**出来的证据，挂在某个句子的审核行下面（`claim_id`）。
 * 这里没有「AI 补充的证据」这种可能：证据只来自本产品已录入字段、Value DNA、上游成稿正文与研发记录，
 * `traceable = false` 的行不得用来支撑 FACT 句（§24 / §49 / §62-5）。
 *
 * `source_id` 只有在证据确实对应某张表的行时才写（例如上游成稿版本行）；产品录入字段本身没有独立行，
 * 因此允许为 null——此时 `source_ref`（字段路径）就是定位依据。
 */
export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => generatedClaims.id, { onDelete: "cascade" }),
    /** 来源字段路径，例如 `product.mountain` / `dna.origin` */
    sourceRef: text("source_ref").notNull(),
    /** 可选的上游记录 id（产品事实行 / 成稿行）；产品字段本身没有独立行时为 null */
    sourceId: uuid("source_id"),
    /** 逐字出处 */
    excerpt: text("excerpt").notNull(),
    evidenceKind: text("evidence_kind").$type<FactEvidenceKind>().notNull(),
    /** 是否能在本产品自己的资料里逐字点回 */
    traceable: boolean("traceable").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("claim_evidence_claim_idx").on(table.claimId)]
);

export type ClaimEvidenceRow = typeof claimEvidence.$inferSelect;
export type NewClaimEvidenceRow = typeof claimEvidence.$inferInsert;
