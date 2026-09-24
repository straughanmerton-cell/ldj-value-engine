import type { Product } from "@ldj/database";
import type { UserRole } from "@ldj/schemas";

export interface ProductApiShape {
  id: string;
  brand_id: string | null;
  product_name: string;
  series_name: string | null;
  year: number;
  tea_type: string;
  tea_subtype: string | null;
  origin_province: string | null;
  origin_city: string | null;
  origin_region: string | null;
  mountain: string | null;
  village: string | null;
  weight_g: number;
  pieces_per_box: number | null;
  boxes_per_case: number | null;
  suggested_retail_price: number | null;
  internal_cost: number | null;
  raw_material: string | null;
  tree_type: string | null;
  tree_age: string | null;
  season: string | null;
  harvest_standard: string | null;
  grade: string | null;
  blend_description: string | null;
  material_notes: string | null;
  kill_green_method: string | null;
  rolling_method: string | null;
  drying_method: string | null;
  pressing_method: string | null;
  fermentation_degree: string | null;
  fermentation_method: string | null;
  storage: string | null;
  processing_notes: string | null;
  dry_leaf_aroma: string | null;
  hot_cup_aroma: string | null;
  liquor_aroma: string | null;
  cold_cup_aroma: string | null;
  entry_taste: string | null;
  bitterness: string | null;
  astringency: string | null;
  sweetness: string | null;
  huigan: string | null;
  salivation: string | null;
  cha_qi: string | null;
  thickness: string | null;
  viscosity: string | null;
  water_texture: string | null;
  early_stage: string | null;
  middle_stage: string | null;
  late_stage: string | null;
  finish: string | null;
  endurance: string | null;
  leaf_bottom: string | null;
  benchmark_mode_preference: string;
  copy_intensity_default: number;
  r_and_d_reference_enabled: boolean;
  r_and_d_reference_notes: string | null;
  has_explicit_benchmark: boolean | null;
  has_rnd_reference: boolean | null;
  rnd_evidence_available: boolean | null;
  product_architecture: unknown;
  formula_philosophy: unknown;
  version: number;
  created_at: string;
  updated_at: string;
}

/** 仅 ADMIN / RESEARCHER 可见的资金类字段（规格 §10.4 internal_cost）。 */
const FINANCIAL_FIELDS = ["internal_cost"] as const satisfies ReadonlyArray<keyof ProductApiShape>;

export function serializeProduct(row: Product, role: UserRole): ProductApiShape {
  const shape: ProductApiShape = {
    id: row.id,
    brand_id: row.brandId,
    product_name: row.productName,
    series_name: row.seriesName,
    year: row.year,
    tea_type: row.teaType,
    tea_subtype: row.teaSubtype,
    origin_province: row.originProvince,
    origin_city: row.originCity,
    origin_region: row.originRegion,
    mountain: row.mountain,
    village: row.village,
    weight_g: Number(row.weightG),
    pieces_per_box: row.piecesPerBox,
    boxes_per_case: row.boxesPerCase,
    suggested_retail_price: row.suggestedRetailPrice === null ? null : Number(row.suggestedRetailPrice),
    internal_cost: row.internalCost === null ? null : Number(row.internalCost),
    raw_material: row.rawMaterial,
    tree_type: row.treeType,
    tree_age: row.treeAge,
    season: row.season,
    harvest_standard: row.harvestStandard,
    grade: row.grade,
    blend_description: row.blendDescription,
    material_notes: row.materialNotes,
    kill_green_method: row.killGreenMethod,
    rolling_method: row.rollingMethod,
    drying_method: row.dryingMethod,
    pressing_method: row.pressingMethod,
    fermentation_degree: row.fermentationDegree,
    fermentation_method: row.fermentationMethod,
    storage: row.storage,
    processing_notes: row.processingNotes,
    dry_leaf_aroma: row.dryLeafAroma,
    hot_cup_aroma: row.hotCupAroma,
    liquor_aroma: row.liquorAroma,
    cold_cup_aroma: row.coldCupAroma,
    entry_taste: row.entryTaste,
    bitterness: row.bitterness,
    astringency: row.astringency,
    sweetness: row.sweetness,
    huigan: row.huigan,
    salivation: row.salivation,
    cha_qi: row.chaQi,
    thickness: row.thickness,
    viscosity: row.viscosity,
    water_texture: row.waterTexture,
    early_stage: row.earlyStage,
    middle_stage: row.middleStage,
    late_stage: row.lateStage,
    finish: row.finish,
    endurance: row.endurance,
    leaf_bottom: row.leafBottom,
    benchmark_mode_preference: row.benchmarkModePreference,
    copy_intensity_default: row.copyIntensityDefault,
    r_and_d_reference_enabled: row.rAndDReferenceEnabled,
    r_and_d_reference_notes: row.rAndDReferenceNotes,
    has_explicit_benchmark: row.hasExplicitBenchmark,
    has_rnd_reference: row.hasRndReference,
    rnd_evidence_available: row.rndEvidenceAvailable,
    product_architecture: row.productArchitecture ?? null,
    formula_philosophy: row.formulaPhilosophy ?? null,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };

  if (role !== "ADMIN" && role !== "RESEARCHER") {
    for (const field of FINANCIAL_FIELDS) {
      shape[field] = null;
    }
  }

  return shape;
}
