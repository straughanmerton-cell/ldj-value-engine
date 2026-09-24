import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockAiProvider } from "@ldj/ai";
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
 * Phase 5（规格 §13 可比性评分 / §36 高价值茶数据库 / §42 Agent 4）。
 *
 * 本文件锁定候选池与相似度的五条红线：
 * - **价格永不参与相似度**（§62-4）：连 Value DNA 里由挂牌价派生的「价格带已知」都必须在评分侧剔除；
 * - **未知不等于相似**（§13）：缺信息的维度按 0 分计并进 `unknown_dimensions`，不猜测补齐；
 * - **同一款茶只算一条**（§62-5）：多条来源按「品牌|名称|年份|规格」去重合并，来源多不叠加证据厚度；
 * - **分档照抄 §13**（55 / 70 / 85）：低于阈值仍入库但标记拒绝，保留原始分档便于审计；
 * - **人工评审不被重算覆盖**（`keep_reviewed`）：已确认的对标不会因为重跑研究退回待评审。
 */

const PRODUCT_A_URL = "https://market.example.com/ldj-peacock-a";
const PRODUCT_B_URL = "https://market.example.com/ldj-peacock-b";
const OTHER_TEA_URL = "https://market.example.com/daiyi-7542";
const NO_NAME_URL = "https://market.example.com/nameless-note";

/** 同款行情页（A）：页面里逐字写上所有被抽字段，保证抽取阶段不会有任何内容被判定为不可回溯。 */
const PAGE_A_HTML = `<html><head><title>龙德记六星孔雀 2026 行情</title></head><body>
<h1>龙德记六星孔雀</h1>
<p>品牌：龙德记 年份：2026 年 茶类：普洱生茶（生茶）</p>
<p>产地：勐海 布朗山，原料：大树春茶，规格 357g。</p>
<p>香气：烟香明显；入口浓强，回甘快，生津强，茶气明显。</p>
<p>挂牌价 12000 元/饼。</p>
</body></html>`;

/** 同款行情页（B）：同一款茶的另一条来源，价格不同，用于验证「来源多 ≠ 分更高」。 */
const PAGE_B_HTML = PAGE_A_HTML.replace("挂牌价 12000 元/饼。", "挂牌价 15000 元/饼。");

/** 完全不同的一款茶：用来验证拒绝档与「未知维度按 0 分」。 */
const OTHER_TEA_HTML = `<html><head><title>大益 7542 2019 行情</title></head><body>
<h1>大益 7542</h1>
<p>品牌：大益 年份：2019 年 茶类：普洱熟茶</p>
<p>产地：临沧，规格 357g。</p>
<p>压制较紧。</p>
<p>挂牌价 380 元/饼。</p>
</body></html>`;

/** 有内容但没写产品名的页面：不得据此生成候选。 */
const NO_NAME_HTML = `<html><head><title>行情随笔</title></head><body>
<p>最近市场上烟香明显的茶不少，行情仅供参考。</p>
</body></html>`;

const PAGES: Record<string, string> = {
  [PRODUCT_A_URL]: PAGE_A_HTML,
  [PRODUCT_B_URL]: PAGE_B_HTML,
  [OTHER_TEA_URL]: OTHER_TEA_HTML,
  [NO_NAME_URL]: NO_NAME_HTML
};

/**
 * 规则化 Mock AI：按来源 URL 返回该页面的抽取结果。
 * 每条 fact 的引文都能在对应页面正文里逐字回溯，因此不会有内容被净化器丢弃——
 * 这样候选池拿到的就是「网页真的写了什么」，用于验证候选归并与十维打分。
 */
function buildTestAiProvider(): MockAiProvider {
  const sameProduct = (price: number) =>
    JSON.stringify({
      product_name: "龙德记六星孔雀",
      brand_name: "龙德记",
      year: 2026,
      tea_type: "普洱生茶",
      origin_region: "勐海",
      mountain: "布朗山",
      village: null,
      weight_g: 357,
      spec_notes: null,
      storage: null,
      prices: [
        {
          value: price,
          currency: "CNY",
          quote: `挂牌价 ${price} 元/饼`,
          price_type: "VERIFIED_TRANSACTION",
          unit_scope: "PIECE",
          weight_g: null,
          observed_at: null,
          note: null
        }
      ],
      facts: [
        { field: "raw_material", value: "大树春茶", quote: "原料：大树春茶" },
        { field: "aroma", value: "烟香明显", quote: "香气：烟香明显" },
        { field: "taste_entry", value: "浓强", quote: "入口浓强" },
        { field: "taste_huigan", value: "回甘快", quote: "回甘快" },
        { field: "taste_salivation", value: "生津强", quote: "生津强" },
        { field: "taste_cha_qi", value: "茶气明显", quote: "茶气明显" }
      ],
      null_reason: null
    });

  return new MockAiProvider([
    { match: /ldj-peacock-a/, text: sameProduct(12000) },
    { match: /ldj-peacock-b/, text: sameProduct(15000) },
    {
      match: /daiyi-7542/,
      text: JSON.stringify({
        product_name: "大益 7542",
        brand_name: "大益",
        year: 2019,
        tea_type: "普洱熟茶",
        origin_region: null,
        mountain: "临沧",
        village: null,
        weight_g: 357,
        spec_notes: "压制较紧",
        storage: null,
        prices: [
          {
            value: 380,
            currency: "CNY",
            quote: "挂牌价 380 元/饼",
            price_type: "LISTING",
            unit_scope: "PIECE",
            weight_g: null,
            observed_at: null,
            note: null
          }
        ],
        facts: [],
        null_reason: null
      })
    },
    {
      match: /nameless-note/,
      text: JSON.stringify({
        product_name: null,
        brand_name: null,
        year: null,
        tea_type: null,
        origin_region: null,
        mountain: null,
        village: null,
        weight_g: null,
        spec_notes: null,
        storage: null,
        prices: [],
        facts: [{ field: "aroma", value: "烟香明显", quote: "烟香明显" }],
        null_reason: null
      })
    },
    { match: /[\s\S]*/, text: JSON.stringify({ dna: {} }) }
  ]);
}

/** 假 fetch：只认本文件登记的四个页面，其余 404。 */
function buildFakeFetch(): typeof fetch {
  return (async (input: string | URL | { url: string }) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const html = PAGES[url];
    if (!html) {
      return new Response("<html><body></body></html>", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }) as unknown as typeof fetch;
}

interface CandidateItem {
  id: string;
  product_id: string;
  product_name: string | null;
  name: string;
  brand_name: string | null;
  year: number | null;
  tea_type: string | null;
  mountain: string | null;
  weight_g: number | null;
  spec_notes: string | null;
  identity_key: string;
  similarity_total: number;
  similarity_band: string;
  similarity: {
    total: number;
    band: string;
    dimensions: {
      dimension: string;
      label: string;
      weight: number;
      ratio: number;
      score: number;
      matched: boolean;
      note: string;
    }[];
    matched_dimensions: string[];
    unknown_dimensions: string[];
    warnings: string[];
  };
  status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  source_ids: string[];
  evidence: { kind: string; field: string; value?: string | null; quote: string }[];
  observed_prices: { value: number | null; price_type: string; quote: string }[];
  merged_sources: number;
  notes: string | null;
}

interface RebuildResult {
  total: number;
  created: number;
  updated: number;
  kept_reviewed: number;
  below_min_score: number;
  reached_limit: boolean;
  band_counts: Record<string, number>;
  min_score: number;
  stats: {
    sources_considered: number;
    skipped_no_name: number;
    merged_multi_source: number;
    drafts: number;
  };
  spec_ref: string;
}

let context: TestContext;
let admin: BootstrapResult;
let productId: string;

beforeAll(async () => {
  context = await createTestContext({
    aiProvider: buildTestAiProvider(),
    crawler: new CrawlerService({ fetchImpl: buildFakeFetch(), allowPrivateHosts: true, timeoutMs: 2_000 })
  });
});

beforeEach(async () => {
  await context.reset();
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
  expect(created.statusCode).toBe(201);
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

/** 登记来源 → 抓取正文 → 走 AI 抽取：候选池的输入就是这一步的结果。 */
async function ingestSource(url: string): Promise<string> {
  const registered = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/sources`,
    headers: authHeader(admin.accessToken),
    payload: { url }
  });
  expect(registered.statusCode).toBe(201);
  const sourceId = (registered.json() as { source: { id: string } }).source.id;

  const fetched = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/sources/${sourceId}/fetch`,
    headers: authHeader(admin.accessToken),
    payload: {}
  });
  expect(fetched.statusCode).toBe(200);

  const extracted = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/sources/${sourceId}/extract`,
    headers: authHeader(admin.accessToken),
    payload: { use_ai: true, force: true }
  });
  expect(extracted.statusCode).toBe(201);
  return sourceId;
}

async function rebuildPool(payload: Record<string, unknown> = {}): Promise<RebuildResult> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/candidates/rebuild`,
    headers: authHeader(admin.accessToken),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as RebuildResult;
}

async function listCandidates(
  query = "",
  token = admin.accessToken
): Promise<{ items: CandidateItem[]; total: number }> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/candidates${query}`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { items: CandidateItem[]; total: number };
}

/** noUncheckedIndexedAccess 下取首条候选：空列表直接失败，避免用 `!` 掩盖问题。 */
function firstCandidate(items: CandidateItem[]): CandidateItem {
  const item = items[0];
  if (!item) {
    throw new Error("候选列表为空");
  }
  return item;
}

function dimensionOf(item: CandidateItem, dimension: string) {
  return item.similarity.dimensions.find((entry) => entry.dimension === dimension);
}

describe("§13 相似度合同（价格不参与）", () => {
  it("合同自检：十个维度权重合计 100，价格不在相似度里；未登录不可读", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/candidates/contract",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      comparable: {
        price_in_similarity: boolean;
        weight_total: number;
        dimensions: { dimension: string; label: string; weight: number }[];
        bands: Record<string, string>;
        statuses: Record<string, string>;
      };
      pool: { price_in_similarity: boolean; identity_key_fields: string[] };
      engine: { price_in_similarity: boolean; weight_total: number };
    };
    expect(body.comparable.price_in_similarity).toBe(false);
    expect(body.pool.price_in_similarity).toBe(false);
    expect(body.engine.price_in_similarity).toBe(false);
    expect(body.comparable.dimensions).toHaveLength(10);
    expect(body.comparable.weight_total).toBe(100);
    expect(body.engine.weight_total).toBe(100);
    expect(body.comparable.dimensions.map((item) => item.dimension)).toEqual([
      "tea_category",
      "concept",
      "origin",
      "material",
      "aroma",
      "taste",
      "positioning",
      "craft",
      "specification",
      "era"
    ]);
    expect(body.comparable.dimensions.some((item) => /price|价格/.test(item.dimension))).toBe(false);
    expect(body.pool.identity_key_fields).toEqual([
      "brand_name",
      "name",
      "year",
      "weight_g",
      "spec_notes"
    ]);
    expect(Object.keys(body.comparable.bands)).toHaveLength(4);
    expect(body.comparable.statuses.PENDING_REVIEW).toBe("待评审");

    const anonymous = await context.app.inject({ method: "GET", url: "/api/candidates/contract" });
    expect(anonymous.statusCode).toBe(401);
    const anonymousList = await context.app.inject({ method: "GET", url: "/api/candidates" });
    expect(anonymousList.statusCode).toBe(401);
  });
});

describe("§13 候选池：从来源抽取结果重建", () => {
  it("同款来源自比：写明的维度全部命中，没写的维度按 0 分并进 unknown_dimensions", async () => {
    await ingestSource(PRODUCT_A_URL);
    const rebuilt = await rebuildPool();
    expect(rebuilt.created).toBe(1);
    expect(rebuilt.updated).toBe(0);
    expect(rebuilt.below_min_score).toBe(0);
    expect(rebuilt.reached_limit).toBe(false);
    expect(rebuilt.min_score).toBe(55);
    expect(rebuilt.band_counts.CORE_COMPARABLE).toBe(1);
    expect(rebuilt.stats).toEqual({
      sources_considered: 1,
      skipped_no_name: 0,
      merged_multi_source: 0,
      drafts: 1
    });
    expect(rebuilt.spec_ref).toBe("§13 / §36 / §42");

    const item = firstCandidate((await listCandidates()).items);
    expect(item.name).toBe("龙德记六星孔雀");
    expect(item.brand_name).toBe("龙德记");
    expect(item.tea_type).toBe("普洱生茶");
    expect(item.mountain).toBe("布朗山");
    expect(item.year).toBe(2026);
    expect(item.weight_g).toBe(357);
    expect(item.identity_key).toBe("龙德记|龙德记六星孔雀|2026|357|");
    expect(item.merged_sources).toBe(1);
    expect(item.source_ids).toHaveLength(1);
    expect(item.status).toBe("PENDING_REVIEW");

    // 网页只写了原料/香气/滋味/产区/规格/年份：工艺与市场定位没有写，绝不猜测补齐。
    expect(item.similarity.unknown_dimensions).toEqual(["positioning", "craft"]);
    for (const dimension of item.similarity.dimensions) {
      if (item.similarity.unknown_dimensions.includes(dimension.dimension)) {
        expect(dimension.score).toBe(0);
        expect(dimension.matched).toBe(false);
        expect(dimension.note).toContain("按 0 分");
        continue;
      }
      expect(dimension.ratio).toBe(1);
      expect(dimension.score).toBe(dimension.weight);
      expect(dimension.matched).toBe(true);
    }
    expect(item.similarity.matched_dimensions).toHaveLength(8);
    expect(item.similarity_total).toBe(88);
    expect(item.similarity_band).toBe("CORE_COMPARABLE");
    expect(item.similarity.warnings.some((warning) => warning.includes("未知不等于相似"))).toBe(
      true
    );
    expect(dimensionOf(item, "taste")?.note).toContain("滋味骨架命中");

    // 挂牌价只作为证据保留：原标注「已验证成交」被按原文纠正为挂牌价（§62-2）。
    expect(item.observed_prices).toHaveLength(1);
    expect(item.observed_prices[0]?.value).toBe(12000);
    expect(item.observed_prices[0]?.price_type).toBe("LISTING");
    expect(item.observed_prices[0]?.quote).toContain("挂牌价 12000");
    expect(item.evidence.some((entry) => entry.kind === "EXTRACTED_FACT")).toBe(true);
    expect(JSON.stringify(item.similarity)).not.toContain("12000");
  });

  it("价格不参与相似度：两条来源价差 3000，合并成一条候选且分数与明细完全不变", async () => {
    await ingestSource(PRODUCT_A_URL);
    await rebuildPool();
    const single = firstCandidate((await listCandidates()).items);
    expect(single.merged_sources).toBe(1);

    await ingestSource(PRODUCT_B_URL);
    const merged = await rebuildPool();
    expect(merged.created).toBe(0);
    expect(merged.updated).toBe(1);
    expect(merged.total).toBe(1);
    expect(merged.stats.sources_considered).toBe(2);
    expect(merged.stats.drafts).toBe(1);
    expect(merged.stats.merged_multi_source).toBe(1);

    const item = firstCandidate((await listCandidates()).items);
    expect(item.merged_sources).toBe(2);
    expect(item.source_ids).toHaveLength(2);
    // 来源变多不等于更相似：总分与十维明细逐字相同。
    expect(item.similarity_total).toBe(single.similarity_total);
    expect(item.similarity).toEqual(single.similarity);
    expect(item.similarity_total).toBe(88);

    const values = item.observed_prices.map((price) => price.value ?? 0).sort((a, b) => a - b);
    expect(values).toEqual([12000, 15000]);
    expect(item.observed_prices.every((price) => price.price_type === "LISTING")).toBe(true);
    expect(item.observed_prices.some((price) => price.quote.includes("挂牌价 15000"))).toBe(true);
    expect(item.evidence.filter((entry) => entry.kind === "PRICE_QUOTE")).toHaveLength(2);
    expect(JSON.stringify(item.similarity)).not.toContain("15000");
  });

  it("完全不同的茶：生熟相反 + 山头不同 + 缺信息，判为拒绝并逐维说明原因", async () => {
    await ingestSource(OTHER_TEA_URL);
    const rebuilt = await rebuildPool();
    expect(rebuilt.created).toBe(1);
    expect(rebuilt.below_min_score).toBe(1);
    expect(rebuilt.band_counts).toEqual({
      REJECT: 1,
      PERIPHERAL_REFERENCE: 0,
      VALID_COMPARABLE: 0,
      CORE_COMPARABLE: 0
    });

    const item = firstCandidate((await listCandidates()).items);
    expect(item.name).toBe("大益 7542");
    expect(item.tea_type).toBe("普洱熟茶");
    expect(item.similarity_total).toBe(3);
    expect(item.similarity_band).toBe("REJECT");
    // 只有「规格 357g」这一项命中；其余维度要么冲突、要么信息缺失。
    expect(item.similarity.matched_dimensions).toEqual(["specification"]);
    expect(item.similarity.unknown_dimensions).toEqual([
      "material",
      "aroma",
      "taste",
      "positioning",
      "craft"
    ]);
    expect(dimensionOf(item, "tea_category")?.note).toContain("生熟相反");
    expect(dimensionOf(item, "origin")?.note).toContain("布朗山");
    expect(dimensionOf(item, "aroma")?.score).toBe(0);
    expect(dimensionOf(item, "aroma")?.note).toContain("按 0 分");
    expect(dimensionOf(item, "specification")?.score).toBe(3);
    expect(item.similarity.warnings.some((warning) => warning.includes("不建议作为对标"))).toBe(
      true
    );

    // 380 元只写在证据里，没有进入任何评分维度。
    expect(item.observed_prices[0]?.value).toBe(380);
    expect(item.observed_prices[0]?.price_type).toBe("LISTING");
    expect(JSON.stringify(item.similarity)).not.toContain("380");
  });

  it("网页没写产品名的来源不进候选池（没有名字就不猜）", async () => {
    const sourceId = await ingestSource(NO_NAME_URL);
    const rebuilt = await rebuildPool();
    expect(rebuilt.stats.sources_considered).toBe(1);
    expect(rebuilt.stats.skipped_no_name).toBe(1);
    expect(rebuilt.stats.drafts).toBe(0);
    expect(rebuilt.created).toBe(0);
    expect(rebuilt.total).toBe(0);

    const list = await listCandidates();
    expect(list.total).toBe(0);
    // 来源本身仍然保留（证据不能被丢掉），只是不生成候选。
    const sourcesResponse = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/sources`,
      headers: authHeader(admin.accessToken)
    });
    expect(sourcesResponse.statusCode).toBe(200);
    const sourcesBody = sourcesResponse.json() as { items: { id: string }[] };
    expect(sourcesBody.items.some((entry) => entry.id === sourceId)).toBe(true);
  });

  it("低于本次构建阈值的候选照样入库，但标记拒绝并保留原始分档", async () => {
    await ingestSource(PRODUCT_A_URL);
    const strict = await rebuildPool({ min_score: 95 });
    expect(strict.min_score).toBe(95);
    expect(strict.below_min_score).toBe(1);
    expect(strict.band_counts.REJECT).toBe(1);
    expect(strict.total).toBe(1);

    const rejected = firstCandidate((await listCandidates()).items);
    expect(rejected.similarity_band).toBe("REJECT");
    expect(
      rejected.similarity.warnings.some(
        (warning) => warning.includes("阈值 95") && warning.includes("原始分档 CORE_COMPARABLE")
      )
    ).toBe(true);
    // 十维明细仍然保留原始打分，便于审计「为什么它本来是核心对标」。
    expect(rejected.similarity_total).toBe(88);
    expect(rejected.similarity.unknown_dimensions).toEqual(["positioning", "craft"]);

    const relaxed = await rebuildPool();
    expect(relaxed.below_min_score).toBe(0);
    expect(relaxed.band_counts.CORE_COMPARABLE).toBe(1);
    expect(firstCandidate((await listCandidates()).items).similarity_band).toBe("CORE_COMPARABLE");
  });

  it("spec_notes 不会冒充原料：候选的原料只来自网页写明的原料信息", async () => {
    await ingestSource(OTHER_TEA_URL);
    await rebuildPool();
    const item = firstCandidate((await listCandidates()).items);
    expect(item.spec_notes).toBe("压制较紧");
    // 网页没有写原料（树型 / 采摘季节），原料维度必须按 0 分，spec_notes 不得被当作原料。
    expect(dimensionOf(item, "material")?.note).toContain("按 0 分");
    expect(dimensionOf(item, "material")?.score).toBe(0);
    expect(item.similarity_total).toBe(3);
  });
});

describe("§13 人工评审与人工登记", () => {
  it("已评审过的候选不会被重算覆盖（keep_reviewed）", async () => {
    await ingestSource(PRODUCT_A_URL);
    await rebuildPool();
    const candidate = firstCandidate((await listCandidates()).items);

    const approved = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/candidates/${candidate.id}`,
      headers: authHeader(admin.accessToken),
      payload: { status: "APPROVED", review_note: "同年同产区，确认作为核心对标" }
    });
    expect(approved.statusCode).toBe(200);
    const approvedBody = approved.json() as CandidateItem;
    expect(approvedBody.status).toBe("APPROVED");
    expect(approvedBody.review_note).toContain("核心对标");
    expect(approvedBody.reviewed_by).toBe(admin.userId);
    expect(approvedBody.reviewed_at).not.toBeNull();

    const kept = await rebuildPool({ keep_reviewed: true });
    expect(kept.kept_reviewed).toBe(1);
    expect(kept.updated).toBe(1);
    const afterKeep = firstCandidate((await listCandidates()).items);
    expect(afterKeep.status).toBe("APPROVED");
    expect(afterKeep.review_note).toContain("核心对标");
    expect(afterKeep.similarity_total).toBe(88);

    const reset = await rebuildPool({ keep_reviewed: false });
    expect(reset.kept_reviewed).toBe(0);
    const afterReset = firstCandidate((await listCandidates()).items);
    expect(afterReset.status).toBe("PENDING_REVIEW");
    expect(afterReset.review_note).toBeNull();
    expect(afterReset.reviewed_by).toBeNull();
    expect(afterReset.reviewed_at).toBeNull();
  });

  it("人工登记候选走同一套十维评分，重复身份键冲突，缺名称被拒", async () => {
    const low = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/candidates`,
      headers: authHeader(admin.accessToken),
      payload: {
        name: "大益 7542",
        brand_name: "大益",
        year: 2019,
        tea_type: "普洱熟茶",
        mountain: "临沧",
        weight_g: 357,
        notes: "人工登记：渠道报价，仅作参考"
      }
    });
    expect(low.statusCode).toBe(201);
    const lowBody = low.json() as CandidateItem;
    expect(lowBody.identity_key).toBe("大益|大益7542|2019|357|");
    expect(lowBody.similarity_total).toBe(3);
    expect(lowBody.similarity_band).toBe("REJECT");
    expect(lowBody.status).toBe("PENDING_REVIEW");
    expect(lowBody.merged_sources).toBe(1);
    expect(lowBody.source_ids).toEqual([]);
    expect(lowBody.observed_prices).toEqual([]);
    expect(lowBody.notes).toContain("人工登记");

    const duplicate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/candidates`,
      headers: authHeader(admin.accessToken),
      payload: { name: "大益7542", brand_name: "大益", year: 2019, weight_g: 357 }
    });
    expect(duplicate.statusCode).toBe(409);

    const unnamed = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/candidates`,
      headers: authHeader(admin.accessToken),
      payload: { brand_name: "大益" }
    });
    expect(unnamed.statusCode).toBe(400);

    // 人工补全具名维度（仍不含价格）后，与「来源自比」一样只能拿到 88：
    // 工艺与市场定位在目标产品侧本来就缺失，任何候选都拿不到这两维的分。
    const high = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/candidates`,
      headers: authHeader(admin.accessToken),
      payload: {
        name: "六星孔雀（同年不同批次）",
        brand_name: "龙德记",
        year: 2026,
        tea_type: "普洱生茶",
        weight_g: 357,
        facet: {
          origin: { mountain: "布朗山" },
          material: ["大树春茶"],
          aroma: ["烟香明显"],
          taste: ["浓强", "回甘快", "生津强", "茶气明显"]
        }
      }
    });
    expect(high.statusCode).toBe(201);
    const highBody = high.json() as CandidateItem;
    expect(highBody.similarity_total).toBe(88);
    expect(highBody.similarity_band).toBe("CORE_COMPARABLE");
    expect(highBody.similarity.unknown_dimensions).toEqual(["positioning", "craft"]);
    expect(highBody.identity_key).toBe("龙德记|六星孔雀同年不同批次|2026|357|");

    const list = await listCandidates();
    expect(list.total).toBe(2);
  });

  it("权限边界：读需登录，写限 ADMIN/RESEARCHER，删除限 ADMIN", async () => {
    await ingestSource(PRODUCT_A_URL);
    await rebuildPool();
    const candidateId = firstCandidate((await listCandidates()).items).id;

    const candidateUrl = `/api/products/${productId}/candidates/${candidateId}`;
    for (const request of [
      { method: "GET" as const, url: `/api/products/${productId}/candidates` },
      { method: "GET" as const, url: candidateUrl },
      { method: "POST" as const, url: `/api/products/${productId}/candidates`, payload: { name: "匿名候选" } },
      { method: "PATCH" as const, url: candidateUrl, payload: { status: "APPROVED" } },
      { method: "DELETE" as const, url: candidateUrl }
    ]) {
      const anonymous = await context.app.inject(request);
      expect(anonymous.statusCode).toBe(401);
    }

    const viewerToken = await createUserToken("VIEWER");
    const viewerRead = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/candidates`,
      headers: authHeader(viewerToken)
    });
    expect(viewerRead.statusCode).toBe(200);
    const viewerWrite = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/candidates`,
      headers: authHeader(viewerToken),
      payload: { name: "只读用户候选" }
    });
    expect(viewerWrite.statusCode).toBe(403);
    const viewerPatch = await context.app.inject({
      method: "PATCH",
      url: candidateUrl,
      headers: authHeader(viewerToken),
      payload: { status: "APPROVED" }
    });
    expect(viewerPatch.statusCode).toBe(403);
    const viewerDelete = await context.app.inject({
      method: "DELETE",
      url: candidateUrl,
      headers: authHeader(viewerToken)
    });
    expect(viewerDelete.statusCode).toBe(403);

    const researcherToken = await createUserToken("RESEARCHER");
    const researcherCreate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/candidates`,
      headers: authHeader(researcherToken),
      payload: { name: "研究员登记候选", brand_name: "某厂" }
    });
    expect(researcherCreate.statusCode).toBe(201);
    const researcherCandidateId = (researcherCreate.json() as CandidateItem).id;
    const researcherPatch = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/candidates/${researcherCandidateId}`,
      headers: authHeader(researcherToken),
      payload: { status: "PENDING_REVIEW", review_note: "待与品牌方核对" }
    });
    expect(researcherPatch.statusCode).toBe(200);
    const researcherDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/candidates/${researcherCandidateId}`,
      headers: authHeader(researcherToken)
    });
    expect(researcherDelete.statusCode).toBe(403);

    const adminDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/candidates/${researcherCandidateId}`,
      headers: authHeader(admin.accessToken)
    });
    expect(adminDelete.statusCode).toBe(204);
    const gone = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/candidates/${researcherCandidateId}`,
      headers: authHeader(admin.accessToken)
    });
    expect(gone.statusCode).toBe(404);
  });
});

describe("§36 高价值茶数据库：候选列表筛选与排序", () => {
  async function seedTwoCandidates(): Promise<void> {
    await ingestSource(PRODUCT_A_URL);
    await rebuildPool();
    await ingestSource(OTHER_TEA_URL);
    await rebuildPool();
  }

  it("按分档 / 状态 / 关键词 / 最低分筛选，并按分数排序", async () => {
    await seedTwoCandidates();
    expect((await listCandidates()).total).toBe(2);

    const core = await listCandidates("?band=CORE_COMPARABLE");
    expect(core.total).toBe(1);
    expect(firstCandidate(core.items).name).toBe("龙德记六星孔雀");

    const rejected = await listCandidates("?band=REJECT");
    expect(rejected.total).toBe(1);
    expect(firstCandidate(rejected.items).name).toBe("大益 7542");

    const pending = await listCandidates("?status=PENDING_REVIEW");
    expect(pending.total).toBe(2);
    const approved = await listCandidates("?status=APPROVED");
    expect(approved.total).toBe(0);

    const byKeyword = await listCandidates("?q=大益");
    expect(byKeyword.total).toBe(1);
    expect(firstCandidate(byKeyword.items).name).toBe("大益 7542");
    const byName = await listCandidates("?q=孔雀");
    expect(byName.total).toBe(1);

    const highScore = await listCandidates("?min_score=50");
    expect(highScore.total).toBe(1);
    expect(firstCandidate(highScore.items).name).toBe("龙德记六星孔雀");

    const ascending = await listCandidates("?sort=score");
    expect(ascending.items.map((item) => item.similarity_total)).toEqual([3, 88]);
    const descending = await listCandidates("?sort=-score");
    expect(descending.items.map((item) => item.similarity_total)).toEqual([88, 3]);
    const byCreated = await listCandidates("?sort=-created_at");
    expect(firstCandidate(byCreated.items).name).toBe("大益 7542");

    const paged = await listCandidates("?sort=-score&page=2&pageSize=1");
    expect(paged.total).toBe(2);
    expect(paged.items).toHaveLength(1);
    expect(firstCandidate(paged.items).name).toBe("大益 7542");
  });

  it("跨产品候选池（/api/candidates）带 product_id 过滤，并回传目标产品名", async () => {
    await seedTwoCandidates();

    const global = await context.app.inject({
      method: "GET",
      url: "/api/candidates?sort=-score",
      headers: authHeader(admin.accessToken)
    });
    expect(global.statusCode).toBe(200);
    const globalBody = global.json() as { items: CandidateItem[]; total: number };
    expect(globalBody.total).toBe(2);
    const top = firstCandidate(globalBody.items);
    expect(top.product_id).toBe(productId);
    expect(top.product_name).toBe("龙德记六星孔雀");

    const filtered = await context.app.inject({
      method: "GET",
      url: `/api/candidates?product_id=${productId}&min_score=50`,
      headers: authHeader(admin.accessToken)
    });
    const filteredBody = filtered.json() as { items: CandidateItem[]; total: number };
    expect(filteredBody.total).toBe(1);
    expect(firstCandidate(filteredBody.items).similarity_total).toBe(88);

    const badQuery = await context.app.inject({
      method: "GET",
      url: "/api/candidates?min_score=140",
      headers: authHeader(admin.accessToken)
    });
    expect(badQuery.statusCode).toBe(400);
  });
});

describe("§55 研究流水线联调：候选池与相似度阶段落地", () => {
  it("跑完研究任务后候选池有数据，两个新阶段标记为已交付", async () => {
    await ingestSource(PRODUCT_A_URL);
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/research/runs`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      status: string;
      stages_run: string[];
      candidates_created: number;
      candidates_total: number;
      candidate_band_counts: Record<string, number>;
      implemented_phases: number[];
      progress: { stage: string; status: string; implemented: boolean }[];
    };
    expect(body.status).toBe("SUCCEEDED");
    expect(body.stages_run).toContain("CANDIDATE_POOL");
    expect(body.stages_run).toContain("SIMILARITY_SCORE");
    expect(body.candidates_total).toBe(1);
    expect(body.candidates_created).toBe(1);
    expect(body.candidate_band_counts.CORE_COMPARABLE).toBe(1);
    expect(body.implemented_phases).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    for (const stage of ["CANDIDATE_POOL", "SIMILARITY_SCORE"]) {
      const entry = body.progress.find((item) => item.stage === stage);
      expect(entry?.status).toBe("SUCCEEDED");
      expect(entry?.implemented).toBe(true);
    }

    const list = await listCandidates();
    expect(list.total).toBe(1);
    expect(firstCandidate(list.items).similarity_total).toBe(88);
  });
});
