import { boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  AnchorResolveSource,
  ResearchMode,
  ResolvedResearchMode,
  SalesCopyDraft,
  ValueFocusKey
} from "@ldj/schemas";
import { researchModeEnum, resolvedResearchModeEnum } from "./enums.js";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * copy_outputs（规格 §35.5 / §21 / §22 / §23 / §26 / §27 / §33 / §47）。
 *
 * 规格 §36 只给出了表名（`copy_outputs`），字段由本阶段按 §21–§26 的输出清单落地。
 *
 * 一行 = 一版「主播拿起来就能讲」的强成交话术，六条规则直接落在列上：
 *
 * 1. **正文与派生结论一起冻结**：`record` 存 `SalesCopyDraft` —— 十三格骨架、§26 九种输出、
 *    §23 评分、§22 七项、§24 合规、§57 验收与引用清单。这些全部由 `@ldj/schemas` 的纯函数产出，
 *    落库后不再随产品事实变化而漂：要改就生成下一版（§62-15），不能把已交付的王者稿「改差」；
 * 2. **成交强度是本版属性**：`intensity` 记录这一版用的是 §21 哪一档（默认 Level 4），
 *    §33 的价值重点八项存 `value_focus`，两处都不推断、不补默认；
 * 3. **模式判定留痕**：`preference` / `mode_at_generation` / `resolved_by` / `mode_reason`
 *    记录生成当时 §17 的结论，日后锚点变化不影响历史版本的定性（Benchmark 还是自建标准）；
 * 4. **排序与筛选用冗余键**：`impact_score_total` / `impact_score_band` / `level5_passed`
 *    是 `record` 的派生值，只为 §31「强成交话术库」的排序与筛选存在，权威内容始终在 `record`；
 * 5. **强化轮次是列**：`intensify_rounds` 由 Phase 13「再狠一点」推进（最多 3 轮，§34）；
 *    读取时以列为准，避免 jsonb 与列两处都改；
 * 6. **版本必须保留**（§62-15）：重新生成只新增 `version`，人工确认只写 `is_confirmed`。
 */
export const copyOutputs = pgTable(
  "copy_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),

    /** 产品录入时的模式偏好：AUTO / BENCHMARK / CATEGORY_CREATOR（§33 模式控件） */
    preference: researchModeEnum("preference").notNull().default("AUTO"),
    /** 生成当时 §17 判定的模式：没有可靠锚点必须是 CATEGORY_CREATOR */
    modeAtGeneration: resolvedResearchModeEnum("mode_at_generation").notNull(),
    resolvedBy: text("resolved_by").$type<AnchorResolveSource>().notNull(),
    modeReason: text("mode_reason").notNull(),

    /** §21 成交强度 1–5（默认 Level 4）；五档的定义与阈值在 `@ldj/schemas` 固化 */
    intensity: smallint("intensity").notNull().default(4),
    /** §34 / §48：这一版自动增强过几轮（Phase 12 恒为 0，Phase 13 最多 3） */
    intensifyRounds: integer("intensify_rounds").notNull().default(0),
    /** §33 价值重点八项（勾中的项必须多讲，未勾中的不硬塞） */
    valueFocus: jsonb("value_focus").$type<ValueFocusKey[]>().notNull(),

    /** 一版完整成稿：正文 + §23 评分 + §22 七项 + §24 合规 + §57 验收 + 引用清单 */
    record: jsonb("record").$type<SalesCopyDraft>().notNull(),

    /** record 的派生冗余键：只服务排序 / 筛选，不参与任何判定 */
    impactScoreTotal: integer("impact_score_total").notNull().default(0),
    impactScoreBand: text("impact_score_band").notNull().default("REWRITE"),
    level5Passed: boolean("level5_passed").notNull().default(false),

    isConfirmed: boolean("is_confirmed").notNull().default(false),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "set null" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("copy_outputs_product_version_idx").on(table.productId, table.version),
    index("copy_outputs_product_idx").on(table.productId),
    index("copy_outputs_confirmed_idx").on(table.productId, table.isConfirmed),
    index("copy_outputs_score_idx").on(table.impactScoreTotal)
  ]
);

export type CopyOutputRow = typeof copyOutputs.$inferSelect;
export type NewCopyOutputRow = typeof copyOutputs.$inferInsert;
