import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";
import type { AnchorSnapshot, AnchorType, SalesAnchorScore } from "@ldj/schemas";
import { anchorTypeEnum } from "./enums.js";
import { comparableCandidates } from "./comparable-candidates.js";
import { marketOffers } from "./market-offers.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * value_anchors（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §36 + §54 保留表）。
 *
 * 一行 = 一条「本产品为什么可以对标它」的可审计结论，不对应价格、也不对应相似度本身。
 *
 * 三条规则直接落在列上：
 * 1. 可靠锚点必须同时满足 `similarity_score >= 70` 与 `price_evidence_score >= 75`（§16.1 / §17），
 *    没有达标候选时本表可以为空，模式判定交给 `/benchmark-mode` 返回 CATEGORY_CREATOR；
 * 2. `snapshot` 把候选与价格证据在锚定那一刻冻住，日后候选/价格变动都不会篡改历史对标理由；
 * 3. `is_manual` + `rationale` 让人工锚点不被重建覆盖，人工判断永远优先于自动排序。
 */
export const valueAnchors = pgTable(
  "value_anchors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    anchorType: anchorTypeEnum("anchor_type").notNull(),
    /** 对标候选；人工锚点允许为空（例如人工指定某个整体对标对象） */
    candidateId: uuid("candidate_id").references(() => comparableCandidates.id, { onDelete: "set null" }),
    /** 该锚点引用的关键价格证据；没有可靠价格时为 NULL（此时不可能是 Highest Value 锚点） */
    marketOfferId: uuid("market_offer_id").references(() => marketOffers.id, { onDelete: "set null" }),

    similarityScore: integer("similarity_score").notNull().default(0),
    priceEvidenceScore: integer("price_evidence_score").notNull().default(0),
    /** 该候选可靠价格在同产品可比价格带中的百分位；没有可靠价格时为 NULL */
    pricePercentile: integer("price_percentile"),
    /** §16.3 六项加权总分；仅 Sales Anchor 有值 */
    salesAnchorScore: numeric("sales_anchor_score", { precision: 5, scale: 2 }),
    /** 六项分项明细 + 中文口径，供审核人员逐项核对；仅 Sales Anchor 有值 */
    salesAnchor: jsonb("sales_anchor").$type<SalesAnchorScore | null>(),

    rank: integer("rank").notNull().default(1),
    /** 同一产品同一时间只保留一条主要锚点 */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** 人工锚点：重建时默认保留，不被自动排序覆盖 */
    isManual: boolean("is_manual").notNull().default(false),
    /** 中文理由：为什么它可以是锚点（§28 / §29 / §30 的文案口径） */
    rationale: text("rationale").notNull(),
    selectedBy: uuid("selected_by").references(() => users.id, { onDelete: "set null" }),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    /** 锚定时刻的候选与价格快照，冻结对标理由 */
    snapshot: jsonb("snapshot").$type<AnchorSnapshot>().notNull(),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("value_anchors_product_idx").on(table.productId),
    index("value_anchors_type_idx").on(table.anchorType),
    index("value_anchors_rank_idx").on(table.productId, table.anchorType, table.rank),
    index("value_anchors_primary_idx").on(table.productId, table.isPrimary)
  ]
);

export type ValueAnchor = typeof valueAnchors.$inferSelect;
export type NewValueAnchor = typeof valueAnchors.$inferInsert;
export type { AnchorType };
