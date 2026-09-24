import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  generateValidatedJson,
  type AiGenerateOptions,
  type AiJsonOptions,
  type AiProvider,
  type AiTextResult
} from "@ldj/ai";
import type { PriceType, PriceUnitScope, SourceKind } from "@ldj/schemas";
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
 * Phase 6（规格 §14 市场价格系统 / §15 Price Evidence Score / §16.1 锚点价格条件）。
 *
 * 本文件锁定价格引擎的四条红线与三档归属：
 * - **挂牌 ≠ 成交**（§62-2）：价格类型按来源原文判定，汇总里分开计数，缺成交证据必须明说；
 * - **整件 ≠ 单饼**（§62-3）：整件价算 1kg 等价但绝不输出 357g 单饼等价；
 * - **没有写 = 不计算**（§14）：缺规格重量时不换算、不拿别处规格倒算；
 * - **未写明身份 ≠ 多来源印证**：SOURCE_UNATTRIBUTED 不与其他来源合并；
 * - **异常值只标记不删除**（§62-15）：同组 4 条起判定，样本不足时宁可不下结论。
 */

interface PagePrice {
  value: number;
  quote: string;
  priceType: PriceType;
  unitScope: PriceUnitScope;
  weightG: number | null;
}

interface PageSpec {
  url: string;
  productName: string | null;
  brandName: string | null;
  year: number | null;
  weightG: number | null;
  price: PagePrice | null;
}

function pageUrl(slug: string): string {
  return `https://market.example.com/${slug}`;
}

/** 同款行情页：产品身份写在页面上，价格原句逐字可回溯。 */
function sameProductPage(slug: string, price: PagePrice): PageSpec {
  return {
    url: pageUrl(slug),
    productName: "龙德记六星孔雀",
    brandName: "龙德记",
    year: 2026,
    weightG: 357,
    price
  };
}

function piecePrice(
  value: number,
  priceType: PriceType = "VERIFIED_TRANSACTION",
  label = "成交价"
): PagePrice {
  return {
    value,
    quote: `${label} ${value} 元/饼`,
    priceType,
    unitScope: "PIECE",
    weightG: null
  };
}

const SPECS: PageSpec[] = [
  // 两条成交价：同一款茶、不同来源、不同价格 → 各自成条，不合并。
  sameProductPage("peacock-deal-12000", piecePrice(12000)),
  sameProductPage("peacock-deal-15000", piecePrice(15000)),
  // 同一价格被两个来源写到 → 合并成一条并计入多来源印证。
  sameProductPage("peacock-deal-13000-a", piecePrice(13000)),
  sameProductPage("peacock-deal-13000-b", piecePrice(13000)),
  // 整件价：来源写明了整件总重（30 饼 / 10710g）。
  {
    url: pageUrl("peacock-case-480000"),
    productName: "龙德记六星孔雀",
    brandName: "龙德记",
    year: 2026,
    weightG: 10710,
    price: {
      value: 480000,
      quote: "成交整件价 480000 元/件",
      priceType: "VERIFIED_TRANSACTION",
      unitScope: "CASE",
      weightG: 10710
    }
  },
  // 没写单位的成交价：不做任何 357g / 1kg 等价。
  {
    url: pageUrl("peacock-deal-20000-no-unit"),
    productName: "龙德记六星孔雀",
    brandName: "龙德记",
    year: 2026,
    weightG: null,
    price: { value: 20000, quote: "成交价 20000 元", priceType: "VERIFIED_TRANSACTION", unitScope: "UNKNOWN", weightG: null }
  },
  // 挂牌价：不得当作成交价。
  sameProductPage("peacock-listing-9000", piecePrice(9000, "LISTING", "挂牌价")),
  // 未写明产品身份的来源：不参与跨来源印证。
  {
    url: pageUrl("nameless-price-note"),
    productName: null,
    brandName: null,
    year: null,
    weightG: null,
    price: piecePrice(7777)
  },
  // 异常值组：4 条同类型 + 同单位 + 同币种 + 同规格。
  sameProductPage("peacock-deal-10000", piecePrice(10000)),
  sameProductPage("peacock-deal-11000", piecePrice(11000)),
  sameProductPage("peacock-deal-12200", piecePrice(12200)),
  sameProductPage("peacock-deal-60000", piecePrice(60000))
];

const SPEC_BY_URL = new Map(SPECS.map((spec) => [spec.url, spec]));

/** 页面正文：产品身份与价格原句都逐字写在页面上（没有写的字段一律不写）。 */
function htmlFor(spec: PageSpec): string {
  const lines: string[] = [];
  if (spec.productName) {
    lines.push(`<h1>${spec.productName}</h1>`);
  }
  const identity: string[] = [];
  if (spec.brandName) {
    identity.push(`品牌：${spec.brandName}`);
  }
  if (spec.year !== null) {
    identity.push(`年份：${spec.year} 年`);
  }
  if (identity.length > 0) {
    lines.push(`<p>${identity.join(" ")}</p>`);
  }
  if (spec.weightG !== null) {
    lines.push(`<p>规格 ${spec.weightG}g。</p>`);
  }
  if (spec.price) {
    lines.push(`<p>${spec.price.quote}。</p>`);
  }
  return `<html><head><title>${spec.productName ?? "行情随笔"}</title></head><body>${lines.join("\n")}</body></html>`;
}

function extractionJsonFor(spec: PageSpec): string {
  return JSON.stringify({
    product_name: spec.productName,
    brand_name: spec.brandName,
    year: spec.year,
    tea_type: spec.productName ? "普洱生茶" : null,
    origin_region: null,
    mountain: null,
    village: null,
    weight_g: spec.weightG,
    spec_notes: null,
    storage: null,
    prices: spec.price
      ? [
          {
            value: spec.price.value,
            currency: "CNY",
            quote: spec.price.quote,
            price_type: spec.price.priceType,
            unit_scope: spec.price.unitScope,
            weight_g: spec.price.weightG,
            observed_at: null,
            note: null
          }
        ]
      : [],
    facts: [],
    null_reason: null
  });
}

/**
 * 规则化 Mock AI：按 prompt 里出现的来源 URL 返回该页面的抽取结果。
 * 返回内容与页面正文逐字一致，用于验证价格引擎拿到的就是「网页真的写了什么」。
 */
class PriceFixtureAiProvider implements AiProvider {
  readonly name = "price-fixture";

  async generateText(options: AiGenerateOptions): Promise<AiTextResult> {
    const prompt = options.messages.map((message) => message.content).join("\n");
    const matched = SPECS.find((spec) => prompt.includes(spec.url));
    const text = matched ? extractionJsonFor(matched) : JSON.stringify({ prices: [], facts: [] });
    return { text, model: "price-fixture", provider: this.name };
  }

  async generateJson<T>(options: AiJsonOptions<T>): Promise<{ data: T; raw: AiTextResult }> {
    const result = await generateValidatedJson(
      async (messages) => {
        const raw = await this.generateText({ ...options, messages });
        return { text: raw.text, model: raw.model, provider: raw.provider };
      },
      options
    );
    const raw = await this.generateText(options);
    return { data: result.data, raw };
  }
}

function buildFakeFetch(): typeof fetch {
  return (async (input: string | URL | { url: string }) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const spec = SPEC_BY_URL.get(url);
    if (!spec) {
      return new Response("<html><body></body></html>", {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    return new Response(htmlFor(spec), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }) as unknown as typeof fetch;
}

interface EvidenceItem {
  component: string;
  label: string;
  weight: number;
  score: number;
  note: string;
}

interface OfferView {
  id: string;
  product_id: string;
  product_name: string | null;
  candidate_id: string | null;
  candidate_name: string | null;
  source_id: string | null;
  source_kind: string | null;
  domain: string | null;
  url: string | null;
  subject_name: string | null;
  subject_brand: string | null;
  subject_year: number | null;
  identity_key: string | null;
  price_type: string;
  unit_scope: string | null;
  value: number;
  currency: string;
  weight_g: number | null;
  unit_grams: number | null;
  price_per_kg: number | null;
  price_357g: number | null;
  piece_equivalent_allowed: boolean;
  evidence_score: number;
  evidence_band: string;
  evidence: { score: number; band: string; items: EvidenceItem[]; notes: string[] };
  attribution: string;
  quote: string;
  quote_traceable: boolean;
  note: string | null;
  manual_note: string | null;
  observed_at: string | null;
  published_at: string | null;
  is_outlier: boolean;
  outlier_reason: string | null;
  outlier_median: number | null;
  outlier_sample_size: number | null;
  outlier_group_key: string | null;
  is_excluded: boolean;
  created_by: string | null;
}

interface SummaryBody {
  product_id: string;
  total_offers: number;
  counted_offers: number;
  strong_offers: number;
  usable_offers: number;
  weak_offers: number;
  outlier_count: number;
  excluded_count: number;
  unattributed_count: number;
  transaction_count: number;
  listing_count: number;
  reliable_count: number;
  buckets: { price_type: string; unit_scope: string | null; count: number; median_price_357g: number | null }[];
  price_level: { basis: string; sample_size: number; median_price_357g: number | null };
  notes: string[];
  spec_ref: string;
}

interface RebuildBody {
  total: number;
  created: number;
  updated: number;
  kept_manual: number;
  outliers: number;
  outlier_groups: number;
  band_counts: Record<string, number>;
  reached_limit: boolean;
  stats: {
    sources_considered: number;
    prices_considered: number;
    drafts: number;
    merged_multi_source: number;
    unattributed: number;
    skipped_limit: number;
  };
  summary: SummaryBody;
  spec_ref: string;
}

let context: TestContext;
let admin: BootstrapResult;
let productId: string;

beforeAll(async () => {
  context = await createTestContext({
    aiProvider: new PriceFixtureAiProvider(),
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

/** 登记来源 → 抓取正文 → AI 抽取：价格引擎的输入就是这一步的结果。 */
async function ingestSource(
  url: string,
  options: { sourceKind?: SourceKind; publishedAt?: string | null } = {}
): Promise<string> {
  const registered = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/sources`,
    headers: authHeader(admin.accessToken),
    payload: {
      url,
      source_kind: options.sourceKind ?? "PRODUCT_PAGE",
      ...(options.publishedAt === null || options.publishedAt === undefined
        ? {}
        : { published_at: options.publishedAt })
    }
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

/** 登记来源时默认写最近日期：新鲜度按「近半年内」给满分。 */
async function ingestFresh(url: string, sourceKind: SourceKind = "PRODUCT_PAGE"): Promise<string> {
  return ingestSource(url, { sourceKind, publishedAt: new Date().toISOString() });
}

async function rebuildPrices(payload: Record<string, unknown> = {}): Promise<RebuildBody> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/market-offers/rebuild`,
    headers: authHeader(admin.accessToken),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as RebuildBody;
}

async function listOffers(
  query = "",
  token = admin.accessToken
): Promise<{ items: OfferView[]; total: number }> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/market-offers${query}`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { items: OfferView[]; total: number };
}

async function summary(token = admin.accessToken): Promise<SummaryBody> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/price-summary`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as SummaryBody;
}

async function createManual(
  payload: Record<string, unknown>,
  token = admin.accessToken
): Promise<OfferView> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/market-offers`,
    headers: authHeader(token),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as OfferView;
}

/** noUncheckedIndexedAccess：按下标取价格条目时空列表直接失败，避免用 `!` 掩盖问题。 */
function offerWithValue(items: OfferView[], value: number): OfferView {
  const item = items.find((entry) => entry.value === value);
  if (!item) {
    throw new Error(`没有找到价格为 ${value} 的价格证据`);
  }
  return item;
}

function componentOf(offer: OfferView, component: string): EvidenceItem | undefined {
  return offer.evidence.items.find((item) => item.component === component);
}

describe("§14 价格合同（挂牌≠成交 / 整件≠单饼 / 没有写=不计算）", () => {
  it("合同自检：五项权重合计 100、价格不参与相似度、四条红线齐全、归属四档", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/prices/contract",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      contract: {
        spec_ref: string;
        evidence_components: { component: string; weight: number }[];
        evidence_weight_total: number;
        evidence_bands: Record<string, string>;
        outlier_min_sample: number;
        case_piece_equivalent_allowed: boolean;
        price_in_similarity: boolean;
        rules: string[];
      };
      engine: {
        price_in_similarity: boolean;
        case_piece_equivalent_allowed: boolean;
        min_reliable_evidence: number;
        requires_weight_for_equivalence: boolean;
        basis_priority: string[];
      };
      attribution_labels: Record<string, string>;
    };

    expect(body.contract.price_in_similarity).toBe(false);
    expect(body.engine.price_in_similarity).toBe(false);
    expect(body.contract.evidence_weight_total).toBe(100);
    expect(body.contract.evidence_components.map((item) => item.component)).toEqual([
      "nature_clarity",
      "source_credibility",
      "product_identity",
      "freshness",
      "cross_source"
    ]);
    expect(body.contract.evidence_components.map((item) => item.weight)).toEqual([25, 25, 20, 15, 15]);
    expect(body.contract.evidence_components.some((item) => /price|价格/.test(item.component))).toBe(
      false
    );
    expect(Object.keys(body.contract.evidence_bands)).toEqual(["STRONG", "USABLE", "WEAK"]);
    expect(body.contract.outlier_min_sample).toBe(4);
    expect(body.contract.case_piece_equivalent_allowed).toBe(false);
    expect(body.engine.case_piece_equivalent_allowed).toBe(false);
    expect(body.engine.min_reliable_evidence).toBe(75);
    expect(body.engine.requires_weight_for_equivalence).toBe(true);
    for (const rule of ["挂牌价 ≠ 成交价", "整件价 ≠ 单饼价（整件溢价不线性拆分）", "历史 / 口述价格 ≠ 当前价格", "没有写 = 不计算等价、不推断补全"]) {
      expect(body.contract.rules).toContain(rule);
    }
    expect(Object.keys(body.attribution_labels).sort()).toEqual([
      "CANDIDATE",
      "MANUAL",
      "SOURCE_IDENTIFIED",
      "SOURCE_UNATTRIBUTED"
    ]);

    const anonymous = await context.app.inject({ method: "GET", url: "/api/prices/contract" });
    expect(anonymous.statusCode).toBe(401);
    const anonymousList = await context.app.inject({ method: "GET", url: "/api/market-offers" });
    expect(anonymousList.statusCode).toBe(401);
  });
});

describe("§14 价格证据：由来源重建", () => {
  it("两条成交价各自成条：单位 / 规格 / 等价价与五项证据分明细都正确", async () => {
    await ingestFresh(pageUrl("peacock-deal-12000"));
    await ingestFresh(pageUrl("peacock-deal-15000"));

    const rebuilt = await rebuildPrices();
    expect(rebuilt.created).toBe(2);
    expect(rebuilt.updated).toBe(0);
    expect(rebuilt.total).toBe(2);
    expect(rebuilt.stats).toEqual({
      sources_considered: 2,
      prices_considered: 2,
      drafts: 2,
      merged_multi_source: 0,
      unattributed: 0,
      skipped_limit: 0
    });
    expect(rebuilt.band_counts).toEqual({ STRONG: 2, USABLE: 0, WEAK: 0 });
    expect(rebuilt.reached_limit).toBe(false);
    expect(rebuilt.spec_ref).toBe("§14 / §15 / §16.1");

    const offer = offerWithValue((await listOffers()).items, 12000);
    expect(offer.product_name).toBe("龙德记六星孔雀");
    expect(offer.subject_name).toBe("龙德记六星孔雀");
    expect(offer.subject_brand).toBe("龙德记");
    expect(offer.subject_year).toBe(2026);
    expect(offer.identity_key).toBe("龙德记|龙德记六星孔雀|2026|357|");
    expect(offer.price_type).toBe("VERIFIED_TRANSACTION");
    expect(offer.unit_scope).toBe("PIECE");
    // 单饼价沿用同一来源页面写明的规格重量：这不是换算，也不是拿产品主档去补。
    expect(offer.weight_g).toBe(357);
    expect(offer.unit_grams).toBe(357);
    expect(offer.price_357g).toBe(12000);
    expect(offer.price_per_kg).toBe(33613.45);
    expect(offer.piece_equivalent_allowed).toBe(true);
    expect(offer.currency).toBe("CNY");
    expect(offer.source_kind).toBe("PRODUCT_PAGE");
    expect(offer.domain).toBe("market.example.com");
    expect(offer.url).toBe(pageUrl("peacock-deal-12000"));
    expect(offer.attribution).toBe("SOURCE_IDENTIFIED");
    expect(offer.quote_traceable).toBe(true);
    expect(offer.is_outlier).toBe(false);

    // 五项证据分：性质 25 + 来源 25 + 身份 20 + 新鲜度 15 + 多来源 6 = 91（强证据）
    expect(offer.evidence_score).toBe(91);
    expect(offer.evidence_band).toBe("STRONG");
    expect(offer.evidence.score).toBe(91);
    expect(offer.evidence.items.map((item) => item.component)).toEqual([
      "nature_clarity",
      "source_credibility",
      "product_identity",
      "freshness",
      "cross_source"
    ]);
    expect(offer.evidence.items.map((item) => item.weight)).toEqual([25, 25, 20, 15, 15]);
    expect(componentOf(offer, "nature_clarity")?.score).toBe(25);
    expect(componentOf(offer, "source_credibility")?.score).toBe(25);
    expect(componentOf(offer, "product_identity")?.note).toContain("产品名");
    expect(componentOf(offer, "product_identity")?.note).toContain("规格");
    expect(componentOf(offer, "freshness")?.score).toBe(15);
    expect(componentOf(offer, "cross_source")?.score).toBe(6);

    const summaryBody = await summary();
    expect(summaryBody.total_offers).toBe(2);
    expect(summaryBody.counted_offers).toBe(2);
    expect(summaryBody.strong_offers).toBe(2);
    expect(summaryBody.outlier_count).toBe(0);
    expect(summaryBody.transaction_count).toBe(2);
    expect(summaryBody.listing_count).toBe(0);
    expect(summaryBody.reliable_count).toBe(2);
    expect(summaryBody.unattributed_count).toBe(0);
    expect(summaryBody.price_level.basis).toBe("VERIFIED_TRANSACTION");
    expect(summaryBody.price_level.sample_size).toBe(2);
    expect(summaryBody.spec_ref).toBe("§14 / §15 / §16.1");
    expect(summaryBody.buckets).toHaveLength(1);
    expect(summaryBody.buckets[0]?.count).toBe(2);
    expect(summaryBody.buckets[0]?.median_price_357g).toBe(13500);
  });

  it("同一价格被两个来源写到：合并成一条并计入多来源印证（不是两条重复证据）", async () => {
    await ingestFresh(pageUrl("peacock-deal-13000-a"));
    await ingestFresh(pageUrl("peacock-deal-13000-b"));

    const rebuilt = await rebuildPrices();
    expect(rebuilt.created).toBe(1);
    expect(rebuilt.total).toBe(1);
    expect(rebuilt.stats.sources_considered).toBe(2);
    expect(rebuilt.stats.prices_considered).toBe(2);
    expect(rebuilt.stats.drafts).toBe(1);
    expect(rebuilt.stats.merged_multi_source).toBe(1);

    const list = await listOffers();
    expect(list.total).toBe(1);
    const offer = offerWithValue(list.items, 13000);
    expect(offer.evidence_score).toBe(95);
    expect(componentOf(offer, "cross_source")?.score).toBe(10);
    expect(componentOf(offer, "cross_source")?.note).toContain("2 个不同来源");
  });

  it("整件价：算得出 1kg 等价，但绝不输出 357g 单饼等价", async () => {
    await ingestFresh(pageUrl("peacock-case-480000"));
    await rebuildPrices();

    const offer = offerWithValue((await listOffers()).items, 480000);
    expect(offer.price_type).toBe("VERIFIED_TRANSACTION");
    expect(offer.unit_scope).toBe("CASE");
    expect(offer.weight_g).toBe(10710);
    expect(offer.unit_grams).toBe(10710);
    expect(offer.price_per_kg).toBe(44817.93);
    expect(offer.price_357g).toBeNull();
    expect(offer.piece_equivalent_allowed).toBe(false);
    expect(offer.evidence.notes.some((note) => note.includes("整件价 ≠ 单饼价"))).toBe(true);

    const summaryBody = await summary();
    expect(summaryBody.notes.some((note) => note.includes("整件价"))).toBe(true);
    expect(summaryBody.buckets[0]?.median_price_357g).toBeNull();
  });

  it("来源没写单位：不做任何 357g / 1kg 等价，也不倒算规格", async () => {
    await ingestFresh(pageUrl("peacock-deal-20000-no-unit"));
    await rebuildPrices();

    const offer = offerWithValue((await listOffers()).items, 20000);
    expect(offer.unit_scope).toBe("UNKNOWN");
    expect(offer.weight_g).toBeNull();
    expect(offer.unit_grams).toBeNull();
    expect(offer.price_per_kg).toBeNull();
    expect(offer.price_357g).toBeNull();
    expect(componentOf(offer, "nature_clarity")?.note).toContain("未写明单饼 / 整件");
    // 性质不明要扣分：成交性质虽有，但单位未写明，按 §14 扣 8 分。
    expect(componentOf(offer, "nature_clarity")?.score).toBe(17);
  });

  it("挂牌价不当成交价：汇总明确提示不得表述为成交，成交条数只数成交证据", async () => {
    await ingestFresh(pageUrl("peacock-listing-9000"));
    await rebuildPrices();

    const offer = offerWithValue((await listOffers()).items, 9000);
    expect(offer.price_type).toBe("LISTING");
    expect(offer.evidence.notes.some((note) => note.includes("挂牌价 ≠ 成交价"))).toBe(true);
    // 挂牌性质 18 + 来源 25 + 身份 20 + 新鲜度 15 + 多来源 6 = 84
    expect(offer.evidence_score).toBe(84);
    expect(componentOf(offer, "nature_clarity")?.score).toBe(18);

    const summaryBody = await summary();
    expect(summaryBody.listing_count).toBe(1);
    expect(summaryBody.transaction_count).toBe(0);
    expect(
      summaryBody.notes.some((note) => note.includes("不得表述为成交价"))
    ).toBe(true);
  });

  it("来源没写产品身份：标记 SOURCE_UNATTRIBUTED，两条无人认领的价格绝不互相印证", async () => {
    const sourceId = await ingestFresh(pageUrl("nameless-price-note"));
    await rebuildPrices();

    const offer = offerWithValue((await listOffers()).items, 7777);
    expect(offer.attribution).toBe("SOURCE_UNATTRIBUTED");
    expect(offer.subject_name).toBeNull();
    expect(offer.identity_key).toBeNull();
    expect(offer.source_id).toBe(sourceId);
    expect(offer.evidence_score).toBe(71);
    expect(offer.evidence_band).toBe("USABLE");
    expect(componentOf(offer, "cross_source")?.score).toBe(6);
    expect(componentOf(offer, "product_identity")?.score).toBe(0);

    const summaryBody = await summary();
    expect(summaryBody.unattributed_count).toBe(1);
    expect(summaryBody.notes.some((note) => note.includes("未写明产品身份的来源"))).toBe(true);
  });

  it("候选池里有同一身份时归属升级为 CANDIDATE（价格本身不参与候选评分）", async () => {
    await ingestFresh(pageUrl("peacock-deal-12000"));

    const rebuiltCandidates = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/candidates/rebuild`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(rebuiltCandidates.statusCode).toBe(201);
    expect((rebuiltCandidates.json() as { total: number }).total).toBe(1);

    await rebuildPrices();
    const offer = offerWithValue((await listOffers()).items, 12000);
    expect(offer.attribution).toBe("CANDIDATE");
    expect(offer.candidate_id).not.toBeNull();
    expect(offer.candidate_name).toBe("龙德记六星孔雀");
    expect(offer.attribution).not.toBe("SOURCE_IDENTIFIED");
  });

  it("重建不会覆盖人工登记的价格，人工修正过的单位也不被来源值冲掉", async () => {
    const sourceId = await ingestFresh(pageUrl("peacock-deal-12000"));
    const manual = await createManual({
      value: 12000,
      price_type: "VERIFIED_TRANSACTION",
      unit_scope: "PIECE",
      weight_g: 357,
      subject_name: "龙德记六星孔雀",
      subject_brand: "龙德记",
      subject_year: 2026,
      candidate_id: null,
      source_id: sourceId,
      quote: "成交价 12000 元/饼",
      observed_at: null,
      note: "人工登记：与品牌方核对过的历史成交"
    });
    expect(manual.attribution).toBe("MANUAL");
    expect(manual.quote_traceable).toBe(true);

    const rebuilt = await rebuildPrices();
    expect(rebuilt.kept_manual).toBe(1);
    expect(rebuilt.created).toBe(0);
    expect(rebuilt.total).toBe(1);
    const kept = offerWithValue((await listOffers()).items, 12000);
    expect(kept.attribution).toBe("MANUAL");
    expect(kept.note).toContain("品牌方核对");
  });
});

describe("§55 价格异常值检测（只标记，不删除）", () => {
  it("同类型同单位同规格满 4 条才判定：偏离中位数的标记异常并给出理由", async () => {
    await ingestFresh(pageUrl("peacock-deal-10000"));
    await ingestFresh(pageUrl("peacock-deal-11000"));
    await ingestFresh(pageUrl("peacock-deal-12200"));
    await ingestFresh(pageUrl("peacock-deal-60000"));

    const rebuilt = await rebuildPrices();
    expect(rebuilt.total).toBe(4);
    expect(rebuilt.outliers).toBe(1);
    expect(rebuilt.outlier_groups).toBe(1);

    const items = (await listOffers()).items;
    const outlier = offerWithValue(items, 60000);
    expect(outlier.is_outlier).toBe(true);
    expect(outlier.outlier_sample_size).toBe(4);
    expect(outlier.outlier_group_key).toBe("VERIFIED_TRANSACTION|PIECE|CNY|357");
    expect(outlier.outlier_reason).toContain("偏离同组中位数");
    expect(outlier.is_excluded).toBe(false);

    for (const value of [10000, 11000, 12200]) {
      const normal = offerWithValue(items, value);
      expect(normal.is_outlier).toBe(false);
      expect(normal.outlier_reason).toBeNull();
      expect(normal.outlier_sample_size).toBe(4);
    }

    const summaryBody = await summary();
    expect(summaryBody.outlier_count).toBe(1);
    // 异常值不计入可靠价格锚点（§16.1）：4 条强证据里只有 3 条可用。
    expect(summaryBody.reliable_count).toBe(3);
    expect(summaryBody.notes.some((note) => note.includes("异常值"))).toBe(true);

    const onlyOutliers = await listOffers("?is_outlier=true");
    expect(onlyOutliers.total).toBe(1);
    expect(offerWithValue(onlyOutliers.items, 60000).is_outlier).toBe(true);
    const withoutOutliers = await listOffers("?is_outlier=false");
    expect(withoutOutliers.total).toBe(3);
  });

  it("样本少于 4 条时不判定异常：宁可不下结论，也要写清原因", async () => {
    await ingestFresh(pageUrl("peacock-deal-12000"));
    await ingestFresh(pageUrl("peacock-deal-15000"));
    await rebuildPrices();

    for (const offer of (await listOffers()).items) {
      expect(offer.is_outlier).toBe(false);
      expect(offer.outlier_sample_size).toBe(2);
      expect(offer.outlier_reason).toBe("同组样本不足（2 条，少于 4 条），不做异常值判断");
    }
    const summaryBody = await summary();
    expect(summaryBody.outlier_count).toBe(0);
    expect(summaryBody.reliable_count).toBe(2);
  });
});

describe("§14 人工登记与人工修正", () => {
  it("人工登记：201 + MANUAL 归属 + 引文不可回溯要如实扣分；重复登记 409", async () => {
    const payload = {
      value: 18000,
      price_type: "LISTING",
      unit_scope: "PIECE",
      weight_g: 357,
      subject_name: "龙德记六星孔雀（渠道报价）",
      subject_brand: "龙德记",
      subject_year: 2026,
      subject_spec: null,
      candidate_id: null,
      source_id: null,
      quote: "渠道口头报价 18000 元/饼（微信记录）",
      observed_at: null,
      note: "人工登记：经销商渠道报价"
    };
    const created = await createManual(payload);
    expect(created.attribution).toBe("MANUAL");
    expect(created.price_type).toBe("LISTING");
    expect(created.weight_g).toBe(357);
    expect(created.price_357g).toBe(18000);
    expect(created.created_by).toBe(admin.userId);
    // 人工登记的最保守口径：没有来源页面可核对，性质与来源可信度都按最低档给分。
    // 性质 18 - 6（引文不可回溯）= 12；来源未分类 8；身份 8+4+4+4 = 20；
    // 没有时间 4（未知 ≠ 新鲜）；只有 1 个来源 6 → 合计 50。
    expect(created.quote_traceable).toBe(false);
    expect(componentOf(created, "nature_clarity")?.score).toBe(12);
    expect(componentOf(created, "source_credibility")?.score).toBe(8);
    expect(componentOf(created, "product_identity")?.score).toBe(20);
    expect(componentOf(created, "freshness")?.score).toBe(4);
    expect(componentOf(created, "cross_source")?.score).toBe(6);
    expect(created.evidence_score).toBe(50);
    expect(created.evidence_band).toBe("WEAK");

    const duplicate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(admin.accessToken),
      payload
    });
    expect(duplicate.statusCode).toBe(409);
    expect(
      (duplicate.json() as { error?: { details?: { offer_id?: string } } }).error?.details
        ?.offer_id
    ).toBe(created.id);

    const missingQuote = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(admin.accessToken),
      payload: { ...payload, value: 19000, quote: "" }
    });
    expect(missingQuote.statusCode).toBe(400);
  });

  it("PATCH 改单位 / 规格：重算证据分与去重键；排除后不进汇总", async () => {
    const created = await createManual({
      value: 6000,
      price_type: "LISTING",
      unit_scope: "PIECE",
      weight_g: 357,
      subject_name: "龙德记六星孔雀",
      subject_brand: "龙德记",
      subject_year: 2026,
      candidate_id: null,
      source_id: null,
      quote: "挂牌价 6000 元/饼",
      observed_at: null,
      note: null
    });
    expect(created.price_357g).toBe(6000);
    expect(created.piece_equivalent_allowed).toBe(true);

    const patched = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/market-offers/${created.id}`,
      headers: authHeader(admin.accessToken),
      payload: { unit_scope: "CASE", weight_g: 10710, manual_note: "整件报价，按整件口径记录" }
    });
    expect(patched.statusCode).toBe(200);
    const patchedBody = patched.json() as OfferView;
    expect(patchedBody.unit_scope).toBe("CASE");
    expect(patchedBody.weight_g).toBe(10710);
    expect(patchedBody.unit_grams).toBe(10710);
    expect(patchedBody.price_per_kg).toBe(560.22);
    expect(patchedBody.price_357g).toBeNull();
    expect(patchedBody.piece_equivalent_allowed).toBe(false);
    expect(patchedBody.manual_note).toContain("整件口径");
    expect(patchedBody.price_type).toBe("LISTING");
    expect(patchedBody.value).toBe(6000);

    // 去重键已随单位 / 规格重算：按新口径再登记同价要判冲突，而不是并存两条。
    const clash = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(admin.accessToken),
      payload: {
        value: 6000,
        price_type: "LISTING",
        unit_scope: "CASE",
        weight_g: 10710,
        subject_name: "龙德记六星孔雀",
        subject_brand: "龙德记",
        subject_year: 2026,
        quote: "整件挂牌价 6000 元/件"
      }
    });
    expect(clash.statusCode).toBe(409);

    const nowBundled = await createManual({
      value: 7000,
      price_type: "LISTING",
      unit_scope: "CASE",
      weight_g: 10710,
      subject_name: "龙德记六星孔雀",
      subject_brand: "龙德记",
      subject_year: 2026,
      quote: "整件挂牌价 7000 元/件"
    });
    expect(nowBundled.price_357g).toBeNull();

    const before = await summary();
    expect(before.counted_offers).toBe(2);
    expect(before.notes.some((note) => note.includes("整件价"))).toBe(true);

    const excluded = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/market-offers/${nowBundled.id}`,
      headers: authHeader(admin.accessToken),
      payload: { is_excluded: true }
    });
    expect(excluded.statusCode).toBe(200);
    expect((excluded.json() as OfferView).is_excluded).toBe(true);

    const after = await summary();
    expect(after.total_offers).toBe(2);
    expect(after.counted_offers).toBe(1);
    expect(after.excluded_count).toBe(1);

    const hiddenByDefault = await listOffers();
    expect(hiddenByDefault.total).toBe(1);
    const included = await listOffers("?include_excluded=true");
    expect(included.total).toBe(2);
  });

  it("来源 / 候选必须属于本产品：跨产品引用一律 400", async () => {
    const other = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { ...SIX_STAR_PEACOCK_FIXTURE, product_name: "龙德记冰岛", brand_id: null }
    });
    expect(other.statusCode).toBe(201);
    const otherProductId = (other.json() as { id: string }).id;
    const foreignSource = await context.app.inject({
      method: "POST",
      url: `/api/products/${otherProductId}/sources`,
      headers: authHeader(admin.accessToken),
      payload: { url: pageUrl("peacock-deal-12000") }
    });
    expect(foreignSource.statusCode).toBe(201);
    const foreignSourceId = (foreignSource.json() as { source: { id: string } }).source.id;

    const base = {
      value: 5000,
      price_type: "LISTING",
      unit_scope: "PIECE",
      subject_name: "龙德记六星孔雀",
      quote: "挂牌价 5000 元/饼"
    };
    const badSource = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(admin.accessToken),
      payload: { ...base, source_id: foreignSourceId }
    });
    expect(badSource.statusCode).toBe(400);

    const badCandidate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(admin.accessToken),
      payload: { ...base, candidate_id: "00000000-0000-4000-8000-000000000000" }
    });
    expect(badCandidate.statusCode).toBe(400);

    const missingProduct = await context.app.inject({
      method: "POST",
      url: "/api/products/00000000-0000-4000-8000-000000000000/market-offers",
      headers: authHeader(admin.accessToken),
      payload: base
    });
    expect(missingProduct.statusCode).toBe(404);
  });

  it("权限边界：读需登录，写限 ADMIN/RESEARCHER，删除限 ADMIN", async () => {
    const created = await createManual({
      value: 8800,
      price_type: "LISTING",
      unit_scope: "PIECE",
      subject_name: "龙德记六星孔雀",
      quote: "挂牌价 8800 元/饼"
    });
    const offerUrl = `/api/products/${productId}/market-offers/${created.id}`;

    for (const request of [
      { method: "GET" as const, url: `/api/products/${productId}/market-offers` },
      { method: "GET" as const, url: offerUrl },
      {
        method: "POST" as const,
        url: `/api/products/${productId}/market-offers`,
        payload: { value: 100, price_type: "LISTING", subject_name: "匿名", quote: "挂牌价 100 元" }
      },
      { method: "PATCH" as const, url: offerUrl, payload: { is_excluded: true } },
      { method: "DELETE" as const, url: offerUrl }
    ]) {
      const anonymous = await context.app.inject(request);
      expect(anonymous.statusCode).toBe(401);
    }

    const viewerToken = await createUserToken("VIEWER");
    const viewerRead = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(viewerToken)
    });
    expect(viewerRead.statusCode).toBe(200);
    const viewerWrite = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(viewerToken),
      payload: { value: 100, price_type: "LISTING", subject_name: "只读用户", quote: "挂牌价 100 元" }
    });
    expect(viewerWrite.statusCode).toBe(403);
    const viewerPatch = await context.app.inject({
      method: "PATCH",
      url: offerUrl,
      headers: authHeader(viewerToken),
      payload: { is_excluded: true }
    });
    expect(viewerPatch.statusCode).toBe(403);

    const researcherToken = await createUserToken("RESEARCHER");
    const researcherOffer = await createManual(
      { value: 6600, price_type: "LISTING", subject_name: "研究员登记", quote: "挂牌价 6600 元" },
      researcherToken
    );
    expect(researcherOffer.attribution).toBe("MANUAL");
    const researcherDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/market-offers/${researcherOffer.id}`,
      headers: authHeader(researcherToken)
    });
    expect(researcherDelete.statusCode).toBe(403);

    const adminDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/market-offers/${researcherOffer.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(adminDelete.statusCode).toBe(204);
    const gone = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/market-offers/${researcherOffer.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(gone.statusCode).toBe(404);

    const missingOffer = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/market-offers/00000000-0000-4000-8000-000000000000`,
      headers: authHeader(admin.accessToken)
    });
    expect(missingOffer.statusCode).toBe(404);
  });

  it("跨产品价格列表（/api/market-offers）带筛选与排序，并回传目标产品名", async () => {
    await ingestFresh(pageUrl("peacock-deal-12000"));
    await ingestFresh(pageUrl("peacock-listing-9000"));
    await rebuildPrices();

    const global = await context.app.inject({
      method: "GET",
      url: "/api/market-offers?sort=-value",
      headers: authHeader(admin.accessToken)
    });
    expect(global.statusCode).toBe(200);
    const globalBody = global.json() as { items: OfferView[]; total: number };
    expect(globalBody.total).toBe(2);
    expect(globalBody.items.map((item) => item.value)).toEqual([12000, 9000]);
    expect(globalBody.items[0]?.product_id).toBe(productId);
    expect(globalBody.items[0]?.product_name).toBe("龙德记六星孔雀");

    const byType = await context.app.inject({
      method: "GET",
      url: "/api/market-offers?price_type=LISTING",
      headers: authHeader(admin.accessToken)
    });
    expect((byType.json() as { total: number }).total).toBe(1);

    const byKeyword = await context.app.inject({
      method: "GET",
      url: "/api/market-offers?q=挂牌",
      headers: authHeader(admin.accessToken)
    });
    expect((byKeyword.json() as { total: number }).total).toBe(1);

    const badQuery = await context.app.inject({
      method: "GET",
      url: "/api/market-offers?is_outlier=not-a-bool",
      headers: authHeader(admin.accessToken)
    });
    expect(badQuery.statusCode).toBe(400);

    // 查询串是字符串：include_excluded=false 必须真的当成 false（不能用 coerce.boolean）。
    const excludedOffers = await context.app.inject({
      method: "GET",
      url: "/api/market-offers?include_excluded=false&sort=-value",
      headers: authHeader(admin.accessToken)
    });
    expect((excludedOffers.json() as { total: number }).total).toBe(2);
  });
});

describe("§55 研究流水线联调：价格阶段落地", () => {
  it("跑完研究任务后价格证据有数据，三个价格阶段标记为已交付", async () => {
    await ingestFresh(pageUrl("peacock-deal-12000"));

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
      implemented_phases: number[];
      price_offers_total: number;
      price_offers_created: number;
      price_evidence_band_counts: Record<string, number>;
      price_reliable: number;
      price_level: string;
      progress: { stage: string; status: string; implemented: boolean; detail?: { price_in_similarity?: boolean } }[];
    };
    expect(body.status).toBe("SUCCEEDED");
    for (const stage of ["PRICE_SEARCH", "PRICE_EVIDENCE", "OUTLIER_DETECTION"]) {
      expect(body.stages_run).toContain(stage);
      const entry = body.progress.find((item) => item.stage === stage);
      expect(entry?.status).toBe("SUCCEEDED");
      expect(entry?.implemented).toBe(true);
    }
    expect(body.implemented_phases).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(body.price_offers_total).toBe(1);
    expect(body.price_offers_created).toBe(1);
    expect(body.price_evidence_band_counts.STRONG).toBe(1);
    expect(body.price_reliable).toBe(1);
    expect(body.price_level).toBe("VERIFIED_TRANSACTION");

    const evidenceStage = body.progress.find((item) => item.stage === "PRICE_EVIDENCE");
    expect(evidenceStage?.detail?.price_in_similarity).toBe(false);

    const list = await listOffers();
    expect(list.total).toBe(1);
    expect(offerWithValue(list.items, 12000).price_357g).toBe(12000);

    // 重复跑：同一批来源重建出同一批价格，不会翻倍。
    const again = await rebuildPrices();
    expect(again.created).toBe(0);
    expect(again.updated).toBe(1);
    expect(again.total).toBe(1);
  });
});
