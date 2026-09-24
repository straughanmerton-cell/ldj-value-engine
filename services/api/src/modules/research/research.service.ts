import { and, desc, eq } from "drizzle-orm";
import type { SearchProvider } from "@ldj/search";
import type { Database, ResearchJob } from "@ldj/database";
import { researchJobs, sources as sourcesTable } from "@ldj/database";
import {
  DELIVERED_PHASES,
  emptyResearchProgress,
  researchJobStatusSchema,
  researchProgressSummary,
  researchProgressView,
  researchStages,
  SOURCE_LIMITS,
  searchPlanQueries,
  RESEARCH_MODE_STAGE_NOTES,
  VALUE_DNA_DIMENSIONS,
  type ResearchProgress,
  type ResearchProgressView,
  type ResearchRunRequest,
  type ResearchStage,
  type ResearchStageProgress,
  type ResearchJobStatus
} from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import { assertProductExists } from "../product-records/product-guard.js";
import { buildValueDna, buildValueDnaMeta, loadValueDnaSources, saveValueDna } from "../../lib/value-dna.js";
import type { SearchPlanService } from "./search-plan.service.js";
import type { SourceService } from "./source.service.js";
import type { CrawlerService } from "./crawler.service.js";
import type { CandidatesService } from "../candidates/candidates.service.js";
import type { MarketPricesService } from "../prices/market-prices.service.js";
import { MARKET_PRICE_ENGINE_INFO } from "../prices/market-prices.service.js";
import type { AnchorsService } from "../anchors/anchors.service.js";

export interface ResearchJobApiShape {
  id: string;
  product_id: string;
  status: ResearchJobStatus;
  current_stage: ResearchStage | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  summary: Record<string, unknown> | null;
  progress: ResearchProgressView[];
  progress_summary: ReturnType<typeof researchProgressSummary>;
  implemented_phases: readonly number[];
  mode_notes: typeof RESEARCH_MODE_STAGE_NOTES;
  spec_ref: "§55 / §56";
}

export interface ResearchRunResponse extends ResearchJobApiShape {
  stages_run: ResearchStage[];
  sources_created: number;
  sources_fetched: number;
  extractions: number;
  candidates_created: number;
  candidates_updated: number;
  candidates_total: number;
  candidates_below_min_score: number;
  candidate_band_counts: Record<string, number>;
  price_offers_total: number;
  price_offers_created: number;
  price_offers_updated: number;
  price_offers_kept_manual: number;
  price_evidence_band_counts: Record<string, number>;
  price_outliers: number;
  price_reliable: number;
  price_level: string;
  anchor_mode: string;
  anchor_count: number;
  anchor_types: Record<string, number>;
}

/**
 * 研究流水线编排（规格 §55 / §56）。
 *
 * 目前执行到 ANCHOR_BUILD：事实归一、Value DNA、搜索策略、全网候选搜索、
 * 来源抓取、网页事实抽取、候选池去重、可比性评分、价格证据与异常值检测、锚点构建。
 * 后续阶段在进度数组里保持 PENDING，并由 researchProgressView 标出
 * 「未交付 Phase」，绝不提前显示成已完成。
 */
export class ResearchService {
  constructor(
    private readonly db: Database,
    private readonly search: SearchProvider,
    private readonly searchPlans: SearchPlanService,
    private readonly sources: SourceService,
    private readonly crawler: CrawlerService,
    private readonly candidates: CandidatesService,
    private readonly prices: MarketPricesService,
    private readonly anchors: AnchorsService
  ) {}

  async listJobs(productId: string, limit = 20): Promise<ResearchJobApiShape[]> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.productId, productId))
      .orderBy(desc(researchJobs.createdAt))
      .limit(limit);
    return rows.map((row) => this.toShape(row));
  }

  async getJob(productId: string, jobId: string): Promise<ResearchJobApiShape> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(researchJobs)
      .where(and(eq(researchJobs.id, jobId), eq(researchJobs.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("研究任务不存在");
    }
    return this.toShape(row);
  }

  /** 最新一次研究任务；从未跑过时返回空进度，前端据此显示「尚未开始研究」。 */
  async getProgress(productId: string): Promise<{
    job: ResearchJobApiShape | null;
    progress: ResearchProgressView[];
    latest: boolean;
  }> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.productId, productId))
      .orderBy(desc(researchJobs.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        job: null,
        progress: researchProgressView(emptyResearchProgress(), DELIVERED_PHASES),
        latest: false
      };
    }
    return { job: this.toShape(row), progress: researchProgressView(row.progress, DELIVERED_PHASES), latest: true };
  }

  async run(
    productId: string,
    input: ResearchRunRequest,
    actorId: string
  ): Promise<ResearchRunResponse> {
    await assertProductExists(this.db, productId);
    const maxQueries = input.max_queries ?? SOURCE_LIMITS.defaultMaxQueriesPerRun;
    const maxResults = input.max_results_per_query ?? SOURCE_LIMITS.defaultMaxResultsPerQuery;
    const maxSources = input.max_sources ?? 8;
    const autoExtract = input.auto_extract ?? true;

    const inserted = await this.db
      .insert(researchJobs)
      .values({
        productId,
        status: "RUNNING",
        currentStage: null,
        progress: emptyResearchProgress(),
        summary: {
          max_queries: maxQueries,
          max_results_per_query: maxResults,
          max_sources: maxSources,
          auto_extract: autoExtract,
          regenerate_plan: input.regenerate_plan ?? false,
          search_provider: this.search.name
        },
        createdBy: actorId
      })
      .returning();
    const job = inserted[0];
    if (!job) {
      throw new AppError("INTERNAL_ERROR", "研究任务创建失败");
    }

    const run = new ProgressTracker(this.db, job.id);
    const stagesRun: ResearchStage[] = [];
    const summary: Record<string, unknown> = { ...(job.summary ?? {}) };
    let sourcesCreated = 0;
    let sourcesFetched = 0;
    let extractions = 0;
    let fatalError: string | null = null;

    // 1) 事实归一 + Value DNA（§39 / §9）
    try {
      const dnaSources = await loadValueDnaSources(this.db, productId);
      const built = buildValueDna(dnaSources);
      const dnaExists = Boolean(dnaSources.product.valueDna);
      if (!dnaExists) {
        const meta = buildValueDnaMeta(built, dnaSources.counts, { generator: "RULE_BASED", version: 1 });
        await saveValueDna(this.db, productId, built.dna, meta);
      }
      stagesRun.push("FACT_NORMALIZE");
      await run.complete("FACT_NORMALIZE", "按录入内容整理产品事实，未提供的字段保持缺失", {
        facts: dnaSources.facts.length,
        tasting_profiles: dnaSources.tastingProfiles.length,
        rnd_references: dnaSources.rndReferences.length
      });
      stagesRun.push("VALUE_DNA");
      await run.complete(
        "VALUE_DNA",
        dnaExists ? "复用已有 Value DNA" : "已生成规则引擎版 Value DNA",
        { missing_dimensions: built.missingDimensions.length, dimensions: VALUE_DNA_DIMENSIONS.length }
      );
    } catch (error) {
      fatalError = error instanceof Error ? error.message : String(error);
      await run.fail("FACT_NORMALIZE", fatalError);
    }

    // 2) 搜索策略（§12 / §40）
    if (!fatalError) {
      try {
        const plan = await this.searchPlans.generate(
          productId,
          { use_ai: input.use_ai, max_per_type: 12 },
          actorId
        );
        summary.query_count = plan.query_count;
        summary.plan_generator = plan.generator;
        summary.plan_dropped = plan.dropped.length;
        stagesRun.push("SEARCH_PLAN");
        await run.complete(
          "SEARCH_PLAN",
          `搜索策略就绪：${plan.query_count} 条查询（${plan.generator}）`,
          {
            query_count: plan.query_count,
            generator: plan.generator,
            dropped: plan.dropped.length,
            counts_by_type: plan.counts_by_type
          }
        );
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        await run.fail("SEARCH_PLAN", fatalError);
      }
    }

    // 3) 全网候选搜索（§12）：搜索必须走真实检索，禁止用模型记忆替代（§62-1）
    if (!fatalError) {
      try {
        const planResponse = await this.searchPlans.get(productId);
        const queries = searchPlanQueries(planResponse.plan).slice(0, maxQueries);
        stagesRun.push("WEB_SEARCH");
        await run.start("WEB_SEARCH", `执行 ${queries.length} 条搜索查询`);
        let results = 0;
        let failedQueries = 0;
        for (const { query_type, query } of queries) {
          try {
            const hits = await this.search.search({ query, maxResults });
            results += hits.length;
            for (const hit of hits) {
              const registered = await this.sources.register(productId, {
                url: hit.url,
                title: hit.title,
                snippet: hit.snippet,
                publishedAt: hit.publishedAt ?? null,
                query,
                queryType: query_type,
                stage: "WEB_SEARCH",
                actorId
              });
              if (registered.created) {
                sourcesCreated += 1;
              }
            }
          } catch {
            failedQueries += 1;
          }
        }
        summary.search_results = results;
        summary.queries_run = queries.length;
        summary.search_failed_queries = failedQueries;
        await run.complete(
          "WEB_SEARCH",
          `${queries.length} 条查询 · ${results} 条结果 · 新增来源 ${sourcesCreated}`,
          { queries: queries.length, results, sources_created: sourcesCreated, failed_queries: failedQueries }
        );
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        await run.fail("WEB_SEARCH", fatalError);
      }
    }

    // 4) 来源抓取（§41）
    let fetchedIds: string[] = [];
    if (!fatalError && maxSources > 0) {
      try {
        stagesRun.push("SOURCE_FETCH");
        await run.start("SOURCE_FETCH", `最多抓取 ${maxSources} 条来源`);
        const pending = await this.db
          .select()
          .from(sourcesTable)
          .where(and(eq(sourcesTable.productId, productId), eq(sourcesTable.fetchStatus, "PENDING")))
          .orderBy(desc(sourcesTable.createdAt))
          .limit(maxSources);
        let failed = 0;
        for (const row of pending) {
          try {
            const fetched = await this.sources.fetch(productId, row.id, {});
            if (fetched.has_content) {
              sourcesFetched += 1;
              fetchedIds.push(row.id);
            } else {
              failed += 1;
            }
          } catch {
            failed += 1;
          }
        }
        summary.sources_considered = pending.length;
        summary.sources_fetched = sourcesFetched;
        summary.sources_failed = failed;
        await run.complete(
          "SOURCE_FETCH",
          `抓取 ${pending.length} 条 · 成功 ${sourcesFetched} · 失败 ${failed}`,
          { considered: pending.length, fetched: sourcesFetched, failed }
        );
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        await run.fail("SOURCE_FETCH", fatalError);
      }
    } else if (maxSources === 0) {
      await run.skipStage("SOURCE_FETCH", "本轮设置 max_sources=0，跳过抓取");
      await run.skipStage("ENTITY_EXTRACT", "没有抓取正文，跳过网页抽取");
      await run.skipStage("CANDIDATE_POOL", "没有抽取结果，跳过候选池归并");
      await run.skipStage("SIMILARITY_SCORE", "没有候选，跳过可比性评分");
      await run.skipStage("PRICE_SEARCH", "没有抽取结果，跳过价格证据提取");
      await run.skipStage("PRICE_EVIDENCE", "没有价格证据，跳过价格证据评分");
      await run.skipStage("OUTLIER_DETECTION", "没有价格证据，跳过异常值检测");
      await run.skipStage("ANCHOR_BUILD", "没有候选与价格证据，跳过锚点构建");
    }

    // 5) 网页事实抽取（§41 Agent 3）
    if (!fatalError && maxSources > 0) {
      try {
        stagesRun.push("ENTITY_EXTRACT");
        await run.start("ENTITY_EXTRACT", autoExtract ? "对抓取成功的来源运行 Agent 3" : "按参数跳过 AI 抽取");
        let prices = 0;
        let facts = 0;
        let withContent = 0;
        if (autoExtract) {
          for (const sourceId of fetchedIds) {
            try {
              const extraction = await this.sources.extract(
                productId,
                sourceId,
                { use_ai: input.use_ai },
                { id: actorId }
              );
              extractions += 1;
              prices += extraction.price_count;
              facts += extraction.extraction.facts.length;
              if (extraction.has_content) {
                withContent += 1;
              }
            } catch {
              // 单条抽取失败不影响整体进度：来源已在列表中保留失败原因
            }
          }
        }
        summary.extractions = extractions;
        summary.extracted_prices = prices;
        summary.extracted_facts = facts;
        await run.complete(
          "ENTITY_EXTRACT",
          `${extractions} 条来源抽取完成 · 价格证据 ${prices} · 事实 ${facts}`,
          { extractions, prices, facts, with_content: withContent }
        );
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        await run.fail("ENTITY_EXTRACT", fatalError);
      }
    }

    // 6) 候选池去重（§36 / §54 comparable_candidates）
    let candidatesCreated = 0;
    let candidatesUpdated = 0;
    let candidatesTotal = 0;
    let candidatesBelowMinScore = 0;
    let candidateBandCounts: Record<string, number> = {};
    if (!fatalError && maxSources > 0) {
      try {
        stagesRun.push("CANDIDATE_POOL");
        await run.start("CANDIDATE_POOL", "按 品牌|名称|年份|规格 归并候选，同一款茶只留一条");
        const rebuilt = await this.candidates.rebuild(productId, { keep_reviewed: true }, actorId);
        candidatesCreated = rebuilt.created;
        candidatesUpdated = rebuilt.updated;
        candidatesTotal = rebuilt.total;
        candidatesBelowMinScore = rebuilt.below_min_score;
        candidateBandCounts = { ...rebuilt.band_counts };
        summary.candidates_total = rebuilt.total;
        summary.candidates_created = rebuilt.created;
        summary.candidates_updated = rebuilt.updated;
        summary.candidates_kept_reviewed = rebuilt.kept_reviewed;
        summary.candidates_below_min_score = rebuilt.below_min_score;
        summary.candidates_skipped_no_name = rebuilt.stats.skipped_no_name;
        await run.complete(
          "CANDIDATE_POOL",
          `${rebuilt.stats.sources_considered} 条抽取结果 → ${rebuilt.stats.drafts} 条候选（新增 ${rebuilt.created} · 合并更新 ${rebuilt.updated}）`,
          {
            sources_considered: rebuilt.stats.sources_considered,
            skipped_no_name: rebuilt.stats.skipped_no_name,
            drafts: rebuilt.stats.drafts,
            created: rebuilt.created,
            updated: rebuilt.updated
          }
        );
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        await run.fail("CANDIDATE_POOL", fatalError);
      }
    }

    // 7) 可比性评分（§13）：十维加权，价格不参与
    if (!fatalError && maxSources > 0) {
      try {
        stagesRun.push("SIMILARITY_SCORE");
        await run.start("SIMILARITY_SCORE", "按 §13 十个维度加权评分（价格不参与）");
        const core = candidateBandCounts["CORE_COMPARABLE"] ?? 0;
        const valid = candidateBandCounts["VALID_COMPARABLE"] ?? 0;
        const peripheral = candidateBandCounts["PERIPHERAL_REFERENCE"] ?? 0;
        const rejected = candidateBandCounts["REJECT"] ?? 0;
        await run.complete(
          "SIMILARITY_SCORE",
          `候选 ${candidatesTotal} 条 · 核心对标 ${core} · 有效对标 ${valid} · 外围参考 ${peripheral} · 拒绝 ${rejected}`,
          {
            total: candidatesTotal,
            band_counts: candidateBandCounts,
            below_min_score: candidatesBelowMinScore,
            price_in_similarity: false,
            spec_ref: "§13"
          }
        );
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        await run.fail("SIMILARITY_SCORE", fatalError);
      }
    }

    // 8) 价格证据提取（§14）：只吃已抓取来源的抽取结果，不额外联网、不推断价格
    let priceOffersTotal = 0;
    let priceOffersCreated = 0;
    let priceOffersUpdated = 0;
    let priceOffersKeptManual = 0;
    let priceBandCounts: Record<string, number> = {};
    let priceOutliers = 0;
    let priceReliable = 0;
    let priceLevel = "NONE";
    let anchorMode = "CATEGORY_CREATOR";
    let anchorCount = 0;
    let anchorTypes: Record<string, number> = {};
    if (!fatalError && maxSources > 0) {
      try {
        stagesRun.push("PRICE_SEARCH");
        await run.start("PRICE_SEARCH", "从已抽取来源中取出价格原话（挂牌 / 成交分别记账）");
        const rebuilt = await this.prices.rebuild(productId, { keep_manual: true }, actorId);
        priceOffersTotal = rebuilt.total;
        priceOffersCreated = rebuilt.created;
        priceOffersUpdated = rebuilt.updated;
        priceOffersKeptManual = rebuilt.kept_manual;
        priceBandCounts = { ...rebuilt.band_counts };
        priceOutliers = rebuilt.outliers;
        priceReliable = rebuilt.summary.reliable_count;
        priceLevel = rebuilt.summary.price_level.basis;
        summary.price_offers_total = rebuilt.total;
        summary.price_offers_created = rebuilt.created;
        summary.price_offers_updated = rebuilt.updated;
        summary.price_offers_kept_manual = rebuilt.kept_manual;
        summary.price_offers_sources = rebuilt.stats.sources_considered;
        summary.price_offers_prices = rebuilt.stats.prices_considered;
        summary.price_offers_merged = rebuilt.stats.merged_multi_source;
        summary.price_offers_unattributed = rebuilt.stats.unattributed;
        summary.price_offers_skipped_limit = rebuilt.stats.skipped_limit;
        await run.complete(
          "PRICE_SEARCH",
          `${rebuilt.stats.sources_considered} 条抽取结果 · ${rebuilt.stats.prices_considered} 条价格原话 → ${rebuilt.total} 条价格证据（新增 ${rebuilt.created} · 更新 ${rebuilt.updated} · 保留人工 ${rebuilt.kept_manual}）`,
          {
            sources_considered: rebuilt.stats.sources_considered,
            prices_considered: rebuilt.stats.prices_considered,
            offers: rebuilt.total,
            created: rebuilt.created,
            updated: rebuilt.updated,
            kept_manual: rebuilt.kept_manual,
            merged_multi_source: rebuilt.stats.merged_multi_source,
            unattributed: rebuilt.stats.unattributed,
            reached_limit: rebuilt.reached_limit,
            spec_ref: "§14"
          }
        );

        stagesRun.push("PRICE_EVIDENCE");
        await run.start("PRICE_EVIDENCE", "按 §15 五项加权给每条价格证据打分并分档");
        await run.complete(
          "PRICE_EVIDENCE",
          `强证据 ${rebuilt.band_counts.STRONG} · 可用 ${rebuilt.band_counts.USABLE} · 弱证据 ${rebuilt.band_counts.WEAK} · 可靠价格锚点 ${rebuilt.summary.reliable_count} 条`,
          {
            band_counts: rebuilt.band_counts,
            reliable_count: rebuilt.summary.reliable_count,
            counted_offers: rebuilt.summary.counted_offers,
            excluded_offers: rebuilt.summary.excluded_count,
            transaction_offers: rebuilt.summary.transaction_count,
            listing_offers: rebuilt.summary.listing_count,
            min_reliable_evidence: MARKET_PRICE_ENGINE_INFO.min_reliable_evidence,
            price_in_similarity: MARKET_PRICE_ENGINE_INFO.price_in_similarity,
            spec_ref: "§15 / §16.1"
          }
        );

        stagesRun.push("OUTLIER_DETECTION");
        await run.start("OUTLIER_DETECTION", "同类型 + 同单位 + 同币种 + 同规格分组做异常值检测");
        await run.complete(
          "OUTLIER_DETECTION",
          `${rebuilt.outlier_groups} 组可比样本 · ${rebuilt.outliers} 条异常值（只标记，不删除）`,
          {
            outlier_groups: rebuilt.outlier_groups,
            outliers: rebuilt.outliers,
            min_sample: MARKET_PRICE_ENGINE_INFO.limits.minOutlierSample,
            spec_ref: "§14 / §55"
          }
        );

        // 9) 锚点构建（§16 / §17 / §55）：判定「对标」还是「自建标准」
        stagesRun.push("ANCHOR_BUILD");
        await run.start("ANCHOR_BUILD", "按 §16 三种锚点判定该产品能否进入高价值对标模式");
        const anchorResult = await this.anchors.rebuild(productId, { keep_manual: true }, actorId);
        anchorMode = anchorResult.mode;
        anchorCount = anchorResult.total;
        anchorTypes = { ...anchorResult.anchor_types };
        summary.anchor_mode = anchorResult.mode;
        summary.anchor_total = anchorResult.total;
        summary.anchor_created = anchorResult.created;
        summary.anchor_removed = anchorResult.removed;
        summary.anchor_kept_manual = anchorResult.kept_manual;
        summary.anchor_types = anchorResult.anchor_types;
        summary.anchor_resolved_by = anchorResult.resolved_by;
        summary.anchor_reason = anchorResult.reason;
        summary.anchor_stats = anchorResult.stats;
        await run.complete(
          "ANCHOR_BUILD",
          anchorResult.mode === "BENCHMARK"
            ? `✓ 进入高价值对标模式（Benchmark Mode）· 锚点 ${anchorResult.total} 条`
            : `✓ 切换自建高端标准模式（Category Creator Mode）· ${anchorResult.reason}`,
          {
            mode: anchorResult.mode,
            resolved_by: anchorResult.resolved_by,
            anchor_types: anchorResult.anchor_types,
            stats: anchorResult.stats,
            min_similarity: 70,
            min_price_evidence: 75,
            excludes_source_unattributed: true,
            spec_ref: "§16 / §17 / §55"
          }
        );
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        await run.fail("PRICE_SEARCH", fatalError);
      }
    }

    // 11) 收口：本轮跑到 ANCHOR_BUILD，其余阶段保持 PENDING（§55 / §56）
    const finalSummary = { ...summary, stages_run: stagesRun };
    const status: ResearchJobStatus = fatalError ? "FAILED" : "SUCCEEDED";
    const updated = await this.db
      .update(researchJobs)
      .set({
        status,
        currentStage: null,
        summary: finalSummary,
        error: fatalError,
        finishedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(researchJobs.id, job.id))
      .returning();
    const finalRow = updated[0] ?? job;

    return {
      ...this.toShape(finalRow),
      stages_run: stagesRun,
      sources_created: sourcesCreated,
      sources_fetched: sourcesFetched,
      extractions,
      candidates_created: candidatesCreated,
      candidates_updated: candidatesUpdated,
      candidates_total: candidatesTotal,
      candidates_below_min_score: candidatesBelowMinScore,
      candidate_band_counts: candidateBandCounts,
      price_offers_total: priceOffersTotal,
      price_offers_created: priceOffersCreated,
      price_offers_updated: priceOffersUpdated,
      price_offers_kept_manual: priceOffersKeptManual,
      price_evidence_band_counts: priceBandCounts,
      price_outliers: priceOutliers,
      price_reliable: priceReliable,
      price_level: priceLevel,
      anchor_mode: anchorMode,
      anchor_count: anchorCount,
      anchor_types: anchorTypes
    };
  }

  private toShape(row: ResearchJob): ResearchJobApiShape {
    const schema = researchJobStatusSchema.safeParse(row.status);
    const status: ResearchJobStatus = schema.success ? schema.data : "PENDING";
    return {
      id: row.id,
      product_id: row.productId,
      status,
      current_stage: row.currentStage,
      started_at: row.startedAt.toISOString(),
      finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
      error: row.error,
      summary: row.summary,
      progress: researchProgressView(row.progress, DELIVERED_PHASES),
      progress_summary: researchProgressSummary(row.progress),
      implemented_phases: DELIVERED_PHASES,
      mode_notes: RESEARCH_MODE_STAGE_NOTES,
      spec_ref: "§55 / §56"
    };
  }
}

/** 进度写入器：每次阶段状态变化都立刻落库，进度 UI 刷新即可看到最新状态。 */
class ProgressTracker {
  private progress: ResearchProgress;

  constructor(
    private readonly db: Database,
    private readonly jobId: string
  ) {
    this.progress = emptyResearchProgress();
  }

  async start(stage: ResearchStage, message?: string): Promise<void> {
    await this.update(stage, { status: "RUNNING", message: message ?? null, started_at: new Date().toISOString() });
  }

  async complete(stage: ResearchStage, message: string, detail?: Record<string, unknown>): Promise<void> {
    await this.update(stage, {
      status: "SUCCEEDED",
      message,
      detail: detail ?? null,
      finished_at: new Date().toISOString()
    });
  }

  async fail(stage: ResearchStage, message: string): Promise<void> {
    await this.update(stage, {
      status: "FAILED",
      message,
      finished_at: new Date().toISOString()
    });
  }

  async skipStage(stage: ResearchStage, message: string): Promise<void> {
    await this.update(stage, {
      status: "SKIPPED",
      message,
      finished_at: new Date().toISOString()
    });
  }

  private async update(stage: ResearchStage, patch: Partial<ResearchStageProgress>): Promise<void> {
    this.progress = this.progress.map((item) =>
      item.stage === stage ? { ...item, ...patch } : item
    );
    const running = this.progress.find((item) => item.status === "RUNNING") ?? null;
    await this.db
      .update(researchJobs)
      .set({
        progress: this.progress,
        currentStage: running?.stage ?? null,
        updatedAt: new Date()
      })
      .where(eq(researchJobs.id, this.jobId));
  }
}

/** 供 API 自检：§55 的 22 个阶段与 §60 的分期顺序均已登记。 */
export const RESEARCH_PIPELINE_STAGE_COUNT = researchStages.length;
