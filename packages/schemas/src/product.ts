import { z } from "zod";
import { researchModeSchema, copyIntensitySchema } from "./enums.js";

const optionalText = z.string().trim().max(2000).optional();
const optionalShortText = z.string().trim().max(200).optional();
const optionalMoney = z.coerce.number().nonnegative().max(100_000_000).optional();
const optionalInt = z.coerce.number().int().nonnegative().max(1_000_000).optional();

/**
 * 产品结构叙事（规格 §5）。Phase 1 仅定义结构并随产品存储，
 * 自动生成能力在 Phase 10。
 */
export const productArchitectureSchema = z.object({
  backbone: z.string().default(""),
  identity: z.string().default(""),
  aroma_role: z.string().default(""),
  body_role: z.string().default(""),
  front_stage_role: z.string().default(""),
  middle_stage_role: z.string().default(""),
  finish_role: z.string().default(""),
  memory_point: z.string().default(""),
  value_role: z.string().default("")
});
export type ProductArchitecture = z.infer<typeof productArchitectureSchema>;

/**
 * 配方哲学（规格 §6）。未确认比例时 known_ratio=false 且不得填写比例数据。
 */
export const formulaPhilosophySchema = z
  .object({
    formula_strategy: z.string().default(""),
    backbone_component: z.array(z.string()).default([]),
    aroma_component: z.array(z.string()).default([]),
    sweetness_component: z.array(z.string()).default([]),
    body_component: z.array(z.string()).default([]),
    finish_component: z.array(z.string()).default([]),
    design_goal: z.string().default(""),
    known_ratio: z.boolean().default(false),
    ratio_data: z.record(z.string(), z.union([z.string(), z.number()])).nullable().default(null)
  })
  .refine((value) => value.known_ratio || !value.ratio_data, {
    message: "known_ratio=false 时不得填写具体配方比例",
    path: ["ratio_data"]
  });
export type FormulaPhilosophy = z.infer<typeof formulaPhilosophySchema>;

/** 产品基础资料（规格 §10.1） */
const productBasics = {
  product_name: z.string().trim().min(1, "产品名称必填").max(200),
  brand_id: z.string().uuid().nullable().optional(),
  series_name: optionalShortText,
  year: z.coerce.number().int().min(1900).max(2100),
  tea_type: z.string().trim().min(1, "茶类必填").max(50),
  tea_subtype: optionalShortText,
  origin_province: optionalShortText,
  origin_city: optionalShortText,
  origin_region: optionalShortText,
  mountain: optionalShortText,
  village: optionalShortText,
  weight_g: z.coerce.number().positive().max(100_000),
  pieces_per_box: optionalInt,
  boxes_per_case: optionalInt,
  suggested_retail_price: optionalMoney,
  internal_cost: optionalMoney
};

/** 原料（规格 §10.2） */
const productMaterial = {
  raw_material: optionalText,
  tree_type: optionalShortText,
  tree_age: optionalShortText,
  season: optionalShortText,
  harvest_standard: optionalShortText,
  grade: optionalShortText,
  blend_description: optionalText,
  material_notes: optionalText
};

/** 工艺（规格 §10.3） */
const productCraft = {
  kill_green_method: optionalShortText,
  rolling_method: optionalShortText,
  drying_method: optionalShortText,
  pressing_method: optionalShortText,
  fermentation_degree: optionalShortText,
  fermentation_method: optionalShortText,
  storage: optionalShortText,
  processing_notes: optionalText
};

/** 感官（规格 §10.4） */
const productSensory = {
  dry_leaf_aroma: optionalShortText,
  hot_cup_aroma: optionalShortText,
  liquor_aroma: optionalShortText,
  cold_cup_aroma: optionalShortText,
  entry_taste: optionalShortText,
  bitterness: optionalShortText,
  astringency: optionalShortText,
  sweetness: optionalShortText,
  huigan: optionalShortText,
  salivation: optionalShortText,
  cha_qi: optionalShortText,
  thickness: optionalShortText,
  viscosity: optionalShortText,
  water_texture: optionalShortText,
  early_stage: optionalShortText,
  middle_stage: optionalShortText,
  late_stage: optionalShortText,
  finish: optionalShortText,
  endurance: optionalShortText,
  leaf_bottom: optionalShortText
};

/** 研发关系（规格 §10.5 + §35.1） */
const productRnd = {
  benchmark_mode_preference: researchModeSchema,
  copy_intensity_default: copyIntensitySchema,
  r_and_d_reference_enabled: z.boolean(),
  r_and_d_reference_notes: optionalText,
  has_explicit_benchmark: z.boolean().optional(),
  has_rnd_reference: z.boolean().optional(),
  rnd_evidence_available: z.boolean().optional()
};

/**
 * 新建产品时的默认值（规格 §10.5）。
 * 更新（PATCH）路径刻意不使用默认值：否则只改某个字段就会把未提交的字段静默重置为默认值。
 */
const productRndWithDefaults = {
  ...productRnd,
  benchmark_mode_preference: productRnd.benchmark_mode_preference.default("AUTO"),
  copy_intensity_default: productRnd.copy_intensity_default.default(4),
  r_and_d_reference_enabled: productRnd.r_and_d_reference_enabled.default(false)
};

export const createProductSchema = z
  .object({
    ...productBasics,
    ...productMaterial,
    ...productCraft,
    ...productSensory,
    ...productRndWithDefaults,
    product_architecture: productArchitectureSchema.nullable().optional(),
    formula_philosophy: formulaPhilosophySchema.nullable().optional()
  })
  .strict();

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    ...productBasics,
    ...productMaterial,
    ...productCraft,
    ...productSensory,
    ...productRnd,
    product_architecture: productArchitectureSchema.nullable().optional(),
    formula_philosophy: formulaPhilosophySchema.nullable().optional()
  })
  .partial()
  .strict();

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  q: z.string().trim().max(200).optional(),
  tea_type: z.string().trim().max(50).optional(),
  mountain: z.string().trim().max(200).optional(),
  brand_id: z.string().uuid().optional(),
  benchmark_mode_preference: researchModeSchema.optional(),
  sort: z.enum(["created_at", "-created_at", "product_name", "-product_name", "year", "-year"]).optional()
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
