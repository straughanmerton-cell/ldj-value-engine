import { and, asc, eq, inArray } from "drizzle-orm";
import type { ComparableCandidate, Database } from "@ldj/database";
import { comparableCandidates, sources as sourcesTable } from "@ldj/database";
import {
  CANDIDATE_LIMITS,
  candidateIdentityKey,
  comparableCandidateSchema,
  evidenceFromExtraction,
  facetFromExtraction,
  facetFromProductInput,
  priceObservationsFromExtraction,
  scoreSimilarity,
  similarityFacetSchema,
  webExtractionAiOutputSchema,
  type CandidateCreateInput,
  type CandidateEvidence,
  type CandidatePriceObservation,
  type CandidateSimilarity,
  type ComparableCandidateView,
  type SimilarityFacet,
  type ValueDna
} from "@ldj/schemas";
import { buildValueDna, loadValueDnaSources, type ValueDnaSources } from "../../lib/value-dna.js";

/**
 * 候选池与可比性评分（规格 §13 / §36 / §42 Agent 4）。
 *
 * 本文件只做三件事，且每一步都可审计：
 * 1. 把「目标产品」与「候选产品」都压缩成不含价格的结构化面（facet）；
 * 2. 把网页抽取结果归并成候选（品牌|名称|年份|规格 去重）；
 * 3. 用 scoreSimilarity 逐维打分——价格永远不参与。
 */

/**
 * Value DNA 会因为录入了建议零售价而派生「价格带已知」这个定位项。
 * 它是价格推导物，必须在评分侧显式剔除，否则价格会绕过类型约束偷偷进入相似度（§62-4）。
 */
const PRICE_DERIVED_POSITIONING = "价格带已知";

const MAX_LIST_ITEMS = 40;

export interface CandidateDraft {
  identityKey: string;
  name: string;
  brandName: string | null;
  year: number | null;
  teaType: string | null;
  mountain: string | null;
  originRegion: string | null;
  rawMaterial: string | null;
  weightG: number | null;
  specNotes: string | null;
  facet: SimilarityFacet;
  similarity: CandidateSimilarity;
  similarityTotal: number;
  similarityBand: ComparableCandidate["similarityBand"];
  sourceIds: string[];
  evidence: CandidateEvidence[];
  observedPrices: CandidatePriceObservation[];
  mergedSources: number;
  notes: string | null;
}

export interface CandidateBuildStats {
  /** 参与归并的来源条数（已有抽取结果的） */
  sources_considered: number;
  /** 因为网页没有写明产品名而被跳过的来源数（无名字不生成候选，绝不猜） */
  skipped_no_name: number;
  /** 由多条来源合并出来的候选数 */
  merged_multi_source: number;
  /** 归并后的候选总数 */
  drafts: number;
}

export interface CandidateBuildResult {
  drafts: CandidateDraft[];
  stats: CandidateBuildStats;
}

/**
 * 候选行上的原料只取网页写明的原料表述（facet.material），
 * 不能拿 spec_notes 顶替——规格备注与原料是两回事，混用会凭空造出原料信息。
 */
function materialText(facet: SimilarityFacet): string | null {
  return facet.material[0] ?? null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mergeLists(left: readonly string[], right: readonly string[]): string[] {
  const merged: string[] = [];
  for (const value of [...left, ...right]) {
    const text = value.trim();
    if (text.length === 0 || merged.includes(text)) {
      continue;
    }
    merged.push(text);
    if (merged.length >= MAX_LIST_ITEMS) {
      break;
    }
  }
  return merged;
}

function mergeFacet(base: SimilarityFacet, extra: SimilarityFacet): SimilarityFacet {
  return similarityFacetSchema.parse({
    tea_type: base.tea_type ?? extra.tea_type ?? null,
    tea_subtype: base.tea_subtype ?? extra.tea_subtype ?? null,
    naming: mergeLists(base.naming, extra.naming),
    origin: {
      province: base.origin.province ?? extra.origin.province ?? null,
      city: base.origin.city ?? extra.origin.city ?? null,
      region: base.origin.region ?? extra.origin.region ?? null,
      mountain: base.origin.mountain ?? extra.origin.mountain ?? null,
      village: base.origin.village ?? extra.origin.village ?? null
    },
    material: mergeLists(base.material, extra.material),
    aroma: mergeLists(base.aroma, extra.aroma),
    taste: mergeLists(base.taste, extra.taste),
    positioning: mergeLists(base.positioning, extra.positioning),
    craft: mergeLists(base.craft, extra.craft),
    weight_g: base.weight_g ?? extra.weight_g ?? null,
    pieces_per_box: base.pieces_per_box ?? extra.pieces_per_box ?? null,
    year: base.year ?? extra.year ?? null
  });
}

function mergeEvidence(
  left: readonly CandidateEvidence[],
  right: readonly CandidateEvidence[]
): CandidateEvidence[] {
  const merged: CandidateEvidence[] = [];
  const seen = new Set<string>();
  for (const item of [...left, ...right]) {
    const key = `${item.kind}|${item.field}|${item.value ?? ""}|${item.quote}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
    if (merged.length >= CANDIDATE_LIMITS.maxEvidencePerCandidate) {
      break;
    }
  }
  return merged;
}

function mergePriceObservations(
  left: readonly CandidatePriceObservation[],
  right: readonly CandidatePriceObservation[]
): CandidatePriceObservation[] {
  const merged: CandidatePriceObservation[] = [];
  const seen = new Set<string>();
  for (const item of [...left, ...right]) {
    const key = `${item.value ?? ""}|${item.price_type}|${item.unit_scope ?? ""}|${item.quote}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
    if (merged.length >= CANDIDATE_LIMITS.maxEvidencePerCandidate) {
      break;
    }
  }
  return merged;
}

/**
 * 目标产品的相似度面：只读录入字段与 Value DNA，不读任何价格字段。
 * DNA 里由价格派生的「价格带已知」在这里被剔除。
 */
export function buildTargetFacet(sources: ValueDnaSources): SimilarityFacet {
  const snapshot = sources.snapshot;
  const dna: ValueDna = buildValueDna(sources).dna;
  return facetFromProductInput({
    tea_type: textOrNull(snapshot["tea_type"]),
    tea_subtype: textOrNull(snapshot["tea_subtype"]),
    naming: [...dna.identity, ...dna.naming_concepts],
    origin_province: textOrNull(snapshot["origin_province"]),
    origin_city: textOrNull(snapshot["origin_city"]),
    origin_region: textOrNull(snapshot["origin_region"]),
    mountain: textOrNull(snapshot["mountain"]),
    village: textOrNull(snapshot["village"]),
    raw_material: textOrNull(snapshot["raw_material"]),
    tree_type: textOrNull(snapshot["tree_type"]),
    season: textOrNull(snapshot["season"]),
    aromas: dna.flavor,
    tastes: dna.taste,
    positionings: dna.positioning.filter((item) => item !== PRICE_DERIVED_POSITIONING),
    crafts: dna.process,
    weight_g: numberOrNull(snapshot["weight_g"]),
    pieces_per_box: numberOrNull(snapshot["pieces_per_box"]),
    year: numberOrNull(snapshot["year"])
  });
}

/**
 * 手工登记候选：先按录入字段成形，再允许人工补充具名维度（不接受价格）。
 *
 * 注意：人工补充只能「加」不能「抹」——不能用 `{...base, ...override}` 直接覆盖，
 * 因为 `candidateCreateSchema.facet` 是 partial schema，未填写的维度解析后是空数组，
 * 直接覆盖会把 base 里由名称/原料推出来的命名、原料、香气、滋味全部清空（分数凭空掉一档）。
 */
export function facetFromCandidateInput(input: CandidateCreateInput): SimilarityFacet {
  const base = facetFromProductInput({
    product_name: input.name,
    tea_type: input.tea_type ?? null,
    origin_region: input.origin_region ?? null,
    mountain: input.mountain ?? null,
    raw_material: input.raw_material ?? null,
    weight_g: input.weight_g ?? null,
    year: input.year ?? null
  });
  const override = input.facet;
  if (!override) {
    return base;
  }
  return similarityFacetSchema.parse({
    tea_type: override.tea_type ?? base.tea_type,
    tea_subtype: override.tea_subtype ?? base.tea_subtype,
    naming: mergeLists(base.naming, override.naming ?? []),
    origin: { ...base.origin, ...(override.origin ?? {}) },
    material: mergeLists(base.material, override.material ?? []),
    aroma: mergeLists(base.aroma, override.aroma ?? []),
    taste: mergeLists(base.taste, override.taste ?? []),
    positioning: mergeLists(base.positioning, override.positioning ?? []),
    craft: mergeLists(base.craft, override.craft ?? []),
    weight_g: override.weight_g ?? base.weight_g,
    pieces_per_box: override.pieces_per_box ?? base.pieces_per_box,
    year: override.year ?? base.year
  });
}

/** 候选行 → API 视图；历史行缺少明细时如实标注，不伪造十维打分。 */
export function serializeCandidate(
  row: ComparableCandidate,
  productName: string | null
): ComparableCandidateView {
  const similarity: CandidateSimilarity =
    row.similarity ??
    ({
      total: row.similarityTotal,
      band: row.similarityBand,
      dimensions: [],
      matched_dimensions: [],
      unknown_dimensions: [],
      warnings: ["该候选缺少十维明细（历史数据）：请重新运行候选池构建后再用于对标"]
    } satisfies CandidateSimilarity);

  return comparableCandidateSchema.parse({
    id: row.id,
    product_id: row.productId,
    product_name: productName,
    name: row.name,
    brand_name: row.brandName,
    year: row.year,
    tea_type: row.teaType,
    mountain: row.mountain,
    weight_g: row.weightG,
    spec_notes: row.specNotes,
    identity_key: row.identityKey,
    similarity_total: row.similarityTotal,
    similarity_band: row.similarityBand,
    similarity,
    status: row.status,
    review_note: row.reviewNote,
    reviewed_by: row.reviewedBy,
    reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    source_ids: row.sourceIds ?? [],
    evidence: row.evidence ?? [],
    observed_prices: row.observedPrices ?? [],
    merged_sources: row.mergedSources,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  });
}

/**
 * 候选池服务：目标面构建 + 网页抽取 → 候选归并。
 *
 * 同一条候选只会存在一行：品牌|名称|年份|规格 相同的来源被合并，
 * 来源数量累加到 merged_sources / source_ids，绝不因为来源多就多算一条候选。
 */
export class CandidatePoolService {
  constructor(private readonly db: Database) {}

  /** 目标产品的相似度面（含去价格处理）。 */
  async targetFacet(productId: string): Promise<SimilarityFacet> {
    return buildTargetFacet(await loadValueDnaSources(this.db, productId));
  }

  /**
   * 从已有抽取结果的来源构建候选草稿。
   *
   * - 网页没写产品名的来源直接跳过（无名字不猜、不生成候选）；
   * - 同一身份键的来源合并成一条，合并后再按合并后的面重算一次分；
   * - 分数只由输入面决定，不会因为来源多而变高。
   */
  async buildDrafts(productId: string, target: SimilarityFacet): Promise<CandidateBuildResult> {
    const rows = await this.db
      .select()
      .from(sourcesTable)
      .where(
        and(
          eq(sourcesTable.productId, productId),
          inArray(sourcesTable.extractionStatus, ["EXTRACTED", "PARTIAL"])
        )
      )
      .orderBy(asc(sourcesTable.createdAt));

    const drafts = new Map<string, CandidateDraft>();
    let skippedNoName = 0;
    let considered = 0;

    for (const row of rows) {
      const raw = row.lastExtraction;
      if (!raw) {
        continue;
      }
      const parsed = webExtractionAiOutputSchema.safeParse(raw);
      if (!parsed.success) {
        continue;
      }
      considered += 1;
      const extraction = parsed.data;
      const name = textOrNull(extraction.product_name);
      if (!name) {
        skippedNoName += 1;
        continue;
      }
      const facet = facetFromExtraction(extraction);
      const identityKey = candidateIdentityKey({
        name,
        brand_name: extraction.brand_name,
        year: extraction.year,
        weight_g: extraction.weight_g,
        spec_notes: extraction.spec_notes
      });
      const evidence = evidenceFromExtraction(extraction, {
        source_id: row.id,
        url: row.url,
        domain: row.domain
      });
      const prices = priceObservationsFromExtraction(extraction, { source_id: row.id, url: row.url });

      const existing = drafts.get(identityKey);
      if (!existing) {
        const similarity = scoreSimilarity(target, facet);
        drafts.set(identityKey, {
          identityKey,
          name,
          brandName: textOrNull(extraction.brand_name),
          year: extraction.year ?? null,
          teaType: textOrNull(extraction.tea_type),
          mountain: textOrNull(extraction.mountain),
          originRegion: textOrNull(extraction.origin_region),
          rawMaterial: materialText(facet),
          weightG: extraction.weight_g ?? null,
          specNotes: textOrNull(extraction.spec_notes),
          facet,
          similarity,
          similarityTotal: similarity.total,
          similarityBand: similarity.band,
          sourceIds: [row.id],
          evidence,
          observedPrices: prices,
          mergedSources: 1,
          notes: extraction.null_reason ?? null
        });
        continue;
      }

      const mergedFacet = mergeFacet(existing.facet, facet);
      const mergedSimilarity = scoreSimilarity(target, mergedFacet);
      drafts.set(identityKey, {
        ...existing,
        brandName: existing.brandName ?? textOrNull(extraction.brand_name),
        year: existing.year ?? extraction.year ?? null,
        teaType: existing.teaType ?? textOrNull(extraction.tea_type),
        mountain: existing.mountain ?? textOrNull(extraction.mountain),
        originRegion: existing.originRegion ?? textOrNull(extraction.origin_region),
        rawMaterial: existing.rawMaterial ?? materialText(facet),
        weightG: existing.weightG ?? extraction.weight_g ?? null,
        specNotes: existing.specNotes ?? textOrNull(extraction.spec_notes),
        facet: mergedFacet,
        similarity: mergedSimilarity,
        similarityTotal: mergedSimilarity.total,
        similarityBand: mergedSimilarity.band,
        sourceIds: existing.sourceIds.includes(row.id)
          ? existing.sourceIds
          : [...existing.sourceIds, row.id],
        evidence: mergeEvidence(existing.evidence, evidence),
        observedPrices: mergePriceObservations(existing.observedPrices, prices),
        mergedSources: existing.mergedSources + 1
      });
    }

    const list = [...drafts.values()];
    return {
      drafts: list,
      stats: {
        sources_considered: considered,
        skipped_no_name: skippedNoName,
        merged_multi_source: list.filter((item) => item.mergedSources > 1).length,
        drafts: list.length
      }
    };
  }
}

/** 供 API 自检：候选池的两条硬约束（价格不参与、去重键固定）。 */
export const CANDIDATE_POOL_CONTRACT = {
  spec_ref: "§13 / §36 / §42",
  price_in_similarity: false,
  identity_key_fields: ["brand_name", "name", "year", "weight_g", "spec_notes"],
  limits: CANDIDATE_LIMITS,
  similarity_source: "packages/schemas/src/similarity.ts#scoreSimilarity"
} as const;
