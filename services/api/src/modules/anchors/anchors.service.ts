import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { ComparableCandidate, Database, MarketOffer, ValueAnchor } from "@ldj/database";
import {
  comparableCandidates,
  marketOffers,
  products,
  sources as sourcesTable,
  valueAnchors
} from "@ldj/database";
import {
  ANCHOR_LIMITS,
  ANCHOR_REQUIREMENTS,
  SIMILARITY_ANCHOR_PRICE_PERCENTILE,
  SIMILARITY_BANDS,
  anchorSchema,
  anchorSnapshotSchema,
  priceEvidenceBandSchema,
  priceTypeSchema,
  scorePriceEvidence,
  scoreSalesAnchor,
  type AnchorBuildRequest,
  type AnchorBuildStats,
  type AnchorListQuery,
  type AnchorOfferBasis,
  type AnchorOfferSnapshot,
  type AnchorRebuildResult,
  type AnchorResolveSource,
  type AnchorSnapshot,
  type AnchorType,
  type AnchorUpdateInput,
  type AnchorView,
  type BenchmarkModeView,
  type ResearchMode,
  type ResolvedResearchMode,
  type SalesAnchorScore
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { assertProductExists } from "../product-records/product-guard.js";

/**
 * 锚点引擎服务（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §55 Build Anchors / §56 进度 UI）。
 *
 * 本服务回答一个产品最关键的问题：**有没有资格进入 Benchmark Mode。**
 *
 * 四条不可动摇的规则：
 * 1. 可靠锚点必须同时满足相似度 ≥ 70 与价格证据分 ≥ 75（§16.1 / §17），缺一不可；
 * 2. 没有达标候选时必须进入 CATEGORY_CREATOR，禁止硬凑竞品、降阈值或编造对标（§17 / §62-10）；
 * 3. 来源没写明产品身份的价格（`SOURCE_UNATTRIBUTED`）不参与锚点判断，避免「只有规格没有身份」的压线价冒充可靠价格；
 * 4. 人工锚点（`is_manual`）在重建时默认保留，人工判断永远优先于自动排序。
 */

const RELIABLE_MIN_EVIDENCE = ANCHOR_REQUIREMENTS.minPriceEvidence;
const RELIABLE_MIN_SIMILARITY = ANCHOR_REQUIREMENTS.minSimilarity;

/** 一条价格能否作为锚点价格证据：非排除、非异常值、证据分达标、且来源写明了产品身份。 */
function isReliableOffer(offer: MarketOffer): boolean {
  if (offer.isExcluded || offer.isOutlier) {
    return false;
  }
  if (offer.attribution === "SOURCE_UNATTRIBUTED") {
    return false;
  }
  return offer.evidenceScore >= RELIABLE_MIN_EVIDENCE;
}

/** 锚点排序使用的可比口径：1kg 等价 → 357g 等价 → 原始金额（缺规格时不做任何换算）。 */
function offerComparable(offer: MarketOffer): { value: number; basis: AnchorOfferBasis } {
  const perKg = offer.pricePerKg === null ? null : Number(offer.pricePerKg);
  if (perKg !== null && perKg > 0) {
    return { value: perKg, basis: "price_per_kg" };
  }
  const per357 = offer.price357g === null ? null : Number(offer.price357g);
  if (per357 !== null && per357 > 0) {
    return { value: per357, basis: "price_357g" };
  }
  const raw = Number(offer.value);
  return { value: raw, basis: raw > 0 ? "value" : "none" };
}

/** 价格百分位：同产品全部可靠价格中，不高于该价格的占比（四舍五入到整数）。 */
function percentileOf(sortedValues: readonly number[], target: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  let le = 0;
  for (const value of sortedValues) {
    if (value <= target + 1e-9) {
      le += 1;
    }
  }
  return Math.round((le / sortedValues.length) * 100);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

/** §16.3「故事价值」：候选是否具备命名、山头、原料、风格、工艺五类可讲的结构信息，每类 20 分。 */
function storyValue(row: ComparableCandidate): { score: number; hits: string[] } {
  const facet = row.facet;
  const hits: string[] = [];
  if ((facet?.naming?.length ?? 0) > 0) {
    hits.push("命名体系");
  }
  if (Boolean(row.mountain ?? facet?.origin?.mountain)) {
    hits.push("山头");
  }
  if ((facet?.material?.length ?? 0) > 0 || Boolean(row.rawMaterial)) {
    hits.push("原料");
  }
  if ((facet?.aroma?.length ?? 0) > 0 || (facet?.taste?.length ?? 0) > 0) {
    hits.push("风格");
  }
  if ((facet?.craft?.length ?? 0) > 0) {
    hits.push("工艺");
  }
  return { score: Math.min(100, hits.length * 20), hits };
}

/** §16.3「市场认知」：来源数量 + 证据条数 + 是否人工确认为对标，三项叠加。 */
function marketRecognition(row: ComparableCandidate): { score: number; note: string } {
  const sources = Math.max(0, row.mergedSources ?? 0);
  const evidence = row.evidence?.length ?? 0;
  const approved = row.status === "APPROVED";
  const score = Math.min(100, 20 * Math.min(sources, 3) + 10 * Math.min(evidence, 4) + (approved ? 20 : 0));
  return {
    score,
    note: `被 ${sources} 个来源提到、保留 ${evidence} 条原话证据${approved ? "、已人工确认为对标" : ""}`
  };
}

/** §16.3「概念相关性」：取 §13 的 concept 与 tea_category 两个维度命中度，概念权重更高。 */
function conceptRelevance(row: ComparableCandidate): { score: number; note: string } {
  const similarity = row.similarity;
  if (!similarity) {
    return { score: 0, note: "该候选缺少十维明细，概念相关性按 0 分计（不猜测补齐）" };
  }
  const concept = similarity.dimensions.find((item) => item.dimension === "concept")?.ratio ?? 0;
  const teaCategory = similarity.dimensions.find((item) => item.dimension === "tea_category")?.ratio ?? 0;
  const score = Math.round((concept * 0.6 + teaCategory * 0.4) * 100);
  return {
    score,
    note: `命名体系 / 产品概念命中度 ${Math.round(concept * 100)}%、茶类命中度 ${Math.round(teaCategory * 100)}%`
  };
}

/** §16.3「证据强度」：以可靠价格证据分为主，没有可靠价格时按候选来源证据打折给分。 */
function evidenceComponent(reliablePriceScore: number, row: ComparableCandidate): { score: number; note: string } {
  if (reliablePriceScore > 0) {
    return { score: clampScore(reliablePriceScore), note: `采用该候选可靠价格证据分 ${reliablePriceScore} 分` };
  }
  const evidence = row.evidence?.length ?? 0;
  if (evidence === 0) {
    return { score: 0, note: "没有可靠价格证据、也没有来源原话证据，按 0 分计" };
  }
  const score = Math.min(60, evidence * 15);
  return { score, note: `${evidence} 条来源原话证据，但没有可靠价格，证据强度打折至 ${score} 分` };
}

interface AnchorPlanItem {
  anchorType: AnchorType;
  candidate: ComparableCandidate;
  offer: MarketOffer | null;
  pricePercentile: number | null;
  priceEvidenceScore: number;
  salesAnchorScore: number | null;
  salesAnchor: SalesAnchorScore | null;
  rank: number;
  rationale: string;
}

interface AnchorPlan {
  items: AnchorPlanItem[];
  stats: AnchorBuildStats;
  /** 是否有候选同时满足相似度 ≥ 70 与价格证据分 ≥ 75 */
  hasReliable: boolean;
}

interface ProductContext {
  id: string;
  name: string;
  preference: ResearchMode;
}

export class AnchorsService {
  constructor(private readonly db: Database) {}

  /* ------------------------------------------------------------- 读取 */

  /** 跨产品锚点列表（高价值锚点库）；带 product_id 时等价于产品级列表。 */
  async list(query: AnchorListQuery): Promise<Paginated<AnchorView>> {
    const filters: SQL[] = [];
    if (query.product_id) {
      filters.push(eq(valueAnchors.productId, query.product_id));
    }
    if (query.anchor_type) {
      filters.push(eq(valueAnchors.anchorType, query.anchor_type));
    }
    if (query.is_primary !== undefined) {
      filters.push(eq(valueAnchors.isPrimary, query.is_primary));
    }
    if (query.q) {
      const pattern = `%${query.q}%`;
      const condition = or(
        ilike(comparableCandidates.name, pattern),
        ilike(valueAnchors.rationale, pattern)
      );
      if (condition) {
        filters.push(condition);
      }
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? ANCHOR_LIMITS.defaultPageSize
    });

    const rows = await this.db
      .select({
        anchor: valueAnchors,
        productName: products.productName,
        candidateName: comparableCandidates.name
      })
      .from(valueAnchors)
      .leftJoin(products, eq(products.id, valueAnchors.productId))
      .leftJoin(comparableCandidates, eq(comparableCandidates.id, valueAnchors.candidateId))
      .where(where)
      .orderBy(...anchorSortOrder(query.sort))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db
      .select({ value: count() })
      .from(valueAnchors)
      .leftJoin(comparableCandidates, eq(comparableCandidates.id, valueAnchors.candidateId))
      .where(where);

    return buildPage(
      rows.map((row) => serializeAnchor(row.anchor, row.productName, row.candidateName)),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  async get(productId: string, anchorId: string): Promise<AnchorView> {
    const row = await this.findRow(productId, anchorId);
    const context = await this.namesFor(row);
    return serializeAnchor(row, context.productName, context.candidateName);
  }

  /** §55 / §56：产品当前的模式判定（不触发重建）。 */
  async benchmarkMode(productId: string): Promise<BenchmarkModeView> {
    const product = await this.loadProduct(productId);
    const rows = await this.loadRows(productId);
    const anchors = await this.serializeMany(rows);
    const resolution = resolveMode(product.preference, rows);
    const primary = anchors.find((anchor) => anchor.is_primary) ?? null;

    return {
      product_id: product.id,
      product_name: product.name,
      preference: product.preference,
      mode: resolution.mode,
      resolved_by: resolution.resolved_by,
      reason: resolution.reason,
      highest_value_count: rows.filter((row) => row.anchorType === "HIGHEST_VALUE").length,
      similarity_high_value_count: rows.filter((row) => row.anchorType === "SIMILARITY_HIGH_VALUE").length,
      sales_anchor_count: rows.filter((row) => row.anchorType === "SALES_ANCHOR").length,
      primary_anchor_id: primary?.id ?? null,
      primary_anchor: primary,
      anchors,
      spec_ref: "§16 / §17 / §55 / §56"
    };
  }

  /* ------------------------------------------------------------- 重建 */

  /**
   * §55 Build Anchors：由候选池 + 价格证据重算三种锚点。
   *
   * 重建只影响自动锚点；`is_manual = true` 的人工锚点默认保留（keep_manual 可关闭）。
   * 没有达标候选时不会写入任何 Highest Value 锚点，模式判定自然落到 CATEGORY_CREATOR。
   */
  async rebuild(
    productId: string,
    input: AnchorBuildRequest,
    actorId: string
  ): Promise<AnchorRebuildResult> {
    const product = await this.loadProduct(productId);
    const keepManual = input.keep_manual ?? true;
    const recompute = input.recompute ?? true;
    const maxPerType = Math.max(1, Math.min(ANCHOR_LIMITS.maxPerType, input.max_per_type ?? ANCHOR_LIMITS.maxPerType));

    const existing = await this.loadRows(productId);
    const plan = await this.buildPlan(productId, maxPerType);

    let created = 0;
    let removed = 0;
    /** keep_manual = false 时人工锚点同样会被清掉，此时「保留人工锚点数」必须是 0（§55）。 */
    const keptManual = keepManual ? existing.filter((row) => row.isManual).length : 0;

    if (recompute) {
      const toRemove = keepManual ? existing.filter((row) => !row.isManual) : existing;
      if (toRemove.length > 0) {
        removed = toRemove.length;
        await this.db
          .delete(valueAnchors)
          .where(inArray(valueAnchors.id, toRemove.map((row) => row.id)));
      }
      if (plan.items.length > 0) {
        const values = await Promise.all(
          plan.items.map(async (item) => ({
            productId,
            anchorType: item.anchorType,
            candidateId: item.candidate.id,
            marketOfferId: item.offer?.id ?? null,
            similarityScore: item.candidate.similarityTotal,
            priceEvidenceScore: item.priceEvidenceScore,
            pricePercentile: item.pricePercentile,
            salesAnchorScore: item.salesAnchorScore === null ? null : String(item.salesAnchorScore),
            salesAnchor: item.salesAnchor,
            rank: item.rank,
            isPrimary: false,
            isManual: false,
            rationale: item.rationale,
            selectedBy: null,
            selectedAt: null,
            snapshot: await this.snapshotFor(item),
            createdBy: actorId
          }))
        );
        const inserted = await this.db
          .insert(valueAnchors)
          .values(values)
          .returning();
        created = inserted.length;
      }
    }

    const rows = await this.loadRows(productId);
    await this.ensurePrimary(rows);
    const finalRows = await this.loadRows(productId);
    const anchors = await this.serializeMany(finalRows);
    const resolution = resolveMode(product.preference, finalRows);

    return {
      total: finalRows.length,
      created,
      removed,
      kept_manual: keptManual,
      mode: resolution.mode,
      resolved_by: resolution.resolved_by,
      reason: resolution.reason,
      primary_anchor_id: anchors.find((anchor) => anchor.is_primary)?.id ?? null,
      anchor_types: {
        HIGHEST_VALUE: finalRows.filter((row) => row.anchorType === "HIGHEST_VALUE").length,
        SIMILARITY_HIGH_VALUE: finalRows.filter((row) => row.anchorType === "SIMILARITY_HIGH_VALUE").length,
        SALES_ANCHOR: finalRows.filter((row) => row.anchorType === "SALES_ANCHOR").length
      },
      stats: plan.stats,
      anchors,
      spec_ref: "§16 / §17 / §55 / §56"
    };
  }

  /* ------------------------------------------------------------- 人工维护 */

  /** 人工选定主要锚点 / 追加理由：一旦人工干预即标记为人工锚点，重建时默认保留。 */
  async update(
    productId: string,
    anchorId: string,
    input: AnchorUpdateInput,
    actorId: string
  ): Promise<AnchorView> {
    await this.findRow(productId, anchorId);
    if (input.is_primary === true) {
      await this.db
        .update(valueAnchors)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(eq(valueAnchors.productId, productId), eq(valueAnchors.isPrimary, true)));
    }
    const patch: Partial<ValueAnchor> = {
      isManual: true,
      selectedBy: actorId,
      selectedAt: new Date(),
      updatedAt: new Date()
    };
    if (input.is_primary !== undefined) {
      patch.isPrimary = input.is_primary;
    }
    if (input.rationale !== undefined) {
      patch.rationale = input.rationale;
    }
    const updated = await this.db
      .update(valueAnchors)
      .set(patch)
      .where(eq(valueAnchors.id, anchorId))
      .returning();
    const row = updated[0];
    if (!row) {
      throw AppError.notFound("锚点不存在");
    }
    const context = await this.namesFor(row);
    return serializeAnchor(row, context.productName, context.candidateName);
  }

  async remove(productId: string, anchorId: string): Promise<void> {
    await this.findRow(productId, anchorId);
    await this.db.delete(valueAnchors).where(eq(valueAnchors.id, anchorId));
  }

  /* ------------------------------------------------------------- 内部实现 */

  private async loadProduct(productId: string): Promise<ProductContext> {
    const rows = await this.db
      .select({
        id: products.id,
        name: products.productName,
        preference: products.benchmarkModePreference
      })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品不存在");
    }
    return { id: row.id, name: row.name, preference: row.preference };
  }

  private async loadRows(productId: string): Promise<ValueAnchor[]> {
    return this.db
      .select()
      .from(valueAnchors)
      .where(eq(valueAnchors.productId, productId))
      .orderBy(asc(valueAnchors.anchorType), asc(valueAnchors.rank));
  }

  private async findRow(productId: string, anchorId: string): Promise<ValueAnchor> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(valueAnchors)
      .where(and(eq(valueAnchors.id, anchorId), eq(valueAnchors.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("锚点不存在");
    }
    return row;
  }

  private async namesFor(row: ValueAnchor): Promise<{ productName: string | null; candidateName: string | null }> {
    const productRows = await this.db
      .select({ name: products.productName })
      .from(products)
      .where(eq(products.id, row.productId))
      .limit(1);
    let candidateName: string | null = null;
    if (row.candidateId) {
      const candidateRows = await this.db
        .select({ name: comparableCandidates.name })
        .from(comparableCandidates)
        .where(eq(comparableCandidates.id, row.candidateId))
        .limit(1);
      candidateName = candidateRows[0]?.name ?? null;
    }
    return { productName: productRows[0]?.name ?? null, candidateName };
  }

  private async serializeMany(rows: readonly ValueAnchor[]): Promise<AnchorView[]> {
    if (rows.length === 0) {
      return [];
    }
    const productId = rows[0]?.productId;
    const productRows = productId
      ? await this.db
          .select({ name: products.productName })
          .from(products)
          .where(eq(products.id, productId))
          .limit(1)
      : [];
    const candidateIds = rows
      .map((row) => row.candidateId)
      .filter((value): value is string => value !== null);
    const candidateRows = candidateIds.length
      ? await this.db
          .select({ id: comparableCandidates.id, name: comparableCandidates.name })
          .from(comparableCandidates)
          .where(inArray(comparableCandidates.id, candidateIds))
      : [];
    const candidateNameById = new Map(candidateRows.map((row) => [row.id, row.name]));
    const productName = productRows[0]?.name ?? null;
    return rows.map((row) =>
      serializeAnchor(row, productName, row.candidateId ? candidateNameById.get(row.candidateId) ?? null : null)
    );
  }

  /**
   * 锚点快照：把候选与价格在锚定那一刻冻住，日后候选 / 价格变动都不会篡改历史对标理由。
   */
  private async snapshotFor(item: AnchorPlanItem): Promise<AnchorSnapshot> {
    const candidate = item.candidate;
    const offer = item.offer;
    let offerSnapshot: AnchorOfferSnapshot | null = null;
    if (offer) {
      const sourceRows = offer.sourceId
        ? await this.db
            .select({ url: sourcesTable.url, domain: sourcesTable.domain })
            .from(sourcesTable)
            .where(eq(sourcesTable.id, offer.sourceId))
            .limit(1)
        : [];
      const observable = offerComparable(offer);
      offerSnapshot = {
        offer_id: offer.id,
        candidate_id: offer.candidateId,
        subject_name: offer.subjectName,
        subject_brand: offer.subjectBrand,
        subject_year: offer.subjectYear,
        subject_spec: offer.subjectSpec,
        value: Number(offer.value),
        currency: offer.currency,
        price_type: priceTypeSchema.parse(offer.priceType),
        unit_scope: offer.unitScope,
        weight_g: offer.weightG,
        price_per_kg: offer.pricePerKg === null ? null : Number(offer.pricePerKg),
        price_357g: offer.price357g === null ? null : Number(offer.price357g),
        evidence_score: offer.evidenceScore,
        evidence_band: priceEvidenceBandSchema.parse(offer.evidenceBand),
        evidence:
          offer.evidence ??
          scorePriceEvidence({
            price_type: priceTypeSchema.parse(offer.priceType),
            unit_scope: offer.unitScope,
            identity: { name: offer.subjectName, brand_name: offer.subjectBrand, year: offer.subjectYear },
            source_kind: null,
            source_count: offer.sourceCount,
            quote_traceable: false
          }),
        attribution: offer.attribution,
        quote: offer.quote,
        quote_traceable: offer.quoteTraceable,
        source_id: offer.sourceId,
        url: sourceRows[0]?.url ?? null,
        domain: sourceRows[0]?.domain ?? null,
        observed_at: offer.observedAt,
        published_at: offer.publishedAt,
        comparable_value: observable.value,
        comparable_basis: observable.basis
      };
    }

    return anchorSnapshotSchema.parse({
      candidate: {
        candidate_id: candidate.id,
        name: candidate.name,
        brand_name: candidate.brandName,
        year: candidate.year,
        tea_type: candidate.teaType,
        mountain: candidate.mountain,
        weight_g: candidate.weightG,
        spec_notes: candidate.specNotes,
        identity_key: candidate.identityKey,
        similarity_total: candidate.similarityTotal,
        similarity_band: candidate.similarityBand,
        similarity: candidate.similarity,
        status: candidate.status,
        merged_sources: candidate.mergedSources,
        evidence: candidate.evidence ?? [],
        observed_prices: candidate.observedPrices ?? [],
        notes: candidate.notes
      },
      market_offer: offerSnapshot,
      price_percentile: item.pricePercentile,
      reliable_price_count: await this.reliablePriceCount(candidate.id),
      evidence_note: item.rationale
    });
  }

  private async reliablePriceCount(candidateId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(marketOffers)
      .where(eq(marketOffers.candidateId, candidateId));
    return rows.filter(isReliableOffer).length;
  }

  /** 主要锚点只保留一条：已有（含人工选定）就不动，否则按「最高价值 → 高相似 → 强成交」选第一条。 */
  private async ensurePrimary(rows: readonly ValueAnchor[]): Promise<void> {
    const hasPrimary = rows.some((row) => row.isPrimary);
    if (hasPrimary) {
      return;
    }
    const order: AnchorType[] = ["HIGHEST_VALUE", "SIMILARITY_HIGH_VALUE", "SALES_ANCHOR"];
    const candidate = order
      .map((type) => rows.filter((row) => row.anchorType === type).sort((a, b) => a.rank - b.rank)[0])
      .find((row): row is ValueAnchor => Boolean(row));
    if (!candidate) {
      return;
    }
    await this.db
      .update(valueAnchors)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(valueAnchors.id, candidate.id));
  }

  /**
   * 组装三种锚点计划。
   *
   * 每个候选最多出现在三种锚点里一次；相似度不足 70 的候选不会进入 Highest Value，
   * 没有可靠价格的候选不会进入 Similarity High Value，相似度低于拒绝档的候选不进入任何锚点。
   */
  private async buildPlan(productId: string, maxPerType: number): Promise<AnchorPlan> {
    const candidateRows = await this.db
      .select()
      .from(comparableCandidates)
      .where(eq(comparableCandidates.productId, productId))
      .orderBy(desc(comparableCandidates.similarityTotal));
    const offerRows = await this.db
      .select()
      .from(marketOffers)
      .where(eq(marketOffers.productId, productId));

    const reliableOffers = offerRows.filter(isReliableOffer);
    const sortedComparables = reliableOffers
      .map((offer) => offerComparable(offer).value)
      .filter((value) => value > 0)
      .sort((left, right) => left - right);

    const candidateByIdentity = new Map(candidateRows.map((row) => [row.identityKey, row]));
    const offersByCandidate = new Map<string, MarketOffer[]>();
    let attributedOffers = 0;
    let unattributedOffers = 0;
    for (const offer of offerRows) {
      if (offer.attribution === "SOURCE_UNATTRIBUTED") {
        unattributedOffers += 1;
      } else {
        attributedOffers += 1;
      }
      const candidateId =
        offer.candidateId ?? (offer.identityKey ? candidateByIdentity.get(offer.identityKey)?.id ?? null : null);
      if (!candidateId) {
        continue;
      }
      const list = offersByCandidate.get(candidateId);
      if (list) {
        list.push(offer);
      } else {
        offersByCandidate.set(candidateId, [offer]);
      }
    }

    const bestOfferFor = (candidateId: string): MarketOffer | null => {
      const list = (offersByCandidate.get(candidateId) ?? []).filter(isReliableOffer);
      if (list.length === 0) {
        return null;
      }
      const sorted = [...list].sort((left, right) => {
        const leftTransaction = left.priceType === "VERIFIED_TRANSACTION" ? 1 : 0;
        const rightTransaction = right.priceType === "VERIFIED_TRANSACTION" ? 1 : 0;
        if (leftTransaction !== rightTransaction) {
          return rightTransaction - leftTransaction;
        }
        return offerComparable(right).value - offerComparable(left).value;
      });
      return sorted[0] ?? null;
    };

    const items: AnchorPlanItem[] = [];

    /* §16.2 Similarity High Value Anchor：相似度 ≥ 70 且价格处于前 20% */
    const similarityAnchors: AnchorPlanItem[] = [];
    for (const candidate of candidateRows) {
      if (candidate.similarityTotal < RELIABLE_MIN_SIMILARITY) {
        continue;
      }
      const offer = bestOfferFor(candidate.id);
      if (!offer) {
        continue;
      }
      const percentile = percentileOf(sortedComparables, offerComparable(offer).value);
      if (percentile < SIMILARITY_ANCHOR_PRICE_PERCENTILE) {
        continue;
      }
      similarityAnchors.push({
        anchorType: "SIMILARITY_HIGH_VALUE",
        candidate,
        offer,
        pricePercentile: percentile,
        priceEvidenceScore: offer.evidenceScore,
        salesAnchorScore: null,
        salesAnchor: null,
        rank: 0,
        rationale: `相似度 ${candidate.similarityTotal} 分（${candidate.similarityBand}），价格处于同产品可靠价格带前 ${100 - percentile}%：可作高相似度对标参照（§16.2）`
      });
    }
    similarityAnchors.sort((left, right) => right.candidate.similarityTotal - left.candidate.similarityTotal);
    items.push(...rankAndLimit(similarityAnchors, maxPerType, "SIMILARITY_HIGH_VALUE"));

    /* §16.1 Highest Value Anchor：相似度 ≥ 70 且价格证据分 ≥ 75，成交价优先 */
    const highestValueAnchors: AnchorPlanItem[] = [];
    for (const candidate of candidateRows) {
      if (candidate.similarityTotal < RELIABLE_MIN_SIMILARITY) {
        continue;
      }
      const offer = bestOfferFor(candidate.id);
      if (!offer) {
        continue;
      }
      const evidenceScore = Math.max(
        ...(offersByCandidate.get(candidate.id) ?? []).filter(isReliableOffer).map((row) => row.evidenceScore)
      );
      if (evidenceScore < RELIABLE_MIN_EVIDENCE) {
        continue;
      }
      const transaction = offer.priceType === "VERIFIED_TRANSACTION";
      highestValueAnchors.push({
        anchorType: "HIGHEST_VALUE",
        candidate,
        offer,
        pricePercentile: percentileOf(sortedComparables, offerComparable(offer).value),
        priceEvidenceScore: evidenceScore,
        salesAnchorScore: null,
        salesAnchor: null,
        rank: 0,
        rationale: `相似度 ${candidate.similarityTotal} 分、价格证据 ${evidenceScore} 分（${transaction ? "成交价" : "可靠挂牌价"}），同时满足 §16.1 两条门槛：可作最高价值锚点`
      });
    }
    highestValueAnchors.sort((left, right) => {
      const leftTransaction = left.offer?.priceType === "VERIFIED_TRANSACTION" ? 1 : 0;
      const rightTransaction = right.offer?.priceType === "VERIFIED_TRANSACTION" ? 1 : 0;
      if (leftTransaction !== rightTransaction) {
        return rightTransaction - leftTransaction;
      }
      const leftValue = left.offer ? offerComparable(left.offer).value : 0;
      const rightValue = right.offer ? offerComparable(right.offer).value : 0;
      return rightValue - leftValue;
    });
    items.push(...rankAndLimit(highestValueAnchors, maxPerType, "HIGHEST_VALUE"));

    /* §16.3 Sales Anchor：相似度不低于拒绝档，六项加权排序 */
    const salesAnchors: AnchorPlanItem[] = [];
    for (const candidate of candidateRows) {
      if (candidate.similarityTotal < SIMILARITY_BANDS.REJECT) {
        continue;
      }
      const offer = bestOfferFor(candidate.id);
      const reliableScore = offer ? offer.evidenceScore : 0;
      const percentile = offer ? percentileOf(sortedComparables, offerComparable(offer).value) : null;
      const story = storyValue(candidate);
      const recognition = marketRecognition(candidate);
      const concept = conceptRelevance(candidate);
      const evidence = evidenceComponent(reliableScore, candidate);
      const salesAnchor = scoreSalesAnchor({
        similarity: candidate.similarityTotal,
        price_level: percentile ?? 0,
        market_recognition: recognition.score,
        story_value: story.score,
        concept_relevance: concept.score,
        evidence: evidence.score
      });
      salesAnchors.push({
        anchorType: "SALES_ANCHOR",
        candidate,
        offer,
        pricePercentile: percentile,
        priceEvidenceScore: reliableScore,
        salesAnchorScore: salesAnchor.total,
        salesAnchor,
        rank: 0,
        rationale: `强成交锚点得分 ${salesAnchor.total}（相似度 ${candidate.similarityTotal} × 30% + 价格水平 ${percentile ?? 0} × 25% + 市场认知 ${recognition.score} × 15% + 故事价值 ${story.score} × 15% + 概念相关性 ${concept.score} × 10% + 证据 ${evidence.score} × 5%）：六项加权合计 100（§16.3）`
      });
    }
    salesAnchors.sort((left, right) => (right.salesAnchorScore ?? 0) - (left.salesAnchorScore ?? 0));
    items.push(...rankAndLimit(salesAnchors, maxPerType, "SALES_ANCHOR"));

    const capped = items.slice(0, ANCHOR_LIMITS.maxPerProduct);
    const reliableCandidates = highestValueAnchors.length;

    return {
      items: capped,
      hasReliable: reliableCandidates > 0,
      stats: {
        candidates_considered: candidateRows.length,
        reliable_price_candidates: new Set(
          reliableOffers
            .map((offer) => offer.candidateId ?? (offer.identityKey ? candidateByIdentity.get(offer.identityKey)?.id ?? null : null))
            .filter((value): value is string => value !== null)
        ).size,
        attributed_price_offers: attributedOffers,
        unattributed_price_offers: unattributedOffers,
        highest_value: highestValueAnchors.length,
        similarity_high_value: similarityAnchors.length,
        sales_anchor: salesAnchors.length
      }
    };
  }
}

/** 按类型内顺序重排名次并截断到每种锚点上限。 */
function rankAndLimit(items: AnchorPlanItem[], maxPerType: number, type: AnchorType): AnchorPlanItem[] {
  return items
    .slice(0, maxPerType)
    .map((item, index) => ({ ...item, anchorType: type, rank: index + 1 }));
}

/** §17 / §55：模式判定。没有达标锚点时必须进入 CATEGORY_CREATOR，不伪造对标。 */
function resolveMode(
  preference: ResearchMode,
  rows: readonly ValueAnchor[]
): { mode: ResolvedResearchMode; resolved_by: AnchorResolveSource; reason: string } {
  const reliable = rows.some(
    (row) => row.similarityScore >= RELIABLE_MIN_SIMILARITY && row.priceEvidenceScore >= RELIABLE_MIN_EVIDENCE
  );
  const counts = {
    highest: rows.filter((row) => row.anchorType === "HIGHEST_VALUE").length,
    similarity: rows.filter((row) => row.anchorType === "SIMILARITY_HIGH_VALUE").length,
    sales: rows.filter((row) => row.anchorType === "SALES_ANCHOR").length
  };
  if (preference === "CATEGORY_CREATOR") {
    return {
      mode: "CATEGORY_CREATOR",
      resolved_by: "MANUAL_PREFERENCE",
      reason: "产品负责人指定进入自建高端标准模式（Category Creator Mode）"
    };
  }
  if (!reliable) {
    const manual = preference === "BENCHMARK" ? "产品负责人虽选择对标模式，" : "";
    return {
      mode: "CATEGORY_CREATOR",
      resolved_by: "NO_RELIABLE_ANCHOR",
      reason: `${manual}无候选同时满足 Similarity ≥ ${RELIABLE_MIN_SIMILARITY} 与 PriceEvidence ≥ ${RELIABLE_MIN_EVIDENCE}，必须进入自建高端标准模式，不得硬凑竞品或降低阈值（§17）`
    };
  }
  return {
    mode: "BENCHMARK",
    resolved_by: preference === "BENCHMARK" ? "MANUAL_PREFERENCE" : "AUTO_ANCHOR",
    reason: `存在 ${counts.highest} 条最高价值锚点（Similarity ≥ ${RELIABLE_MIN_SIMILARITY} 且 PriceEvidence ≥ ${RELIABLE_MIN_EVIDENCE}）：进入高价值对标模式（§16.1 / §55）`
  };
}

function anchorSortOrder(sort: AnchorListQuery["sort"]): SQL[] {
  switch (sort) {
    case "rank":
      return [asc(valueAnchors.rank), asc(valueAnchors.createdAt)];
    case "-similarity":
      return [desc(valueAnchors.similarityScore), asc(valueAnchors.rank)];
    case "similarity":
      return [asc(valueAnchors.similarityScore), asc(valueAnchors.rank)];
    case "-price_evidence":
      return [desc(valueAnchors.priceEvidenceScore), asc(valueAnchors.rank)];
    case "price_evidence":
      return [asc(valueAnchors.priceEvidenceScore), asc(valueAnchors.rank)];
    case "sales":
      return [asc(valueAnchors.salesAnchorScore), asc(valueAnchors.rank)];
    case "-sales":
      return [desc(valueAnchors.salesAnchorScore), asc(valueAnchors.rank)];
    case "created_at":
      return [asc(valueAnchors.createdAt)];
    case "-created_at":
      return [desc(valueAnchors.createdAt)];
    default:
      return [asc(valueAnchors.rank), desc(valueAnchors.createdAt)];
  }
}

export function serializeAnchor(
  row: ValueAnchor,
  productName: string | null,
  candidateName: string | null
): AnchorView {
  return anchorSchema.parse({
    id: row.id,
    product_id: row.productId,
    product_name: productName,
    anchor_type: row.anchorType,
    candidate_id: row.candidateId,
    candidate_name: candidateName,
    market_offer_id: row.marketOfferId,
    similarity_score: row.similarityScore,
    price_evidence_score: row.priceEvidenceScore,
    price_percentile: row.pricePercentile,
    sales_anchor_score: row.salesAnchorScore === null ? null : Number(row.salesAnchorScore),
    sales_anchor: row.salesAnchor ?? null,
    rank: row.rank,
    is_primary: row.isPrimary,
    is_manual: row.isManual,
    rationale: row.rationale,
    selected_by: row.selectedBy,
    selected_at: row.selectedAt ? row.selectedAt.toISOString() : null,
    snapshot: row.snapshot,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  });
}

/** 供 API 自检与前端展示：§16 / §17 的阈值、权重与红线只从这里读取。 */
export const ANCHOR_ENGINE_INFO = {
  spec_ref: "§16 / §17 / §55 / §56",
  min_similarity: RELIABLE_MIN_SIMILARITY,
  min_price_evidence: RELIABLE_MIN_EVIDENCE,
  price_percentile_threshold: SIMILARITY_ANCHOR_PRICE_PERCENTILE,
  price_in_similarity: false,
  excludes_source_unattributed: true,
  no_fake_benchmark: true,
  limits: ANCHOR_LIMITS,
  note: "锚点只描述「为什么可以对标」；没有达标候选时进入 Category Creator Mode，不硬凑竞品"
} as const;
