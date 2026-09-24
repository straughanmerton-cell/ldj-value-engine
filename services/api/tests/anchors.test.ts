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
 * Phase 7（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §55 Build Anchors / §56 进度 UI）。
 *
 * 本文件锁定锚点引擎的四条红线：
 * - **两条硬门槛缺一不可**（§16.1）：相似度 ≥ 70 **且** 价格证据分 ≥ 75 才算可靠锚点；
 * - **没有达标候选必须进自建高端标准**（§17 / §62-10）：不硬凑竞品、不降阈值、不编造对标；
 * - **未写明产品身份的价格不进锚点**（SOURCE_UNATTRIBUTED）：只有规格没有身份的压线价不算可靠价格；
 * - **异常值与人工判断**：异常值只标记不参与锚点；人工锚点重建时默认保留、主锚点只保留一条。
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
  /** null = 页面通篇没写这是哪个产品（价格会落成 SOURCE_UNATTRIBUTED） */
  identity: "PEACOCK" | "DAIYI" | null;
  title: string;
  body: string;
  price: PagePrice | null;
}

function pageUrl(slug: string): string {
  return `https://anchor.example.com/${slug}`;
}

/** 同款行情页：产品身份、原料与感官原话都逐字写在页面上（与候选池测试同一份 fixture，保证相似度 88）。 */
function peacockPage(slug: string, price: PagePrice | null): PageSpec {
  const priceLine = price ? `<p>${price.quote}。</p>` : "";
  return {
    url: pageUrl(slug),
    identity: "PEACOCK",
    title: "龙德记六星孔雀 2026 行情",
    body: `<html><head><title>龙德记六星孔雀 2026 行情</title></head><body>
<h1>龙德记六星孔雀</h1>
<p>品牌：龙德记 年份：2026 年 茶类：普洱生茶（生茶）</p>
<p>产地：勐海 布朗山，原料：大树春茶，规格 357g。</p>
<p>香气：烟香明显；入口浓强，回甘快，生津强，茶气明显。</p>
${priceLine}
</body></html>`,
    price
  };
}

const PEACOCK_FACTS = [
  { field: "raw_material", value: "大树春茶", quote: "原料：大树春茶" },
  { field: "aroma", value: "烟香明显", quote: "香气：烟香明显" },
  { field: "taste_entry", value: "浓强", quote: "入口浓强" },
  { field: "taste_huigan", value: "回甘快", quote: "回甘快" },
  { field: "taste_salivation", value: "生津强", quote: "生津强" },
  { field: "taste_cha_qi", value: "茶气明显", quote: "茶气明显" }
];

function deal(slug: string, value: number): PageSpec {
  const quote = `成交价 ${value} 元/饼`;
  return peacockPage(slug, {
    value,
    quote,
    priceType: "VERIFIED_TRANSACTION",
    unitScope: "PIECE",
    weightG: null
  });
}

/** 完全没有可信相似度的另一款茶：用来验证拒绝档不进任何锚点。 */
const DAIYI_PAGE: PageSpec = {
  url: pageUrl("daiyi-listing-3800"),
  identity: "DAIYI",
  title: "大益 7542 2019 行情",
  body: `<html><head><title>大益 7542 2019 行情</title></head><body>
<h1>大益 7542</h1>
<p>品牌：大益 年份：2019 年 茶类：普洱熟茶</p>
<p>产地：临沧，规格 357g。</p>
<p>压制较紧。</p>
<p>挂牌价 3800 元/饼。</p>
</body></html>`,
  price: { value: 3800, quote: "挂牌价 3800 元/饼", priceType: "LISTING", unitScope: "PIECE", weightG: null }
};

/** 来源通篇没写产品身份、只写了规格与价格：不得当可靠价格。 */
function namelessPage(slug: string, value: number): PageSpec {
  const quote = `成交价 ${value} 元/饼`;
  return {
    url: pageUrl(slug),
    identity: null,
    title: "某款普洱生茶行情页",
    body: `<html><head><title>某款普洱生茶行情</title></head><body>
<p>规格 357g。</p>
<p>${quote}。</p>
</body></html>`,
    price: { value, quote, priceType: "VERIFIED_TRANSACTION", unitScope: "PIECE", weightG: 357 }
  };
}

/**
 * 同款候选的价格样本：12000 / 12500 / 13000 / 15000 四条正常成交价 + 30000 一条偏离值，
 * 让「异常值只标记、不参与锚点」可以在同一组里被观察到。
 */
const DEAL_PAGES = [
  deal("peacock-deal-12000", 12000),
  deal("peacock-deal-15000", 15000),
  deal("peacock-deal-12500", 12500),
  deal("peacock-deal-13000", 13000),
  deal("peacock-deal-30000", 30000)
];

/** 没有价格、但产品身份与原料都写全的页面：用来验证「相似度够但没有可靠价格」。 */
const NO_PRICE_PAGE: PageSpec = peacockPage("peacock-no-price", null);

const NAMELESS_PAGE = namelessPage("nameless-deal-7700", 7700);
const NAMELESS_PAGE_ALT = namelessPage("nameless-deal-8800", 8800);

const SPECS: PageSpec[] = [
  ...DEAL_PAGES,
  DAIYI_PAGE,
  NAMELESS_PAGE,
  NO_PRICE_PAGE,
  NAMELESS_PAGE_ALT
];

const SPEC_BY_URL = new Map(SPECS.map((spec) => [spec.url, spec]));

function extractionJsonFor(spec: PageSpec): string {
  const peacock = spec.identity === "PEACOCK";
  const daiyi = spec.identity === "DAIYI";
  return JSON.stringify({
    product_name: peacock ? "龙德记六星孔雀" : daiyi ? "大益 7542" : null,
    brand_name: peacock ? "龙德记" : daiyi ? "大益" : null,
    year: peacock ? 2026 : daiyi ? 2019 : null,
    tea_type: peacock ? "普洱生茶" : daiyi ? "普洱熟茶" : null,
    origin_region: peacock ? "勐海" : daiyi ? null : null,
    mountain: peacock ? "布朗山" : daiyi ? "临沧" : null,
    village: null,
    weight_g: peacock || daiyi ? 357 : null,
    spec_notes: daiyi ? "压制较紧" : null,
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
    facts: peacock
      ? PEACOCK_FACTS
      : daiyi
        ? []
        : [],
    null_reason: spec.identity === null ? "页面只写了规格与价格，没有写明是哪个产品" : null
  });
}

/** 规则化 Mock AI：按 prompt 里出现的来源 URL 返回该页面的抽取结果（与页面正文逐字一致）。 */
class AnchorFixtureAiProvider implements AiProvider {
  readonly name = "anchor-fixture";

  async generateText(options: AiGenerateOptions): Promise<AiTextResult> {
    const prompt = options.messages.map((message) => message.content).join("\n");
    const matched = SPECS.find((spec) => prompt.includes(spec.url));
    const text = matched ? extractionJsonFor(matched) : JSON.stringify({ prices: [], facts: [] });
    return { text, model: "anchor-fixture", provider: this.name };
  }

  async generateJson<T>(options: AiJsonOptions<T>): Promise<{ data: T; raw: AiTextResult }> {
    const result = await generateValidatedJson<T>(
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
    return new Response(spec.body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }) as unknown as typeof fetch;
}

interface SalesAnchorItem {
  component: string;
  label: string;
  weight: number;
  score: number;
  contribution: number;
  note: string;
}

interface AnchorItem {
  id: string;
  product_id: string;
  product_name: string | null;
  anchor_type: string;
  candidate_id: string | null;
  candidate_name: string | null;
  market_offer_id: string | null;
  similarity_score: number;
  price_evidence_score: number;
  price_percentile: number | null;
  sales_anchor_score: number | null;
  sales_anchor: { total: number; items: SalesAnchorItem[]; formula: string } | null;
  rank: number;
  is_primary: boolean;
  is_manual: boolean;
  rationale: string;
  snapshot: {
    candidate: { name: string; similarity_total: number; similarity_band: string };
    market_offer: {
      value: number;
      quote: string;
      price_type: string;
      evidence_score: number;
      comparable_value: number;
      comparable_basis: string;
      attribution: string;
    } | null;
    price_percentile: number | null;
    reliable_price_count: number;
    evidence_note: string;
  };
  created_at: string;
  updated_at: string;
}

interface RebuildBody {
  total: number;
  created: number;
  removed: number;
  kept_manual: number;
  mode: string;
  resolved_by: string;
  reason: string;
  primary_anchor_id: string | null;
  anchor_types: Record<string, number>;
  stats: {
    candidates_considered: number;
    reliable_price_candidates: number;
    attributed_price_offers: number;
    unattributed_price_offers: number;
    highest_value: number;
    similarity_high_value: number;
    sales_anchor: number;
  };
  anchors: AnchorItem[];
  spec_ref: string;
}

interface ModeBody {
  product_id: string;
  product_name: string | null;
  preference: string;
  mode: string;
  resolved_by: string;
  reason: string;
  highest_value_count: number;
  similarity_high_value_count: number;
  sales_anchor_count: number;
  primary_anchor_id: string | null;
  primary_anchor: AnchorItem | null;
  anchors: AnchorItem[];
  spec_ref: string;
}

interface OfferItem {
  id: string;
  value: number;
  price_type: string;
  evidence_score: number;
  evidence_band: string;
  attribution: string;
  identity_key: string | null;
  is_outlier: boolean;
  quote: string;
}

let context: TestContext;
let admin: BootstrapResult;
let productId: string;

beforeAll(async () => {
  context = await createTestContext({
    aiProvider: new AnchorFixtureAiProvider(),
    crawler: new CrawlerService({ fetchImpl: buildFakeFetch(), allowPrivateHosts: true, timeoutMs: 2_000 })
  });
});

beforeEach(async () => {
  await context.reset();
  admin = await bootstrapAdmin(context.app, {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  });
  productId = await createProduct("龙德记六星孔雀", "AUTO");
});

afterAll(async () => {
  await context.close();
});

async function createProduct(
  name: string,
  preference: "AUTO" | "BENCHMARK" | "CATEGORY_CREATOR"
): Promise<string> {
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: {
      ...SIX_STAR_PEACOCK_FIXTURE,
      product_name: name,
      benchmark_mode_preference: preference,
      brand_id: null
    }
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { id: string }).id;
}

async function createUserToken(role: "RESEARCHER" | "VIEWER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: `${role.toLowerCase()}-phase7@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

/** 登记来源 → 抓取正文 → AI 抽取：锚点引擎的输入就是这一步的结果。 */
async function ingestSource(
  pid: string,
  url: string,
  sourceKind: SourceKind = "PRODUCT_PAGE"
): Promise<string> {
  const registered = await context.app.inject({
    method: "POST",
    url: `/api/products/${pid}/sources`,
    headers: authHeader(admin.accessToken),
    payload: { url, source_kind: sourceKind, published_at: new Date().toISOString() }
  });
  expect(registered.statusCode).toBe(201);
  const sourceId = (registered.json() as { source: { id: string } }).source.id;

  const fetched = await context.app.inject({
    method: "POST",
    url: `/api/products/${pid}/sources/${sourceId}/fetch`,
    headers: authHeader(admin.accessToken),
    payload: {}
  });
  expect(fetched.statusCode).toBe(200);

  const extracted = await context.app.inject({
    method: "POST",
    url: `/api/products/${pid}/sources/${sourceId}/extract`,
    headers: authHeader(admin.accessToken),
    payload: { use_ai: true, force: true }
  });
  expect(extracted.statusCode).toBe(201);
  return sourceId;
}

async function rebuildCandidates(pid: string): Promise<void> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${pid}/candidates/rebuild`,
    headers: authHeader(admin.accessToken),
    payload: {}
  });
  expect(response.statusCode).toBe(201);
}

async function rebuildPrices(pid: string): Promise<void> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${pid}/market-offers/rebuild`,
    headers: authHeader(admin.accessToken),
    payload: {}
  });
  expect(response.statusCode).toBe(201);
}

async function rebuildAnchors(
  payload: Record<string, unknown> = {},
  pid = productId,
  token = admin.accessToken
): Promise<RebuildBody> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${pid}/anchors/rebuild`,
    headers: authHeader(token),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as RebuildBody;
}

async function listAnchors(
  pid = productId,
  query = "",
  token = admin.accessToken
): Promise<{ items: AnchorItem[]; total: number }> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${pid}/anchors${query}`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { items: AnchorItem[]; total: number };
}

async function benchmarkMode(pid = productId, token = admin.accessToken): Promise<ModeBody> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${pid}/benchmark-mode`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as ModeBody;
}

async function listOffers(pid = productId): Promise<OfferItem[]> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${pid}/market-offers?pageSize=100`,
    headers: authHeader(admin.accessToken)
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { items: OfferItem[] }).items;
}

/** 完整跑一遍「来源 → 候选 → 价格 → 锚点」，锚点引擎的真实输入顺序就是这个。 */
async function seedPeacockAnchors(): Promise<RebuildBody> {
  for (const spec of [...DEAL_PAGES, DAIYI_PAGE, NAMELESS_PAGE]) {
    await ingestSource(productId, spec.url);
  }
  await rebuildCandidates(productId);
  await rebuildPrices(productId);
  return rebuildAnchors();
}

function anchorOf(items: AnchorItem[], type: string): AnchorItem {
  const item = items.find((entry) => entry.anchor_type === type);
  if (!item) {
    throw new Error(`没有找到 ${type} 锚点：${items.map((entry) => entry.anchor_type).join("、")}`);
  }
  return item;
}

function offerOf(items: OfferItem[], value: number): OfferItem {
  const item = items.find((entry) => entry.value === value);
  if (!item) {
    throw new Error(`没有找到价格为 ${value} 的价格证据`);
  }
  return item;
}

describe("§16 锚点合同（两条硬门槛 / 三种锚点 / 不硬凑竞品）", () => {
  it("合同自检：70 + 75 两条门槛、价格前 20%、六项权重合计 100、六条规则齐全；未登录不可读", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/anchors/contract",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      contract: {
        spec_ref: string;
        types: { type: string; label: string; requirement: string; sort: string }[];
        requirements: { min_similarity: number; min_price_evidence: number };
        similarity_high_value_top_percent: number;
        price_percentile_threshold: number;
        sales_anchor_weights: Record<string, number>;
        sales_anchor_formula: string;
        excludes_source_unattributed: boolean;
        no_fake_benchmark: boolean;
        price_in_similarity: boolean;
        rules: string[];
      };
      engine: {
        min_similarity: number;
        min_price_evidence: number;
        price_percentile_threshold: number;
        price_in_similarity: boolean;
        excludes_source_unattributed: boolean;
        no_fake_benchmark: boolean;
        limits: { maxPerProduct: number; maxPerType: number; maxPageSize: number };
      };
      type_labels: Record<string, string>;
      mode_labels: Record<string, string>;
    };

    expect(body.contract.spec_ref).toBe("§16 / §17");
    expect(body.contract.requirements.min_similarity).toBe(70);
    expect(body.contract.requirements.min_price_evidence).toBe(75);
    expect(body.engine.min_similarity).toBe(70);
    expect(body.engine.min_price_evidence).toBe(75);

    expect(body.contract.types.map((item) => item.type)).toEqual([
      "HIGHEST_VALUE",
      "SIMILARITY_HIGH_VALUE",
      "SALES_ANCHOR"
    ]);
    expect(body.contract.types.every((item) => item.requirement.length > 0 && item.sort.length > 0)).toBe(true);
    expect(body.contract.types.map((item) => item.label).join("|")).toContain("最高价值锚点");
    expect(body.contract.types.map((item) => item.label).join("|")).toContain("高相似度锚点");
    expect(body.contract.types.map((item) => item.label).join("|")).toContain("强成交锚点");

    expect(body.contract.price_percentile_threshold).toBe(80);
    expect(body.contract.similarity_high_value_top_percent).toBe(20);
    expect(body.engine.price_percentile_threshold).toBe(80);

    // §16.3 六项权重合计 100（前端按百分点展示，不会出现两处口径不一致）
    expect(body.contract.sales_anchor_weights).toEqual({
      similarity: 30,
      price_level: 25,
      market_recognition: 15,
      story_value: 15,
      concept_relevance: 10,
      evidence: 5
    });
    const weightTotal = Object.values(body.contract.sales_anchor_weights).reduce(
      (sum, weight) => sum + weight,
      0
    );
    expect(weightTotal).toBe(100);
    expect(body.contract.sales_anchor_formula).toContain("Similarity × 0.30");
    expect(body.contract.sales_anchor_formula).toContain("Evidence × 0.05");

    // 红线：价格不参与相似度、未写明身份的价格不进锚点、没有达标候选不硬凑竞品
    expect(body.contract.price_in_similarity).toBe(false);
    expect(body.contract.excludes_source_unattributed).toBe(true);
    expect(body.contract.no_fake_benchmark).toBe(true);
    expect(body.engine.price_in_similarity).toBe(false);
    expect(body.engine.excludes_source_unattributed).toBe(true);
    expect(body.engine.no_fake_benchmark).toBe(true);

    expect(body.contract.rules).toHaveLength(6);
    expect(body.contract.rules.some((rule) => rule.includes("Similarity ≥ 70"))).toBe(true);
    expect(body.contract.rules.some((rule) => rule.includes("PriceEvidence ≥ 75"))).toBe(true);
    expect(body.contract.rules.some((rule) => rule.includes("不得硬凑竞品"))).toBe(true);
    expect(body.contract.rules.some((rule) => rule.includes("未写明产品身份"))).toBe(true);
    expect(body.contract.rules.some((rule) => rule.includes("成交价优先"))).toBe(true);
    expect(body.contract.rules.some((rule) => rule.includes("前 20%"))).toBe(true);

    expect(Object.keys(body.type_labels).sort()).toEqual([
      "HIGHEST_VALUE",
      "SALES_ANCHOR",
      "SIMILARITY_HIGH_VALUE"
    ]);
    expect(Object.keys(body.mode_labels).sort()).toEqual(["BENCHMARK", "CATEGORY_CREATOR"]);
    expect(body.mode_labels.BENCHMARK).toContain("对标模式");
    expect(body.mode_labels.CATEGORY_CREATOR).toContain("自建高端标准");
    expect(body.engine.limits.maxPerType).toBe(10);
    expect(body.engine.limits.maxPerProduct).toBe(60);

    const anonymous = await context.app.inject({ method: "GET", url: "/api/anchors/contract" });
    expect(anonymous.statusCode).toBe(401);
    const anonymousList = await context.app.inject({ method: "GET", url: "/api/anchors" });
    expect(anonymousList.statusCode).toBe(401);
  });
});

describe("§16 三种锚点：由候选池 + 价格证据重建", () => {
  it("相似度 ≥ 70 且价格证据 ≥ 75 → 最高价值锚点，模式判定进入 Benchmark Mode，主锚点唯一", async () => {
    const rebuilt = await seedPeacockAnchors();

    expect(rebuilt.spec_ref).toBe("§16 / §17 / §55 / §56");
    expect(rebuilt.created).toBe(3);
    expect(rebuilt.removed).toBe(0);
    expect(rebuilt.total).toBe(3);
    expect(rebuilt.anchor_types).toEqual({
      HIGHEST_VALUE: 1,
      SIMILARITY_HIGH_VALUE: 1,
      SALES_ANCHOR: 1
    });
    expect(rebuilt.mode).toBe("BENCHMARK");
    expect(rebuilt.resolved_by).toBe("AUTO_ANCHOR");
    expect(rebuilt.reason).toContain("最高价值锚点");

    // 统计口径：2 条候选（同款 + 大益）都带可靠价格（同款成交价 / 大益挂牌价），
    // 但只有同款同时满足 §16.1 的两条门槛，所以只有它进入锚点
    expect(rebuilt.stats).toEqual({
      candidates_considered: 2,
      reliable_price_candidates: 2,
      attributed_price_offers: 6,
      unattributed_price_offers: 1,
      highest_value: 1,
      similarity_high_value: 1,
      sales_anchor: 1
    });

    const items = (await listAnchors()).items;
    expect(items).toHaveLength(3);
    expect(items.filter((item) => item.is_primary)).toHaveLength(1);

    const highest = anchorOf(items, "HIGHEST_VALUE");
    expect(highest.similarity_score).toBe(88);
    expect(highest.price_evidence_score).toBeGreaterThanOrEqual(75);
    expect(highest.rank).toBe(1);
    expect(highest.is_primary).toBe(true);
    expect(highest.candidate_name).toBe("龙德记六星孔雀");
    // 异常值 30000 只标记不参与：锚点取的是组内最高的非异常成交价 15000
    expect(highest.snapshot.market_offer?.value).toBe(15000);
    expect(highest.snapshot.market_offer?.price_type).toBe("VERIFIED_TRANSACTION");
    expect(highest.snapshot.market_offer?.comparable_basis).toBe("price_per_kg");
    expect(highest.snapshot.reliable_price_count).toBe(4);
    expect(highest.rationale).toContain("§16.1");

    const similarity = anchorOf(items, "SIMILARITY_HIGH_VALUE");
    expect(similarity.similarity_score).toBe(88);
    // 价格处于同产品可靠价格带前 20% → 百分位 100
    expect(similarity.price_percentile).toBe(100);
    expect(similarity.snapshot.price_percentile).toBe(100);
    expect(similarity.rationale).toContain("§16.2");
    expect(similarity.is_primary).toBe(false);

    const sales = anchorOf(items, "SALES_ANCHOR");
    expect(sales.sales_anchor_score).not.toBeNull();
    expect(sales.rationale).toContain("§16.3");
    const salesItems = sales.sales_anchor?.items ?? [];
    expect(salesItems).toHaveLength(6);
    expect(salesItems.map((item) => item.component)).toEqual([
      "similarity",
      "price_level",
      "market_recognition",
      "story_value",
      "concept_relevance",
      "evidence"
    ]);
    expect(salesItems.map((item) => item.weight)).toEqual([30, 25, 15, 15, 10, 5]);
    expect(salesItems.every((item) => item.note.length > 0)).toBe(true);
    const contributionSum = Math.round(
      salesItems.reduce((sum, item) => sum + item.contribution, 0) * 100
    ) / 100;
    expect(sales.sales_anchor?.total).toBe(contributionSum);
    expect(sales.sales_anchor?.formula).toContain("Similarity × 0.30");
    expect(salesItems.find((item) => item.component === "similarity")?.score).toBe(88);

    // 相似度不足拒绝档的候选不进任何锚点（大益 7542 相似度 3 分）
    expect(items.every((item) => item.candidate_name === "龙德记六星孔雀")).toBe(true);
    const candidateList = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/candidates?pageSize=100`,
      headers: authHeader(admin.accessToken)
    });
    const names = (candidateList.json() as { items: { name: string; similarity_total: number }[] }).items;
    expect(names.map((item) => item.name).sort()).toEqual(["大益 7542", "龙德记六星孔雀"]);

    const mode = await benchmarkMode();
    expect(mode.mode).toBe("BENCHMARK");
    expect(mode.resolved_by).toBe("AUTO_ANCHOR");
    expect(mode.preference).toBe("AUTO");
    expect(mode.highest_value_count).toBe(1);
    expect(mode.similarity_high_value_count).toBe(1);
    expect(mode.sales_anchor_count).toBe(1);
    expect(mode.primary_anchor?.anchor_type).toBe("HIGHEST_VALUE");
    expect(mode.spec_ref).toBe("§16 / §17 / §55 / §56");

    const primaryResponse = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/anchors/${highest.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(primaryResponse.statusCode).toBe(200);
    expect((primaryResponse.json() as AnchorItem).snapshot.market_offer?.evidence_score).toBeGreaterThanOrEqual(75);
  });

  it("异常值只标记不删除：同组 5 条里 30000 被标异常，锚点绝不引用它", async () => {
    await seedPeacockAnchors();

    const offers = await listOffers();
    expect(offers).toHaveLength(7);
    const outlier = offerOf(offers, 30000);
    expect(outlier.is_outlier).toBe(true);
    expect(offerOf(offers, 15000).is_outlier).toBe(false);
    expect(offerOf(offers, 12000).is_outlier).toBe(false);

    const items = (await listAnchors()).items;
    expect(items.some((item) => item.snapshot.market_offer?.value === 30000)).toBe(false);
    expect(items.every((item) => item.market_offer_id !== outlier.id)).toBe(true);
  });

  it("来源没写产品身份的价格（SOURCE_UNATTRIBUTED）只计数、不进锚点", async () => {
    const rebuilt = await seedPeacockAnchors();
    expect(rebuilt.stats.unattributed_price_offers).toBe(1);
    expect(rebuilt.stats.attributed_price_offers).toBe(6);

    const offers = await listOffers();
    const unattributed = offerOf(offers, 7700);
    expect(unattributed.attribution).toBe("SOURCE_UNATTRIBUTED");
    expect(unattributed.identity_key).toBeNull();
    // 这条价格即使够到 75 分的强证据门槛，也不允许当锚点价格
    expect(unattributed.evidence_score).toBe(75);
    expect(unattributed.evidence_band).toBe("STRONG");

    const items = (await listAnchors()).items;
    expect(items.every((item) => item.market_offer_id !== unattributed.id)).toBe(true);
    expect(
      items.every((item) => !String(item.snapshot.market_offer?.quote ?? "").includes("7700"))
    ).toBe(true);
    expect(items.every((item) => item.snapshot.market_offer?.attribution !== "SOURCE_UNATTRIBUTED")).toBe(
      true
    );
  });
});

describe("§17 无达标候选：必须进入 Category Creator Mode，不得硬凑竞品", () => {
  it("相似度够但没有可靠价格 → CATEGORY_CREATOR（NO_RELIABLE_ANCHOR），明确写出不得硬凑竞品", async () => {
    const otherId = await createProduct("龙德记六星孔雀", "AUTO");
    await ingestSource(otherId, NO_PRICE_PAGE.url);
    await ingestSource(otherId, NAMELESS_PAGE_ALT.url);
    await rebuildCandidates(otherId);
    await rebuildPrices(otherId);

    const rebuilt = await rebuildAnchors({}, otherId);
    expect(rebuilt.mode).toBe("CATEGORY_CREATOR");
    expect(rebuilt.resolved_by).toBe("NO_RELIABLE_ANCHOR");
    expect(rebuilt.reason).toContain("不得硬凑竞品或降低阈值");
    expect(rebuilt.anchor_types.HIGHEST_VALUE).toBe(0);
    expect(rebuilt.anchor_types.SIMILARITY_HIGH_VALUE).toBe(0);
    // 相似度 88 ≥ 拒绝档，强成交锚点仍然存在；但它不构成「可靠价格锚点」
    expect(rebuilt.anchor_types.SALES_ANCHOR).toBe(1);
    expect(rebuilt.stats.candidates_considered).toBe(1);
    expect(rebuilt.stats.reliable_price_candidates).toBe(0);
    expect(rebuilt.stats.attributed_price_offers).toBe(0);
    expect(rebuilt.stats.unattributed_price_offers).toBe(1);
    expect(rebuilt.primary_anchor_id).toBe(anchorOf(rebuilt.anchors, "SALES_ANCHOR").id);

    const mode = await benchmarkMode(otherId);
    expect(mode.mode).toBe("CATEGORY_CREATOR");
    expect(mode.resolved_by).toBe("NO_RELIABLE_ANCHOR");
    expect(mode.highest_value_count).toBe(0);
    expect(mode.primary_anchor?.similarity_score).toBe(88);
  });

  it("产品负责人选了 Benchmark 但没有达标候选：仍进 CATEGORY_CREATOR 并写明原因", async () => {
    const otherId = await createProduct("龙德记六星孔雀", "BENCHMARK");
    await ingestSource(otherId, NO_PRICE_PAGE.url);
    await rebuildCandidates(otherId);
    const rebuilt = await rebuildAnchors({}, otherId);

    expect(rebuilt.mode).toBe("CATEGORY_CREATOR");
    expect(rebuilt.resolved_by).toBe("NO_RELIABLE_ANCHOR");
    expect(rebuilt.reason).toContain("产品负责人虽选择对标模式");
    expect(rebuilt.reason).toContain("不得硬凑竞品");
  });

  it("产品负责人显式指定 CATEGORY_CREATOR：按人工偏好判定（MANUAL_PREFERENCE）", async () => {
    await seedPeacockAnchors();
    const patched = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}`,
      headers: authHeader(admin.accessToken),
      payload: { benchmark_mode_preference: "CATEGORY_CREATOR" }
    });
    expect(patched.statusCode).toBe(200);

    const mode = await benchmarkMode();
    expect(mode.preference).toBe("CATEGORY_CREATOR");
    expect(mode.mode).toBe("CATEGORY_CREATOR");
    expect(mode.resolved_by).toBe("MANUAL_PREFERENCE");
    expect(mode.reason).toContain("自建高端标准模式");
    // 判定变了，但已经算出来的锚点不会被抹掉（只改结论，不改证据）
    expect(mode.highest_value_count).toBe(1);
  });
});

describe("§55 Build Anchors：人工优先、重算语义与幂等", () => {
  it("人工锚点重建时默认保留，主锚点只保留一条；keep_manual=false 才清除", async () => {
    const first = await seedPeacockAnchors();
    const sales = anchorOf(first.anchors, "SALES_ANCHOR");

    const manual = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/anchors/${sales.id}`,
      headers: authHeader(admin.accessToken),
      payload: { is_primary: true, rationale: "人工判断：这条强成交锚点更适合作为主对标理由" }
    });
    expect(manual.statusCode).toBe(200);
    const manualBody = manual.json() as AnchorItem;
    expect(manualBody.is_manual).toBe(true);
    expect(manualBody.is_primary).toBe(true);
    expect(manualBody.rationale).toContain("人工判断");

    const kept = await rebuildAnchors();
    expect(kept.kept_manual).toBe(1);
    expect(kept.removed).toBe(2);
    expect(kept.created).toBe(3);
    expect(kept.total).toBe(4);
    expect(kept.anchor_types.SALES_ANCHOR).toBe(2);
    expect(kept.primary_anchor_id).toBe(sales.id);
    expect(kept.anchors.filter((item) => item.is_primary)).toHaveLength(1);
    expect(kept.anchors.find((item) => item.id === sales.id)?.rationale).toContain("人工判断");

    const dropped = await rebuildAnchors({ keep_manual: false });
    expect(dropped.kept_manual).toBe(0);
    expect(dropped.removed).toBe(4);
    expect(dropped.created).toBe(3);
    expect(dropped.total).toBe(3);
    expect(dropped.anchor_types.SALES_ANCHOR).toBe(1);
    expect(dropped.anchors.some((item) => item.id === sales.id)).toBe(false);
    expect(dropped.primary_anchor_id).toBe(anchorOf(dropped.anchors, "HIGHEST_VALUE").id);
  });

  it("recompute=false：只补主锚点、不重算已有锚点；max_per_type 越界被拒", async () => {
    await seedPeacockAnchors();
    const before = (await listAnchors()).items;
    const skipped = await rebuildAnchors({ recompute: false });
    expect(skipped.created).toBe(0);
    expect(skipped.removed).toBe(0);
    expect(skipped.total).toBe(3);
    expect(skipped.anchors.map((item) => item.id).sort()).toEqual(before.map((item) => item.id).sort());

    const tooMany = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/anchors/rebuild`,
      headers: authHeader(admin.accessToken),
      payload: { max_per_type: 99 }
    });
    expect(tooMany.statusCode).toBe(400);
    const unknown = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/anchors/rebuild`,
      headers: authHeader(admin.accessToken),
      payload: { max_per_type: 3, product: "x" }
    });
    expect(unknown.statusCode).toBe(400);

    const limited = await rebuildAnchors({ max_per_type: 1 });
    expect(limited.total).toBe(3);
    expect(limited.anchor_types).toEqual({
      HIGHEST_VALUE: 1,
      SIMILARITY_HIGH_VALUE: 1,
      SALES_ANCHOR: 1
    });
  });

  it("锚点快照冻结对标理由：重建后历史锚点的快照内容不随价格变化而改写", async () => {
    const first = await seedPeacockAnchors();
    const highest = anchorOf(first.anchors, "HIGHEST_VALUE");
    const snapshotJson = JSON.stringify(highest.snapshot);
    expect(snapshotJson).toContain("龙德记六星孔雀");
    expect(highest.snapshot.candidate.similarity_total).toBe(88);
    expect(highest.snapshot.candidate.similarity_band).toBe("CORE_COMPARABLE");

    // 再登记一条更高的成交价：新锚点会取新价格，但快照里冻结的是当时的证据
    const raised = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/market-offers`,
      headers: authHeader(admin.accessToken),
      payload: {
        value: 18000,
        price_type: "VERIFIED_TRANSACTION",
        unit_scope: "PIECE",
        weight_g: 357,
        subject_name: "龙德记六星孔雀",
        subject_brand: "龙德记",
        subject_year: 2026,
        quote: "人工补充：成交价 18000 元/饼"
      }
    });
    expect(raised.statusCode).toBe(201);

    const second = await rebuildAnchors();
    const newHighest = anchorOf(second.anchors, "HIGHEST_VALUE");
    // 人工登记没有来源正文 → 50 分弱证据，够不到 §16.1 的 75 分门槛，因此仍取来源成交价
    expect(newHighest.snapshot.market_offer?.value).toBe(15000);
    expect(newHighest.price_evidence_score).toBeGreaterThanOrEqual(75);
  });
});

describe("§16 锚点列表：筛选、排序、分页与跨产品高价值锚点库", () => {
  it("产品级列表支持按类型 / 主锚点 / 关键词筛选，排序与分页生效", async () => {
    await seedPeacockAnchors();

    const all = await listAnchors();
    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.anchor_type).sort()).toEqual([
      "HIGHEST_VALUE",
      "SALES_ANCHOR",
      "SIMILARITY_HIGH_VALUE"
    ]);
    expect(all.items.every((item) => item.product_id === productId)).toBe(true);
    expect(all.items.every((item) => item.candidate_name === "龙德记六星孔雀")).toBe(true);
    expect(all.items.every((item) => item.is_manual === false)).toBe(true);

    const byType = await listAnchors(productId, "?anchor_type=SALES_ANCHOR");
    expect(byType.total).toBe(1);
    expect(byType.items[0]?.anchor_type).toBe("SALES_ANCHOR");

    const primary = await listAnchors(productId, "?is_primary=true");
    expect(primary.total).toBe(1);
    expect(primary.items[0]?.anchor_type).toBe("HIGHEST_VALUE");
    expect((await listAnchors(productId, "?is_primary=false")).total).toBe(2);

    // 关键词只匹配候选名与对标理由：不会去猜别的字段
    expect((await listAnchors(productId, `?q=${encodeURIComponent("孔雀")}`)).total).toBe(3);
    const byRationale = await listAnchors(productId, `?q=${encodeURIComponent("§16.3")}`);
    expect(byRationale.total).toBe(1);
    expect(byRationale.items[0]?.anchor_type).toBe("SALES_ANCHOR");
    expect((await listAnchors(productId, `?q=${encodeURIComponent("查无此词")}`)).total).toBe(0);

    // 排序：相似度与价格证据分在三种锚点上都是非空字段，降序必须单调不增
    const bySimilarity = await listAnchors(productId, "?sort=-similarity");
    const similarityScores = bySimilarity.items.map((item) => item.similarity_score);
    expect(similarityScores).toEqual([...similarityScores].sort((left, right) => right - left));
    const byEvidence = await listAnchors(productId, "?sort=-price_evidence");
    const evidenceScores = byEvidence.items.map((item) => item.price_evidence_score);
    expect(evidenceScores).toEqual([...evidenceScores].sort((left, right) => right - left));

    const firstPage = await listAnchors(productId, "?page=1&pageSize=2");
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(3);
    const secondPage = await listAnchors(productId, "?page=2&pageSize=2");
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size).toBe(3);

    const tooBig = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/anchors?pageSize=999`,
      headers: authHeader(admin.accessToken)
    });
    expect(tooBig.statusCode).toBe(400);
    const badSort = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/anchors?sort=unknown`,
      headers: authHeader(admin.accessToken)
    });
    expect(badSort.statusCode).toBe(400);
  });

  it("跨产品锚点列表（/api/anchors）带产品名与类型筛选，可按 product_id 收窄", async () => {
    await seedPeacockAnchors();
    const otherId = await createProduct("龙德记冰岛老寨", "AUTO");
    for (const spec of [...DEAL_PAGES, DAIYI_PAGE]) {
      await ingestSource(otherId, spec.url);
    }
    await rebuildCandidates(otherId);
    await rebuildPrices(otherId);
    await rebuildAnchors({}, otherId);

    const list = async (query: string): Promise<{ items: AnchorItem[]; total: number }> => {
      const response = await context.app.inject({
        method: "GET",
        url: `/api/anchors${query}`,
        headers: authHeader(admin.accessToken)
      });
      expect(response.statusCode).toBe(200);
      return response.json() as { items: AnchorItem[]; total: number };
    };

    const global = await list("?pageSize=100");
    expect(global.total).toBe(6);
    const perProduct = new Map<string, number>();
    for (const item of global.items) {
      perProduct.set(item.product_id, (perProduct.get(item.product_id) ?? 0) + 1);
    }
    expect(perProduct.get(productId)).toBe(3);
    expect(perProduct.get(otherId)).toBe(3);
    // 锚点库必须能一眼看出这条对标属于哪个产品，不允许只有 UUID
    expect(global.items.every((item) => Boolean(item.product_name))).toBe(true);

    const narrowed = await list(`?product_id=${otherId}`);
    expect(narrowed.total).toBe(3);
    expect(narrowed.items.every((item) => item.product_id === otherId)).toBe(true);
    expect(narrowed.items.map((item) => item.product_name)).toEqual([
      "龙德记冰岛老寨",
      "龙德记冰岛老寨",
      "龙德记冰岛老寨"
    ]);

    expect((await list("?anchor_type=HIGHEST_VALUE&pageSize=100")).total).toBe(2);
    expect((await list("?anchor_type=SALES_ANCHOR&pageSize=100")).total).toBe(2);
    expect((await list(`?product_id=${"00000000-0000-4000-8000-000000000000"}`)).total).toBe(0);
  });

  it("权限边界：读需登录，写限 ADMIN/RESEARCHER，删除限 ADMIN；不存在的资源返回 404", async () => {
    await seedPeacockAnchors();
    const items = (await listAnchors()).items;
    const primary = anchorOf(items, "HIGHEST_VALUE");
    const sales = anchorOf(items, "SALES_ANCHOR");
    const missing = "00000000-0000-4000-8000-000000000000";

    for (const request of [
      { method: "GET" as const, url: "/api/anchors" },
      { method: "GET" as const, url: `/api/products/${productId}/anchors` },
      { method: "GET" as const, url: `/api/products/${productId}/benchmark-mode` },
      { method: "GET" as const, url: `/api/products/${productId}/anchors/${primary.id}` },
      { method: "POST" as const, url: `/api/products/${productId}/anchors/rebuild`, payload: {} },
      {
        method: "PATCH" as const,
        url: `/api/products/${productId}/anchors/${sales.id}`,
        payload: { is_primary: true }
      },
      { method: "DELETE" as const, url: `/api/products/${productId}/anchors/${sales.id}` }
    ]) {
      const anonymous = await context.app.inject(request);
      expect(anonymous.statusCode).toBe(401);
    }

    const viewerToken = await createUserToken("VIEWER");
    const viewerRead = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/benchmark-mode`,
      headers: authHeader(viewerToken)
    });
    expect(viewerRead.statusCode).toBe(200);
    const viewerRebuild = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/anchors/rebuild`,
      headers: authHeader(viewerToken),
      payload: {}
    });
    expect(viewerRebuild.statusCode).toBe(403);
    const viewerPatch = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/anchors/${sales.id}`,
      headers: authHeader(viewerToken),
      payload: { is_primary: true }
    });
    expect(viewerPatch.statusCode).toBe(403);
    const viewerDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/anchors/${sales.id}`,
      headers: authHeader(viewerToken)
    });
    expect(viewerDelete.statusCode).toBe(403);

    const researcherToken = await createUserToken("RESEARCHER");
    const researcherRebuild = await rebuildAnchors({}, productId, researcherToken);
    expect(researcherRebuild.total).toBe(3);
    // 重算会整体换掉自动锚点，后续人工操作必须落在重建后的新锚点上
    const rebuiltSales = anchorOf(researcherRebuild.anchors, "SALES_ANCHOR");
    expect(rebuiltSales.id).not.toBe(sales.id);
    const researcherPatch = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/anchors/${rebuiltSales.id}`,
      headers: authHeader(researcherToken),
      payload: { is_primary: true, rationale: "研究员人工选定主锚点" }
    });
    expect(researcherPatch.statusCode).toBe(200);
    expect((researcherPatch.json() as AnchorItem).is_manual).toBe(true);
    const researcherDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/anchors/${rebuiltSales.id}`,
      headers: authHeader(researcherToken)
    });
    expect(researcherDelete.statusCode).toBe(403);

    const adminDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/anchors/${rebuiltSales.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(adminDelete.statusCode).toBe(204);
    const gone = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/anchors/${rebuiltSales.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(gone.statusCode).toBe(404);

    const missingProduct = await context.app.inject({
      method: "POST",
      url: `/api/products/${missing}/anchors/rebuild`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(missingProduct.statusCode).toBe(404);
    const missingMode = await context.app.inject({
      method: "GET",
      url: `/api/products/${missing}/benchmark-mode`,
      headers: authHeader(admin.accessToken)
    });
    expect(missingMode.statusCode).toBe(404);
    const missingAnchor = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/anchors/${missing}`,
      headers: authHeader(admin.accessToken)
    });
    expect(missingAnchor.statusCode).toBe(404);
    const missingPatch = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/anchors/${missing}`,
      headers: authHeader(admin.accessToken),
      payload: { is_primary: true }
    });
    expect(missingPatch.statusCode).toBe(404);
    const missingDelete = await context.app.inject({
      method: "DELETE",
      url: `/api/products/${productId}/anchors/${missing}`,
      headers: authHeader(admin.accessToken)
    });
    expect(missingDelete.statusCode).toBe(404);
    const unknownField = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/anchors/${primary.id}`,
      headers: authHeader(admin.accessToken),
      payload: { note: "规格 §55 只允许 is_primary 与 rationale" }
    });
    expect(unknownField.statusCode).toBe(400);
  });
});
