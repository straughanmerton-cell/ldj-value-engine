import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ResearchStage, WebExtractionAiOutput } from "@ldj/schemas";
import {
  sourceExtractionStatusEnum,
  sourceFetchStatusEnum,
  sourceKindEnum
} from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * sources（规格 §11 事实状态 / §41 网页抽取 / §54 保留表）。
 *
 * 同一产品的同一规范化 URL 只登记一次（unique(canonical_url, product_id)），
 * 重复登记只刷新抓取状态，不产生第二条来源——来源数量直接决定证据可信度。
 */
export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    /** 触发本条来源的搜索查询（手工登记时为 null） */
    query: text("query"),
    queryType: text("query_type"),
    stage: text("stage").$type<ResearchStage | null>(),

    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    domain: text("domain").notNull().default("unknown"),
    title: text("title"),
    snippet: text("snippet"),
    sourceKind: sourceKindEnum("source_kind").notNull().default("OTHER"),
    publishedAt: text("published_at"),
    note: text("note"),

    fetchStatus: sourceFetchStatusEnum("fetch_status").notNull().default("PENDING"),
    httpStatus: integer("http_status"),
    fetchError: text("fetch_error"),
    contentText: text("content_text"),
    contentChars: integer("content_chars"),

    extractionStatus: sourceExtractionStatusEnum("extraction_status").notNull().default("NOT_EXTRACTED"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    /** 最近一次抽取的净化结果（含 dropped / warnings），用于证据中心复看 */
    lastExtraction: jsonb("last_extraction").$type<WebExtractionAiOutput | null>(),
    lastExtractionDropped: jsonb("last_extraction_dropped").$type<unknown[] | null>(),
    lastExtractionWarnings: jsonb("last_extraction_warnings").$type<string[] | null>(),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("sources_canonical_product_idx").on(table.canonicalUrl, table.productId),
    index("sources_product_idx").on(table.productId),
    index("sources_domain_idx").on(table.domain),
    index("sources_kind_idx").on(table.sourceKind)
  ]
);

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

/**
 * source_extractions（规格 §41）：每次 Agent 3 抽取整行保留，不覆盖历史。
 * 抽取结果只作为「来源证据」，绝不自动写入产品事实（product_facts 必须人工确认）。
 */
export const sourceExtractions = pgTable(
  "source_extractions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    extraction: jsonb("extraction").$type<WebExtractionAiOutput>().notNull(),
    dropped: jsonb("dropped").$type<unknown[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    hasContent: jsonb("has_content").$type<boolean>().notNull().default(false),

    /** 抽取到的价格条数（净化后仍保留的） */
    priceCount: integer("price_count").notNull().default(0),
    /** 抽到的价格类型分布（用于「挂牌 ≠ 成交」的统计口径） */
    priceTypeCounts: jsonb("price_type_counts").$type<Record<string, number>>(),

    promptKey: text("prompt_key").notNull().default("WEB_EXTRACTOR"),
    promptVersion: integer("prompt_version"),
    provider: text("provider"),
    model: text("model"),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("source_extractions_source_idx").on(table.sourceId),
    index("source_extractions_product_idx").on(table.productId)
  ]
);

export type SourceExtraction = typeof sourceExtractions.$inferSelect;
export type NewSourceExtraction = typeof sourceExtractions.$inferInsert;
