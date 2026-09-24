import { and, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { AiProvider } from "@ldj/ai";
import type { Database, NewSource, Source, SourceExtraction } from "@ldj/database";
import { sourceExtractions, sources } from "@ldj/database";
import {
  canonicalizeUrl,
  classifySourceKind,
  emptyWebExtraction,
  ruleBasedWebExtraction,
  sanitizeWebExtraction,
  sourceDomainOf,
  SOURCE_LIMITS,
  webExtractionAiOutputSchema,
  type CreateSourceInput,
  type SourceExtractRequest,
  type SourceExtractionStatus,
  type SourceKind,
  type SourceListQuery,
  type WebExtractionAiOutput
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { assertProductExists } from "../product-records/product-guard.js";
import type { ActivePromptSource } from "../prompts/service.js";
import type { CrawlerService } from "./crawler.service.js";

export interface ResearchActor {
  id: string;
}

export interface SourceApiShape {
  id: string;
  product_id: string;
  url: string;
  canonical_url: string;
  domain: string;
  title: string | null;
  snippet: string | null;
  source_kind: SourceKind;
  published_at: string | null;
  note: string | null;
  query: string | null;
  query_type: string | null;
  stage: string | null;
  fetch_status: Source["fetchStatus"];
  http_status: number | null;
  fetch_error: string | null;
  content_chars: number | null;
  /** 列表接口不返回 60k 正文，只给出是否存在与预览，避免一次拉爆。 */
  has_content: boolean;
  content_preview: string | null;
  extraction_status: SourceExtractionStatus;
  extracted_at: string | null;
  price_count: number;
  fact_count: number;
  created_at: string;
  updated_at: string;
}

export interface SourceDetailShape extends SourceApiShape {
  content_text: string | null;
}

export interface SourceExtractionApiShape {
  id: string;
  source_id: string;
  product_id: string;
  has_content: boolean;
  extraction: WebExtractionAiOutput;
  dropped: unknown[];
  warnings: string[];
  price_count: number;
  price_type_counts: Record<string, number>;
  prompt_key: string;
  prompt_version: number | null;
  provider: string | null;
  model: string | null;
  created_at: string;
}

export interface RegisterSourceResult {
  source: SourceApiShape;
  created: boolean;
}

function preview(text: string | null): string | null {
  if (!text) {
    return null;
  }
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function extractionCounts(source: Source): { price: number; fact: number } {
  const output = source.lastExtraction;
  return {
    price: output?.prices.length ?? 0,
    fact: output?.facts.length ?? 0
  };
}

export function serializeSource(source: Source): SourceApiShape {
  const counts = extractionCounts(source);
  return {
    id: source.id,
    product_id: source.productId,
    url: source.url,
    canonical_url: source.canonicalUrl,
    domain: source.domain,
    title: source.title,
    snippet: source.snippet,
    source_kind: source.sourceKind,
    published_at: source.publishedAt,
    note: source.note,
    query: source.query,
    query_type: source.queryType,
    stage: source.stage,
    fetch_status: source.fetchStatus,
    http_status: source.httpStatus,
    fetch_error: source.fetchError,
    content_chars: source.contentChars,
    has_content: Boolean(source.contentText && source.contentText.length > 0),
    content_preview: preview(source.contentText),
    extraction_status: source.extractionStatus,
    extracted_at: source.extractedAt ? source.extractedAt.toISOString() : null,
    price_count: counts.price,
    fact_count: counts.fact,
    created_at: source.createdAt.toISOString(),
    updated_at: source.updatedAt.toISOString()
  };
}

export function serializeSourceDetail(source: Source): SourceDetailShape {
  return { ...serializeSource(source), content_text: source.contentText };
}

export function serializeSourceExtraction(row: SourceExtraction): SourceExtractionApiShape {
  return {
    id: row.id,
    source_id: row.sourceId,
    product_id: row.productId,
    has_content: row.hasContent,
    extraction: row.extraction,
    dropped: row.dropped ?? [],
    warnings: row.warnings ?? [],
    price_count: row.priceCount,
    price_type_counts: row.priceTypeCounts ?? {},
    prompt_key: row.promptKey,
    prompt_version: row.promptVersion,
    provider: row.provider,
    model: row.model,
    created_at: row.createdAt.toISOString()
  };
}

/**
 * 来源服务（规格 §11 / §41 / §54）。
 *
 * 一条来源只登记一次：同一个规范化 URL 重复出现时只刷新搜索命中信息，
 * 不产生第二条记录——来源数量直接决定证据可信度，重复登记等于伪造证据密度。
 */
export class SourceService {
  constructor(
    private readonly db: Database,
    private readonly ai: AiProvider,
    private readonly prompts: ActivePromptSource,
    private readonly crawler: CrawlerService
  ) {}

  async list(productId: string, query: SourceListQuery): Promise<Paginated<SourceApiShape>> {
    await assertProductExists(this.db, productId);
    const filters: SQL[] = [eq(sources.productId, productId)];
    if (query.source_kind) {
      filters.push(eq(sources.sourceKind, query.source_kind));
    }
    if (query.fetch_status) {
      filters.push(eq(sources.fetchStatus, query.fetch_status));
    }
    if (query.extraction_status) {
      filters.push(eq(sources.extractionStatus, query.extraction_status));
    }
    if (query.keyword) {
      const pattern = `%${query.keyword}%`;
      const condition = or(ilike(sources.title, pattern), ilike(sources.url, pattern));
      if (condition) {
        filters.push(condition);
      }
    }
    const where = and(...filters);

    const pagination = normalizePagination({
      page: 1,
      pageSize: query.limit ?? SOURCE_LIMITS.defaultMaxResultsPerQuery * 10
    });
    const rows = await this.db
      .select()
      .from(sources)
      .where(where)
      .orderBy(desc(sources.createdAt))
      .limit(pagination.pageSize);
    const totalRows = await this.db.select({ value: count() }).from(sources).where(where);

    return buildPage(
      rows.map(serializeSource),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  async getById(productId: string, sourceId: string): Promise<SourceDetailShape> {
    return serializeSourceDetail(await this.findRow(productId, sourceId));
  }

  async listExtractions(productId: string, sourceId: string): Promise<SourceExtractionApiShape[]> {
    await this.findRow(productId, sourceId);
    const rows = await this.db
      .select()
      .from(sourceExtractions)
      .where(eq(sourceExtractions.sourceId, sourceId))
      .orderBy(desc(sourceExtractions.createdAt));
    return rows.map(serializeSourceExtraction);
  }

  /** 手工登记来源（规格 §41）：人工贴入的链接同样要走规范化与分类。 */
  async create(
    productId: string,
    input: CreateSourceInput,
    actor: ResearchActor
  ): Promise<RegisterSourceResult> {
    return this.register(productId, {
      url: input.url,
      title: input.title ?? null,
      snippet: input.snippet ?? null,
      sourceKind: input.source_kind ?? null,
      publishedAt: input.published_at ?? null,
      note: input.note ?? null,
      query: null,
      queryType: null,
      stage: null,
      actorId: actor.id
    });
  }

  /**
   * 登记（或复用）一条来源。搜索结果、抓取结果与人工登记都走这里，
   * 保证同一规范化 URL 在同产品下永远只有一条记录。
   */
  async register(
    productId: string,
    input: {
      url: string;
      title?: string | null;
      snippet?: string | null;
      sourceKind?: SourceKind | null;
      publishedAt?: string | null;
      note?: string | null;
      query?: string | null;
      queryType?: string | null;
      stage?: string | null;
      actorId: string | null;
    }
  ): Promise<RegisterSourceResult> {
    await assertProductExists(this.db, productId);
    const canonicalUrl = canonicalizeUrl(input.url);
    const existing = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.productId, productId), eq(sources.canonicalUrl, canonicalUrl)))
      .limit(1);
    if (existing[0]) {
      const updated = await this.db
        .update(sources)
        .set({
          title: existing[0].title ?? input.title ?? null,
          snippet: existing[0].snippet ?? input.snippet ?? null,
          query: existing[0].query ?? input.query ?? null,
          queryType: existing[0].queryType ?? input.queryType ?? null,
          updatedAt: new Date()
        })
        .where(eq(sources.id, existing[0].id))
        .returning();
      return { source: serializeSource(updated[0] ?? existing[0]), created: false };
    }

    const totalRows = await this.db
      .select({ value: count() })
      .from(sources)
      .where(eq(sources.productId, productId));
    if (Number(totalRows[0]?.value ?? 0) >= SOURCE_LIMITS.maxSourcesPerProduct) {
      throw AppError.validation(
        `单个产品最多登记 ${SOURCE_LIMITS.maxSourcesPerProduct} 条来源，已达到上限`,
        { limit: SOURCE_LIMITS.maxSourcesPerProduct }
      );
    }

    const values: NewSource = {
      productId,
      url: input.url,
      canonicalUrl,
      domain: sourceDomainOf(input.url),
      title: input.title ?? null,
      snippet: input.snippet ?? null,
      sourceKind:
        input.sourceKind ?? classifySourceKind(input.url, input.title ?? input.snippet ?? null),
      publishedAt: input.publishedAt ?? null,
      note: input.note ?? null,
      query: input.query ?? null,
      queryType: input.queryType ?? null,
      stage: (input.stage as NewSource["stage"]) ?? null,
      createdBy: input.actorId
    };
    const inserted = await this.db.insert(sources).values(values).returning();
    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "来源登记失败");
    }
    return { source: serializeSource(row), created: true };
  }

  /** 抓取正文（规格 §41）：URL 不可抓时直接 400，不静默跳过。 */
  async fetch(productId: string, sourceId: string, options: { force?: boolean } = {}): Promise<SourceDetailShape> {
    const row = await this.findRow(productId, sourceId);
    if (!options.force && row.fetchStatus === "FETCHED" && row.contentText) {
      return serializeSourceDetail(row);
    }

    const result = await this.crawler.fetch(row.url);
    const updated = await this.db
      .update(sources)
      .set({
        fetchStatus: result.ok ? "FETCHED" : "FAILED",
        httpStatus: result.httpStatus,
        fetchError: result.error,
        contentText: result.text.length > 0 ? result.text : null,
        contentChars: result.charCount,
        title: row.title ?? result.title,
        domain: sourceDomainOf(result.finalUrl || row.url),
        updatedAt: new Date()
      })
      .where(eq(sources.id, sourceId))
      .returning();
    return serializeSourceDetail(updated[0] ?? row);
  }

  /**
   * Agent 3 网页事实抽取（规格 §41）。
   * 抽取结果只落 source_extractions：抓到的价格与事实是「来源证据」，
   * 绝不自动写入产品事实（product_facts 必须人工在 §11 六态中确认）。
   */
  async extract(
    productId: string,
    sourceId: string,
    input: SourceExtractRequest,
    actor: ResearchActor
  ): Promise<SourceExtractionApiShape> {
    const row = await this.findRow(productId, sourceId);
    if (!input.force) {
      const existing = await this.db
        .select()
        .from(sourceExtractions)
        .where(eq(sourceExtractions.sourceId, sourceId))
        .orderBy(desc(sourceExtractions.createdAt))
        .limit(1);
      if (existing[0]) {
        return serializeSourceExtraction(existing[0]);
      }
    }

    let text = row.contentText ?? "";
    if (text.length === 0) {
      const fetched = await this.fetch(productId, sourceId, {});
      text = fetched.content_text ?? "";
    }
    const sourceKind = row.sourceKind;

    const warnings: string[] = [];
    let candidate: WebExtractionAiOutput;
    let generator = "RULE_BASED";
    let promptVersion: number | null = null;
    let provider: string | null = null;
    let model: string | null = null;

    const wantAi = input.use_ai ?? this.ai.name !== "mock";
    let ruleFallback = false;
    if (wantAi && text.length > 0) {
      try {
        const active = await this.prompts.getActiveContent("WEB_EXTRACTOR");
        const { data, raw } = await this.ai.generateJson({
          schema: webExtractionAiOutputSchema,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: [
                active.content,
                "",
                "附加约束（§41 / §62-13）：只输出 schema 规定的 JSON；",
                "网页没有写的内容一律 null，禁止任何换算与推断。"
              ].join("\n")
            },
            {
              role: "user",
              content: JSON.stringify({ source_kind: sourceKind, url: row.url, page_text: text.slice(0, 40_000) })
            }
          ]
        });
        candidate = data;
        generator = "AI_ASSISTED";
        promptVersion = active.version;
        provider = raw.provider;
        model = raw.model;
      } catch (error) {
        ruleFallback = true;
        warnings.push(
          `AI 抽取未完成，已退回规则抽取：${error instanceof Error ? error.message : String(error)}`
        );
        candidate = ruleBasedWebExtraction(text, sourceKind);
      }
    } else {
      ruleFallback = text.length > 0;
      candidate =
        text.length > 0
          ? ruleBasedWebExtraction(text, sourceKind)
          : emptyWebExtraction("页面正文为空，请先抓取正文再抽取");
      if (ruleFallback) {
        generator = "RULE_BASED";
      }
    }

    const sanitized = sanitizeWebExtraction(candidate, text, sourceKind);
    const priceTypeCounts: Record<string, number> = {};
    for (const price of sanitized.output.prices) {
      priceTypeCounts[price.price_type] = (priceTypeCounts[price.price_type] ?? 0) + 1;
    }

    const status: SourceExtractionStatus =
      text.length === 0
        ? "FAILED"
        : sanitized.has_content
          ? "EXTRACTED"
          : "PARTIAL";

    const inserted = await this.db
      .insert(sourceExtractions)
      .values({
        sourceId,
        productId,
        extraction: sanitized.output,
        dropped: sanitized.dropped as unknown as unknown[],
        warnings: [...warnings, ...sanitized.warnings],
        hasContent: sanitized.has_content,
        priceCount: sanitized.output.prices.length,
        priceTypeCounts,
        promptKey: "WEB_EXTRACTOR",
        promptVersion,
        provider,
        model,
        createdBy: actor.id
      })
      .returning();

    await this.db
      .update(sources)
      .set({
        extractionStatus: status,
        extractedAt: new Date(),
        lastExtraction: sanitized.output,
        lastExtractionDropped: sanitized.dropped as unknown as unknown[],
        lastExtractionWarnings: [...warnings, ...sanitized.warnings],
        updatedAt: new Date()
      })
      .where(eq(sources.id, sourceId));

    const created = inserted[0];
    if (!created) {
      throw new AppError("INTERNAL_ERROR", "抽取结果写入失败");
    }
    return serializeSourceExtraction(created);
  }

  async remove(productId: string, sourceId: string): Promise<void> {
    const row = await this.findRow(productId, sourceId);
    await this.db.delete(sources).where(eq(sources.id, row.id));
  }

  private async findRow(productId: string, sourceId: string): Promise<Source> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("来源不存在");
    }
    return row;
  }
}
