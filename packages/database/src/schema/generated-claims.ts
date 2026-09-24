import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { FactReviewEngine, FactReviewStatus, SalesCopyCompliance } from "@ldj/schemas";
import { claimTypeEnum, riskLevelEnum } from "./enums.js";
import { copyOutputs } from "./copy-outputs.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * generated_claims（规格 §24 / §25 / §36 / §49 / §53）。
 *
 * 一行 = **一次事实审核里的一个句子**，列即 §53 表格的六列（句子 / Claim Type / Risk / Evidence /
 * 修改建议 + 阻断标记），字段全部来自 `@ldj/schemas` 的 `buildFactReview()`，落库后不再重算。
 *
 * 三条口径直接落在表结构上：
 *
 * 1. **审核版本 = 成稿 + 审核序号**：`(copy_output_id, review_version)` 唯一，一次成稿可以被审核
 *    多次，`review_version` 只增不删（§62-15）；同一版本的首句行即该版本身份（`factReviewVersionSummarySchema.id`）；
 * 2. **评审级结论每行同值**：`engine` / `overall_risk` / `publishable` / `facts_used` / `compliance` /
 *    `evidence_gaps` / `warnings` 是**这一版审核的冻结结论**，同一审核版本的每一行都写同一份，
 *    因此只取某一行也能回答「这一版当时判成什么样」；`summary` / `claim_counts` 则由行本身机械计数得出
 *    （计数不是重新判定，与 `copy_outputs.impact_score_total` 同一性质）；
 * 3. **审批只写状态，不改结论**：`approval_status` / `approval_note` / `reviewed_by` / `reviewed_at`
 *    记在**被审批的那一版审核**的行上，重新审核只新增审核版本，历史审批留痕（§53 / §62-15）。
 *
 * `rnd_confirmed` / `has_reliable_price_anchor` / `price_high_story_ready` 一律取自**成稿落库时冻结的值**
 * （`copy_outputs.record.compliance.rnd_confirmed` / `record.anchor` / `record.price_high_story_ready`），
 * 不按今天的研发资料或锚点重算，否则同一版成稿会因为资料变化而「越审越松」或「越审越严」（§57）。
 */
export const generatedClaims = pgTable(
  "generated_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    copyOutputId: uuid("copy_output_id")
      .notNull()
      .references(() => copyOutputs.id, { onDelete: "cascade" }),
    /** 被审核的那一版强成交话术（`copy_outputs.version` 的冻结副本，便于版本列表免 join） */
    copyVersion: integer("copy_version").notNull(),
    /** 这一版成稿的第几次事实审核（从 1 递增，只增不删） */
    reviewVersion: integer("review_version").notNull(),
    /** RULE = 纯规则；RULE_AI = 规则 + Agent 11 标注（AI 只能加严，§62-14） */
    engine: text("engine").$type<FactReviewEngine>().notNull(),

    /** —— 评审级冻结结论（同一审核版本每行同值）—— */
    overallRisk: riskLevelEnum("overall_risk").notNull(),
    publishable: boolean("publishable").notNull(),
    rndConfirmed: boolean("rnd_confirmed").notNull(),
    hasReliablePriceAnchor: boolean("has_reliable_price_anchor").notNull(),
    priceHighStoryReady: boolean("price_high_story_ready").notNull(),
    /** §23 同口径：这一版逐字回查到的已录入事实条数 */
    factsUsed: integer("facts_used").notNull().default(0),
    /** §24 / §25 全文合规结论（与逐句判定同源） */
    compliance: jsonb("compliance").$type<SalesCopyCompliance>().notNull(),
    /** 逐句缺少出处的事实断言（§49 / §57） */
    evidenceGaps: jsonb("evidence_gaps").$type<string[]>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull(),

    /** —— 逐句行（§53 表格）—— */
    sentenceIndex: integer("sentence_index").notNull(),
    text: text("text").notNull(),
    claimType: claimTypeEnum("claim_type").notNull(),
    risk: riskLevelEnum("risk").notNull(),
    issue: text("issue"),
    suggestion: text("suggestion"),
    /** RED = 阻断句：存在任何一条就不允许审批（§53 / §57 / §62-14） */
    isBlocking: boolean("is_blocking").notNull().default(false),

    /** —— 人工审批（写在被审批的那一版审核上）—— */
    approvalStatus: text("approval_status").$type<FactReviewStatus>().notNull().default("PENDING"),
    approvalNote: text("approval_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("generated_claims_version_sentence_idx").on(
      table.copyOutputId,
      table.reviewVersion,
      table.sentenceIndex
    ),
    index("generated_claims_product_idx").on(table.productId),
    index("generated_claims_review_idx").on(table.copyOutputId, table.reviewVersion),
    index("generated_claims_approval_idx").on(table.productId, table.approvalStatus, table.reviewVersion)
  ]
);

export type GeneratedClaimRow = typeof generatedClaims.$inferSelect;
export type NewGeneratedClaimRow = typeof generatedClaims.$inferInsert;
