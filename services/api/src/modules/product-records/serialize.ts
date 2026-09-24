import type { ProductFact, RndReference, TastingProfile } from "@ldj/database";
import { rndReferenceAllowsClaims } from "@ldj/schemas";

export interface ProductFactApiShape {
  id: string;
  product_id: string;
  fact_key: string;
  fact_label: string | null;
  fact_group: string;
  fact_value: string;
  fact_status: string;
  evidence_note: string | null;
  evidence_source_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TastingProfileApiShape {
  id: string;
  product_id: string;
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
  taster_name: string | null;
  tasted_at: string | null;
  conclusion: string | null;
  evidence_source_id: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RndReferenceApiShape {
  id: string;
  product_id: string;
  reference_product_id: string | null;
  reference_product_name: string;
  reference_type: string;
  description: string;
  verification_status: string;
  evidence_source_id: string | null;
  evidence_note: string | null;
  /** 规格 §25：只有 RND_CONFIRMED 才允许声明研发 / 对标关系。 */
  claims_allowed: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function serializeProductFact(row: ProductFact): ProductFactApiShape {
  return {
    id: row.id,
    product_id: row.productId,
    fact_key: row.factKey,
    fact_label: row.factLabel,
    fact_group: row.factGroup,
    fact_value: row.factValue,
    fact_status: row.factStatus,
    evidence_note: row.evidenceNote,
    evidence_source_id: row.evidenceSourceId,
    confirmed_by: row.confirmedBy,
    confirmed_at: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

export function serializeTastingProfile(row: TastingProfile): TastingProfileApiShape {
  return {
    id: row.id,
    product_id: row.productId,
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
    taster_name: row.tasterName,
    tasted_at: row.tastedAt ? row.tastedAt.toISOString() : null,
    conclusion: row.conclusion,
    evidence_source_id: row.evidenceSourceId,
    version: row.version,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

export function serializeRndReference(row: RndReference): RndReferenceApiShape {
  return {
    id: row.id,
    product_id: row.productId,
    reference_product_id: row.referenceProductId,
    reference_product_name: row.referenceProductName,
    reference_type: row.referenceType,
    description: row.description,
    verification_status: row.verificationStatus,
    evidence_source_id: row.evidenceSourceId,
    evidence_note: row.evidenceNote,
    claims_allowed: rndReferenceAllowsClaims(row.verificationStatus),
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}
