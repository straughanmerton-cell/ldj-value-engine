import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  CandidateEvidence,
  CandidatePriceObservation,
  CandidateSimilarity,
  SimilarityFacet
} from "@ldj/schemas";
import { candidateStatusEnum, similarityBandEnum } from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * comparable_candidates（规格 §36 保留表 / §13 可比性评分 / §42 Agent 4）。
 *
 * 一条候选 = 一款被网页或其他来源提到的对标产品。同一款茶被多个来源提到时按
 * `(product_id, identity_key)` 合并成一条（identity_key = 品牌|名称|年份|规格），
 * 来源数量记在 merged_sources 与 source_ids 上，绝不因为来源多就多算一条候选。
 *
 * 价格只以「来源原话」形式存在 observed_prices 里，供 Phase 6 价格引擎使用；
 * similarity 的计算输入（facet）不含任何价格字段。
 */
export const comparableCandidates = pgTable(
  "comparable_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** 候选产品名（网页原文或人工登记，不改写） */
    name: text("name").notNull(),
    brandName: text("brand_name"),
    year: integer("year"),
    teaType: text("tea_type"),
    mountain: text("mountain"),
    originRegion: text("origin_region"),
    rawMaterial: text("raw_material"),
    weightG: integer("weight_g"),
    specNotes: text("spec_notes"),

    /** 去重键：品牌|名称|年份|规格（见 candidateIdentityKey） */
    identityKey: text("identity_key").notNull(),

    /** 相似度输入面（不含价格） */
    facet: jsonb("facet").$type<SimilarityFacet>().notNull(),
    similarityTotal: integer("similarity_total").notNull().default(0),
    similarityBand: similarityBandEnum("similarity_band").notNull().default("REJECT"),
    /** 十维明细 + 未知维度 + 中文说明 */
    similarity: jsonb("similarity").$type<CandidateSimilarity | null>(),

    status: candidateStatusEnum("status").notNull().default("PENDING_REVIEW"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    /** 提到该候选的来源 id 列表（去重合并时累加） */
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").$type<CandidateEvidence[]>().notNull().default([]),
    /** 观察价原话：只作证据，不参与相似度（§62-4） */
    observedPrices: jsonb("observed_prices").$type<CandidatePriceObservation[]>().notNull().default([]),
    /** 合并了多少条同身份来源 */
    mergedSources: integer("merged_sources").notNull().default(1),
    notes: text("notes"),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("comparable_candidates_identity_idx").on(table.productId, table.identityKey),
    index("comparable_candidates_product_idx").on(table.productId),
    index("comparable_candidates_score_idx").on(table.similarityTotal),
    index("comparable_candidates_band_idx").on(table.similarityBand),
    index("comparable_candidates_status_idx").on(table.status)
  ]
);

export type ComparableCandidate = typeof comparableCandidates.$inferSelect;
export type NewComparableCandidate = typeof comparableCandidates.$inferInsert;
