import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  AnchorResolveSource,
  ResearchMode,
  ResolvedResearchMode,
  ValueCodeAnalysisDimension,
  ValueCodeAnchorContext,
  ValueCodeCounts,
  ValueCodeItem,
  ValueCodeKey,
  ValueStories
} from "@ldj/schemas";
import { researchModeEnum, resolvedResearchModeEnum, valueCodeKeyEnum } from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * value_codes（规格 §18 / §54：Value Code 字典表）。
 *
 * 一行 = §18 定义的一个 Value Code。这张表是「字典快照」，唯一数据源是
 * `@ldj/schemas` 的 `VALUE_CODE_META`（16 个 Code、顺序与口径由 §18 固定），
 * 服务层按需同步，不做人工改写：字典一旦能被人改，Code 口径就会漂。
 */
export const valueCodes = pgTable(
  "value_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: valueCodeKeyEnum("code").notNull(),
    label: text("label").notNull(),
    /** 内部分析口径：这个 Code 到底在说什么 */
    definition: text("definition").notNull(),
    /** §43 中会产出这个 Code 的分析维度 */
    dimensions: jsonb("dimensions").$type<ValueCodeAnalysisDimension[]>().notNull(),
    /** §44 的底层条件 */
    requirement: text("requirement").notNull(),
    /** §18 的 contribution */
    contribution: text("contribution").notNull(),
    /** 允许引用的证据字段路径白名单（product.* / dna.*） */
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull(),
    /** §19：是否属于「今天不成立、看未来底子」的时间依赖型 */
    timeDependent: boolean("time_dependent").notNull().default(false),
    specRef: text("spec_ref").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("value_codes_code_idx").on(table.code)]
);

/**
 * product_value_codes（规格 §18 / §19 / §20 / §54：产品级价值映射）。
 *
 * 一行 = 一版「这款产品的 16 个 Code 各自处于什么状态」。
 *
 * 五条规则直接落在列上：
 * 1. `codes` 固定 16 条、顺序固定（§18），整块冻结，产品事实变化不会篡改历史映射；
 * 2. 状态只有 5 种（§19），`TIME_DEPENDENT` 的成交表达在数据里就是固定安全句式，
 *    不可能在落库后被人改成「以后一定会有。」；
 * 3. `evidence_gaps` 是映射的一部分：事实不足时留缺口清单，而不是留弱化版故事（§11 / §62-7）；
 * 4. 对标只提供标准：`anchor_context` 只记录「参考了哪条锚点」，本产品事实一律来自自身字段（§44 / §62-5）；
 * 5. 所有版本必须保留（§62-15）：重新生成只新增 `version`，人工确认写在 `is_confirmed` 上。
 */
export const productValueCodes = pgTable(
  "product_value_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** 产品录入时的模式偏好：AUTO / BENCHMARK / CATEGORY_CREATOR */
    preference: researchModeEnum("preference").notNull().default("AUTO"),
    /** 生成时判定的模式（§17） */
    modeAtGeneration: resolvedResearchModeEnum("mode_at_generation").notNull(),
    /** 模式来源：AUTO_ANCHOR / MANUAL_PREFERENCE / NO_RELIABLE_ANCHOR */
    resolvedBy: text("resolved_by").$type<AnchorResolveSource>().notNull(),
    modeReason: text("mode_reason").notNull(),

    /** 对标上下文：只说明「高价值产品需要什么底层条件」，不作为本产品证据（§44） */
    anchorContext: jsonb("anchor_context").$type<ValueCodeAnchorContext | null>(),

    /** 16 个 Code 的完整映射（§18 顺序） */
    codes: jsonb("codes").$type<ValueCodeItem[]>().notNull(),
    /** 5 种状态各自的计数（§19） */
    codeCounts: jsonb("code_counts").$type<ValueCodeCounts>().notNull(),
    /** 六类价值故事（§20）；配方哲学固定 HANDOFF（Phase 11），产品结构取 Phase 10 的结构正文（无结构则 GAP） */
    stories: jsonb("stories").$type<ValueStories>().notNull(),

    /** 缺口清单：还缺哪些事实才能把 Code 讲成故事 */
    evidenceGaps: jsonb("evidence_gaps").$type<string[]>().notNull(),
    /** 本版映射引用的事实字段路径（product.* / dna.*），可逐条回查 */
    factRefs: jsonb("fact_refs").$type<string[]>().notNull(),
    valueDnaRefs: jsonb("value_dna_refs").$type<string[]>().notNull(),

    isConfirmed: boolean("is_confirmed").notNull().default(false),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("product_value_codes_product_version_idx").on(table.productId, table.version),
    index("product_value_codes_product_idx").on(table.productId),
    index("product_value_codes_confirmed_idx").on(table.productId, table.isConfirmed)
  ]
);

export type ValueCode = typeof valueCodes.$inferSelect;
export type NewValueCode = typeof valueCodes.$inferInsert;
export type ProductValueCode = typeof productValueCodes.$inferSelect;
export type NewProductValueCode = typeof productValueCodes.$inferInsert;
export type { AnchorResolveSource, ResearchMode, ResolvedResearchMode, ValueCodeKey };
