import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid
} from "drizzle-orm/pg-core";
import type { FormulaPhilosophy, ProductArchitecture, ValueDna, ValueDnaMeta } from "@ldj/schemas";
import { brands } from "./brands.js";
import { researchModeEnum } from "./enums.js";
import { users } from "./users.js";

/**
 * products 表（规格 §10 产品录入 + §35.1 新增字段）。
 *
 * 说明：Phase 1 将 §10.4 感官字段内联在 products 上，保证产品录入表单一次成型；
 * Phase 2 引入 tasting_profiles 作为可版本化的品饮记录（见 docs/architecture.md 与 agent_memory/bugs.md）。
 */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),

    // ---- §10.1 基础资料 ----
    productName: text("product_name").notNull(),
    seriesName: text("series_name"),
    year: integer("year").notNull(),
    teaType: text("tea_type").notNull(),
    teaSubtype: text("tea_subtype"),
    originProvince: text("origin_province"),
    originCity: text("origin_city"),
    originRegion: text("origin_region"),
    mountain: text("mountain"),
    village: text("village"),
    weightG: numeric("weight_g", { precision: 10, scale: 2 }).notNull(),
    piecesPerBox: integer("pieces_per_box"),
    boxesPerCase: integer("boxes_per_case"),
    suggestedRetailPrice: numeric("suggested_retail_price", { precision: 14, scale: 2 }),
    internalCost: numeric("internal_cost", { precision: 14, scale: 2 }),

    // ---- §10.2 原料 ----
    rawMaterial: text("raw_material"),
    treeType: text("tree_type"),
    treeAge: text("tree_age"),
    season: text("season"),
    harvestStandard: text("harvest_standard"),
    grade: text("grade"),
    blendDescription: text("blend_description"),
    materialNotes: text("material_notes"),

    // ---- §10.3 工艺 ----
    killGreenMethod: text("kill_green_method"),
    rollingMethod: text("rolling_method"),
    dryingMethod: text("drying_method"),
    pressingMethod: text("pressing_method"),
    fermentationDegree: text("fermentation_degree"),
    fermentationMethod: text("fermentation_method"),
    storage: text("storage"),
    processingNotes: text("processing_notes"),

    // ---- §10.4 感官 ----
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

    // ---- §10.5 / §35.1 研发关系与成交增强字段 ----
    benchmarkModePreference: researchModeEnum("benchmark_mode_preference").notNull().default("AUTO"),
    copyIntensityDefault: smallint("copy_intensity_default").notNull().default(4),
    rAndDReferenceEnabled: boolean("r_and_d_reference_enabled").notNull().default(false),
    rAndDReferenceNotes: text("r_and_d_reference_notes"),
    hasExplicitBenchmark: boolean("has_explicit_benchmark"),
    hasRndReference: boolean("has_rnd_reference"),
    rndEvidenceAvailable: boolean("rnd_evidence_available"),
    formulaPhilosophy: jsonb("formula_philosophy").$type<FormulaPhilosophy | null>(),
    productArchitecture: jsonb("product_architecture").$type<ProductArchitecture | null>(),

    /**
     * 产品价值 DNA（规格 §9）：11 个维度数组 + 元数据分开存。
     * 元数据保留 provenance / 生成器 / 上游记录数量，用于追溯与过期判定。
     */
    valueDna: jsonb("value_dna").$type<ValueDna | null>(),
    valueDnaMeta: jsonb("value_dna_meta").$type<ValueDnaMeta | null>(),

    // ---- 元数据 ----
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("products_product_name_idx").on(table.productName),
    index("products_tea_type_idx").on(table.teaType),
    index("products_mountain_idx").on(table.mountain),
    index("products_brand_id_idx").on(table.brandId)
  ]
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
