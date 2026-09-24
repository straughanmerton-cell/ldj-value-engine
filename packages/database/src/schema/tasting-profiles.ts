import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { products } from "./products.js";
import { users } from "./users.js";

/**
 * tasting_profiles（规格 §10.4 / §36 保留表）。
 *
 * 同一个产品可以有多条品饮记录（不同品饮人、不同日期、不同轮次），
 * 因此 §10.4 的 20 项感官字段同时保留在 products 上（产品主档案的当前口径）
 * 与 tasting_profiles（可版本化的品饮档案）中，两边都不做自动同步。
 */
export const tastingProfiles = pgTable(
  "tasting_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),

    // ---- §10.4 感官（20 项）----
    dryLeafAroma: text("dry_leaf_aroma"),
    hotCupAroma: text("hot_cup_aroma"),
    liquorAroma: text("liquor_aroma"),
    coldCupAroma: text("cold_cup_aroma"),
    entryTaste: text("entry_taste"),
    bitterness: text("bitterness"),
    astringency: text("astringency"),
    sweetness: text("sweetness"),
    huigan: text("huigan"),
    salivation: text("salivation"),
    chaQi: text("cha_qi"),
    thickness: text("thickness"),
    viscosity: text("viscosity"),
    waterTexture: text("water_texture"),
    earlyStage: text("early_stage"),
    middleStage: text("middle_stage"),
    lateStage: text("late_stage"),
    finish: text("finish"),
    endurance: text("endurance"),
    leafBottom: text("leaf_bottom"),

    // ---- 品饮上下文 ----
    tasterName: text("taster_name"),
    tastedAt: timestamp("tasted_at", { withTimezone: true }),
    conclusion: text("conclusion"),
    evidenceSourceId: uuid("evidence_source_id"),

    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("tasting_profiles_product_id_idx").on(table.productId),
    index("tasting_profiles_tasted_at_idx").on(table.tastedAt)
  ]
);

export type TastingProfile = typeof tastingProfiles.$inferSelect;
export type NewTastingProfile = typeof tastingProfiles.$inferInsert;
