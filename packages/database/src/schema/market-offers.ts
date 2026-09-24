import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { MarketOfferAttribution, PriceEvidence, PriceType, PriceUnitScope } from "@ldj/schemas";
import { marketOfferAttributionEnum, priceEvidenceBandEnum, priceTypeEnum } from "./enums.js";
import { comparableCandidates } from "./comparable-candidates.js";
import { products } from "./products.js";
import { sources } from "./sources.js";
import { users } from "./users.js";

/**
 * market_offers（规格 §14 市场价格系统 / §15 Price Evidence Score / §54 保留表）。
 *
 * 一行 = 一条价格证据：来源写了什么价、是什么性质、对应什么规格。
 * 四条不可动摇的规则直接落在列上：
 * 1. `price_type` 按来源原文判定，挂牌价永远不是成交价（§62-2）；
 * 2. `unit_scope` 必填语义、`weight_g` 没写就 NULL，整件价不折算单饼价（§62-3）；
 * 3. `observed_at` / `published_at` 只存来源原文写法，历史价不当当前价（§62-4）；
 * 4. 价格不参与相似度：相似度只看 comparable_candidates（§13）。
 *
 * 去重键 `dedup_key` = 身份 + 价格类型 + 单位 + 币种 + 规格 + 数值：
 * 不同来源写到同一组价格时合并成一行并把来源数累加到 `source_ids` / `source_count`，
 * 数值不同则各自成行（价格带由汇总统计给出，绝不把两个价格平均成一个假价格）。
 */
export const marketOffers = pgTable(
  "market_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** 价格挂在哪个对标候选上；来源没写身份时为 NULL（绝不强行挂靠） */
    candidateId: uuid("candidate_id").references(() => comparableCandidates.id, { onDelete: "set null" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),

    /** 价格主体身份：一律取来源原文，未写明即 NULL */
    subjectName: text("subject_name"),
    subjectBrand: text("subject_brand"),
    subjectYear: integer("subject_year"),
    subjectSpec: text("subject_spec"),
    identityKey: text("identity_key"),

    priceType: priceTypeEnum("price_type").notNull(),
    unitScope: text("unit_scope").$type<PriceUnitScope | null>(),
    value: numeric("value", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("CNY"),
    /** 来源写明的规格重量（单饼重量或整件总重）；没写即 NULL，不做任何推断 */
    weightG: integer("weight_g"),
    piecesPerCase: integer("pieces_per_case"),

    /** 归一化结果：缺重量一律 NULL（没有写 = 不计算） */
    pricePerKg: numeric("price_per_kg", { precision: 16, scale: 2 }),
    price357g: numeric("price_357g", { precision: 16, scale: 2 }),
    /** 整件价是否允许折算单饼价：整件稀缺溢价不线性拆分（§14 / §62-3） */
    pieceEquivalentAllowed: boolean("piece_equivalent_allowed").notNull().default(true),

    evidenceScore: integer("evidence_score").notNull().default(0),
    evidenceBand: priceEvidenceBandEnum("evidence_band").notNull().default("WEAK"),
    /** 五项加权明细 + 中文理由，供审核人员逐项核对 */
    evidence: jsonb("evidence").$type<PriceEvidence | null>(),

    attribution: marketOfferAttributionEnum("attribution").notNull().default("MANUAL"),
    /** 来源原话，必须逐字可回溯；人工登记也要写清出处原话 */
    quote: text("quote").notNull(),
    /**
     * 引文是否能在来源正文中逐字回溯。
     * 存下来而不是读时现算：一次抽取就把结果定死，人工改单位重算证据分时口径不会漂移。
     */
    quoteTraceable: boolean("quote_traceable").notNull().default(false),
    note: text("note"),
    /** 人工备注：与 note 分开，重算证据不会覆盖人工判断 */
    manualNote: text("manual_note"),

    /** 来源原文写法的时间（可能是「2024 年春」这类模糊表述，故用 text 存原话） */
    observedAt: text("observed_at"),
    publishedAt: text("published_at"),

    /** 异常值只标记不删除（§62-15）：保留原始价格供人工判断 */
    isOutlier: boolean("is_outlier").notNull().default(false),
    outlierReason: text("outlier_reason"),
    outlierMedian: numeric("outlier_median", { precision: 14, scale: 2 }),
    outlierSampleSize: integer("outlier_sample_size"),
    outlierGroupKey: text("outlier_group_key"),
    /** 人工排除：被排除的价格不进入汇总与锚点，但仍在库里可查 */
    isExcluded: boolean("is_excluded").notNull().default(false),

    /** 去重键：身份 + 类型 + 单位 + 币种 + 规格 + 数值 */
    dedupKey: text("dedup_key").notNull(),
    /** 同一组价格被哪些来源写到（同一页面重复登记不算多个来源） */
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    sourceCount: integer("source_count").notNull().default(1),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("market_offers_dedup_idx").on(table.productId, table.dedupKey),
    index("market_offers_product_idx").on(table.productId),
    index("market_offers_candidate_idx").on(table.candidateId),
    index("market_offers_type_idx").on(table.priceType),
    index("market_offers_band_idx").on(table.evidenceBand),
    index("market_offers_outlier_idx").on(table.isOutlier)
  ]
);

export type MarketOffer = typeof marketOffers.$inferSelect;
export type NewMarketOffer = typeof marketOffers.$inferInsert;
export type { MarketOfferAttribution, PriceType };
