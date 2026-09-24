import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockAiProvider } from "@ldj/ai";
import { MockSearchProvider } from "@ldj/search";
import { researchStages } from "@ldj/schemas";
import { CrawlerService } from "../src/modules/research/crawler.service.js";
import {
  SIX_STAR_PEACOCK_FIXTURE,
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

/**
 * Phase 4（规格 §12 搜索策略 / §41 抓取与网页抽取 / §55 研究流水线 / §56 进度 UI）。
 *
 * 本文件集中锁定 Phase 4 的四条红线：
 * - 搜索必须走 Provider，不得用模型记忆替代（§62-1）；
 * - 同一规范化 URL 只登记一条来源（来源密度不能被重复登记伪造）；
 * - 抓取失败如实记录，不静默跳过（§41）；
 * - 网页抽取只落 source_extractions，绝不自动写入产品事实（§11 / §41）。
 */

const PRICE_PAGE_URL = "https://market.example.com/peacock-2026";
const BROKEN_PAGE_URL = "https://news.example.com/peacock-2026";
const PRIVATE_URL = "http://192.168.1.10/internal-price";

/** 有正文、有价格、有年份与重量的页面（模拟真实行情页）。 */
const PRICE_PAGE_HTML = `<html><head><title>龙德记六星孔雀 2026 行情</title></head><body>
<h1>龙德记六星孔雀 2026 年 布朗山 大树春茶 357g</h1>
<p>挂牌价 12000 元/饼，整件价 48 万元。</p>
<p>本站内容仅供行情参考。</p>
</body></html>`;

/** 404 且无正文：抓取如实失败，抽取不应凭空产出任何信息。 */
const BROKEN_PAGE_HTML = `<html><head></head><body></body></html>`;

interface FetchLog {
  url: string;
  count: number;
}

/** 假 fetch：只认两个已知 URL，其余一律 404；记录调用次数用于验证「不重复抓取」。 */
function buildFakeFetchCalls(): { calls: FetchLog[]; impl: typeof fetch } {
  const calls: FetchLog[] = [];
  const impl = (async (input: string | URL | { url: string }) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const existing = calls.find((item) => item.url === url);
    if (existing) {
      existing.count += 1;
    } else {
      calls.push({ url, count: 1 });
    }
    if (url.startsWith(PRICE_PAGE_URL)) {
      return new Response(PRICE_PAGE_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    return new Response(BROKEN_PAGE_HTML, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

/**
 * 规则化 Mock AI：网页抽取阶段返回一份「夹杂违规内容」的候选，
 * 用于验证 AI 输出必须过 schema、且不可回溯 / 换算 / 虚构的内容被丢弃（§58-2 / §62-3·13）。
 */
function buildTestAiProvider(): MockAiProvider {
  return new MockAiProvider([
    {
      match: /网页事实抽取|WEB_EXTRACTOR|page_text/,
      text: JSON.stringify({
        product_name: "龙德记六星孔雀",
        brand_name: null,
        year: 2026,
        tea_type: null,
        origin_region: null,
        mountain: "布朗山",
        village: null,
        weight_g: 357,
        spec_notes: null,
        storage: null,
        prices: [
          {
            value: 12000,
            currency: "CNY",
            quote: "挂牌价 12000 元/饼，整件价 48 万元",
            price_type: "VERIFIED_TRANSACTION",
            unit_scope: "PIECE",
            weight_g: null,
            observed_at: null,
            note: null
          },
          {
            value: 480000,
            currency: "CNY",
            quote: "挂牌价 12000 元/饼，整件价 48 万元",
            price_type: "OFFICIAL_RETAIL",
            unit_scope: "PIECE",
            weight_g: null,
            observed_at: null,
            note: null
          },
          {
            value: 888888,
            currency: "CNY",
            quote: "成交价 888888 元",
            price_type: "VERIFIED_TRANSACTION",
            unit_scope: "PIECE",
            weight_g: null,
            observed_at: null,
            note: null
          }
        ],
        facts: [
          { field: "mountain", value: "布朗山", quote: "布朗山 大树春茶" },
          { field: "tree_age", value: "300 年古树", quote: "300 年古树原料" }
        ],
        null_reason: null
      })
    },
    {
      match: /[\s\S]*/,
      text: JSON.stringify({ dna: {} })
    }
  ]);
}

let context: TestContext;
let admin: BootstrapResult;
let productId: string;
let crawler: CrawlerService;
let fetchCalls: FetchLog[];

beforeAll(async () => {
  const fake = buildFakeFetchCalls();
  fetchCalls = fake.calls;
  crawler = new CrawlerService({
    fetchImpl: fake.impl,
    allowPrivateHosts: true,
    timeoutMs: 2_000
  });
  context = await createTestContext({
    aiProvider: buildTestAiProvider(),
    searchProvider: new MockSearchProvider([
      {
        match: /./,
        results: [
          {
            title: "龙德记六星孔雀 2026 行情",
            url: PRICE_PAGE_URL,
            snippet: "挂牌价 12000 元/饼，整件价 48 万元"
          },
          {
            title: "龙德记六星孔雀 2026 新闻",
            url: BROKEN_PAGE_URL,
            snippet: "暂无正文"
          }
        ]
      }
    ]),
    crawler
  });
});

beforeEach(async () => {
  await context.reset();
  fetchCalls.length = 0;
  admin = await bootstrapAdmin(context.app, {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  });
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
  });
  productId = (created.json() as { id: string }).id;
});

afterAll(async () => {
  await context.close();
});

async function createUserToken(role: "RESEARCHER" | "VIEWER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: `${role.toLowerCase()}@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

async function registerSource(url: string): Promise<{ id: string; created: boolean; status: number }> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/sources`,
    headers: authHeader(admin.accessToken),
    payload: { url }
  });
  const body = response.json() as { source: { id: string }; created: boolean };
  return { id: body.source.id, created: body.created, status: response.statusCode };
}

describe("来源登记与去重（规格 §11 / §41 / §54）", () => {
  it("同一规范化 URL 只登记一条来源，跟踪参数不产生新记录", async () => {
    const first = await registerSource(`${PRICE_PAGE_URL}?utm_source=wechat#detail`);
    expect(first.status).toBe(201);
    expect(first.created).toBe(true);

    const second = await registerSource(`${PRICE_PAGE_URL}/?spm=a1z.123`);
    expect(second.status).toBe(200);
    expect(second.created).toBe(false);

    const list = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/sources`,
      headers: authHeader(admin.accessToken)
    });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: { id: string; domain: string }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(first.id);
    expect(items[0]?.domain).toBe("market.example.com");
  });

  it("非法 URL 与内网地址都会被拦截（§41 SSRF）", async () => {
    const invalid = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources`,
      headers: authHeader(admin.accessToken),
      payload: { url: "不是链接" }
    });
    expect(invalid.statusCode).toBe(400);

    // 非 http(s) 协议：抓取阶段直接 400，不静默跳过。
    const ftpSource = await registerSource("ftp://market.example.com/peacock-price");
    const protocolBlocked = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources/${ftpSource.id}/fetch`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(protocolBlocked.statusCode).toBe(400);

    // 只允许 http/https，内网与本地地址一律拒绝（默认 Crawler 未放开内网）。
    const strict = new CrawlerService();
    expect(strict.assertFetchable(PRICE_PAGE_URL)).toBeInstanceOf(URL);
    expect(() => strict.assertFetchable("http://127.0.0.1:8000/price")).toThrow();
    expect(() => strict.assertFetchable(PRIVATE_URL)).toThrow();
    await expect(strict.fetch(PRIVATE_URL)).rejects.toThrow();
  });

  it("抓取成功写入正文；再次抓取直接复用，不重复请求", async () => {
    const created = await registerSource(PRICE_PAGE_URL);
    const fetched = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources/${created.id}/fetch`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(fetched.statusCode).toBe(200);
    const body = fetched.json() as {
      fetch_status: string;
      has_content: boolean;
      content_chars: number;
      content_text: string;
      title: string | null;
    };
    expect(body.fetch_status).toBe("FETCHED");
    expect(body.has_content).toBe(true);
    expect(body.content_chars).toBeGreaterThan(0);
    expect(body.content_text).toContain("挂牌价");
    expect(body.title).toBe("龙德记六星孔雀 2026 行情");

    const again = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources/${created.id}/fetch`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(again.statusCode).toBe(200);
    expect(fetchCalls.filter((item) => item.url === PRICE_PAGE_URL)).toHaveLength(1);
  });

  it("抓取失败如实记录状态与原因，不静默跳过（§41）", async () => {
    const created = await registerSource(BROKEN_PAGE_URL);
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources/${created.id}/fetch`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      fetch_status: string;
      http_status: number | null;
      fetch_error: string | null;
      has_content: boolean;
    };
    expect(body.fetch_status).toBe("FAILED");
    expect(body.http_status).toBe(404);
    expect(body.fetch_error).toBe("HTTP 404");
    expect(body.has_content).toBe(false);
  });
});

describe("Agent 3 网页事实抽取（规格 §41 / §62-2·3·13）", () => {
  it("AI 候选被逐条净化：换算、不可回溯与虚构内容全部丢弃，且不写产品事实", async () => {
    const created = await registerSource(PRICE_PAGE_URL);
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources/${created.id}/extract`,
      headers: authHeader(admin.accessToken),
      payload: { use_ai: true, force: true }
    });
    expect(response.statusCode).toBe(201);
    const extraction = response.json() as {
      has_content: boolean;
      price_count: number;
      price_type_counts: Record<string, number>;
      extraction: {
        mountain: string | null;
        year: number | null;
        weight_g: number | null;
        prices: { value: number; price_type: string; unit_scope: string }[];
        facts: { field: string }[];
      };
      dropped: { field: string; value: string; reason: string }[];
      warnings: string[];
      prompt_key: string;
      prompt_version: number | null;
      provider: string | null;
    };

    expect(extraction.extraction.mountain).toBe("布朗山");
    expect(extraction.extraction.year).toBe(2026);
    expect(extraction.extraction.weight_g).toBe(357);
    expect(extraction.has_content).toBe(true);
    expect(extraction.prompt_key).toBe("WEB_EXTRACTOR");

    // 挂牌价被 AI 标成成交价：按原文纠正为 LISTING，并留下纠正记录。
    const kept = extraction.extraction.prices.find((price) => price.value === 12000);
    expect(kept?.price_type).toBe("LISTING");
    expect(kept?.unit_scope).toBe("PIECE");
    expect(extraction.price_type_counts.LISTING).toBe(1);

    const reasons = extraction.dropped.map((item) => item.reason);
    // 48 万是整件价，被标成官方单饼零售价 → 整条丢弃（§62-3）
    expect(reasons).toContain("UNIT_MISMATCH");
    // 888888 不在页面正文里 → 不可回溯，整条丢弃
    expect(reasons).toContain("NOT_ON_PAGE");
    expect(reasons).toContain("PRICE_TYPE_CORRECTED");
    expect(extraction.extraction.prices.some((price) => price.value === 480000)).toBe(false);
    expect(extraction.extraction.prices.some((price) => price.value === 888888)).toBe(false);
    // 「300 年古树」页面没有 → 不进入事实
    expect(extraction.extraction.facts.some((fact) => fact.field === "tree_age")).toBe(false);
    expect(extraction.price_count).toBe(1);

    // 抽取结果只落来源证据，产品事实必须仍然为空（§11 / §41）。
    const facts = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken)
    });
    expect(facts.statusCode).toBe(200);
    expect((facts.json() as { items: unknown[] }).items).toHaveLength(0);

    const history = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/sources/${created.id}/extractions`,
      headers: authHeader(admin.accessToken)
    });
    expect(history.statusCode).toBe(200);
    expect((history.json() as { items: unknown[] }).items).toHaveLength(1);

    // 未指定 force 时复用已有抽取，不产生第二条记录（§62-15 版本保留）。
    const reused = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources/${created.id}/extract`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(reused.statusCode).toBe(201);
    const historyAgain = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/sources/${created.id}/extractions`,
      headers: authHeader(admin.accessToken)
    });
    expect((historyAgain.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it("无正文的来源抽取如实标记失败，不生成任何候选事实", async () => {
    const created = await registerSource(BROKEN_PAGE_URL);
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources/${created.id}/extract`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(response.statusCode).toBe(201);
    const extraction = response.json() as {
      has_content: boolean;
      price_count: number;
      extraction: { prices: unknown[]; facts: unknown[]; null_reason: string | null };
    };
    expect(extraction.has_content).toBe(false);
    expect(extraction.price_count).toBe(0);
    expect(extraction.extraction.prices).toHaveLength(0);
    expect(extraction.extraction.facts).toHaveLength(0);
  });
});

describe("研究流水线（规格 §55 / §56 / §62-1）", () => {
  it("搜索策略（Agent 2）按 Value DNA 生成并落库，未生成时只给未落库预览", async () => {
    const preview = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/search-plan`,
      headers: authHeader(admin.accessToken)
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as {
      stored: boolean;
      stale: boolean;
      query_count: number;
      counts_by_type: Record<string, number>;
      warnings: string[];
    };
    expect(previewBody.stored).toBe(false);
    expect(previewBody.stale).toBe(true);
    expect(previewBody.query_count).toBeGreaterThan(0);
    expect(Object.keys(previewBody.counts_by_type)).toHaveLength(9);
    expect(previewBody.warnings.some((item) => item.includes("未落库"))).toBe(true);

    const generated = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/search-plan/generate`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(generated.statusCode).toBe(201);
    const generatedBody = generated.json() as {
      stored: boolean;
      query_count: number;
      generator: string;
      queries: { query_type: string; query: string }[];
      spec_ref: string;
    };
    expect(generatedBody.stored).toBe(true);
    expect(generatedBody.generator).toBe("RULE_BASED");
    expect(generatedBody.spec_ref).toBe("§12 / §40");
    expect(generatedBody.queries).toHaveLength(generatedBody.query_count);
    expect(generatedBody.queries.some((item) => item.query.includes("龙德记六星孔雀"))).toBe(true);

    const stored = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/search-plan`,
      headers: authHeader(admin.accessToken)
    });
    expect((stored.json() as { stored: boolean; stale: boolean }).stored).toBe(true);
    expect((stored.json() as { stored: boolean; stale: boolean }).stale).toBe(false);

    const anonymous = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/search-plan`
    });
    expect(anonymous.statusCode).toBe(401);

    const viewerToken = await createUserToken("VIEWER");
    const viewerGenerate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/search-plan/generate`,
      headers: authHeader(viewerToken),
      payload: {}
    });
    expect(viewerGenerate.statusCode).toBe(403);
  });

  it("跑通研究：22 阶段全部登记，执行到高价值锚点构建，其余保持 PENDING", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/research/runs`,
      headers: authHeader(admin.accessToken),
      payload: { auto_extract: true, use_ai: true, max_queries: 6 }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      id: string;
      status: string;
      implemented_phases: number[];
      stages_run: string[];
      sources_created: number;
      sources_fetched: number;
      extractions: number;
      progress: { stage: string; status: string; phase: number; implemented: boolean; label: string }[];
      progress_summary: { total: number; succeeded: number; pending: number };
      mode_notes: { BENCHMARK: string; CATEGORY_CREATOR: string };
      candidates_created: number;
      candidates_total: number;
      candidate_band_counts: Record<string, number>;
    };

    expect(body.status).toBe("SUCCEEDED");
    expect(body.implemented_phases).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(body.progress).toHaveLength(researchStages.length);
    expect(body.progress).toHaveLength(22);
    expect(body.progress.map((item) => item.stage)).toEqual([...researchStages]);

    const byStage = new Map(body.progress.map((item) => [item.stage, item]));
    for (const stage of [
      "FACT_NORMALIZE",
      "VALUE_DNA",
      "SEARCH_PLAN",
      "WEB_SEARCH",
      "SOURCE_FETCH",
      "ENTITY_EXTRACT",
      "CANDIDATE_POOL",
      "SIMILARITY_SCORE",
      "PRICE_SEARCH",
      "PRICE_EVIDENCE",
      "OUTLIER_DETECTION",
      "ANCHOR_BUILD"
    ]) {
      expect(byStage.get(stage)?.status).toBe("SUCCEEDED");
      expect(byStage.get(stage)?.implemented).toBe(true);
    }
    // Phase 12 已交付：强成交话术与成交冲击力评分两个阶段归到 Phase 12，
    // 但本次研究运行仍然不执行它们（它们读的是研究结论，不是研究流水线的一步）。
    for (const stage of ["SALES_COPY", "IMPACT_SCORE"]) {
      const item = byStage.get(stage);
      expect(item?.status).toBe("PENDING");
      expect(item?.implemented).toBe(true);
      expect(item?.phase).toBe(12);
      expect(item?.label).toBeTruthy();
    }
    // Phase 13 已交付：牛逼化强化同理归到 Phase 13，研究流水线本身也不执行它。
    {
      const item = byStage.get("INTENSIFY");
      expect(item?.status).toBe("PENDING");
      expect(item?.implemented).toBe(true);
      expect(item?.phase).toBe(13);
      expect(item?.label).toBeTruthy();
    }
    // Phase 14 已交付：事实审核与人工审批归到 Phase 14，研究流水线本身也不执行它们
    // （它们读的是成稿，不是研究流水线的一步）。
    for (const stage of ["FACT_REVIEW", "HUMAN_APPROVAL"]) {
      const item = byStage.get(stage);
      expect(item?.status).toBe("PENDING");
      expect(item?.implemented).toBe(true);
      expect(item?.phase).toBe(14);
      expect(item?.label).toBeTruthy();
    }
    expect(body.progress_summary.total).toBe(22);
    expect(body.progress_summary.succeeded).toBe(12);
    expect(body.progress_summary.pending).toBe(10);
    expect(body.stages_run).toEqual([
      "FACT_NORMALIZE",
      "VALUE_DNA",
      "SEARCH_PLAN",
      "WEB_SEARCH",
      "SOURCE_FETCH",
      "ENTITY_EXTRACT",
      "CANDIDATE_POOL",
      "SIMILARITY_SCORE",
      "PRICE_SEARCH",
      "PRICE_EVIDENCE",
      "OUTLIER_DETECTION",
      "ANCHOR_BUILD"
    ]);
    expect(body.sources_created).toBe(2);
    expect(body.sources_fetched).toBe(1);
    expect(body.extractions).toBe(1);
    // 抽取结果里写明了产品名 → 归并成 1 条候选；网页没写茶类 → 该维度按 0 分，总分落在拒绝档。
    expect(body.candidates_created).toBe(1);
    expect(body.candidates_total).toBe(1);
    expect(body.candidate_band_counts.REJECT).toBe(1);
    expect(body.mode_notes.BENCHMARK).toContain("Benchmark Mode");
    expect(body.mode_notes.CATEGORY_CREATOR).toContain("Category Creator Mode");

    const progress = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/research/progress`,
      headers: authHeader(admin.accessToken)
    });
    expect(progress.statusCode).toBe(200);
    const progressBody = progress.json() as { latest: boolean; job: { id: string } | null };
    expect(progressBody.latest).toBe(true);
    expect(progressBody.job?.id).toBe(body.id);

    const job = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/research/runs/${body.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(job.statusCode).toBe(200);

    const runs = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/research/runs`,
      headers: authHeader(admin.accessToken)
    });
    expect((runs.json() as { items: unknown[] }).items).toHaveLength(1);

    // 搜索结果里的两条 URL 都登记成了来源，重复命中的 URL 不重复计数。
    const sources = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/sources`,
      headers: authHeader(admin.accessToken)
    });
    const items = (sources.json() as { items: { url: string; query: string | null; stage: string | null }[] }).items;
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.query !== null)).toBe(true);
    expect(items.every((item) => item.stage === "WEB_SEARCH")).toBe(true);
  });

  it("从未跑过研究时返回空进度，且不伪造已完成阶段（§56）", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/research/progress`,
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      latest: boolean;
      job: unknown;
      progress: { status: string; implemented: boolean }[];
    };
    expect(body.latest).toBe(false);
    expect(body.job).toBeNull();
    expect(body.progress).toHaveLength(22);
    expect(body.progress.every((item) => item.status === "PENDING")).toBe(true);
    // implemented 表示「该阶段属于已交付 Phase」，与是否跑过无关：
    // Phase 3–7 覆盖 12 个流水线阶段，Phase 9 的 VALUE_CODES / VALUE_MAPPING、
    // Phase 10 的 PRODUCT_ARCHITECTURE_SEED / PRODUCT_ARCHITECTURE 与
    // Phase 11 的 FORMULA_PHILOSOPHY、Phase 12 的 SALES_COPY / IMPACT_SCORE、
    // Phase 13 的 INTENSIFY、Phase 14 的 FACT_REVIEW / HUMAN_APPROVAL 均已交付，
    // 因此 22 个阶段全部标记为已交付（Phase 1–14 无未交付阶段）。
    expect(body.progress.filter((item) => item.implemented)).toHaveLength(22);
    expect(body.progress.filter((item) => !item.implemented)).toHaveLength(0);
  });

  it("max_sources=0 时抓取与抽取标记为 SKIPPED，而不是假装完成", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/research/runs`,
      headers: authHeader(admin.accessToken),
      payload: { max_sources: 0, max_queries: 3 }
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      status: string;
      sources_fetched: number;
      extractions: number;
      stages_run: string[];
      progress: { stage: string; status: string; message: string | null }[];
    };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.sources_fetched).toBe(0);
    expect(body.extractions).toBe(0);
    expect(body.stages_run).not.toContain("SOURCE_FETCH");
    const byStage = new Map(body.progress.map((item) => [item.stage, item]));
    expect(byStage.get("SOURCE_FETCH")?.status).toBe("SKIPPED");
    expect(byStage.get("ENTITY_EXTRACT")?.status).toBe("SKIPPED");
    expect(byStage.get("CANDIDATE_POOL")?.status).toBe("SKIPPED");
    expect(byStage.get("SIMILARITY_SCORE")?.status).toBe("SKIPPED");
    expect(byStage.get("PRICE_SEARCH")?.status).toBe("SKIPPED");
    expect(byStage.get("PRICE_EVIDENCE")?.status).toBe("SKIPPED");
    expect(byStage.get("OUTLIER_DETECTION")?.status).toBe("SKIPPED");
    expect(byStage.get("ANCHOR_BUILD")?.status).toBe("SKIPPED");
    expect(byStage.get("WEB_SEARCH")?.status).toBe("SUCCEEDED");
  });
});

describe("研究模块权限（Phase 4 RBAC）", () => {
  it("未登录读取与写入都被拒绝", async () => {
    const read = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/sources`
    });
    expect(read.statusCode).toBe(401);
    const write = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/research/runs`,
      payload: {}
    });
    expect(write.statusCode).toBe(401);
  });

  it("VIEWER 不能登记来源或跑研究，RESEARCHER 不能删除来源", async () => {
    const viewerToken = await createUserToken("VIEWER");
    const researcherToken = await createUserToken("RESEARCHER");

    const viewerWrite = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/sources`,
      headers: authHeader(viewerToken),
      payload: { url: PRICE_PAGE_URL }
    });
    expect(viewerWrite.statusCode).toBe(403);

    const viewerRun = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/research/runs`,
      headers: authHeader(viewerToken),
      payload: {}
    });
    expect(viewerRun.statusCode).toBe(403);

    const created = await registerSource(PRICE_PAGE_URL);
    const researcherDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/sources/${created.id}`,
      headers: authHeader(researcherToken)
    });
    expect(researcherDelete.statusCode).toBe(403);

    const adminDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/sources/${created.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(adminDelete.statusCode).toBe(204);

    const after = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/sources`,
      headers: authHeader(admin.accessToken)
    });
    expect((after.json() as { items: unknown[] }).items).toHaveLength(0);
  });
});
