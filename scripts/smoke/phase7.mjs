/**
 * Phase 7 端到端冒烟（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §55 Build Anchors / §56 进度 UI）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase7.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（锚点 / 价格证据 / 候选 / 来源随之级联删除）
 *       与临时账号；开发库最终只保留 seed（品牌「龙德记」+ 管理员），并校验 value_anchors = 0。
 *
 * 为什么直接用 pg 灌来源：本地默认 SEARCH_PROVIDER=mock，检索不会返回任何结果，
 * 锚点引擎的真实输入（候选池 + 价格证据）只能由「已抓取 + 已抽取」的来源推出来，
 * 所以脚本按 Agent 3 的真实输出结构写入 sources.last_extraction。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase7-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase7-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** 同款候选的成交价样本：四条正常价 + 一条偏离值（用来验证异常值只标记、不参与锚点）。 */
const DEAL_VALUES = [12000, 15000, 12500, 13000];
const OUTLIER_VALUE = 30000;
const DAIYI_VALUE = 3800;
const NAMELESS_VALUE = 7700;

/** 30 天前：稳定落在「近半年内」档（时间新鲜度 15 分），不受机器当天日期影响。 */
const RECENT_DATE = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

function sourceUrl(slug) {
  return `https://smoke-phase7.example.com/${slug}`;
}

/** 目标产品（与 API 测试 fixture 一致）。 */
const TARGET_PRODUCT = {
  product_name: "龙德记六星孔雀",
  year: 2026,
  tea_type: "普洱生茶",
  tea_subtype: "生茶",
  origin_province: "云南",
  origin_city: "西双版纳",
  origin_region: "勐海",
  mountain: "布朗山",
  weight_g: 357,
  raw_material: "大树春茶",
  season: "春茶",
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  console.log(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
}

async function request(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

/** 读取仓库根目录 .env 里的 DATABASE_URL（脚本不依赖 dotenv）。 */
function databaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
    if (match && match[1]) {
      return match[1];
    }
  }
  throw new Error("未找到 DATABASE_URL（.env 或环境变量）");
}

function itemOf(items, predicate) {
  return (items ?? []).find(predicate);
}

/** 同款行情页正文：产品身份、原料与感官原话都逐字写在页面上（相似度才能过 70 分门槛）。 */
function peacockBody(extraLines) {
  return [
    "龙德记六星孔雀 2026 行情",
    "品牌：龙德记 年份：2026 年 茶类：普洱生茶（生茶）",
    "产地：勐海 布朗山，原料：大树春茶，规格 357g。",
    "香气：烟香明显；入口浓强，回甘快，生津强，茶气明显。",
    ...extraLines
  ].join("\n");
}

/**
 * Agent 3 抽取结果（已落库形态）。
 * identity 为 null 时模拟「来源通篇没写是哪个产品」的页面（§62-2 / §62-7）。
 */
function extraction({ identity, prices }) {
  const peacock = identity === "PEACOCK";
  const daiyi = identity === "DAIYI";
  return {
    product_name: peacock ? "龙德记六星孔雀" : daiyi ? "大益 7542" : null,
    brand_name: peacock ? "龙德记" : daiyi ? "大益" : null,
    year: peacock ? 2026 : daiyi ? 2019 : null,
    tea_type: peacock ? "普洱生茶" : daiyi ? "普洱熟茶" : null,
    origin_region: peacock ? "勐海" : null,
    mountain: peacock ? "布朗山" : daiyi ? "临沧" : null,
    village: null,
    weight_g: peacock || daiyi ? 357 : null,
    spec_notes: daiyi ? "压制较紧" : null,
    storage: null,
    prices: prices.map((price) => ({
      value: price.value,
      currency: "CNY",
      quote: price.quote,
      price_type: price.priceType,
      unit_scope: price.unitScope,
      weight_g: price.weightG ?? null,
      observed_at: price.observedAt === undefined ? RECENT_DATE : price.observedAt,
      note: "冒烟数据：价格性质按原文判定"
    })),
    facts: peacock
      ? [
          { field: "raw_material", value: "大树春茶", quote: "原料：大树春茶" },
          { field: "aroma", value: "烟香明显", quote: "香气：烟香明显" },
          { field: "taste_entry", value: "浓强", quote: "入口浓强" },
          { field: "taste_huigan", value: "回甘快", quote: "回甘快" },
          { field: "taste_salivation", value: "生津强", quote: "生津强" },
          { field: "taste_cha_qi", value: "茶气明显", quote: "茶气明显" }
        ]
      : [],
    null_reason: identity === null ? "页面只写了规格与价格，没有写明是哪个产品" : null
  };
}

/** 同款成交价页（identity 写明，价格性质为成交价）。 */
function dealPage(value) {
  const quote = `成交价 ${value} 元/饼`;
  return {
    url: sourceUrl(`peacock-deal-${value}`),
    title: `龙德记六星孔雀 2026 成交记录（${value}）`,
    body: peacockBody([`成交记录：${quote}。`]),
    extraction: extraction({
      identity: "PEACOCK",
      prices: [{ priceType: "VERIFIED_TRANSACTION", value, unitScope: "PIECE", quote }]
    })
  };
}

/** 另一款茶：用来验证拒绝档候选不会进任何锚点。 */
function daiyiPage() {
  const quote = `挂牌价 ${DAIYI_VALUE} 元/饼`;
  return {
    url: sourceUrl("daiyi-7542-listing"),
    title: "大益 7542 2019 行情",
    body: [
      "大益 7542 2019 行情",
      "品牌：大益 年份：2019 年 茶类：普洱熟茶",
      "产地：临沧，规格 357g。",
      "压制较紧。",
      `${quote}。`
    ].join("\n"),
    extraction: extraction({
      identity: "DAIYI",
      prices: [{ priceType: "LISTING", value: DAIYI_VALUE, unitScope: "PIECE", quote }]
    })
  };
}

/**
 * 通篇没写产品身份、只写了规格与价格：不得当可靠价格。
 *
 * 刻意给一个「近半年内」的日期：这样 §15 五项里身份项仍得 4 分，总分正好压到 75（STRONG 压线），
 * 用来验证真正的红线——**即使够到强证据分，未写身份的价格也不得进入锚点**（§62-2 / §62-7）。
 */
function namelessPage(slug, value) {
  const quote = `成交价 ${value} 元/饼`;
  return {
    url: sourceUrl(slug),
    title: "某款普洱生茶行情页",
    body: ["某款普洱生茶行情", "规格 357g。", `${quote}。`].join("\n"),
    extraction: extraction({
      identity: null,
      prices: [
        {
          priceType: "VERIFIED_TRANSACTION",
          value,
          unitScope: "PIECE",
          weightG: 357,
          quote
        }
      ]
    })
  };
}

/** 身份与原料都写全、但页面没有任何价格：用来验证「相似度够但没有可靠价格」。 */
function noPricePage(slug) {
  return {
    url: sourceUrl(slug),
    title: "龙德记六星孔雀 2026 品鉴记录",
    body: peacockBody(["品鉴记录：只写口感，没有写任何价格。"]),
    extraction: extraction({ identity: "PEACOCK", prices: [] })
  };
}

async function insertSource(client, productId, spec) {
  const inserted = await client.query(
    `insert into sources
       (product_id, url, canonical_url, domain, title, source_kind,
        fetch_status, http_status, content_text, content_chars,
        extraction_status, extracted_at, last_extraction)
     values ($1, $2, $3, $4, $5, 'PRODUCT_PAGE', 'FETCHED', 200, $6, $7, 'EXTRACTED', now(), $8::jsonb)
     returning id`,
    [
      productId,
      spec.url,
      spec.url,
      "smoke-phase7.example.com",
      spec.title,
      spec.body,
      spec.body.length,
      JSON.stringify(spec.extraction)
    ]
  );
  return inserted.rows[0]?.id;
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  let productId;
  const extraProductIds = [];
  const createdUserEmails = [];

  /** 灌入「已抓取 + 已抽取」来源 → 重建候选池与价格证据。 */
  async function seed(product, specs) {
    for (const spec of specs) {
      await insertSource(client, product, spec);
    }
    const candidates = await request("POST", `/api/products/${product}/candidates/rebuild`, {
      token,
      body: {}
    });
    check("候选池重建返回 201", candidates.status === 201, candidates.status);
    const prices = await request("POST", `/api/products/${product}/market-offers/rebuild`, {
      token,
      body: {}
    });
    check("价格证据重建返回 201", prices.status === 201, prices.status);
  }

  async function rebuildAnchors(product, body = {}) {
    return request("POST", `/api/products/${product}/anchors/rebuild`, { token, body });
  }

  /**
   * 创建冒烟产品。`label` 只用于日志区分：产品名统一用基线 fixture 名。
   *
   * 原因：相似度含「命名体系」维度（§13），来源页面上写的产品名必须与产品自身名称能对上，
   * 否则相似度会天然掉到 70 以下、锚点判定失真。API 测试（anchors.test.ts）同样用基线产品名建库，
   * 只是每个产品 id 不同；跨产品锚点库按 product_id 区分，不受重名影响。
   */
  async function createProduct(label, preference) {
    const created = await request("POST", "/api/products", {
      token,
      body: {
        ...TARGET_PRODUCT,
        product_name: TARGET_PRODUCT.product_name,
        benchmark_mode_preference: preference,
        brand_id: null
      }
    });
    check(`创建产品「${label}」返回 201`, created.status === 201, created.status);
    return created.payload?.id;
  }

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("返回 access_token", typeof token === "string" && token.length > 10);

    console.log("\n[2] 锚点合同自检：两条硬门槛、三种锚点、六项权重合计 100、三条红线");
    const contract = await request("GET", "/api/anchors/contract", { token });
    check("锚点合同返回 200", contract.status === 200, contract.status);
    const anchorContract = contract.payload?.contract;
    check("合同引用 §16 / §17", anchorContract?.spec_ref === "§16 / §17", anchorContract?.spec_ref);
    check(
      "两条硬门槛：相似度 ≥ 70 且价格证据分 ≥ 75",
      anchorContract?.requirements?.min_similarity === 70 && anchorContract?.requirements?.min_price_evidence === 75,
      anchorContract?.requirements
    );
    check(
      "三种锚点齐备且顺序固定（最高价值 → 高相似度 → 强成交）",
      JSON.stringify((anchorContract?.types ?? []).map((item) => item.type)) ===
        JSON.stringify(["HIGHEST_VALUE", "SIMILARITY_HIGH_VALUE", "SALES_ANCHOR"]),
      (anchorContract?.types ?? []).map((item) => item.type)
    );
    check(
      "每种锚点都写明门槛与排序口径（前端不会只剩类型码）",
      (anchorContract?.types ?? []).length === 3 &&
        (anchorContract?.types ?? []).every((item) => item.requirement?.length > 0 && item.sort?.length > 0)
    );
    check(
      "三种锚点中文标签齐全",
      ["最高价值锚点", "高相似度锚点", "强成交锚点"].every((label) =>
        (anchorContract?.types ?? []).some((item) => String(item.label).includes(label))
      ),
      (anchorContract?.types ?? []).map((item) => item.label)
    );
    check(
      "高相似度锚点取同产品价格带前 20%（百分位阈值 80）",
      anchorContract?.similarity_high_value_top_percent === 20 && anchorContract?.price_percentile_threshold === 80,
      {
        top: anchorContract?.similarity_high_value_top_percent,
        percentile: anchorContract?.price_percentile_threshold
      }
    );
    check(
      "强成交锚点六项权重为 30/25/15/15/10/5",
      JSON.stringify(anchorContract?.sales_anchor_weights) ===
        JSON.stringify({
          similarity: 30,
          price_level: 25,
          market_recognition: 15,
          story_value: 15,
          concept_relevance: 10,
          evidence: 5
        }),
      anchorContract?.sales_anchor_weights
    );
    check(
      "强成交锚点权重合计 100（与相似度十维权重不混淆）",
      Object.values(anchorContract?.sales_anchor_weights ?? {}).reduce((sum, weight) => sum + weight, 0) === 100
    );
    check(
      "强成交公式写明 Similarity × 0.30 与 Evidence × 0.05",
      String(anchorContract?.sales_anchor_formula ?? "").includes("Similarity × 0.30") &&
        String(anchorContract?.sales_anchor_formula ?? "").includes("Evidence × 0.05"),
      anchorContract?.sales_anchor_formula
    );
    check("红线：价格不参与相似度（price_in_similarity = false）", anchorContract?.price_in_similarity === false, anchorContract?.price_in_similarity);
    check(
      "红线：未写明产品身份的价格不进锚点（excludes_source_unattributed = true）",
      anchorContract?.excludes_source_unattributed === true,
      anchorContract?.excludes_source_unattributed
    );
    check("红线：没有达标候选不硬凑竞品（no_fake_benchmark = true）", anchorContract?.no_fake_benchmark === true, anchorContract?.no_fake_benchmark);
    check(
      "六条规则齐全（含两条门槛 / 不硬凑 / 未写身份 / 成交价优先 / 前 20%）",
      (anchorContract?.rules ?? []).length === 6 &&
        (anchorContract?.rules ?? []).some((rule) => rule.includes("Similarity ≥ 70")) &&
        (anchorContract?.rules ?? []).some((rule) => rule.includes("PriceEvidence ≥ 75")) &&
        (anchorContract?.rules ?? []).some((rule) => rule.includes("不得硬凑竞品")) &&
        (anchorContract?.rules ?? []).some((rule) => rule.includes("未写明产品身份")) &&
        (anchorContract?.rules ?? []).some((rule) => rule.includes("成交价优先")) &&
        (anchorContract?.rules ?? []).some((rule) => rule.includes("前 20%")),
      anchorContract?.rules
    );
    const engine = contract.payload?.engine;
    check(
      "引擎自检与合同口径一致（70 / 75 / 80 百分位）",
      engine?.min_similarity === 70 && engine?.min_price_evidence === 75 && engine?.price_percentile_threshold === 80,
      engine
    );
    check(
      "引擎上限：单产品 60 条 / 每种 10 条 / 单页最大 100",
      engine?.limits?.maxPerProduct === 60 && engine?.limits?.maxPerType === 10 && engine?.limits?.maxPageSize === 100,
      engine?.limits
    );
    check(
      "模式标签：对标模式 / 自建高端标准",
      String(contract.payload?.mode_labels?.BENCHMARK ?? "").includes("对标模式") &&
        String(contract.payload?.mode_labels?.CATEGORY_CREATOR ?? "").includes("自建高端标准"),
      contract.payload?.mode_labels
    );
    check(
      "三种锚点标签齐全",
      Object.keys(contract.payload?.type_labels ?? {}).length === 3,
      contract.payload?.type_labels
    );
    check("未登录读锚点合同返回 401", (await request("GET", "/api/anchors/contract")).status === 401);
    check("未登录读高价值锚点库返回 401", (await request("GET", "/api/anchors")).status === 401);

    console.log("\n[3] 创建冒烟产品");
    productId = await createProduct(TARGET_PRODUCT.product_name, "AUTO");
    check("返回产品 id", typeof productId === "string" && productId.length > 10, productId);

    console.log("\n[4] 灌入 8 条「已抓取 + 已抽取」来源（同款成交价 + 大益挂牌价 + 未写身份 + 无价格）");
    const sourceSpecs = [
      ...DEAL_VALUES.map(dealPage),
      dealPage(OUTLIER_VALUE),
      daiyiPage(),
      namelessPage(`nameless-deal-${NAMELESS_VALUE}`, NAMELESS_VALUE),
      noPricePage("peacock-no-price")
    ];
    for (const spec of sourceSpecs) {
      await insertSource(client, productId, spec);
    }
    const sourceCount = await client.query("select count(*)::int as total from sources where product_id = $1", [
      productId
    ]);
    check("8 条来源均已落库", sourceCount.rows[0]?.total === 8, sourceCount.rows[0]);

    console.log("\n[5] 先重建候选池（锚点的第一条硬门槛就是候选相似度）");
    const candidateRebuild = await request("POST", `/api/products/${productId}/candidates/rebuild`, {
      token,
      body: {}
    });
    check("候选池重建返回 201", candidateRebuild.status === 201, candidateRebuild.status);
    const candidates = await request("GET", `/api/products/${productId}/candidates?pageSize=100`, { token });
    const candidateItems = candidates.payload?.items ?? [];
    check("候选池共 2 条（同款 + 大益）", candidateItems.length === 2, candidateItems.map((item) => item.name));
    const peacockCandidate = itemOf(candidateItems, (item) => item.name === "龙德记六星孔雀");
    const daiyiCandidate = itemOf(candidateItems, (item) => item.name === "大益 7542");
    check(
      "同款候选相似度 ≥ 70（过得了 §16.1 第一条门槛）",
      (peacockCandidate?.similarity_total ?? 0) >= 70,
      peacockCandidate?.similarity_total
    );
    check(
      "同款候选落在可比档（VALID_COMPARABLE / CORE_COMPARABLE）",
      ["VALID_COMPARABLE", "CORE_COMPARABLE"].includes(peacockCandidate?.similarity_band),
      peacockCandidate?.similarity_band
    );
    check(
      "相似度十维明细里没有价格维度（价格与相似度物理分离）",
      (peacockCandidate?.similarity?.dimensions ?? []).length > 0 &&
        (peacockCandidate?.similarity?.dimensions ?? []).every(
          (dimension) => !String(dimension.dimension ?? "").includes("price")
        ),
      (peacockCandidate?.similarity?.dimensions ?? []).map((dimension) => dimension.dimension)
    );
    check(
      "大益 7542 相似度 < 55（拒绝档，永远进不了锚点）",
      (daiyiCandidate?.similarity_total ?? 100) < 55 && daiyiCandidate?.similarity_band === "REJECT",
      { score: daiyiCandidate?.similarity_total, band: daiyiCandidate?.similarity_band }
    );

    console.log("\n[6] 由来源重建价格证据（含异常值标记与未写身份价格）");
    const priceRebuild = await request("POST", `/api/products/${productId}/market-offers/rebuild`, {
      token,
      body: {}
    });
    check("价格证据重建返回 201", priceRebuild.status === 201, priceRebuild.status);
    const offers = await request("GET", `/api/products/${productId}/market-offers?pageSize=100`, { token });
    const offerItems = offers.payload?.items ?? [];
    check("价格证据 7 条（5 条同款成交价 + 大益挂牌价 + 未写身份成交价）", offerItems.length === 7, offerItems.map((item) => item.value));
    const outlier = itemOf(offerItems, (item) => item.value === OUTLIER_VALUE);
    check("偏离值 30000 被标记异常（只标记、不删除）", outlier?.is_outlier === true, outlier?.is_outlier);
    check(
      "同组正常价 12000 / 15000 不被误标",
      itemOf(offerItems, (item) => item.value === 12000)?.is_outlier === false &&
        itemOf(offerItems, (item) => item.value === 15000)?.is_outlier === false
    );
    const unattributed = itemOf(offerItems, (item) => item.value === NAMELESS_VALUE);
    check(
      "未写产品身份的价格标记 SOURCE_UNATTRIBUTED",
      unattributed?.attribution === "SOURCE_UNATTRIBUTED",
      unattributed?.attribution
    );
    check("未写身份的价格没有身份键（不参与跨来源印证）", unattributed?.identity_key === null, unattributed?.identity_key);
    check(
      "未写身份的价格即使够到强证据分也如实记录",
      (unattributed?.evidence_score ?? 0) >= 75,
      unattributed?.evidence_score
    );

    console.log("\n[7] 重建三种锚点：两条门槛都过的同款候选 → 进入 Benchmark Mode");
    const anchorRebuild = await rebuildAnchors(productId);
    check("锚点重建返回 201", anchorRebuild.status === 201, anchorRebuild.status);
    const rebuild = anchorRebuild.payload;
    check("重建产出 3 条锚点（三种各一条）", rebuild?.created === 3 && rebuild?.total === 3, {
      created: rebuild?.created,
      total: rebuild?.total
    });
    check(
      "三种锚点各 1 条",
      JSON.stringify(rebuild?.anchor_types) ===
        JSON.stringify({ HIGHEST_VALUE: 1, SIMILARITY_HIGH_VALUE: 1, SALES_ANCHOR: 1 }),
      rebuild?.anchor_types
    );
    check("统计口径：考虑 2 条候选", rebuild?.stats?.candidates_considered === 2, rebuild?.stats);
    check(
      "统计口径：带可靠价格证据的候选 2 条（同款成交价 / 大益挂牌价）",
      rebuild?.stats?.reliable_price_candidates === 2,
      rebuild?.stats?.reliable_price_candidates
    );
    check(
      "统计口径：已归属价格 6 条 / 未写身份价格 1 条分开计数",
      rebuild?.stats?.attributed_price_offers === 6 && rebuild?.stats?.unattributed_price_offers === 1,
      rebuild?.stats
    );
    check(
      "模式判定：AUTO 偏好下由锚点引擎判成对标模式（AUTO_ANCHOR）",
      rebuild?.mode === "BENCHMARK" && rebuild?.resolved_by === "AUTO_ANCHOR",
      { mode: rebuild?.mode, resolved_by: rebuild?.resolved_by }
    );
    check("判定理由写明「最高价值锚点」", String(rebuild?.reason ?? "").includes("最高价值锚点"), rebuild?.reason);
    check("规范引用 §16 / §17 / §55 / §56", rebuild?.spec_ref === "§16 / §17 / §55 / §56", rebuild?.spec_ref);
    const anchorItems = rebuild?.anchors ?? [];
    check("主锚点唯一", anchorItems.filter((item) => item.is_primary).length === 1, anchorItems.filter((item) => item.is_primary).length);

    const highest = itemOf(anchorItems, (item) => item.anchor_type === "HIGHEST_VALUE");
    check("最高价值锚点相似度 ≥ 70", (highest?.similarity_score ?? 0) >= 70, highest?.similarity_score);
    check("最高价值锚点价格证据分 ≥ 75", (highest?.price_evidence_score ?? 0) >= 75, highest?.price_evidence_score);
    check(
      "最高价值锚点取组内最高的非异常成交价 15000（不是异常值 30000）",
      highest?.snapshot?.market_offer?.value === 15000,
      highest?.snapshot?.market_offer?.value
    );
    check(
      "锚点快照写明价格性质为成交价（成交价优先于挂牌价）",
      highest?.snapshot?.market_offer?.price_type === "VERIFIED_TRANSACTION",
      highest?.snapshot?.market_offer?.price_type
    );
    check(
      "锚点快照冻结组内可靠价格条数 4",
      highest?.snapshot?.reliable_price_count === 4,
      highest?.snapshot?.reliable_price_count
    );
    check("最高价值锚点对标理由引用 §16.1", String(highest?.rationale ?? "").includes("§16.1"), highest?.rationale);
    check("主锚点落在最高价值锚点", highest?.is_primary === true);

    const similarityAnchor = itemOf(anchorItems, (item) => item.anchor_type === "SIMILARITY_HIGH_VALUE");
    check(
      "高相似度锚点价格百分位 100（同产品价格带前 20%）",
      similarityAnchor?.price_percentile === 100 && similarityAnchor?.snapshot?.price_percentile === 100,
      { percentile: similarityAnchor?.price_percentile, snapshot: similarityAnchor?.snapshot?.price_percentile }
    );
    check("高相似度锚点对标理由引用 §16.2", String(similarityAnchor?.rationale ?? "").includes("§16.2"), similarityAnchor?.rationale);
    check("高相似度锚点不是主锚点", similarityAnchor?.is_primary === false);

    const salesAnchor = itemOf(anchorItems, (item) => item.anchor_type === "SALES_ANCHOR");
    const salesItems = salesAnchor?.sales_anchor?.items ?? [];
    check("强成交锚点六项明细齐全", salesItems.length === 6, salesItems.length);
    check(
      "强成交锚点权重为 30/25/15/15/10/5",
      JSON.stringify(salesItems.map((item) => item.weight)) === JSON.stringify([30, 25, 15, 15, 10, 5]),
      salesItems.map((item) => item.weight)
    );
    const contributionSum = Math.round(salesItems.reduce((sum, item) => sum + item.contribution, 0) * 100) / 100;
    check(
      "强成交锚点加权合计等于总分（不在别处重复算一遍）",
      Math.abs((salesAnchor?.sales_anchor?.total ?? 0) - contributionSum) < 0.02,
      { total: salesAnchor?.sales_anchor?.total, contributionSum }
    );
    check("强成交锚点理由引用 §16.3（基线里叫「牛逼化」前一步的强成交口径）", String(salesAnchor?.rationale ?? "").includes("§16.3"), salesAnchor?.rationale);
    check(
      "大益 7542（拒绝档）不进任何锚点",
      anchorItems.length > 0 && anchorItems.every((item) => item.candidate_name === "龙德记六星孔雀"),
      anchorItems.map((item) => item.candidate_name)
    );
    check(
      "异常值 30000 不被任何锚点引用",
      anchorItems.every((item) => item.snapshot?.market_offer?.value !== OUTLIER_VALUE)
    );
    check(
      "未写身份的价格 7700 不被任何锚点引用",
      anchorItems.every((item) => item.market_offer_id !== unattributed?.id) &&
        anchorItems.every((item) => !String(item.snapshot?.market_offer?.quote ?? "").includes(String(NAMELESS_VALUE)))
    );

    console.log("\n[8] 模式判定接口（§56 进度 UI 读的就是这个）");
    const mode = await request("GET", `/api/products/${productId}/benchmark-mode`, { token });
    check("模式判定返回 200", mode.status === 200, mode.status);
    check("mode = BENCHMARK", mode.payload?.mode === "BENCHMARK", mode.payload?.mode);
    check("resolved_by = AUTO_ANCHOR", mode.payload?.resolved_by === "AUTO_ANCHOR", mode.payload?.resolved_by);
    check("偏好字段回传 AUTO", mode.payload?.preference === "AUTO", mode.payload?.preference);
    check(
      "三种锚点计数 1 / 1 / 1",
      mode.payload?.highest_value_count === 1 &&
        mode.payload?.similarity_high_value_count === 1 &&
        mode.payload?.sales_anchor_count === 1,
      {
        highest: mode.payload?.highest_value_count,
        similarity: mode.payload?.similarity_high_value_count,
        sales: mode.payload?.sales_anchor_count
      }
    );
    check("主锚点类型为 HIGHEST_VALUE", mode.payload?.primary_anchor?.anchor_type === "HIGHEST_VALUE", mode.payload?.primary_anchor?.anchor_type);
    check("回传产品名（前端不用只显示 UUID）", mode.payload?.product_name === TARGET_PRODUCT.product_name, mode.payload?.product_name);
    check("判定接口只读：不改动锚点数量", (mode.payload?.anchors ?? []).length === 3, (mode.payload?.anchors ?? []).length);

    console.log("\n[9] 人工选定主锚点：人工判断必须留下痕迹、且主锚点只能一条");
    const manualPatch = await request("PATCH", `/api/products/${productId}/anchors/${salesAnchor?.id}`, {
      token,
      body: { is_primary: true, rationale: "人工判断：这条强成交锚点更适合当主对标理由" }
    });
    check("人工选定主锚点返回 200", manualPatch.status === 200, manualPatch.status);
    check("人工干预后标记 is_manual = true", manualPatch.payload?.is_manual === true, manualPatch.payload?.is_manual);
    check("人工理由已写入", String(manualPatch.payload?.rationale ?? "").includes("人工判断"), manualPatch.payload?.rationale);
    check("被选中的锚点成为主锚点", manualPatch.payload?.is_primary === true);
    const afterManual = await request("GET", `/api/products/${productId}/anchors?is_primary=true`, { token });
    check(
      "同产品主锚点仍只有一条（人工改主锚点不会留下两条）",
      afterManual.payload?.total === 1 && afterManual.payload?.items?.[0]?.id === salesAnchor?.id,
      { total: afterManual.payload?.total, id: afterManual.payload?.items?.[0]?.id }
    );
    const unknownField = await request("PATCH", `/api/products/${productId}/anchors/${salesAnchor?.id}`, {
      token,
      body: { note: "§55 只允许 is_primary 与 rationale" }
    });
    check("人工维护多余字段返回 400（schema 严格）", unknownField.status === 400, unknownField.status);

    console.log("\n[10] 重建语义：人工优先、keep_manual / recompute / 上限严格校验");
    const kept = await rebuildAnchors(productId);
    check("重建默认保留人工锚点（kept_manual = 1）", kept.payload?.kept_manual === 1, kept.payload?.kept_manual);
    check(
      "重建清掉旧自动锚点并补回 3 条（removed = 2 / created = 3 / total = 4）",
      kept.payload?.removed === 2 && kept.payload?.created === 3 && kept.payload?.total === 4,
      { removed: kept.payload?.removed, created: kept.payload?.created, total: kept.payload?.total }
    );
    check("重建后主锚点仍是人工选定的那条", kept.payload?.primary_anchor_id === salesAnchor?.id, kept.payload?.primary_anchor_id);
    check(
      "人工理由不被重算改写",
      String(itemOf(kept.payload?.anchors, (item) => item.id === salesAnchor?.id)?.rationale ?? "").includes("人工判断")
    );

    const dropped = await rebuildAnchors(productId, { keep_manual: false });
    check("keep_manual = false 才清除人工锚点（kept_manual = 0）", dropped.payload?.kept_manual === 0, dropped.payload?.kept_manual);
    check("清除后人工锚点已不存在", !(dropped.payload?.anchors ?? []).some((item) => item.id === salesAnchor?.id));
    check(
      "清除后回到 3 条锚点，主锚点回到最高价值锚点",
      dropped.payload?.total === 3 &&
        itemOf(dropped.payload?.anchors, (item) => item.is_primary)?.anchor_type === "HIGHEST_VALUE",
      { total: dropped.payload?.total, primary: itemOf(dropped.payload?.anchors, (item) => item.is_primary)?.anchor_type }
    );

    const beforeIdempotent = (dropped.payload?.anchors ?? []).map((item) => item.id).sort();
    const idempotent = await rebuildAnchors(productId, { recompute: false });
    check(
      "recompute = false：不重算（created / removed = 0，锚点 id 不变）",
      idempotent.payload?.created === 0 &&
        idempotent.payload?.removed === 0 &&
        JSON.stringify((idempotent.payload?.anchors ?? []).map((item) => item.id).sort()) === JSON.stringify(beforeIdempotent),
      { created: idempotent.payload?.created, removed: idempotent.payload?.removed }
    );
    check(
      "max_per_type 越界返回 400",
      (await rebuildAnchors(productId, { max_per_type: 99 })).status === 400
    );
    check(
      "重建请求多余字段返回 400（schema 严格）",
      (await rebuildAnchors(productId, { max_per_type: 3, product: "x" })).status === 400
    );

    console.log("\n[11] 锚点列表：筛选 / 排序 / 分页（前端高价值锚点库的数据源）");
    const allAnchors = await request("GET", `/api/products/${productId}/anchors`, { token });
    check("产品级列表返回 3 条", allAnchors.payload?.total === 3 && (allAnchors.payload?.items ?? []).length === 3, allAnchors.payload?.total);
    const byType = await request("GET", `/api/products/${productId}/anchors?anchor_type=SALES_ANCHOR`, { token });
    check(
      "按类型筛选（强成交锚点）",
      byType.payload?.total === 1 && byType.payload?.items?.[0]?.anchor_type === "SALES_ANCHOR",
      byType.payload
    );
    const primaryOnly = await request("GET", `/api/products/${productId}/anchors?is_primary=true`, { token });
    check("按主锚点筛选", primaryOnly.payload?.total === 1, primaryOnly.payload?.total);
    const byName = await request("GET", `/api/products/${productId}/anchors?q=${encodeURIComponent("孔雀")}`, { token });
    check("按候选名搜索", byName.payload?.total === 3, byName.payload?.total);
    const byRationale = await request("GET", `/api/products/${productId}/anchors?q=${encodeURIComponent("§16.2")}`, { token });
    check(
      "按对标理由搜索（只命中高相似度锚点）",
      byRationale.payload?.total === 1 && byRationale.payload?.items?.[0]?.anchor_type === "SIMILARITY_HIGH_VALUE",
      byRationale.payload?.total
    );
    const byEvidence = await request("GET", `/api/products/${productId}/anchors?sort=-price_evidence`, { token });
    const evidenceScores = (byEvidence.payload?.items ?? []).map((item) => item.price_evidence_score);
    check(
      "按价格证据分降序排序（单调不增）",
      evidenceScores.length === 3 && JSON.stringify(evidenceScores) === JSON.stringify([...evidenceScores].sort((a, b) => b - a)),
      evidenceScores
    );
    const firstPage = await request("GET", `/api/products/${productId}/anchors?page=1&pageSize=2`, { token });
    check(
      "分页：单页上限生效且总数照实回传",
      (firstPage.payload?.items ?? []).length === 2 && firstPage.payload?.total === 3,
      { items: (firstPage.payload?.items ?? []).length, total: firstPage.payload?.total }
    );
    check(
      "单页超过上限返回 400",
      (await request("GET", `/api/products/${productId}/anchors?pageSize=999`, { token })).status === 400
    );

    console.log("\n[12] §17 无达标候选：必须进入 Category Creator Mode，不得硬凑竞品");
    const noPriceProduct = await createProduct("龙德记冒烟无价格产品", "AUTO");
    extraProductIds.push(noPriceProduct);
    await seed(noPriceProduct, [noPricePage("no-price-b"), namelessPage("nameless-deal-8800", 8800)]);
    const noPriceRebuild = await rebuildAnchors(noPriceProduct);
    check("相似度够但没有可靠价格 → CATEGORY_CREATOR", noPriceRebuild.payload?.mode === "CATEGORY_CREATOR", noPriceRebuild.payload?.mode);
    check("resolved_by = NO_RELIABLE_ANCHOR", noPriceRebuild.payload?.resolved_by === "NO_RELIABLE_ANCHOR", noPriceRebuild.payload?.resolved_by);
    check(
      "理由写明「不得硬凑竞品或降低阈值」",
      String(noPriceRebuild.payload?.reason ?? "").includes("不得硬凑竞品") &&
        String(noPriceRebuild.payload?.reason ?? "").includes("降低阈值"),
      noPriceRebuild.payload?.reason
    );
    check("0 条最高价值锚点（没有硬凑出来的对标）", noPriceRebuild.payload?.anchor_types?.HIGHEST_VALUE === 0, noPriceRebuild.payload?.anchor_types);
    check(
      "没有任何锚点伪装成最高价值锚点",
      (noPriceRebuild.payload?.anchors ?? []).every((item) => item.anchor_type !== "HIGHEST_VALUE")
    );
    check(
      "相似度达标的候选仍如实保留强成交锚点 1 条（结论不达标 ≠ 证据消失）",
      noPriceRebuild.payload?.anchor_types?.SALES_ANCHOR === 1,
      noPriceRebuild.payload?.anchor_types
    );

    const benchmarkPreferenceProduct = await createProduct("龙德记冒烟对标偏好产品", "BENCHMARK");
    extraProductIds.push(benchmarkPreferenceProduct);
    await seed(benchmarkPreferenceProduct, [noPricePage("no-price-c")]);
    const prefRebuild = await rebuildAnchors(benchmarkPreferenceProduct);
    check(
      "偏好 Benchmark 但没有达标候选：仍进 CATEGORY_CREATOR（§17 优先于人工偏好）",
      prefRebuild.payload?.mode === "CATEGORY_CREATOR" && prefRebuild.payload?.resolved_by === "NO_RELIABLE_ANCHOR",
      { mode: prefRebuild.payload?.mode, resolved_by: prefRebuild.payload?.resolved_by }
    );
    check(
      "理由写明「产品负责人虽选择对标模式」",
      String(prefRebuild.payload?.reason ?? "").includes("产品负责人虽选择对标模式"),
      prefRebuild.payload?.reason
    );
    const prefMode = await request("GET", `/api/products/${benchmarkPreferenceProduct}/benchmark-mode`, { token });
    check(
      "模式判定接口回传同一结论与偏好",
      prefMode.payload?.mode === "CATEGORY_CREATOR" && prefMode.payload?.preference === "BENCHMARK",
      { mode: prefMode.payload?.mode, preference: prefMode.payload?.preference }
    );

    const manualPreferenceProduct = await createProduct("龙德记冒烟自建标准产品", "CATEGORY_CREATOR");
    extraProductIds.push(manualPreferenceProduct);
    await seed(manualPreferenceProduct, [dealPage(15800)]);
    const manualPrefRebuild = await rebuildAnchors(manualPreferenceProduct);
    check(
      "产品负责人显式指定 CATEGORY_CREATOR → MANUAL_PREFERENCE",
      manualPrefRebuild.payload?.mode === "CATEGORY_CREATOR" &&
        manualPrefRebuild.payload?.resolved_by === "MANUAL_PREFERENCE",
      { mode: manualPrefRebuild.payload?.mode, resolved_by: manualPrefRebuild.payload?.resolved_by }
    );
    check(
      "理由写明「自建高端标准模式」",
      String(manualPrefRebuild.payload?.reason ?? "").includes("自建高端标准模式"),
      manualPrefRebuild.payload?.reason
    );
    check(
      "判定变了但锚点照样算出来（只改结论，不改证据）",
      manualPrefRebuild.payload?.anchor_types?.HIGHEST_VALUE === 1,
      manualPrefRebuild.payload?.anchor_types
    );

    console.log("\n[13] 跨产品高价值锚点库（/api/anchors）");
    const global = await request("GET", "/api/anchors?pageSize=100", { token });
    check("跨产品锚点库返回 200", global.status === 200, global.status);
    const globalItems = global.payload?.items ?? [];
    check("锚点库汇总 8 条（3 + 1 + 1 + 3）", global.payload?.total === 8, global.payload?.total);
    check("每条锚点都带产品名（能看出对标属于哪个产品）", globalItems.every((item) => Boolean(item.product_name)));
    check(
      "锚点库覆盖 4 个产品",
      new Set(globalItems.map((item) => item.product_id)).size === 4,
      [...new Set(globalItems.map((item) => item.product_id))].length
    );
    const narrowed = await request("GET", `/api/anchors?product_id=${productId}`, { token });
    check(
      "按 product_id 收窄到产品级",
      narrowed.payload?.total === 3 && (narrowed.payload?.items ?? []).every((item) => item.product_id === productId),
      narrowed.payload?.total
    );
    const globalHighest = await request("GET", "/api/anchors?anchor_type=HIGHEST_VALUE&pageSize=100", { token });
    check(
      "锚点库可按类型筛选（最高价值锚点 2 条）",
      globalHighest.payload?.total === 2,
      globalHighest.payload?.total
    );

    console.log("\n[14] 权限与边界：读需登录，写限 ADMIN / RESEARCHER，删除限 ADMIN，不存在就如实报不存在");
    const missingId = "00000000-0000-4000-8000-000000000000";
    const currentAnchors = (await request("GET", `/api/products/${productId}/anchors`, { token })).payload?.items ?? [];
    const currentSales = itemOf(currentAnchors, (item) => item.anchor_type === "SALES_ANCHOR");
    for (const [name, options] of [
      ["列表", { method: "GET", path: `/api/products/${productId}/anchors` }],
      ["模式判定", { method: "GET", path: `/api/products/${productId}/benchmark-mode` }],
      ["单条锚点", { method: "GET", path: `/api/products/${productId}/anchors/${currentSales?.id}` }],
      ["重建锚点", { method: "POST", path: `/api/products/${productId}/anchors/rebuild`, body: {} }],
      [
        "人工维护锚点",
        {
          method: "PATCH",
          path: `/api/products/${productId}/anchors/${currentSales?.id}`,
          body: { is_primary: true }
        }
      ],
      ["删除锚点", { method: "DELETE", path: `/api/products/${productId}/anchors/${currentSales?.id}` }]
    ]) {
      const anonymous = await request(options.method, options.path, { body: options.body });
      check(`未登录${name}返回 401`, anonymous.status === 401, anonymous.status);
    }

    const viewerToken = await (async () => {
      const registered = await request("POST", "/api/auth/register", {
        token,
        body: { email: VIEWER_EMAIL, password: ROLE_PASSWORD, name: "冒烟只读用户", role: "VIEWER" }
      });
      check("创建只读账号返回 201", registered.status === 201, registered.status);
      createdUserEmails.push(VIEWER_EMAIL);
      return registered.payload?.tokens?.access_token;
    })();
    const viewerRead = await request("GET", `/api/products/${productId}/benchmark-mode`, { token: viewerToken });
    check("只读账号可以看模式判定", viewerRead.status === 200, viewerRead.status);
    check(
      "只读账号不能重建锚点（否则能改判定结论）",
      (await request("POST", `/api/products/${productId}/anchors/rebuild`, { token: viewerToken, body: {} })).status === 403
    );
    check(
      "只读账号不能人工改主锚点",
      (
        await request("PATCH", `/api/products/${productId}/anchors/${currentSales?.id}`, {
          token: viewerToken,
          body: { is_primary: true }
        })
      ).status === 403
    );
    check(
      "只读账号不能删除锚点",
      (await request("DELETE", `/api/products/${productId}/anchors/${currentSales?.id}`, { token: viewerToken })).status === 403
    );

    const researcherToken = await (async () => {
      const registered = await request("POST", "/api/auth/register", {
        token,
        body: { email: RESEARCHER_EMAIL, password: ROLE_PASSWORD, name: "冒烟研究员", role: "RESEARCHER" }
      });
      check("创建研究员账号返回 201", registered.status === 201, registered.status);
      createdUserEmails.push(RESEARCHER_EMAIL);
      return registered.payload?.tokens?.access_token;
    })();
    const researcherRebuild = await request("POST", `/api/products/${productId}/anchors/rebuild`, {
      token: researcherToken,
      body: {}
    });
    check("研究员可以重建锚点", researcherRebuild.status === 201, researcherRebuild.status);
    const rebuiltSales = itemOf(researcherRebuild.payload?.anchors, (item) => item.anchor_type === "SALES_ANCHOR");
    const researcherPatch = await request("PATCH", `/api/products/${productId}/anchors/${rebuiltSales?.id}`, {
      token: researcherToken,
      body: { is_primary: true, rationale: "研究员人工选定主锚点" }
    });
    check("研究员可以人工选定主锚点", researcherPatch.status === 200, researcherPatch.status);
    check("人工干预标记 is_manual = true", researcherPatch.payload?.is_manual === true, researcherPatch.payload?.is_manual);
    check(
      "研究员不能删除锚点（删除限 ADMIN）",
      (await request("DELETE", `/api/products/${productId}/anchors/${rebuiltSales?.id}`, { token: researcherToken }))
        .status === 403
    );
    const adminDelete = await request("DELETE", `/api/products/${productId}/anchors/${rebuiltSales?.id}`, { token });
    check("管理员删除锚点返回 204", adminDelete.status === 204, adminDelete.status);
    check(
      "删除后再查该锚点返回 404",
      (await request("GET", `/api/products/${productId}/anchors/${rebuiltSales?.id}`, { token })).status === 404
    );
    check(
      "给不存在的产品重建锚点返回 404",
      (await request("POST", `/api/products/${missingId}/anchors/rebuild`, { token, body: {} })).status === 404
    );
    check(
      "查不存在的产品模式判定返回 404",
      (await request("GET", `/api/products/${missingId}/benchmark-mode`, { token })).status === 404
    );
    check(
      "查不存在的锚点返回 404",
      (await request("GET", `/api/products/${productId}/anchors/${missingId}`, { token })).status === 404
    );
    check(
      "改不存在的锚点返回 404",
      (
        await request("PATCH", `/api/products/${productId}/anchors/${missingId}`, {
          token,
          body: { is_primary: true }
        })
      ).status === 404
    );
    check(
      "删不存在的锚点返回 404",
      (await request("DELETE", `/api/products/${productId}/anchors/${missingId}`, { token })).status === 404
    );

    console.log("\n[15] 研究进度（§56）已把锚点阶段标记为已交付");
    const progress = await request("GET", `/api/products/${productId}/research/progress`, { token });
    check("研究进度返回 200", progress.status === 200, progress.status);
    // 进度接口（§56 UI 数据源）不给 implemented_phases 汇总字段，交付范围看每个阶段的 implemented 标记。
    const progressItems = progress.payload?.progress ?? [];
    const deliveredPhases = [...new Set(progressItems.filter((item) => item.implemented).map((item) => item.phase))].sort(
      (left, right) => left - right
    );
    // 流水线阶段从 Phase 3 起（Phase 1–2 没有研究阶段）；Phase 8 是模式分支、没有新增研究阶段，
    // Phase 9 的 VALUE_CODES / VALUE_MAPPING、Phase 10 的 PRODUCT_ARCHITECTURE、Phase 11 的
    // FORMULA_PHILOSOPHY、Phase 12 的 SALES_COPY、Phase 13 的 INTENSIFY 与 Phase 14 的
    // FACT_REVIEW / HUMAN_APPROVAL 已交付，因此这里覆盖 3–7、9、10、11、12、13 与 14。
    check(
      "研究流水线阶段覆盖到 Phase 7，且 Phase 9 / 10 / 11 / 12 / 13 / 14 的阶段已交付",
      JSON.stringify(deliveredPhases) === JSON.stringify([3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14]),
      deliveredPhases
    );
    const valueCodesStage = itemOf(progressItems, (item) => item.stage === "VALUE_CODES");
    check(
      "Phase 9 价值映射已交付，但流水线未执行该阶段时状态仍为 PENDING",
      valueCodesStage?.implemented === true && valueCodesStage?.status === "PENDING" && valueCodesStage?.phase === 9,
      valueCodesStage
    );
    // 尚未交付的阶段必须保持未交付标记，不假装完成。
    const productArchitectureStage = itemOf(progressItems, (item) => item.stage === "PRODUCT_ARCHITECTURE");
    check(
      "Phase 10 产品结构已交付，但流水线未执行该阶段时状态仍为 PENDING",
      productArchitectureStage?.implemented === true &&
        productArchitectureStage?.status === "PENDING" &&
        productArchitectureStage?.phase === 10,
      productArchitectureStage
    );
    const formulaStage = itemOf(progressItems, (item) => item.stage === "FORMULA_PHILOSOPHY");
    check(
      "Phase 11 配方哲学已交付，但流水线未执行该阶段时状态仍为 PENDING",
      formulaStage?.implemented === true &&
        formulaStage?.status === "PENDING" &&
        formulaStage?.phase === 11,
      formulaStage
    );
    const anchorStage = itemOf(progressItems, (item) => item.stage === "ANCHOR_BUILD");
    check(
      "ANCHOR_BUILD 阶段标记为已实现且归属 Phase 7",
      anchorStage?.implemented === true && anchorStage?.phase === 7,
      anchorStage
    );
  } finally {
    for (const extraId of extraProductIds) {
      const removed = await request("DELETE", `/api/products/${extraId}`, { token });
      console.log(
        `[清理] 删除对照产品 ${extraId} → ${removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`}`
      );
    }
    if (productId) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `[清理] 删除冒烟产品（级联删除锚点 / 价格证据 / 候选 / 来源）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from sources) as sources, (select count(*)::int from market_offers) as offers, (select count(*)::int from comparable_candidates) as candidates, (select count(*)::int from value_anchors) as anchors"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：products=${row?.products} · sources=${row?.sources} · market_offers=${row?.offers} · comparable_candidates=${row?.candidates} · value_anchors=${row?.anchors}`
    );
    check(
      "冒烟结束后业务表清零（只保留 seed）",
      row?.products === 0 &&
        row?.sources === 0 &&
        row?.offers === 0 &&
        row?.candidates === 0 &&
        row?.anchors === 0,
      row
    );
    await client.end();
  }

  console.log(`\n结果：${passed} 项通过，${failures.length} 项失败`);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("冒烟脚本异常：", error);
  process.exitCode = 1;
});
