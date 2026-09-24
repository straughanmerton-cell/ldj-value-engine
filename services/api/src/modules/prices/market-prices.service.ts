import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { Database, MarketOffer } from "@ldj/database";
import {
  comparableCandidates,
  marketOffers,
  products,
  sources as sourcesTable
} from "@ldj/database";
import {
  ANCHOR_REQUIREMENTS,
  candidateIdentityKey,
  detectPriceOutliers,
  MARKET_OFFER_LIMITS,
  marketOfferSchema,
  normalizePriceEquivalents,
  priceEvidenceBandSchema,
  priceTypeSchema,
  scorePriceEvidence,
  webExtractionAiOutputSchema,
  type MarketOfferAttribution,
  type MarketOfferCreateInput,
  type MarketOfferListQuery,
  type MarketOfferRebuildRequest,
  type MarketOfferUpdateInput,
  type MarketOfferView,
  type PriceEvidence,
  type PriceEvidenceBand,
  type PriceSummary,
  type PriceType,
  type PriceTypeBucket,
  type PriceUnitScope
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { assertProductExists } from "../product-records/product-guard.js";

/**
 * 价格引擎服务（规格 §14 市场价格系统 / §15 Price Evidence Score / §16.1 锚点价格条件）。
 *
 * 本服务只做四件事：
 * 1. 把来源里的价格原话落成一条条可审计的价格证据（market_offers）；
 * 2. 每条证据按 §15 五项加权打「价格证据分」，并给出中文理由；
 * 3. 按「类型 + 单位 + 币种 + 规格」分组做异常值检测，只标记不删除；
 * 4. 给 Phase 7 锚点引擎提供价格汇总（可靠锚点要求证据分 ≥ 75）。
 *
 * 四条红线在代码层强制：挂牌 ≠ 成交、整件 ≠ 单饼、历史 ≠ 当前、没有写 = 不计算。
 * 价格永远不参与相似度（§13），也不因为报价多就自动升级为「成交价」。
 */

export interface MarketOfferRebuildStats {
  /** 参与重建的来源条数（已抽取完成的） */
  sources_considered: number;
  /** 来源里出现的价格条数（含被合并的重复价） */
  prices_considered: number;
  /** 去重后落成的价格证据条数 */
  drafts: number;
  /** 被多个来源写到同一组价格的条数 */
  merged_multi_source: number;
  /** 来源没有写明产品身份、只能标记 SOURCE_UNATTRIBUTED 的条数 */
  unattributed: number;
  /** 因为触达单产品上限而跳过的条数 */
  skipped_limit: number;
}

export interface MarketOfferRebuildResult {
  total: number;
  created: number;
  updated: number;
  /** 人工登记的价格不会被重建覆盖 */
  kept_manual: number;
  outliers: number;
  outlier_groups: number;
  band_counts: Record<PriceEvidenceBand, number>;
  reached_limit: boolean;
  stats: MarketOfferRebuildStats;
  summary: PriceSummary;
  spec_ref: "§14 / §15 / §16.1";
}

interface OfferDraft {
  dedupKey: string;
  candidateId: string | null;
  sourceId: string | null;
  sourceIds: string[];
  sourceCount: number;
  subjectName: string | null;
  subjectBrand: string | null;
  subjectYear: number | null;
  subjectSpec: string | null;
  identityKey: string | null;
  priceType: PriceType;
  unitScope: PriceUnitScope | null;
  value: number;
  currency: string;
  weightG: number | null;
  piecesPerCase: number | null;
  attribution: MarketOfferAttribution;
  quote: string;
  note: string | null;
  observedAt: string | null;
  publishedAt: string | null;
  sourceKind: string | null;
  domain: string | null;
  quoteTraceable: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) {
    return null;
  }
  return round2((left + right) / 2);
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 单位对应的总克重：只有写明规格重量（或按 kg 计价）才算，其余一律 null。 */
export function unitGramsOf(scope: PriceUnitScope | null, weightG: number | null): number | null {
  if (scope === "KG") {
    return 1000;
  }
  if (scope === "PIECE" || scope === "BUNDLE" || scope === "CASE") {
    return weightG !== null && weightG > 0 ? weightG : null;
  }
  return null;
}

/**
 * 去重键：身份 + 价格类型 + 单位 + 币种 + 规格 + 数值。
 *
 * 来源没写明产品身份时用来源自身作身份前缀：没有身份就谈不上「多个来源印证同一条价格」，
 * 绝不让两条无关的价格因为都缺身份而被合并成「多来源证据」。
 */
export function offerDedupKey(input: {
  identityKey: string | null;
  sourceId?: string | null;
  priceType: PriceType;
  unitScope: PriceUnitScope | null;
  currency: string;
  weightG: number | null;
  value: number;
}): string {
  const identity = input.identityKey ?? `SOURCE:${input.sourceId ?? "MANUAL"}`;
  return [
    identity,
    input.priceType,
    input.unitScope ?? "UNKNOWN",
    input.currency.toUpperCase(),
    input.weightG === null ? "" : String(Math.round(input.weightG)),
    String(round2(input.value))
  ].join("|");
}

/** 汇总统计只看未被人工排除的价格；但库里始终保留全部原始价格（§62-15）。 */
function isCounted(row: MarketOffer): boolean {
  return !row.isExcluded;
}

/**
 * 行 → 视图时需要的来源侧信息。
 *
 * `market_offers` 只存「这条价格本身」的事实；来源类型 / 域名 / 链接一律以 `sources`
 * 为准（join 读，不冗余存），所以来源改了域名这里立刻跟着变，不会出现两份数据打架。
 */
export interface MarketOfferContext {
  productName: string | null;
  candidateName: string | null;
  sourceKind: string | null;
  domain: string | null;
  url: string | null;
}

function bandEmpty(): Record<PriceEvidenceBand, number> {
  return { STRONG: 0, USABLE: 0, WEAK: 0 };
}

/** 价格锚点的比较基准：只能拿同一性质、同一单位的价格互相比较（§14 / §62-2·3）。 */
const BASIS_PRIORITY: PriceType[] = [
  "VERIFIED_TRANSACTION",
  "AUCTION_HAMMER",
  "OFFICIAL_RETAIL",
  "LISTING",
  "HISTORICAL_REFERENCE"
];

export class MarketPricesService {
  constructor(private readonly db: Database) {}

  /** 跨产品价格列表（§14 市场价格中心）；带 product_id 时等价于产品级列表。 */
  async list(query: MarketOfferListQuery): Promise<Paginated<MarketOfferView>> {
    const filters: SQL[] = [];
    if (query.product_id) {
      filters.push(eq(marketOffers.productId, query.product_id));
    }
    if (query.candidate_id) {
      filters.push(eq(marketOffers.candidateId, query.candidate_id));
    }
    if (query.price_type) {
      filters.push(eq(marketOffers.priceType, query.price_type));
    }
    if (query.unit_scope) {
      filters.push(eq(marketOffers.unitScope, query.unit_scope));
    }
    if (query.evidence_band) {
      filters.push(eq(marketOffers.evidenceBand, query.evidence_band));
    }
    if (query.attribution) {
      filters.push(eq(marketOffers.attribution, query.attribution));
    }
    if (query.is_outlier !== undefined) {
      filters.push(eq(marketOffers.isOutlier, query.is_outlier));
    }
    if (!query.include_excluded) {
      filters.push(eq(marketOffers.isExcluded, false));
    }
    if (query.q) {
      const pattern = `%${query.q}%`;
      const condition = or(
        ilike(marketOffers.subjectName, pattern),
        ilike(marketOffers.subjectBrand, pattern),
        ilike(marketOffers.quote, pattern)
      );
      if (condition) {
        filters.push(condition);
      }
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? MARKET_OFFER_LIMITS.defaultPageSize
    });

    const rows = await this.db
      .select(offerSelection)
      .from(marketOffers)
      .innerJoin(products, eq(products.id, marketOffers.productId))
      .leftJoin(comparableCandidates, eq(comparableCandidates.id, marketOffers.candidateId))
      .leftJoin(sourcesTable, eq(sourcesTable.id, marketOffers.sourceId))
      .where(where)
      .orderBy(...offerSortOrder(query.sort))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db.select({ value: count() }).from(marketOffers).where(where);

    return buildPage(
      rows.map((row) => serializeOffer(row.offer, offerContext(row))),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  async get(productId: string, offerId: string): Promise<MarketOfferView> {
    const { row, context } = await this.findRow(productId, offerId);
    return serializeOffer(row, context);
  }

  /**
   * 人工登记价格：同样要写清原文引文（quote），并且**不允许**声明成交价以外的推断。
   * 人工登记无法逐字回溯到来源正文，价格证据分按最保守口径计算。
   */
  async create(
    productId: string,
    input: MarketOfferCreateInput,
    actorId: string
  ): Promise<MarketOfferView> {
    await assertProductExists(this.db, productId);
    // 来源必须属于本产品：跨产品挂来源会让「多来源印证」变成假的
    const source = input.source_id ? await this.assertSource(productId, input.source_id) : null;
    if (input.candidate_id) {
      await this.assertCandidate(productId, input.candidate_id);
    }
    const identityKey = candidateIdentityKey({
      name: input.subject_name,
      brand_name: input.subject_brand ?? null,
      year: input.subject_year ?? null,
      weight_g: input.weight_g ?? null,
      spec_notes: input.subject_spec ?? null
    });
    const weightG = input.weight_g === null || input.weight_g === undefined ? null : Math.round(input.weight_g);
    const dedupKey = offerDedupKey({
      identityKey,
      priceType: input.price_type,
      unitScope: input.unit_scope ?? null,
      currency: input.currency ?? "CNY",
      weightG,
      value: input.value
    });
    const existing = await this.findByDedupKey(productId, dedupKey);
    if (existing) {
      throw new AppError("CONFLICT", "该产品下已存在同身份 / 同类型 / 同单位 / 同规格的同价条目", 409, {
        offer_id: existing.id
      });
    }
    const totalRows = await this.db
      .select({ value: count() })
      .from(marketOffers)
      .where(eq(marketOffers.productId, productId));
    if (Number(totalRows[0]?.value ?? 0) >= MARKET_OFFER_LIMITS.maxPerProduct) {
      throw AppError.validation(
        `单个产品最多登记 ${MARKET_OFFER_LIMITS.maxPerProduct} 条价格证据，已达到上限`,
        { limit: MARKET_OFFER_LIMITS.maxPerProduct }
      );
    }

    // 人工登记的引文同样要能回溯：挂了来源就回正文里逐字核对，核不到按不可回溯给分
    const quoteTraceable = Boolean(source?.contentText && source.contentText.includes(input.quote));
    const evidence = scorePriceEvidence({
      price_type: input.price_type,
      unit_scope: input.unit_scope ?? null,
      identity: {
        name: input.subject_name,
        brand_name: input.subject_brand ?? null,
        year: input.subject_year ?? null,
        weight_g: weightG,
        spec_notes: input.subject_spec ?? null
      },
      source_kind: sourceKindOrNull(source?.sourceKind),
      domain: source?.domain ?? null,
      observed_at: input.observed_at ?? null,
      published_at: source?.publishedAt ?? null,
      source_count: 1,
      quote_traceable: quoteTraceable
    });
    const normalization = normalizePriceEquivalents({
      value: input.value,
      unit_scope: input.unit_scope ?? null,
      weight_g: weightG
    });

    const inserted = await this.db
      .insert(marketOffers)
      .values({
        productId,
        candidateId: input.candidate_id ?? null,
        sourceId: input.source_id ?? null,
        subjectName: input.subject_name,
        subjectBrand: input.subject_brand ?? null,
        subjectYear: input.subject_year ?? null,
        subjectSpec: input.subject_spec ?? null,
        identityKey,
        priceType: input.price_type,
        unitScope: input.unit_scope ?? null,
        value: String(round2(input.value)),
        currency: (input.currency ?? "CNY").toUpperCase(),
        weightG,
        piecesPerCase: input.pieces_per_case ?? null,
        pricePerKg: normalization.price_per_kg === null ? null : String(normalization.price_per_kg),
        price357g: normalization.price_357g === null ? null : String(normalization.price_357g),
        pieceEquivalentAllowed: normalization.piece_equivalent_allowed,
        evidenceScore: evidence.score,
        evidenceBand: evidence.band,
        evidence,
        attribution: "MANUAL",
        quote: input.quote,
        quoteTraceable,
        note: input.note ?? null,
        observedAt: input.observed_at ?? null,
        publishedAt: source?.publishedAt ?? null,
        dedupKey,
        sourceIds: source ? [source.id] : [],
        sourceCount: 1,
        createdBy: actorId
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "价格证据登记失败");
    }
    const saved = await this.findRow(productId, row.id);
    return serializeOffer(saved.row, saved.context);
  }

  /**
   * 人工修正只允许「补规格 / 改单位 / 加备注 / 排除」：
   * 价格数值、价格类型与引文一律不可改——改了就是篡改证据（§62-2·3·4）。
   */
  async update(
    productId: string,
    offerId: string,
    input: MarketOfferUpdateInput
  ): Promise<MarketOfferView> {
    const { row, context } = await this.findRow(productId, offerId);
    const unitScope = input.unit_scope ?? row.unitScope;
    const weightG =
      input.weight_g === undefined
        ? row.weightG
        : input.weight_g === null
          ? null
          : Math.round(input.weight_g);
    const value = Number(row.value);
    const normalization = normalizePriceEquivalents({ value, unit_scope: unitScope, weight_g: weightG });
    const evidence = scorePriceEvidence({
      price_type: row.priceType,
      unit_scope: unitScope,
      identity: {
        name: row.subjectName,
        brand_name: row.subjectBrand,
        year: row.subjectYear,
        weight_g: weightG,
        spec_notes: row.subjectSpec
      },
      source_kind: sourceKindOrNull(context.sourceKind),
      domain: context.domain,
      observed_at: row.observedAt,
      published_at: row.publishedAt,
      source_count: row.sourceCount,
      quote_traceable: row.quoteTraceable
    });

    // 规格重量本身就是产品身份的一部分（身份键含重量）：改了单位 / 规格，
    // 身份键必须跟着重算，否则「同一条价格按修正后的口径再登记」会绕过去重，
    // 变成两条看起来互不相干的证据。
    const nextIdentityKey = row.subjectName
      ? candidateIdentityKey({
          name: row.subjectName,
          brand_name: row.subjectBrand,
          year: row.subjectYear,
          weight_g: weightG,
          spec_notes: row.subjectSpec
        })
      : row.identityKey;

    // 去重键同样要随新口径对齐；但如果新键已被别的价格占用（真撞车），
    // 保留旧键，绝不覆盖别人的证据。
    const nextDedupKey = await this.rekeyIfFree(
      productId,
      row,
      nextIdentityKey,
      unitScope,
      weightG
    );

    const updated = await this.db
      .update(marketOffers)
      .set({
        unitScope,
        weightG,
        identityKey: nextIdentityKey,
        piecesPerCase:
          input.pieces_per_case === undefined ? row.piecesPerCase : input.pieces_per_case,
        manualNote: input.manual_note === undefined ? row.manualNote : input.manual_note,
        isExcluded: input.is_excluded === undefined ? row.isExcluded : input.is_excluded,
        pricePerKg: normalization.price_per_kg === null ? null : String(normalization.price_per_kg),
        price357g: normalization.price_357g === null ? null : String(normalization.price_357g),
        pieceEquivalentAllowed: normalization.piece_equivalent_allowed,
        evidenceScore: evidence.score,
        evidenceBand: evidence.band,
        evidence,
        dedupKey: nextDedupKey,
        updatedAt: new Date()
      })
      .where(and(eq(marketOffers.id, offerId), eq(marketOffers.productId, productId)))
      .returning();
    const saved = updated[0];
    if (!saved) {
      throw AppError.notFound("价格证据不存在");
    }
    await this.refreshOutliers(productId);
    const refreshed = await this.findRow(productId, offerId);
    return serializeOffer(refreshed.row, refreshed.context);
  }

  /**
   * 从来源抽取结果重建价格证据（研究流水线 PRICE_SEARCH 阶段）。
   *
   * 来源里没写规格重量就保持 NULL；整件价不折算单饼价；人工登记与人工备注不被覆盖。
   */
  async rebuild(
    productId: string,
    input: MarketOfferRebuildRequest,
    actorId: string
  ): Promise<MarketOfferRebuildResult> {
    await assertProductExists(this.db, productId);
    const keepManual = input.keep_manual ?? true;
    const built = await this.buildDraftsFromSources(productId);

    const existingRows = await this.db
      .select()
      .from(marketOffers)
      .where(eq(marketOffers.productId, productId));
    const byKey = new Map(existingRows.map((row) => [row.dedupKey, row]));

    let created = 0;
    let updated = 0;
    let keptManual = 0;
    let skippedLimit = 0;
    const rowsAfter = [...existingRows];

    for (const draft of built.drafts) {
      const existing = byKey.get(draft.dedupKey);
      if (existing) {
        if (existing.attribution === "MANUAL" && keepManual) {
          keptManual += 1;
          continue;
        }
        const next = await this.applyDraftToExisting(existing, draft);
        const index = rowsAfter.findIndex((row) => row.id === existing.id);
        if (index >= 0) {
          rowsAfter[index] = next;
        }
        updated += 1;
        continue;
      }
      if (rowsAfter.length >= MARKET_OFFER_LIMITS.maxPerProduct) {
        skippedLimit += 1;
        continue;
      }
      const inserted = await this.insertDraft(productId, draft, actorId);
      rowsAfter.push(inserted);
      created += 1;
    }

    const outlierResult = await this.persistOutliers(rowsAfter);
    const summary = await this.summary(productId);
    const bandCounts = bandEmpty();
    for (const row of rowsAfter) {
      if (!isCounted(row)) {
        continue;
      }
      const band = priceEvidenceBandSchema.safeParse(row.evidenceBand);
      if (band.success) {
        bandCounts[band.data] += 1;
      }
    }

    return {
      total: rowsAfter.length,
      created,
      updated,
      kept_manual: keptManual,
      outliers: outlierResult.outliers,
      outlier_groups: outlierResult.groups,
      band_counts: bandCounts,
      reached_limit: skippedLimit > 0,
      stats: { ...built.stats, skipped_limit: skippedLimit },
      summary,
      spec_ref: "§14 / §15 / §16.1"
    };
  }

  async remove(productId: string, offerId: string): Promise<void> {
    await this.findRow(productId, offerId);
    await this.db
      .delete(marketOffers)
      .where(and(eq(marketOffers.id, offerId), eq(marketOffers.productId, productId)));
  }

  /**
   * 价格汇总（§14 / §16.1）：给 Phase 7 锚点引擎判断「这个产品到底有没有可靠价格锚点」。
   * 汇总只统计未被人工排除的价格；挂牌与成交分开计数，异常值单独点出。
   */
  async summary(productId: string): Promise<PriceSummary> {
    const rows = await this.db.select().from(marketOffers).where(eq(marketOffers.productId, productId));
    const productName = await this.productName(productId);
    const counted = rows.filter(isCounted);
    const bands = bandEmpty();
    let outliers = 0;
    let reliable = 0;
    for (const row of counted) {
      const band = priceEvidenceBandSchema.safeParse(row.evidenceBand);
      if (band.success) {
        bands[band.data] += 1;
      }
      if (row.isOutlier) {
        outliers += 1;
      }
      if (!row.isOutlier && row.evidenceScore >= ANCHOR_REQUIREMENTS.minPriceEvidence) {
        reliable += 1;
      }
    }

    const notes: string[] = [];
    if (counted.length === 0) {
      notes.push("暂无价格证据：没有价格就不讲价格故事（§22），进入自建标准模式");
    }
    if (reliable === 0 && counted.length > 0) {
      notes.push(
        `暂无可靠价格锚点：证据分 ≥ ${ANCHOR_REQUIREMENTS.minPriceEvidence} 且非异常值的价格 0 条，价格只能作背景参考`
      );
    }
    const listingOnly =
      counted.length > 0 && counted.every((row) => row.priceType !== "VERIFIED_TRANSACTION");
    if (listingOnly) {
      notes.push("现有价格均为挂牌 / 官方 / 历史参考价，缺少成交证据：不得表述为成交价（§62-2）");
    }
    const caseRows = counted.filter((row) => row.unitScope === "CASE");
    if (caseRows.length > 0) {
      notes.push(`${caseRows.length} 条整件价：只参与 1kg 等价，不折算单饼价（§62-3）`);
    }
    const unattributed = rows.filter((row) => row.attribution === "SOURCE_UNATTRIBUTED").length;
    if (unattributed > 0) {
      notes.push(`${unattributed} 条价格来自未写明产品身份的来源，不计入跨来源印证`);
    }
    if (outliers > 0) {
      notes.push(`${outliers} 条价格为异常值（同类型同单位同规格内偏离中位数过多）：只标记，不删除`);
    }

    const priceLevel = pickPriceLevel(counted);

    return {
      product_id: productId,
      product_name: productName,
      total_offers: rows.length,
      counted_offers: counted.length,
      strong_offers: bands.STRONG,
      usable_offers: bands.USABLE,
      weak_offers: bands.WEAK,
      outlier_count: outliers,
      excluded_count: rows.length - counted.length,
      unattributed_count: unattributed,
      transaction_count: counted.filter((row) => row.priceType === "VERIFIED_TRANSACTION").length,
      listing_count: counted.filter((row) => row.priceType === "LISTING").length,
      reliable_count: reliable,
      buckets: buildBuckets(counted),
      price_level: priceLevel,
      notes,
      spec_ref: "§14 / §15 / §16.1"
    };
  }

  /**
   * 来源 → 价格证据草稿。
   *
   * 只读已经抽取完成的来源（crawler / Agent 3 的产物），不在这里联网、不在这里推断：
   * 来源没写的信息就是 NULL，来源没写的规格重量就不做任何 357g / 1kg 换算。
   */
  private async buildDraftsFromSources(productId: string): Promise<{
    drafts: OfferDraft[];
    stats: MarketOfferRebuildStats;
  }> {
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
    const candidateRows = await this.db
      .select()
      .from(comparableCandidates)
      .where(eq(comparableCandidates.productId, productId));
    const candidateByKey = new Map(candidateRows.map((row) => [row.identityKey, row.id]));

    const drafts = new Map<string, OfferDraft>();
    let considered = 0;
    let pricesConsidered = 0;
    let unattributed = 0;

    for (const row of rows) {
      const parsed = webExtractionAiOutputSchema.safeParse(row.lastExtraction ?? null);
      if (!parsed.success) {
        continue;
      }
      considered += 1;
      const extraction = parsed.data;
      const subjectName = textOrNull(extraction.product_name);
      const weightG = numberOrNull(extraction.weight_g);
      const identityKey = subjectName
        ? candidateIdentityKey({
            name: subjectName,
            brand_name: extraction.brand_name ?? null,
            year: extraction.year ?? null,
            weight_g: weightG,
            spec_notes: extraction.spec_notes ?? null
          })
        : null;
      const candidateId = identityKey ? candidateByKey.get(identityKey) ?? null : null;

      for (const price of extraction.prices) {
        pricesConsidered += 1;
        const unitScope = price.unit_scope ?? null;
        /**
         * 规格重量的取值顺序（§14 / §62-3）：
         * 1. 这条价格自己写明的重量（整件价必须走这一条）；
         * 2. 单饼价可以沿用同一条来源里写明的产品规格重量——同名同页写下的 357g 就是这条价格的规格，
         *    这不是换算，也不是拿产品主档去补；
         * 3. 其余一律 NULL：没有写 = 不计算等价（整件 / 提价绝不用别处的重量倒算）。
         */
        const statedWeight =
          price.weight_g === null || price.weight_g === undefined || price.weight_g <= 0
            ? null
            : Math.round(price.weight_g);
        const pageWeight =
          weightG !== null && weightG > 0 && unitScope === "PIECE" ? Math.round(weightG) : null;
        const priceWeight = statedWeight ?? pageWeight;
        const currency = (price.currency ?? "CNY").toUpperCase();
        const dedupKey = offerDedupKey({
          identityKey,
          sourceId: row.id,
          priceType: price.price_type,
          unitScope,
          currency,
          weightG: priceWeight,
          value: price.value
        });
        const existing = drafts.get(dedupKey);
        if (existing) {
          existing.sourceIds = existing.sourceIds.includes(row.id)
            ? existing.sourceIds
            : [...existing.sourceIds, row.id];
          existing.sourceCount = existing.sourceIds.length;
          continue;
        }
        /**
         * 归属只有三种可能，不能含糊（§14）：
         * - 来源写明产品身份且候选项里有对应条目 → CANDIDATE（这条价格挂在候选人上）；
         * - 来源写明产品身份但候选池里还没有 → SOURCE_IDENTIFIED（身份可信，只是尚未归并成候选）；
         * - 来源压根没写是哪个产品 → SOURCE_UNATTRIBUTED（不参与跨来源印证）。
         */
        const attribution: MarketOfferAttribution = !subjectName
          ? "SOURCE_UNATTRIBUTED"
          : candidateId
            ? "CANDIDATE"
            : "SOURCE_IDENTIFIED";
        if (attribution === "SOURCE_UNATTRIBUTED") {
          unattributed += 1;
        }
        drafts.set(dedupKey, {
          dedupKey,
          candidateId,
          sourceId: row.id,
          sourceIds: [row.id],
          sourceCount: 1,
          subjectName,
          subjectBrand: textOrNull(extraction.brand_name),
          subjectYear: extraction.year ?? null,
          subjectSpec: textOrNull(extraction.spec_notes),
          identityKey,
          priceType: price.price_type,
          unitScope,
          value: price.value,
          currency,
          weightG: priceWeight,
          piecesPerCase: null,
          attribution,
          quote: price.quote,
          note: textOrNull(price.note),
          observedAt: textOrNull(price.observed_at),
          publishedAt: textOrNull(row.publishedAt),
          sourceKind: row.sourceKind,
          domain: row.domain,
          // 抽取结果已由 sanitizeWebExtraction 强制逐字回溯；这里再核一次正文，核不到就按不可回溯给分
          quoteTraceable: Boolean(row.contentText && row.contentText.includes(price.quote))
        });
      }
    }

    const list = [...drafts.values()];
    return {
      drafts: list,
      stats: {
        sources_considered: considered,
        prices_considered: pricesConsidered,
        drafts: list.length,
        merged_multi_source: list.filter((draft) => draft.sourceCount > 1).length,
        unattributed,
        skipped_limit: 0
      }
    };
  }

  private async insertDraft(productId: string, draft: OfferDraft, actorId: string): Promise<MarketOffer> {
    const evidence = this.evidenceForDraft(draft);
    const normalization = normalizePriceEquivalents({
      value: draft.value,
      unit_scope: draft.unitScope,
      weight_g: draft.weightG
    });
    const inserted = await this.db
      .insert(marketOffers)
      .values({
        productId,
        candidateId: draft.candidateId,
        sourceId: draft.sourceId,
        subjectName: draft.subjectName,
        subjectBrand: draft.subjectBrand,
        subjectYear: draft.subjectYear,
        subjectSpec: draft.subjectSpec,
        identityKey: draft.identityKey,
        priceType: draft.priceType,
        unitScope: draft.unitScope,
        value: String(round2(draft.value)),
        currency: draft.currency,
        weightG: draft.weightG,
        piecesPerCase: draft.piecesPerCase,
        pricePerKg: normalization.price_per_kg === null ? null : String(normalization.price_per_kg),
        price357g: normalization.price_357g === null ? null : String(normalization.price_357g),
        pieceEquivalentAllowed: normalization.piece_equivalent_allowed,
        evidenceScore: evidence.score,
        evidenceBand: evidence.band,
        evidence,
        attribution: draft.attribution,
        quote: draft.quote,
        quoteTraceable: draft.quoteTraceable,
        note: draft.note,
        observedAt: draft.observedAt,
        publishedAt: draft.publishedAt,
        dedupKey: draft.dedupKey,
        sourceIds: draft.sourceIds,
        sourceCount: draft.sourceCount,
        createdBy: actorId
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "价格证据写入失败");
    }
    return row;
  }

  /**
   * 刷新已存在的引擎来源价格：重算证据分与等价价格。
   * 人工登记的条目默认在 rebuild 主循环里就被跳过（keep_manual 默认 true），
   * 走到这里的只有引擎自己写的条目；人工备注与排除标记在这条路径上也不改写。
   */
  private async applyDraftToExisting(existing: MarketOffer, draft: OfferDraft): Promise<MarketOffer> {
    const unitScope = existing.unitScope ?? draft.unitScope;
    const weightG = existing.weightG ?? draft.weightG;
    const evidence = this.evidenceForDraft(draft, {
      unit_scope: unitScope,
      weight_g: weightG,
      source_count: draft.sourceCount
    });
    const normalization = normalizePriceEquivalents({
      value: Number(existing.value),
      unit_scope: unitScope,
      weight_g: weightG
    });
    const updated = await this.db
      .update(marketOffers)
      .set({
        candidateId: draft.candidateId ?? existing.candidateId,
        sourceId: existing.sourceId ?? draft.sourceId,
        subjectName: draft.subjectName ?? existing.subjectName,
        subjectBrand: draft.subjectBrand ?? existing.subjectBrand,
        subjectYear: draft.subjectYear ?? existing.subjectYear,
        subjectSpec: draft.subjectSpec ?? existing.subjectSpec,
        identityKey: draft.identityKey ?? existing.identityKey,
        unitScope,
        weightG,
        pricePerKg: normalization.price_per_kg === null ? null : String(normalization.price_per_kg),
        price357g: normalization.price_357g === null ? null : String(normalization.price_357g),
        pieceEquivalentAllowed: normalization.piece_equivalent_allowed,
        evidenceScore: evidence.score,
        evidenceBand: evidence.band,
        evidence,
        attribution: draft.attribution,
        quoteTraceable: draft.quoteTraceable,
        note: draft.note ?? existing.note,
        observedAt: draft.observedAt ?? existing.observedAt,
        publishedAt: draft.publishedAt ?? existing.publishedAt,
        sourceIds: draft.sourceIds,
        sourceCount: draft.sourceCount,
        updatedAt: new Date()
      })
      .where(eq(marketOffers.id, existing.id))
      .returning();
    return updated[0] ?? existing;
  }

  private evidenceForDraft(
    draft: OfferDraft,
    override: { unit_scope?: PriceUnitScope | null; weight_g?: number | null; source_count?: number } = {}
  ): PriceEvidence {
    return scorePriceEvidence({
      price_type: draft.priceType,
      unit_scope: override.unit_scope === undefined ? draft.unitScope : override.unit_scope,
      identity: {
        name: draft.subjectName,
        brand_name: draft.subjectBrand,
        year: draft.subjectYear,
        weight_g: override.weight_g === undefined ? draft.weightG : override.weight_g,
        spec_notes: draft.subjectSpec
      },
      source_kind: this.sourceKindOfDraft(draft),
      domain: draft.domain,
      observed_at: draft.observedAt,
      published_at: draft.publishedAt,
      source_count: override.source_count ?? draft.sourceCount,
      quote_traceable: draft.quoteTraceable
    });
  }

  /** 来源类型只认白名单，避免脏数据把价格可信度抬高（未知按最低档给分）。 */
  private sourceKindOfDraft(draft: OfferDraft) {
    return sourceKindOrNull(draft.sourceKind);
  }

  private async refreshOutliers(productId: string): Promise<void> {
    const rows = await this.db.select().from(marketOffers).where(eq(marketOffers.productId, productId));
    await this.persistOutliers(rows);
  }

  /** 异常值落库：只标记，不删除；人工排除的条目不参与判定。 */
  private async persistOutliers(rows: readonly MarketOffer[]): Promise<{ outliers: number; groups: number }> {
    const counted = rows.filter(isCounted);
    if (counted.length === 0) {
      return { outliers: 0, groups: 0 };
    }
    const weights: Record<string, number | null> = {};
    for (const row of counted) {
      weights[row.id] = row.weightG;
    }
    const result = detectPriceOutliers(
      counted.map((row) => ({
        id: row.id,
        value: Number(row.value),
        price_type: priceTypeSchema.parse(row.priceType),
        unit_scope: row.unitScope,
        currency: row.currency
      })),
      weights
    );
    let outliers = 0;
    const groups = new Set<string>();
    for (const item of result) {
      if (item.is_outlier) {
        outliers += 1;
      }
      if (item.sample_size >= MARKET_OFFER_LIMITS.minOutlierSample) {
        groups.add(item.group_key);
      }
      await this.db
        .update(marketOffers)
        .set({
          isOutlier: item.is_outlier,
          outlierReason: item.reason,
          outlierMedian: item.median === null ? null : String(item.median),
          outlierSampleSize: item.sample_size,
          outlierGroupKey: item.group_key,
          updatedAt: new Date()
        })
        .where(eq(marketOffers.id, item.id));
    }
    return { outliers, groups: groups.size };
  }

  private async findByDedupKey(productId: string, dedupKey: string): Promise<MarketOffer | null> {
    const rows = await this.db
      .select()
      .from(marketOffers)
      .where(and(eq(marketOffers.productId, productId), eq(marketOffers.dedupKey, dedupKey)))
      .limit(1);
    return rows[0] ?? null;
  }

  private async findRow(
    productId: string,
    offerId: string
  ): Promise<{ row: MarketOffer; context: MarketOfferContext }> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select(offerSelection)
      .from(marketOffers)
      .innerJoin(products, eq(products.id, marketOffers.productId))
      .leftJoin(comparableCandidates, eq(comparableCandidates.id, marketOffers.candidateId))
      .leftJoin(sourcesTable, eq(sourcesTable.id, marketOffers.sourceId))
      .where(and(eq(marketOffers.id, offerId), eq(marketOffers.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("价格证据不存在");
    }
    return { row: row.offer, context: offerContext(row) };
  }

  private async assertCandidate(productId: string, candidateId: string): Promise<void> {
    const rows = await this.db
      .select({ id: comparableCandidates.id })
      .from(comparableCandidates)
      .where(
        and(eq(comparableCandidates.id, candidateId), eq(comparableCandidates.productId, productId))
      )
      .limit(1);
    if (!rows[0]) {
      throw AppError.validation("候选不存在或不属于该产品", { candidate_id: candidateId });
    }
  }

  /** 来源必须属于本产品：跨产品挂来源会把「多来源印证」变成假的。 */
  private async assertSource(productId: string, sourceId: string) {
    const rows = await this.db
      .select()
      .from(sourcesTable)
      .where(and(eq(sourcesTable.id, sourceId), eq(sourcesTable.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.validation("来源不存在或不属于该产品", { source_id: sourceId });
    }
    return row;
  }

  /** 单位 / 规格变化后重算去重键；真撞车时保留旧键，绝不覆盖别人的证据。 */
  private async rekeyIfFree(
    productId: string,
    row: MarketOffer,
    identityKey: string | null,
    unitScope: PriceUnitScope | null,
    weightG: number | null
  ): Promise<string> {
    const next = offerDedupKey({
      identityKey,
      sourceId: row.sourceId,
      priceType: priceTypeSchema.parse(row.priceType),
      unitScope,
      currency: row.currency,
      weightG,
      value: Number(row.value)
    });
    if (next === row.dedupKey) {
      return row.dedupKey;
    }
    const clash = await this.findByDedupKey(productId, next);
    return clash && clash.id !== row.id ? row.dedupKey : next;
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

const SOURCE_KIND_WHITELIST = new Set([
  "SEARCH_RESULT",
  "PRODUCT_PAGE",
  "PRICE_PAGE",
  "MARKETPLACE",
  "AUCTION_PAGE",
  "ARTICLE",
  "FORUM",
  "SOCIAL",
  "OTHER"
]);

function sourceKindOrNull(value: string | null | undefined) {
  return value && SOURCE_KIND_WHITELIST.has(value) ? (value as never) : null;
}

function offerSortOrder(sort: MarketOfferListQuery["sort"]) {
  switch (sort) {
    case "value":
      return [asc(marketOffers.value), desc(marketOffers.createdAt)];
    case "evidence":
      return [asc(marketOffers.evidenceScore), desc(marketOffers.createdAt)];
    case "-evidence":
      return [desc(marketOffers.evidenceScore), desc(marketOffers.createdAt)];
    case "created_at":
      return [asc(marketOffers.createdAt)];
    case "-created_at":
      return [desc(marketOffers.createdAt)];
    case "-value":
    default:
      return [desc(marketOffers.value), desc(marketOffers.createdAt)];
  }
}

/**
 * 价格列表 / 详情的统一查询列：价格行 + 产品名 + 候选名 + 来源三件套。
 * 三张表的读法只有这一份，避免各接口各写一套 join 导致视图字段不一致。
 */
const offerSelection = {
  offer: marketOffers,
  productName: products.productName,
  candidateName: comparableCandidates.name,
  sourceKind: sourcesTable.sourceKind,
  domain: sourcesTable.domain,
  url: sourcesTable.url
} as const;

function offerContext(row: {
  productName: string | null;
  candidateName: string | null;
  sourceKind: string | null;
  domain: string | null;
  url: string | null;
}): MarketOfferContext {
  return {
    productName: row.productName,
    candidateName: row.candidateName,
    sourceKind: row.sourceKind,
    domain: row.domain,
    url: row.url
  };
}

/**
 * 行 → API 视图：单位克重与等价价格按「没写就不算」的规则现算，不读缓存。
 * 出口一律过 `marketOfferSchema`（§62-11）：字段少了、类型飘了都当场报错，
 * 而不是把半成品形状丢给前端。
 */
export function serializeOffer(row: MarketOffer, context: MarketOfferContext): MarketOfferView {
  const evidence = row.evidence ?? null;
  return marketOfferSchema.parse({
    id: row.id,
    product_id: row.productId,
    product_name: context.productName,
    candidate_id: row.candidateId,
    candidate_name: context.candidateName,
    source_id: row.sourceId,
    source_kind: context.sourceKind,
    domain: context.domain,
    url: context.url,
    subject_name: row.subjectName,
    subject_brand: row.subjectBrand,
    subject_year: row.subjectYear,
    subject_spec: row.subjectSpec,
    identity_key: row.identityKey,
    price_type: priceTypeSchema.parse(row.priceType),
    unit_scope: row.unitScope,
    value: Number(row.value),
    currency: row.currency,
    weight_g: row.weightG,
    unit_grams: unitGramsOf(row.unitScope, row.weightG),
    pieces_per_case: row.piecesPerCase,
    price_per_kg: row.pricePerKg === null ? null : Number(row.pricePerKg),
    price_357g: row.price357g === null ? null : Number(row.price357g),
    piece_equivalent_allowed: row.pieceEquivalentAllowed,
    evidence_score: row.evidenceScore,
    evidence_band: priceEvidenceBandSchema.parse(row.evidenceBand),
    evidence:
      evidence ??
      scorePriceEvidence({
        price_type: priceTypeSchema.parse(row.priceType),
        unit_scope: row.unitScope,
        identity: { name: row.subjectName, brand_name: row.subjectBrand, year: row.subjectYear },
        source_kind: null,
        source_count: row.sourceCount,
        quote_traceable: false
      }),
    attribution: row.attribution,
    quote_traceable: row.quoteTraceable,
    quote: row.quote,
    note: row.note,
    manual_note: row.manualNote,
    observed_at: row.observedAt,
    published_at: row.publishedAt,
    is_outlier: row.isOutlier,
    outlier_reason: row.outlierReason,
    outlier_median: row.outlierMedian === null ? null : Number(row.outlierMedian),
    outlier_sample_size: row.outlierSampleSize,
    outlier_group_key: row.outlierGroupKey,
    is_excluded: row.isExcluded,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  });
}

/** 价格带（§14）：同类型 + 同单位分组的中位数，绝不跨类型混算。 */
function buildBuckets(rows: readonly MarketOffer[]): PriceTypeBucket[] {
  const groups = new Map<string, MarketOffer[]>();
  for (const row of rows) {
    const key = `${row.priceType}|${row.unitScope ?? "UNKNOWN"}`;
    const list = groups.get(key);
    if (list) {
      list.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  const buckets: PriceTypeBucket[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    if (!first) {
      continue;
    }
    buckets.push({
      price_type: priceTypeSchema.parse(first.priceType),
      unit_scope: first.unitScope,
      count: list.length,
      median_value: median(list.map((row) => Number(row.value))),
      median_price_per_kg: median(
        list
          .map((row) => (row.pricePerKg === null ? null : Number(row.pricePerKg)))
          .filter((value): value is number => value !== null)
      ),
      median_price_357g: median(
        list
          .map((row) => (row.price357g === null ? null : Number(row.price357g)))
          .filter((value): value is number => value !== null)
      ),
      strong_count: list.filter((row) => row.evidenceBand === "STRONG").length,
      outlier_count: list.filter((row) => row.isOutlier).length
    });
  }
  return buckets.sort((left, right) => right.count - left.count);
}

/**
 * 价格水平基准：优先成交 → 拍卖 → 官方 → 挂牌 → 历史参考。
 * 没有写明规格重量时 median_price_per_kg 为 null，绝不用别处的规格倒算。
 */
function pickPriceLevel(rows: readonly MarketOffer[]): PriceSummary["price_level"] {
  const usable = rows.filter((row) => !row.isOutlier);
  for (const basis of BASIS_PRIORITY) {
    const list = usable.filter((row) => row.priceType === basis);
    if (list.length === 0) {
      continue;
    }
    return {
      basis,
      currency: list[0]?.currency ?? "CNY",
      sample_size: list.length,
      median_price_per_kg: median(
        list
          .map((row) => (row.pricePerKg === null ? null : Number(row.pricePerKg)))
          .filter((value): value is number => value !== null)
      ),
      median_price_357g: median(
        list
          .map((row) => (row.price357g === null ? null : Number(row.price357g)))
          .filter((value): value is number => value !== null)
      )
    };
  }
  return {
    basis: "NONE",
    currency: "CNY",
    sample_size: 0,
    median_price_per_kg: null,
    median_price_357g: null
  };
}

/** 供 API 自检：价格引擎的四条红线与五项权重（前端直接展示这份合同）。 */
export const MARKET_PRICE_ENGINE_INFO = {
  spec_ref: "§14 / §15 / §16.1",
  price_in_similarity: false,
  case_piece_equivalent_allowed: false,
  min_reliable_evidence: ANCHOR_REQUIREMENTS.minPriceEvidence,
  limits: MARKET_OFFER_LIMITS,
  basis_priority: BASIS_PRIORITY,
  /** 缺规格重量时一律不换算：没有写 = 不计算 */
  requires_weight_for_equivalence: true,
  note: "价格证据只描述来源写了什么；成交价与挂牌价分开统计，异常值只标记不删除"
} as const;
