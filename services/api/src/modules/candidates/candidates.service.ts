import { and, asc, count, desc, eq, gte, ilike, or, type SQL } from "drizzle-orm";
import type { ComparableCandidate, Database } from "@ldj/database";
import { comparableCandidates, products } from "@ldj/database";
import {
  CANDIDATE_LIMITS,
  candidateIdentityKey,
  scoreSimilarity,
  similarityBands,
  type CandidateBuildRequest,
  type CandidateCreateInput,
  type CandidateListQuery,
  type CandidateReviewInput,
  type CandidateSimilarity,
  type ComparableCandidateView,
  type SimilarityBand
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { assertProductExists } from "../product-records/product-guard.js";
import {
  CandidatePoolService,
  facetFromCandidateInput,
  serializeCandidate,
  type CandidateBuildStats
} from "./similarity.service.js";

/**
 * 候选池服务（规格 §13 / §36 / §42 Agent 4）。
 *
 * 候选是对标论证的原料：一条候选 = 一款被来源提到的茶 + 十维相似度 + 可回溯的原话证据。
 * 本服务只负责读写与评审流程，评分与去重规则在 similarity.service.ts，价格永不进入打分。
 */

export interface CandidateRebuildResult {
  total: number;
  created: number;
  updated: number;
  /** 因 keep_reviewed 保留原评审状态的候选数 */
  kept_reviewed: number;
  /** 总分低于本次构建阈值、仅保留用于审计的候选数 */
  below_min_score: number;
  /** 是否触达单产品候选上限（触达后不再新增，避免一次研究写入失控） */
  reached_limit: boolean;
  band_counts: Record<SimilarityBand, number>;
  min_score: number;
  stats: CandidateBuildStats;
  spec_ref: "§13 / §36 / §42";
}

function emptyBandCounts(): Record<SimilarityBand, number> {
  return similarityBands.reduce(
    (acc, band) => {
      acc[band] = 0;
      return acc;
    },
    {} as Record<SimilarityBand, number>
  );
}

/**
 * 低于本次构建阈值时把候选标记为 REJECT：候选仍然入库（便于审计与复盘），
 * 但不会被当作可用对标使用；原始总分与原始分档保留在警告里。
 */
function applyMinScore(similarity: CandidateSimilarity, minScore: number): CandidateSimilarity {
  if (similarity.total >= minScore || similarity.band === "REJECT") {
    return similarity;
  }
  return {
    ...similarity,
    band: "REJECT",
    warnings: [
      ...similarity.warnings,
      `本次构建阈值 ${minScore} 分：总分 ${similarity.total} 低于阈值，标记为拒绝以便审计（原始分档 ${similarity.band}）`
    ]
  };
}

export class CandidatesService {
  constructor(
    private readonly db: Database,
    private readonly pool: CandidatePoolService
  ) {}

  /** 跨产品候选列表（高价值茶数据库）；带 product_id 时等价于产品级列表。 */
  async list(query: CandidateListQuery): Promise<Paginated<ComparableCandidateView>> {
    const filters: SQL[] = [];
    if (query.product_id) {
      filters.push(eq(comparableCandidates.productId, query.product_id));
    }
    if (query.band) {
      filters.push(eq(comparableCandidates.similarityBand, query.band));
    }
    if (query.status) {
      filters.push(eq(comparableCandidates.status, query.status));
    }
    if (query.min_score !== undefined) {
      filters.push(gte(comparableCandidates.similarityTotal, query.min_score));
    }
    if (query.q) {
      const pattern = `%${query.q}%`;
      const condition = or(
        ilike(comparableCandidates.name, pattern),
        ilike(comparableCandidates.brandName, pattern)
      );
      if (condition) {
        filters.push(condition);
      }
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? CANDIDATE_LIMITS.defaultPageSize
    });
    const orderBy = sortOrder(query.sort);

    const rows = await this.db
      .select({ candidate: comparableCandidates, productName: products.productName })
      .from(comparableCandidates)
      .innerJoin(products, eq(products.id, comparableCandidates.productId))
      .where(where)
      .orderBy(...orderBy)
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db
      .select({ value: count() })
      .from(comparableCandidates)
      .where(where);

    return buildPage(
      rows.map((row) => serializeCandidate(row.candidate, row.productName)),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  async get(productId: string, candidateId: string): Promise<ComparableCandidateView> {
    const { row, productName } = await this.findRow(productId, candidateId);
    return serializeCandidate(row, productName);
  }

  /** 手工登记候选：走同一套十维评分；同身份键冲突时返回 409，不静默覆盖。 */
  async create(
    productId: string,
    input: CandidateCreateInput,
    actorId: string
  ): Promise<ComparableCandidateView> {
    await assertProductExists(this.db, productId);
    const identityKey = candidateIdentityKey({
      name: input.name,
      brand_name: input.brand_name ?? null,
      year: input.year ?? null,
      weight_g: input.weight_g ?? null,
      spec_notes: input.spec_notes ?? null
    });
    const existing = await this.db
      .select()
      .from(comparableCandidates)
      .where(
        and(
          eq(comparableCandidates.productId, productId),
          eq(comparableCandidates.identityKey, identityKey)
        )
      )
      .limit(1);
    if (existing[0]) {
      throw new AppError(
        "CONFLICT",
        "同一产品下已存在同品牌 / 名称 / 年份 / 规格的候选",
        409,
        { candidate_id: existing[0].id }
      );
    }
    const totalRows = await this.db
      .select({ value: count() })
      .from(comparableCandidates)
      .where(eq(comparableCandidates.productId, productId));
    if (Number(totalRows[0]?.value ?? 0) >= CANDIDATE_LIMITS.maxCandidatesPerProduct) {
      throw AppError.validation(
        `单个产品最多登记 ${CANDIDATE_LIMITS.maxCandidatesPerProduct} 条候选，已达到上限`,
        { limit: CANDIDATE_LIMITS.maxCandidatesPerProduct }
      );
    }

    const facet = facetFromCandidateInput(input);
    const target = await this.pool.targetFacet(productId);
    const similarity = scoreSimilarity(target, facet);

    const inserted = await this.db
      .insert(comparableCandidates)
      .values({
        productId,
        name: input.name,
        brandName: input.brand_name ?? null,
        year: input.year ?? null,
        teaType: input.tea_type ?? null,
        mountain: input.mountain ?? null,
        originRegion: input.origin_region ?? null,
        rawMaterial: input.raw_material ?? null,
        weightG: input.weight_g === null || input.weight_g === undefined ? null : Math.round(input.weight_g),
        specNotes: input.spec_notes ?? null,
        identityKey,
        facet,
        similarityTotal: similarity.total,
        similarityBand: similarity.band,
        similarity,
        status: "PENDING_REVIEW",
        sourceIds: [],
        evidence: input.evidence ?? [],
        observedPrices: [],
        mergedSources: 1,
        notes: input.notes ?? null,
        createdBy: actorId
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "候选登记失败");
    }
    const productName = await this.productName(productId);
    return serializeCandidate(row, productName);
  }

  /** 人工评审：只改状态与评审意见，重算分数不会覆盖人工判断。 */
  async review(
    productId: string,
    candidateId: string,
    input: CandidateReviewInput,
    actorId: string
  ): Promise<ComparableCandidateView> {
    await this.findRow(productId, candidateId);
    const updated = await this.db
      .update(comparableCandidates)
      .set({
        status: input.status,
        reviewNote: input.review_note ?? null,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(comparableCandidates.id, candidateId), eq(comparableCandidates.productId, productId)))
      .returning();
    const row = updated[0];
    if (!row) {
      throw AppError.notFound("候选不存在");
    }
    const productName = await this.productName(productId);
    return serializeCandidate(row, productName);
  }

  /**
   * 从来源抽取结果重建候选池（研究流水线 Phase 5 调用）。
   * 已存在的人工评审结果默认保留；低于阈值的候选照样入库并标记拒绝，便于审计。
   */
  async rebuild(
    productId: string,
    input: CandidateBuildRequest,
    actorId: string
  ): Promise<CandidateRebuildResult> {
    await assertProductExists(this.db, productId);
    const minScore = input.min_score ?? CANDIDATE_LIMITS.minScoreToStore;
    const keepReviewed = input.keep_reviewed ?? true;
    const target = await this.pool.targetFacet(productId);
    const built = await this.pool.buildDrafts(productId, target);

    const existingRows = await this.db
      .select()
      .from(comparableCandidates)
      .where(eq(comparableCandidates.productId, productId));
    const byKey = new Map(existingRows.map((row) => [row.identityKey, row]));

    let created = 0;
    let updated = 0;
    let keptReviewed = 0;
    let belowMinScore = 0;
    let reachedLimit = false;
    const bandCounts = emptyBandCounts();

    for (const draft of built.drafts) {
      const similarity = applyMinScore(draft.similarity, minScore);
      if (similarity.total < minScore) {
        belowMinScore += 1;
      }
      bandCounts[similarity.band] += 1;
      const existing = byKey.get(draft.identityKey);

      if (!existing) {
        if (existingRows.length + created >= CANDIDATE_LIMITS.maxCandidatesPerProduct) {
          reachedLimit = true;
          continue;
        }
        await this.db.insert(comparableCandidates).values({
          productId,
          name: draft.name,
          brandName: draft.brandName,
          year: draft.year,
          teaType: draft.teaType,
          mountain: draft.mountain,
          originRegion: draft.originRegion,
          rawMaterial: draft.rawMaterial,
          weightG: draft.weightG === null ? null : Math.round(draft.weightG),
          specNotes: draft.specNotes,
          identityKey: draft.identityKey,
          facet: draft.facet,
          similarityTotal: similarity.total,
          similarityBand: similarity.band,
          similarity,
          status: "PENDING_REVIEW",
          sourceIds: draft.sourceIds,
          evidence: draft.evidence,
          observedPrices: draft.observedPrices,
          mergedSources: draft.mergedSources,
          notes: draft.notes,
          createdBy: actorId
        });
        created += 1;
        continue;
      }

      const preserve = keepReviewed && existing.status !== "PENDING_REVIEW";
      if (preserve) {
        keptReviewed += 1;
      }
      await this.db
        .update(comparableCandidates)
        .set({
          name: draft.name,
          brandName: draft.brandName ?? existing.brandName,
          year: draft.year ?? existing.year,
          teaType: draft.teaType ?? existing.teaType,
          mountain: draft.mountain ?? existing.mountain,
          originRegion: draft.originRegion ?? existing.originRegion,
          rawMaterial: draft.rawMaterial ?? existing.rawMaterial,
          weightG: draft.weightG === null ? existing.weightG : Math.round(draft.weightG),
          specNotes: draft.specNotes ?? existing.specNotes,
          facet: draft.facet,
          similarityTotal: similarity.total,
          similarityBand: similarity.band,
          similarity,
          status: preserve ? existing.status : "PENDING_REVIEW",
          reviewNote: preserve ? existing.reviewNote : null,
          reviewedBy: preserve ? existing.reviewedBy : null,
          reviewedAt: preserve ? existing.reviewedAt : null,
          sourceIds: draft.sourceIds,
          evidence: draft.evidence,
          observedPrices: draft.observedPrices,
          mergedSources: draft.mergedSources,
          notes: draft.notes ?? existing.notes,
          updatedAt: new Date()
        })
        .where(eq(comparableCandidates.id, existing.id));
      updated += 1;
    }

    const totalRows = await this.db
      .select({ value: count() })
      .from(comparableCandidates)
      .where(eq(comparableCandidates.productId, productId));

    return {
      total: Number(totalRows[0]?.value ?? 0),
      created,
      updated,
      kept_reviewed: keptReviewed,
      below_min_score: belowMinScore,
      reached_limit: reachedLimit,
      band_counts: bandCounts,
      min_score: minScore,
      stats: built.stats,
      spec_ref: "§13 / §36 / §42"
    };
  }

  async remove(productId: string, candidateId: string): Promise<void> {
    await this.findRow(productId, candidateId);
    await this.db
      .delete(comparableCandidates)
      .where(and(eq(comparableCandidates.id, candidateId), eq(comparableCandidates.productId, productId)));
  }

  private async findRow(
    productId: string,
    candidateId: string
  ): Promise<{ row: ComparableCandidate; productName: string | null }> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select({ candidate: comparableCandidates, productName: products.productName })
      .from(comparableCandidates)
      .innerJoin(products, eq(products.id, comparableCandidates.productId))
      .where(and(eq(comparableCandidates.id, candidateId), eq(comparableCandidates.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("候选不存在");
    }
    return { row: row.candidate, productName: row.productName };
  }

  private async productName(productId: string): Promise<string | null> {
    const rows = await this.db
      .select({ name: products.productName })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    return rows[0]?.name ?? null;
  }
}

function sortOrder(sort: CandidateListQuery["sort"]) {
  switch (sort) {
    case "score":
      return [asc(comparableCandidates.similarityTotal), desc(comparableCandidates.createdAt)];
    case "created_at":
      return [asc(comparableCandidates.createdAt)];
    case "-created_at":
      return [desc(comparableCandidates.createdAt)];
    case "-score":
    default:
      return [desc(comparableCandidates.similarityTotal), desc(comparableCandidates.createdAt)];
  }
}
