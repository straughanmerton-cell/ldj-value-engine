import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  CategoryReadiness,
  CategoryStyleIdentity,
  CategoryStandard,
  CategoryCreatorTrigger,
  ResolvedResearchMode,
  ValueLogic
} from "@ldj/schemas";
import { categoryCreatorTriggerEnum, categoryReadinessEnum, resolvedResearchModeEnum } from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * category_creator_profiles（规格 §4.2 / §17 / §29 / §54 保留表）。
 *
 * 一行 = 一版「没有对标时，这款茶自己给自己定的标准」。
 *
 * 四条规则直接落在列上：
 * 1. 只有无可靠锚点（或产品负责人显式弃用对标）时才生成，触发条件逐行记录（§4.2 / §17）；
 * 2. `standard` / `style_identity` / `value_logic` 全部整块冻结，日后产品事实变化不会篡改历史标准；
 * 3. `evidence_gaps` 是标准的一部分：事实不足时留缺口清单，而不是留弱化版文案（§4.2 / §62-7）；
 * 4. 所有版本必须保留（§62-15）：重新生成只新增 `version`，人工确认写在 `is_confirmed` 上。
 */
export const categoryCreatorProfiles = pgTable(
  "category_creator_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    trigger: categoryCreatorTriggerEnum("trigger").notNull(),
    /** 生成时的模式判定结论，正常情况下是 CATEGORY_CREATOR（用户弃用对标时可能仍是 BENCHMARK） */
    modeAtGeneration: resolvedResearchModeEnum("mode_at_generation").notNull(),
    readiness: categoryReadinessEnum("readiness").notNull(),
    supportedAxes: integer("supported_axes").notNull().default(0),
    totalAxes: integer("total_axes").notNull().default(6),

    /** 六轴自建标准（骨架 / 底气 / 身份 / 第一口 / 后半程 / 工艺） */
    standard: jsonb("standard").$type<CategoryStandard>().notNull(),
    /** 风格身份证：身份名、定位、第一口 / 中段 / 后半程、最不能丢的一项、明确不声称什么 */
    styleIdentity: jsonb("style_identity").$type<CategoryStyleIdentity>().notNull(),
    /** 价值逻辑四段：FACT → INTERPRETATION → VALUE → SALES_LINE（§24 三层标记） */
    valueLogic: jsonb("value_logic").$type<ValueLogic>().notNull(),

    /** 缺口清单：还缺哪些事实才能把标准讲成成交表达 */
    evidenceGaps: jsonb("evidence_gaps").$type<string[]>().notNull(),
    /** 本版标准引用的事实字段路径（product.* / dna.*），可逐条回查 */
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
    uniqueIndex("category_creator_profiles_product_version_idx").on(table.productId, table.version),
    index("category_creator_profiles_product_idx").on(table.productId),
    index("category_creator_profiles_readiness_idx").on(table.productId, table.readiness)
  ]
);

export type CategoryCreatorProfile = typeof categoryCreatorProfiles.$inferSelect;
export type NewCategoryCreatorProfile = typeof categoryCreatorProfiles.$inferInsert;
export type { CategoryCreatorTrigger, CategoryReadiness, ResolvedResearchMode };
