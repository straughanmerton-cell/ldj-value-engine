/**
 * Phase 6 端到端冒烟（规格 §14 市场价格系统 / §15 Price Evidence Score / §16.1 锚点价格条件）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase6.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（市场价格 / 来源 / 候选随之级联删除）
 *       与临时账号；开发库最终只保留 seed（品牌「龙德记」+ 管理员）。
 *
 * 为什么直接用 pg 灌来源：本地默认 SEARCH_PROVIDER=mock，检索不会返回任何结果，研究流水线
 * 不可能自己产出价格证据。脚本直接在 sources 表写入「已经抓取并抽取完成」的来源
 * （last_extraction 与真实 Agent 3 输出同结构），验证价格引擎只读来源、不编造来源（§62-1）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase6-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase6-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

const SOURCE_A_URL = "https://smoke-phase6.example.com/ldj-peacock-a";
const SOURCE_B_URL = "https://smoke-phase6.example.com/ldj-peacock-b";
const SOURCE_C_URL = "https://smoke-phase6.example.com/ldj-peacock-c";
const SOURCE_D_URL = "https://smoke-phase6.example.com/ldj-peacock-d";
const SOURCE_E_URL = "https://smoke-phase6.example.com/ldj-peacock-e";

/** 30 天前：稳定落在「近半年内」档（时间新鲜度 15 分），不受机器当天日期影响。 */
const RECENT_DATE = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

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

const TARGET_IDENTITY_KEY = "龙德记|龙德记六星孔雀|2026|357|";

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

function evidenceItem(offer, component) {
  return (offer?.evidence?.items ?? []).find((entry) => entry.component === component);
}

/** 网页正文：来源写明的原话必须能逐字回溯（quote_traceable）。 */
function pageText(title, lines) {
  return [`${title} 2026 行情`, ...lines].join("\n");
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
      "smoke-phase6.example.com",
      spec.title,
      spec.body,
      spec.body.length,
      JSON.stringify(spec.extraction)
    ]
  );
  return inserted.rows[0]?.id;
}

/**
 * Agent 3 抽取结果（已落库形态）。
 * `identity: false` 模拟「来源通篇没写是哪个产品」的页面（§62-2 / §62-7）。
 */
function extraction({ identity, priceType, value, unitScope, priceWeightG, quote }) {
  return {
    product_name: identity ? "龙德记六星孔雀" : null,
    brand_name: identity ? "龙德记" : null,
    year: identity ? 2026 : null,
    tea_type: identity ? "普洱生茶" : null,
    origin_region: identity ? "勐海" : null,
    mountain: identity ? "布朗山" : null,
    village: null,
    weight_g: identity ? 357 : null,
    spec_notes: null,
    storage: null,
    prices: [
      {
        value,
        currency: "CNY",
        quote,
        price_type: priceType,
        unit_scope: unitScope,
        weight_g: priceWeightG ?? null,
        observed_at: RECENT_DATE,
        note: "冒烟数据：价格性质按原文判定"
      }
    ],
    facts: identity
      ? [
          { field: "raw_material", value: "大树春茶", quote: "原料：大树春茶" },
          { field: "taste_entry", value: "浓强", quote: "入口浓强" }
        ]
      : [],
    null_reason: identity ? null : "页面只写了价格，没有写明是哪个产品"
  };
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  let productId;
  let otherProductId;
  const createdUserEmails = [];

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

    console.log("\n[2] 价格合同自检：四条红线、五项权重合计 100、三档、分档基准优先级");
    const contract = await request("GET", "/api/prices/contract", { token });
    check("合同自检返回 200", contract.status === 200, contract.status);
    const priceContract = contract.payload?.contract;
    check("contract.price_in_similarity = false", priceContract?.price_in_similarity === false, priceContract?.price_in_similarity);
    check(
      "contract.case_piece_equivalent_allowed = false（整件价不折算单饼价）",
      priceContract?.case_piece_equivalent_allowed === false,
      priceContract?.case_piece_equivalent_allowed
    );
    check("五项证据分权重合计 100", priceContract?.evidence_weight_total === 100, priceContract?.evidence_weight_total);
    check(
      "五项权重为 25/25/20/15/15",
      JSON.stringify((priceContract?.evidence_components ?? []).map((item) => item.weight)) ===
        JSON.stringify([25, 25, 20, 15, 15]),
      (priceContract?.evidence_components ?? []).map((item) => item.weight)
    );
    check(
      "五项组件顺序与 §15 一致",
      JSON.stringify((priceContract?.evidence_components ?? []).map((item) => item.component)) ===
        JSON.stringify(["nature_clarity", "source_credibility", "product_identity", "freshness", "cross_source"]),
      (priceContract?.evidence_components ?? []).map((item) => item.component)
    );
    check(
      "三档标签齐全（强证据 / 可用但谨慎 / 弱证据）",
      Object.keys(priceContract?.evidence_bands ?? {}).length === 3 &&
        String(priceContract?.evidence_bands?.STRONG ?? "").includes("强证据") &&
        String(priceContract?.evidence_bands?.WEAK ?? "").includes("弱证据"),
      priceContract?.evidence_bands
    );
    check("异常值最小样本量为 4", priceContract?.outlier_min_sample === 4, priceContract?.outlier_min_sample);
    check(
      "四条红线（含价格不参与相似度）已登记",
      (priceContract?.rules ?? []).length >= 4 &&
        (priceContract?.rules ?? []).some((rule) => rule.includes("挂牌价 ≠ 成交价")) &&
        (priceContract?.rules ?? []).some((rule) => rule.includes("整件价 ≠ 单饼价")) &&
        (priceContract?.rules ?? []).some((rule) => rule.includes("价格不参与相似度")),
      priceContract?.rules
    );
    const engine = contract.payload?.engine;
    check("引擎自检 price_in_similarity = false", engine?.price_in_similarity === false, engine?.price_in_similarity);
    check("引擎要求缺重量不换算", engine?.requires_weight_for_equivalence === true, engine?.requires_weight_for_equivalence);
    check("可靠价格锚点证据分门槛 = 75", engine?.min_reliable_evidence === 75, engine?.min_reliable_evidence);
    check(
      "分档基准优先级：成交 → 拍卖 → 官方 → 挂牌 → 历史",
      JSON.stringify(engine?.basis_priority) ===
        JSON.stringify([
          "VERIFIED_TRANSACTION",
          "AUCTION_HAMMER",
          "OFFICIAL_RETAIL",
          "LISTING",
          "HISTORICAL_REFERENCE"
        ]),
      engine?.basis_priority
    );
    check(
      "四种归属标签齐全",
      ["MANUAL", "CANDIDATE", "SOURCE_IDENTIFIED", "SOURCE_UNATTRIBUTED"].every(
        (key) => typeof contract.payload?.attribution_labels?.[key] === "string"
      ),
      contract.payload?.attribution_labels
    );
    const anonymousContract = await request("GET", "/api/prices/contract");
    check("未登录读价格合同返回 401", anonymousContract.status === 401, anonymousContract.status);
    const anonymousOffers = await request("GET", "/api/market-offers");
    check("未登录读价格列表返回 401", anonymousOffers.status === 401, anonymousOffers.status);

    console.log("\n[3] 创建冒烟产品");
    const created = await request("POST", "/api/products", {
      token,
      body: { ...TARGET_PRODUCT, brand_id: null }
    });
    check("创建产品返回 201", created.status === 201, created.status);
    productId = created.payload?.id;
    check("返回产品 id", typeof productId === "string" && productId.length > 10);

    console.log("\n[4] 人工登记价格证据：必须写引文、无来源按最保守给分、同价冲突不静默覆盖");
    const manualBody = {
      value: 3800,
      price_type: "LISTING",
      unit_scope: "PIECE",
      weight_g: 357,
      subject_name: "大益 7542",
      subject_brand: "大益",
      subject_year: 2019,
      quote: "人工登记：渠道报价 3800 元/饼"
    };
    const manual = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: manualBody
    });
    check("人工登记返回 201", manual.status === 201, manual.status);
    const manualOfferId = manual.payload?.id;
    check("归属标记为人工登记", manual.payload?.attribution === "MANUAL", manual.payload?.attribution);
    check("人工登记无来源正文 → quote_traceable = false", manual.payload?.quote_traceable === false, manual.payload?.quote_traceable);
    check("人工登记证据分 50（弱证据）", manual.payload?.evidence_score === 50 && manual.payload?.evidence_band === "WEAK", {
      score: manual.payload?.evidence_score,
      band: manual.payload?.evidence_band
    });
    check(
      "证据分明细五项合计等于总分",
      (manual.payload?.evidence?.items ?? []).reduce((sum, item) => sum + item.score, 0) === manual.payload?.evidence_score &&
        (manual.payload?.evidence?.items ?? []).length === 5,
      manual.payload?.evidence?.items
    );
    check(
      "没有来源类型时按最低档给分并写明理由",
      evidenceItem(manual.payload, "source_credibility")?.score === 8 &&
        String(evidenceItem(manual.payload, "source_credibility")?.note ?? "").includes("未分类"),
      evidenceItem(manual.payload, "source_credibility")
    );
    check(
      "证据分理由明说「引文无法逐字回溯」",
      String(evidenceItem(manual.payload, "nature_clarity")?.note ?? "").includes("无法在来源正文中逐字回溯"),
      evidenceItem(manual.payload, "nature_clarity")
    );
    check(
      "没写时间时新鲜度按 4 分（未知 ≠ 新鲜）",
      evidenceItem(manual.payload, "freshness")?.score === 4,
      evidenceItem(manual.payload, "freshness")
    );
    check(
      "挂牌价提醒：挂牌 ≠ 成交",
      (manual.payload?.evidence?.notes ?? []).some((note) => note.includes("挂牌价 ≠ 成交价")),
      manual.payload?.evidence?.notes
    );
    check(
      "人工登记 357g 单饼价 → 1kg 等价 10644.26、357g 等价 = 原价",
      manual.payload?.price_per_kg === 10644.26 && manual.payload?.price_357g === 3800,
      { perKg: manual.payload?.price_per_kg, per357: manual.payload?.price_357g }
    );

    const duplicate = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: manualBody
    });
    check("同身份 / 同类型 / 同单位 / 同规格同价返回 409", duplicate.status === 409, duplicate.status);
    check(
      "409 回传已存在的价格证据 id，便于前端直接跳转",
      duplicate.payload?.error?.details?.offer_id === manualOfferId,
      duplicate.payload?.error
    );
    const noValue = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: { price_type: "LISTING", subject_name: "大益 7542", quote: "报价 3800 元/饼" }
    });
    check("缺价格数值返回 400", noValue.status === 400, noValue.status);
    const noQuote = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: { value: 3900, price_type: "LISTING", subject_name: "大益 7542" }
    });
    check("缺原文引文返回 400（价格必须带原话）", noQuote.status === 400, noQuote.status);
    const noSubject = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: { value: 3900, price_type: "LISTING", quote: "报价 3900 元/饼" }
    });
    check("缺比对产品名返回 400", noSubject.status === 400, noSubject.status);
    const unknownField = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: { value: 3900, price_type: "LISTING", subject_name: "大益 7542", quote: "报价 3900 元/饼", price: 1 }
    });
    check("多余字段返回 400（schema 严格）", unknownField.status === 400, unknownField.status);

    console.log("\n[5] 灌入三条「已抓取 + 已抽取」来源（两条写明身份 + 一条未写身份）");
    const quoteA = "成交价 12000 元/饼";
    const quoteC = "挂牌价 12800 元/饼";
    const quoteD = "成交价 20000 元/饼";
    const sourceSpecs = [
      {
        url: SOURCE_A_URL,
        title: "龙德记六星孔雀 2026 成交记录",
        body: pageText("龙德记六星孔雀", [
          "品牌：龙德记 年份：2026 年 茶类：普洱生茶",
          "产地：勐海 布朗山，原料：大树春茶，规格 357g。",
          `成交记录：${quoteA}。`
        ]),
        extraction: extraction({
          identity: true,
          priceType: "VERIFIED_TRANSACTION",
          value: 12000,
          unitScope: "PIECE",
          quote: quoteA
        })
      },
      {
        url: SOURCE_C_URL,
        title: "龙德记六星孔雀 2026 挂牌",
        body: pageText("龙德记六星孔雀", [
          "品牌：龙德记 年份：2026 年 茶类：普洱生茶 规格 357g。",
          `${quoteC}。`
        ]),
        extraction: extraction({
          identity: true,
          priceType: "LISTING",
          value: 12800,
          unitScope: "PIECE",
          quote: quoteC
        })
      },
      {
        url: SOURCE_D_URL,
        title: "某款普洱生茶行情页（未写产品身份）",
        body: pageText("某款普洱生茶行情", ["规格 357g。", `${quoteD}。`]),
        extraction: extraction({
          identity: false,
          priceType: "VERIFIED_TRANSACTION",
          value: 20000,
          unitScope: "PIECE",
          priceWeightG: 357,
          quote: quoteD
        })
      }
    ];
    const sourceIds = {};
    for (const spec of sourceSpecs) {
      sourceIds[spec.url] = await insertSource(client, productId, spec);
    }
    check("三条来源均已落库", Object.values(sourceIds).every((id) => typeof id === "string"), sourceIds);

    console.log("\n[6] 先重建候选池（价格归属需要候选条目）");
    const candidateRebuild = await request("POST", `/api/products/${productId}/candidates/rebuild`, {
      token,
      body: {}
    });
    check("候选池重建返回 201", candidateRebuild.status === 201, candidateRebuild.status);

    console.log("\n[7] 由来源重建价格证据（§15 五项加权打分 + 跨来源合并）");
    const rebuilt = await request("POST", `/api/products/${productId}/market-offers/rebuild`, {
      token,
      body: {}
    });
    check("重建返回 201", rebuilt.status === 201, rebuilt.status);
    check("新建 3 条、未更新", rebuilt.payload?.created === 3 && rebuilt.payload?.updated === 0, {
      created: rebuilt.payload?.created,
      updated: rebuilt.payload?.updated
    });
    check("没有任何人工登记被重建覆盖", rebuilt.payload?.kept_manual === 0, rebuilt.payload?.kept_manual);
    check(
      "统计口径：3 条来源 → 3 条价格 → 3 条证据（暂无跨来源合并）",
      rebuilt.payload?.stats?.sources_considered === 3 &&
        rebuilt.payload?.stats?.prices_considered === 3 &&
        rebuilt.payload?.stats?.drafts === 3 &&
        rebuilt.payload?.stats?.merged_multi_source === 0 &&
        rebuilt.payload?.stats?.unattributed === 1 &&
        rebuilt.payload?.stats?.skipped_limit === 0,
      rebuilt.payload?.stats
    );
    check(
      "分档统计：强 3 / 可用 0 / 弱 1（未写身份的来源写了规格 357g，身份项得 4 分 → 75 分压线强证据；人工登记那条 50 分）",
      rebuilt.payload?.band_counts?.STRONG === 3 &&
        rebuilt.payload?.band_counts?.USABLE === 0 &&
        rebuilt.payload?.band_counts?.WEAK === 1,
      rebuilt.payload?.band_counts
    );
    check("未触达单产品上限", rebuilt.payload?.reached_limit === false, rebuilt.payload?.reached_limit);
    check("spec_ref 指向 §14 / §15 / §16.1", rebuilt.payload?.spec_ref === "§14 / §15 / §16.1", rebuilt.payload?.spec_ref);

    const list = await request("GET", `/api/products/${productId}/market-offers?pageSize=100&sort=-value`, { token });
    check("产品级价格列表返回 200", list.status === 200, list.status);
    check("共 4 条价格证据（3 条来源派生 + 1 条人工登记）", list.payload?.total === 4, list.payload?.total);
    const items = list.payload?.items ?? [];

    const traded = itemOf(items, (item) => item.value === 12000);
    check("成交价 12000 已落库", Boolean(traded), items.map((item) => item.value));
    check("按原文判定为成交价", traded?.price_type === "VERIFIED_TRANSACTION", traded?.price_type);
    check("单来源成交价证据分 91（强证据）", traded?.evidence_score === 91 && traded?.evidence_band === "STRONG", {
      score: traded?.evidence_score,
      band: traded?.evidence_band
    });
    check(
      "只有一个来源时多来源印证按最低档给 6 分并写明原因",
      evidenceItem(traded, "cross_source")?.score === 6 &&
        String(evidenceItem(traded, "cross_source")?.note ?? "").includes("只有 1 个来源"),
      evidenceItem(traded, "cross_source")
    );
    check("归属挂到已有对标候选", traded?.attribution === "CANDIDATE", traded?.attribution);
    check("身份键 = 品牌|名称|年份|规格", traded?.identity_key === TARGET_IDENTITY_KEY, traded?.identity_key);
    check(
      "357g 单饼：357g 等价 = 原价、1kg 等价 = 33613.45",
      traded?.price_357g === 12000 && traded?.price_per_kg === 33613.45,
      { per357: traded?.price_357g, perKg: traded?.price_per_kg }
    );
    check("单饼价允许折算单饼等价", traded?.piece_equivalent_allowed === true, traded?.piece_equivalent_allowed);

    const listed = itemOf(items, (item) => item.value === 12800);
    check("挂牌价单来源证据分 84（强证据）", listed?.evidence_score === 84 && listed?.evidence_band === "STRONG", {
      score: listed?.evidence_score,
      band: listed?.evidence_band
    });
    check("挂牌价不因报价高就被当成成交", listed?.price_type === "LISTING", listed?.price_type);
    check(
      "挂牌价提醒写明「不得表述为成交」",
      (listed?.evidence?.notes ?? []).some((note) => note.includes("不得表述为成交")),
      listed?.evidence?.notes
    );

    const unattributed = itemOf(items, (item) => item.value === 20000);
    check("来源未写身份 → 归属 SOURCE_UNATTRIBUTED", unattributed?.attribution === "SOURCE_UNATTRIBUTED", unattributed?.attribution);
    check("来源未写身份 → 身份键为 null，不与其他来源互相印证", unattributed?.identity_key === null, unattributed?.identity_key);
    check("来源未写产品身份但写了规格 357g → 身份项 4 分，总分 75 压线强证据", unattributed?.evidence_score === 75 && unattributed?.evidence_band === "STRONG", {
      score: unattributed?.evidence_score,
      band: unattributed?.evidence_band
    });
    check(
      "无产品名时身份项只按已写明的字段计分，并声明「缺少的字段不猜」",
      evidenceItem(unattributed, "product_identity")?.score === 4 &&
        String(evidenceItem(unattributed, "product_identity")?.note ?? "").includes("已确定：规格") &&
        String(evidenceItem(unattributed, "product_identity")?.note ?? "").includes("缺少的字段不猜"),
      evidenceItem(unattributed, "product_identity")
    );
    check(
      "价格证据带来源上下文（域名 / 来源类型），便于人工复核",
      unattributed?.domain === "smoke-phase6.example.com" && unattributed?.source_kind === "PRODUCT_PAGE",
      { domain: unattributed?.domain, kind: unattributed?.source_kind }
    );

    console.log("\n[8] 列表筛选（类型 / 归属 / 分档 / 异常值 / 关键词 / 上限）");
    const byType = await request("GET", `/api/products/${productId}/market-offers?price_type=LISTING&pageSize=100`, { token });
    check("按挂牌价筛选返回 2 条（来源挂牌 + 人工挂牌）", byType.payload?.total === 2, byType.payload?.total);
    const byUnattributed = await request("GET", `/api/products/${productId}/market-offers?attribution=SOURCE_UNATTRIBUTED`, { token });
    check("按「来源未写身份」筛选返回 1 条", byUnattributed.payload?.total === 1, byUnattributed.payload?.total);
    const byManual = await request("GET", `/api/products/${productId}/market-offers?attribution=MANUAL`, { token });
    check("按「人工登记」筛选返回 1 条", byManual.payload?.total === 1, byManual.payload?.total);
    const byBand = await request("GET", `/api/products/${productId}/market-offers?evidence_band=STRONG&pageSize=100`, { token });
    check("按强证据筛选返回 3 条（成交 91 / 挂牌 84 / 未写身份但写了规格 75）", byBand.payload?.total === 3, byBand.payload?.total);
    const byNotOutlier = await request("GET", `/api/products/${productId}/market-offers?is_outlier=false&pageSize=100`, { token });
    check("「只看异常值 = false」筛选生效（不会被当成 true）", byNotOutlier.payload?.total === 4, byNotOutlier.payload?.total);
    const byKeyword = await request("GET", `/api/products/${productId}/market-offers?q=${encodeURIComponent("大益")}`, { token });
    check("关键词按产品名 / 品牌 / 引文检索", byKeyword.payload?.total === 1, byKeyword.payload?.total);
    const badPageSize = await request("GET", `/api/products/${productId}/market-offers?pageSize=999`, { token });
    check("pageSize 超上限返回 400", badPageSize.status === 400, badPageSize.status);
    const crossProduct = await request("GET", "/api/market-offers?pageSize=100", { token });
    check(
      "跨产品价格列表返回 200，共 4 条",
      crossProduct.status === 200 && crossProduct.payload?.total === 4,
      crossProduct.payload?.total
    );
    check(
      "跨产品列表条目带产品名，便于市场价格中心展示",
      (crossProduct.payload?.items ?? []).every((item) => item.product_name === "龙德记六星孔雀")
    );

    console.log("\n[9] 人工修正：只允许补规格 / 改单位 / 加备注 / 排除，且口径重算");
    const missingWeight = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { weight_g: null }
    });
    check("清空规格重量返回 200", missingWeight.status === 200, missingWeight.status);
    check(
      "没有写重量 = 不计算 1kg / 357g 等价",
      missingWeight.payload?.price_per_kg === null && missingWeight.payload?.price_357g === null,
      { perKg: missingWeight.payload?.price_per_kg, per357: missingWeight.payload?.price_357g }
    );
    check(
      "身份键随规格重算（规格重量属于产品身份）",
      missingWeight.payload?.identity_key === "龙德记|龙德记六星孔雀|2026||",
      missingWeight.payload?.identity_key
    );
    check(
      "规格缺失后证据分从 84 重算为 80（产品身份少 4 分）",
      missingWeight.payload?.evidence_score === 80,
      missingWeight.payload?.evidence_score
    );
    const reweighted = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { weight_g: 400 }
    });
    check("补写规格重量 400g 返回 200", reweighted.status === 200, reweighted.status);
    check(
      "按新规格重算等价价：1kg = 32000、357g = 11424",
      reweighted.payload?.price_per_kg === 32000 && reweighted.payload?.price_357g === 11424,
      { perKg: reweighted.payload?.price_per_kg, per357: reweighted.payload?.price_357g }
    );
    check("规格补全后证据分回到 84", reweighted.payload?.evidence_score === 84, reweighted.payload?.evidence_score);
    const reKeyed = await client.query("select dedup_key from market_offers where id = $1", [listed?.id]);
    check(
      "去重键随规格重算（否则同一条价格换口径再登记会绕过去重）",
      String(reKeyed.rows[0]?.dedup_key ?? "").includes("|400|12800"),
      reKeyed.rows[0]?.dedup_key
    );
    const unitChanged = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { unit_scope: "KG" }
    });
    check("改单位为「按 kg 计价」返回 200", unitChanged.status === 200, unitChanged.status);
    check(
      "按 kg 计价：总克重 1000、1kg 等价 = 原值、357g 等价 = 4569.6",
      unitChanged.payload?.unit_grams === 1000 &&
        unitChanged.payload?.price_per_kg === 12800 &&
        unitChanged.payload?.price_357g === 4569.6,
      {
        unitGrams: unitChanged.payload?.unit_grams,
        perKg: unitChanged.payload?.price_per_kg,
        per357: unitChanged.payload?.price_357g
      }
    );
    check(
      "改单位后证据分按新口径重算（KG 是写明单位，不再扣「未写明单饼 / 整件」的 8 分，仍为 84）",
      unitChanged.payload?.evidence_score === 84,
      unitChanged.payload?.evidence_score
    );
    const restored = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { unit_scope: "PIECE", weight_g: 357 }
    });
    check("口径还原返回 200", restored.status === 200, restored.status);
    check(
      "还原后身份键 / 等价价 / 证据分都回到来源口径",
      restored.payload?.identity_key === TARGET_IDENTITY_KEY &&
        restored.payload?.price_357g === 12800 &&
        restored.payload?.price_per_kg === 35854.34 &&
        restored.payload?.evidence_score === 84,
      {
        identity: restored.payload?.identity_key,
        perKg: restored.payload?.price_per_kg,
        score: restored.payload?.evidence_score
      }
    );
    const immutableValue = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { value: 9999 }
    });
    check("试图改价格数值返回 400（改了就成篡改证据）", immutableValue.status === 400, immutableValue.status);
    const immutableQuote = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { quote: "改成 9999 元/饼" }
    });
    check("试图改原文引文返回 400", immutableQuote.status === 400, immutableQuote.status);
    const noteAdded = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { manual_note: "人工复核：来源页已核对，规格 357g 无误" }
    });
    check(
      "补人工备注返回 200 且不改动证据分",
      noteAdded.status === 200 && noteAdded.payload?.evidence_score === 84,
      noteAdded.payload?.evidence_score
    );
    check("人工备注原样保留", String(noteAdded.payload?.manual_note ?? "").includes("来源页已核对"), noteAdded.payload?.manual_note);
    const excluded = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { is_excluded: true }
    });
    check("人工排除返回 200", excluded.status === 200 && excluded.payload?.is_excluded === true, excluded.payload?.is_excluded);
    const hiddenByDefault = await request("GET", `/api/products/${productId}/market-offers?pageSize=100`, { token });
    check("被排除的价格默认不出现在列表里", hiddenByDefault.payload?.total === 3, hiddenByDefault.payload?.total);
    const withExcluded = await request("GET", `/api/products/${productId}/market-offers?include_excluded=true&pageSize=100`, { token });
    check(
      "带 include_excluded 时仍可查到被排除的价格（只排除、不删除）",
      withExcluded.payload?.total === 4,
      withExcluded.payload?.total
    );
    const reIncluded = await request("PATCH", `/api/products/${productId}/market-offers/${listed?.id}`, {
      token,
      body: { is_excluded: false }
    });
    check("取消排除返回 200", reIncluded.status === 200 && reIncluded.payload?.is_excluded === false, reIncluded.payload?.is_excluded);

    console.log("\n[10] 整件价：可算 1kg 等价，绝不折算单饼价；没写净重就两个等价价都为 null");
    const caseOffer = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: {
        value: 480000,
        price_type: "LISTING",
        unit_scope: "CASE",
        weight_g: 10710,
        pieces_per_case: 30,
        subject_name: "龙德记六星孔雀",
        subject_brand: "龙德记",
        subject_year: 2026,
        quote: "整件挂牌 480000 元/件（30 饼，整件净重 10710g）"
      }
    });
    check("登记整件价返回 201", caseOffer.status === 201, caseOffer.status);
    check(
      "整件价仍可算 1kg 等价 = 44817.93",
      caseOffer.payload?.price_per_kg === 44817.93,
      caseOffer.payload?.price_per_kg
    );
    check(
      "整件价不输出 357g 单饼等价（整件稀缺溢价不线性拆分）",
      caseOffer.payload?.price_357g === null && caseOffer.payload?.piece_equivalent_allowed === false,
      { per357: caseOffer.payload?.price_357g, allowed: caseOffer.payload?.piece_equivalent_allowed }
    );
    check(
      "整件价写明红线「整件价 ≠ 单饼价」",
      (caseOffer.payload?.evidence?.notes ?? []).some((note) => note.includes("整件价 ≠ 单饼价")),
      caseOffer.payload?.evidence?.notes
    );
    check("整件件数原样保存（30 饼 / 件）", caseOffer.payload?.pieces_per_case === 30, caseOffer.payload?.pieces_per_case);

    const caseNoWeight = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: {
        value: 400000,
        price_type: "LISTING",
        unit_scope: "CASE",
        subject_name: "龙德记六星孔雀",
        subject_brand: "龙德记",
        subject_year: 2026,
        quote: "整件挂牌 400000 元/件（未写整件净重）"
      }
    });
    check("登记没写净重的整件价返回 201", caseNoWeight.status === 201, caseNoWeight.status);
    check(
      "整件价没写净重 → 1kg / 357g 等价都为 null，且 357g 等价仍不允许",
      caseNoWeight.payload?.unit_grams === null &&
        caseNoWeight.payload?.price_per_kg === null &&
        caseNoWeight.payload?.price_357g === null &&
        caseNoWeight.payload?.piece_equivalent_allowed === false,
      {
        unitGrams: caseNoWeight.payload?.unit_grams,
        perKg: caseNoWeight.payload?.price_per_kg,
        per357: caseNoWeight.payload?.price_357g
      }
    );
    check(
      "没写净重也不猜口径：整件价红线提醒照旧保留",
      (caseNoWeight.payload?.evidence?.notes ?? []).some((note) => note.includes("整件价 ≠ 单饼价")),
      caseNoWeight.payload?.evidence?.notes
    );

    console.log("\n[11] 人工登记不被来源重建覆盖：来源同价并入时不覆盖人工口径");
    const manualListed = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: {
        value: 13600,
        price_type: "LISTING",
        unit_scope: "PIECE",
        weight_g: 357,
        subject_name: "龙德记六星孔雀",
        subject_brand: "龙德记",
        subject_year: 2026,
        quote: "渠道挂牌 13600 元/饼"
      }
    });
    check("人工登记渠道挂牌价返回 201", manualListed.status === 201, manualListed.status);
    check(
      "人工登记口径最保守：无来源正文 → 50 分弱证据",
      manualListed.payload?.evidence_score === 50 && manualListed.payload?.evidence_band === "WEAK",
      { score: manualListed.payload?.evidence_score, band: manualListed.payload?.evidence_band }
    );
    const quoteE = "渠道挂牌价 13600 元/饼";
    sourceIds[SOURCE_E_URL] = await insertSource(client, productId, {
      url: SOURCE_E_URL,
      title: "龙德记六星孔雀 2026 渠道挂牌",
      body: pageText("龙德记六星孔雀", [
        "品牌：龙德记 年份：2026 年 茶类：普洱生茶 规格 357g。",
        `${quoteE}。`
      ]),
      extraction: extraction({
        identity: true,
        priceType: "LISTING",
        value: 13600,
        unitScope: "PIECE",
        quote: quoteE
      })
    });
    check("第四条来源已落库", typeof sourceIds[SOURCE_E_URL] === "string", sourceIds[SOURCE_E_URL]);

    const rebuiltAgain = await request("POST", `/api/products/${productId}/market-offers/rebuild`, {
      token,
      body: {}
    });
    check("重建返回 201", rebuiltAgain.status === 201, rebuiltAgain.status);
    check(
      "来源同价并入人工条目：不新建、引擎来源条目按新口径更新 3 条",
      rebuiltAgain.payload?.created === 0 && rebuiltAgain.payload?.updated === 3,
      { created: rebuiltAgain.payload?.created, updated: rebuiltAgain.payload?.updated }
    );
    check(
      "人工登记的那条被原样保留（keep_manual 默认生效）",
      rebuiltAgain.payload?.kept_manual === 1,
      rebuiltAgain.payload?.kept_manual
    );
    check(
      "来源 / 价格原话计数同步到 4 条",
      rebuiltAgain.payload?.stats?.sources_considered === 4 &&
        rebuiltAgain.payload?.stats?.prices_considered === 4 &&
        rebuiltAgain.payload?.stats?.drafts === 4,
      rebuiltAgain.payload?.stats
    );
    const keptManual = await request("GET", `/api/products/${productId}/market-offers/${manualListed.payload?.id}`, {
      token
    });
    check(
      "人工条目保持人工口径：归属 MANUAL、引文原样、分数没被来源分替换",
      keptManual.payload?.attribution === "MANUAL" &&
        keptManual.payload?.quote === "渠道挂牌 13600 元/饼" &&
        keptManual.payload?.evidence_score === 50,
      {
        attribution: keptManual.payload?.attribution,
        score: keptManual.payload?.evidence_score,
        quote: keptManual.payload?.quote
      }
    );
    const afterManualRebuild = await request("GET", `/api/products/${productId}/market-offers?pageSize=100`, {
      token
    });
    check(
      "此时共 7 条价格证据（3 条来源派生 + 2 条人工登记 + 2 条整件价）",
      afterManualRebuild.payload?.total === 7,
      afterManualRebuild.payload?.total
    );

    console.log("\n[12] 异常值检测：同类型 + 同单位 + 同规格分组，样本 ≥ 4 才判定，只标记不删除");
    for (const value of [12900, 13000, 13100, 60000]) {
      const extra = await request("POST", `/api/products/${productId}/market-offers`, {
        token,
        body: {
          value,
          price_type: "LISTING",
          unit_scope: "PIECE",
          weight_g: 357,
          subject_name: "大益 7542",
          subject_brand: "大益",
          subject_year: 2019,
          quote: `渠道挂牌 ${value} 元/饼`
        }
      });
      check(`登记对照挂牌价 ${value} 元返回 201`, extra.status === 201, extra.status);
    }
    const outlierRebuild = await request("POST", `/api/products/${productId}/market-offers/rebuild`, {
      token,
      body: {}
    });
    check("重建返回 201", outlierRebuild.status === 201, outlierRebuild.status);
    check(
      "异常值 2 条（3800 与 60000），可比样本组 1 组",
      outlierRebuild.payload?.outliers === 2 && outlierRebuild.payload?.outlier_groups === 1,
      { outliers: outlierRebuild.payload?.outliers, groups: outlierRebuild.payload?.outlier_groups }
    );
    const outlierList = await request("GET", `/api/products/${productId}/market-offers?is_outlier=true&pageSize=100`, {
      token
    });
    check(
      "异常值清单就是偏离最远的两条挂牌价",
      JSON.stringify((outlierList.payload?.items ?? []).map((item) => item.value).sort((left, right) => left - right)) ===
        JSON.stringify([3800, 60000]),
      (outlierList.payload?.items ?? []).map((item) => item.value)
    );
    check(
      "异常值写明同组样本量 7 与中位数 13000（可复核）",
      (outlierList.payload?.items ?? []).every(
        (item) => item.outlier_sample_size === 7 && item.outlier_median === 13000 && typeof item.outlier_reason === "string"
      ),
      (outlierList.payload?.items ?? []).map((item) => ({
        size: item.outlier_sample_size,
        median: item.outlier_median
      }))
    );
    const afterOutliers = await request("GET", `/api/products/${productId}/market-offers?pageSize=100`, { token });
    check("异常值只标记不删除：总数仍为 11 条", afterOutliers.payload?.total === 11, afterOutliers.payload?.total);
    const tradedAfterOutliers = itemOf(afterOutliers.payload?.items, (item) => item.value === 12000);
    check(
      "样本不足的组不下结论（成交价组只有 2 条 → 不判异常）",
      tradedAfterOutliers?.is_outlier === false &&
        String(tradedAfterOutliers?.outlier_reason ?? "").includes("样本不足"),
      tradedAfterOutliers?.outlier_reason
    );

    console.log("\n[13] 价格汇总（§14 / §16.1）：给锚点引擎判断「有没有可靠价格锚点」");
    const excludeTarget = await request("PATCH", `/api/products/${productId}/market-offers/${unattributed?.id}`, {
      token,
      body: { is_excluded: true }
    });
    check(
      "排除未写产品身份的那条价格返回 200",
      excludeTarget.status === 200 && excludeTarget.payload?.is_excluded === true,
      excludeTarget.payload?.is_excluded
    );
    const summary = await request("GET", `/api/products/${productId}/price-summary`, { token });
    check("价格汇总返回 200", summary.status === 200, summary.status);
    check(
      "汇总口径：11 条登记 / 10 条计入 / 1 条被排除",
      summary.payload?.total_offers === 11 &&
        summary.payload?.counted_offers === 10 &&
        summary.payload?.excluded_count === 1,
      {
        total: summary.payload?.total_offers,
        counted: summary.payload?.counted_offers,
        excluded: summary.payload?.excluded_count
      }
    );
    check(
      "分档统计：强 2 / 可用 0 / 弱 8",
      summary.payload?.strong_offers === 2 &&
        summary.payload?.usable_offers === 0 &&
        summary.payload?.weak_offers === 8,
      {
        strong: summary.payload?.strong_offers,
        usable: summary.payload?.usable_offers,
        weak: summary.payload?.weak_offers
      }
    );
    check(
      "成交价与挂牌价分开计数（成交 1 / 挂牌 9），绝不合并说成成交",
      summary.payload?.transaction_count === 1 && summary.payload?.listing_count === 9,
      { transaction: summary.payload?.transaction_count, listing: summary.payload?.listing_count }
    );
    check(
      "可靠价格锚点 2 条（证据分 ≥ 75 且非异常值）",
      summary.payload?.reliable_count === 2,
      summary.payload?.reliable_count
    );
    check(
      "异常值 2 条进汇总提醒，且不删除",
      summary.payload?.outlier_count === 2 &&
        (summary.payload?.notes ?? []).some((note) => note.includes("异常值")),
      { outliers: summary.payload?.outlier_count, notes: summary.payload?.notes }
    );
    check(
      "未写身份的价格被单独点出，不计入跨来源印证",
      summary.payload?.unattributed_count === 1 &&
        (summary.payload?.notes ?? []).some((note) => note.includes("未写明产品身份")),
      { unattributed: summary.payload?.unattributed_count, notes: summary.payload?.notes }
    );
    check(
      "整件价在汇总里单独提醒",
      (summary.payload?.notes ?? []).some((note) => note.includes("整件价")),
      summary.payload?.notes
    );
    check(
      "价格水平基准优先取成交价：成交 1 条，357g 中位 12000 / 1kg 中位 33613.45",
      summary.payload?.price_level?.basis === "VERIFIED_TRANSACTION" &&
        summary.payload?.price_level?.sample_size === 1 &&
        summary.payload?.price_level?.median_price_357g === 12000 &&
        summary.payload?.price_level?.median_price_per_kg === 33613.45,
      summary.payload?.price_level
    );
    const listingBucket = (summary.payload?.buckets ?? []).find(
      (bucket) => bucket.price_type === "LISTING" && bucket.unit_scope === "PIECE"
    );
    check(
      "价格带按类型 + 单位分组：挂牌单饼 7 条、中位 13000、强证据 1、异常值 2",
      listingBucket?.count === 7 &&
        listingBucket?.median_value === 13000 &&
        listingBucket?.strong_count === 1 &&
        listingBucket?.outlier_count === 2,
      listingBucket
    );
    check(
      "挂牌价带绝不与成交价混算（成交组单独 1 条）",
      (summary.payload?.buckets ?? []).some(
        (bucket) => bucket.price_type === "VERIFIED_TRANSACTION" && bucket.count === 1
      ),
      summary.payload?.buckets
    );
    check("汇总 spec_ref 指向 §14 / §15 / §16.1", summary.payload?.spec_ref === "§14 / §15 / §16.1", summary.payload?.spec_ref);

    console.log("\n[14] 价格不参与相似度（§13 / §62-6）：价格与相似度物理分离");
    const candidatePool = await request("GET", `/api/products/${productId}/candidates?sort=-score`, { token });
    check("候选池可读", candidatePool.status === 200, candidatePool.status);
    const selfCandidate = itemOf(candidatePool.payload?.items, (item) => item.name === "龙德记六星孔雀");
    check(
      "同款候选来自写明身份的来源（身份键含规格）",
      Boolean(selfCandidate),
      (candidatePool.payload?.items ?? []).map((item) => item.name)
    );
    const candidateDetail = await request(
      "GET",
      `/api/products/${productId}/candidates/${selfCandidate?.id}`,
      { token }
    );
    check("候选详情返回 200", candidateDetail.status === 200, candidateDetail.status);
    const similarityJson = JSON.stringify(candidateDetail.payload?.similarity ?? {});
    check(
      "相似度结构里没有任何 price 字段",
      !/price/i.test(similarityJson),
      similarityJson.slice(0, 240)
    );
    const registeredPrices = [3800, 12000, 12800, 13600, 12900, 13000, 13100, 20000, 60000, 400000, 480000];
    check(
      "相似度结构里不含任何已登记价格数值",
      !registeredPrices.some((value) => similarityJson.includes(String(value))),
      registeredPrices.filter((value) => similarityJson.includes(String(value)))
    );
    const dimensions = candidateDetail.payload?.similarity?.dimensions ?? [];
    check(
      "十维明细齐全且权重合计 100",
      dimensions.length === 10 &&
        dimensions.reduce((sum, item) => sum + (item.weight ?? 0), 0) === 100,
      { count: dimensions.length, weights: dimensions.map((item) => item.weight) }
    );
    check(
      "价格单独放在 observed_prices，不进入 similarity",
      Array.isArray(candidateDetail.payload?.observed_prices) &&
        Object.keys(candidateDetail.payload?.similarity ?? {}).every((key) => !/price/i.test(key)),
      Object.keys(candidateDetail.payload?.similarity ?? {})
    );
    const candidateContract = await request("GET", "/api/candidates/contract", { token });
    check(
      "候选池合同同样声明 price_in_similarity = false",
      candidateContract.payload?.pool?.price_in_similarity === false &&
        candidateContract.payload?.engine?.price_in_similarity === false,
      candidateContract.payload?.pool
    );

    console.log("\n[15] 权限与边界：写限 ADMIN / RESEARCHER，删除限 ADMIN，不存在就如实报不存在");
    const anonymousRebuild = await request("POST", `/api/products/${productId}/market-offers/rebuild`, {
      body: {}
    });
    check("未登录重建价格证据返回 401", anonymousRebuild.status === 401, anonymousRebuild.status);

    const viewer = await request("POST", "/api/auth/register", {
      token,
      body: { email: VIEWER_EMAIL, password: ROLE_PASSWORD, name: "冒烟只读账号", role: "VIEWER" }
    });
    check("管理员创建只读账号返回 201", viewer.status === 201, viewer.status);
    const viewerToken = viewer.payload?.tokens?.access_token;
    if (viewer.status === 201) {
      createdUserEmails.push(VIEWER_EMAIL);
    }
    const viewerRead = await request("GET", `/api/products/${productId}/market-offers`, { token: viewerToken });
    check("只读账号可读价格证据", viewerRead.status === 200, viewerRead.status);
    const viewerSummary = await request("GET", `/api/products/${productId}/price-summary`, { token: viewerToken });
    check("只读账号可读价格汇总", viewerSummary.status === 200, viewerSummary.status);
    const viewerWrite = await request("POST", `/api/products/${productId}/market-offers`, {
      token: viewerToken,
      body: {
        value: 9999,
        price_type: "LISTING",
        unit_scope: "PIECE",
        weight_g: 357,
        subject_name: "只读账号想登记的价格",
        quote: "只读账号不该能写价格"
      }
    });
    check("只读账号登记价格返回 403", viewerWrite.status === 403, viewerWrite.status);
    const viewerDelete = await request(
      "DELETE",
      `/api/products/${productId}/market-offers/${manualOfferId}`,
      { token: viewerToken }
    );
    check("只读账号删除价格返回 403", viewerDelete.status === 403, viewerDelete.status);

    const researcher = await request("POST", "/api/auth/register", {
      token,
      body: { email: RESEARCHER_EMAIL, password: ROLE_PASSWORD, name: "冒烟研究员账号", role: "RESEARCHER" }
    });
    check("管理员创建研究员账号返回 201", researcher.status === 201, researcher.status);
    const researcherToken = researcher.payload?.tokens?.access_token;
    if (researcher.status === 201) {
      createdUserEmails.push(RESEARCHER_EMAIL);
    }
    const researcherCreate = await request("POST", `/api/products/${productId}/market-offers`, {
      token: researcherToken,
      body: {
        value: 9999,
        price_type: "LISTING",
        unit_scope: "PIECE",
        weight_g: 357,
        subject_name: "研究员登记价格",
        quote: "研究员登记：渠道挂牌 9999 元/饼"
      }
    });
    check("研究员可登记价格返回 201", researcherCreate.status === 201, researcherCreate.status);
    const researcherOfferId = researcherCreate.payload?.id;
    const researcherPatch = await request(
      "PATCH",
      `/api/products/${productId}/market-offers/${researcherOfferId}`,
      { token: researcherToken, body: { manual_note: "研究员复核：来源页已核对" } }
    );
    check("研究员可人工修正价格返回 200", researcherPatch.status === 200, researcherPatch.status);
    const researcherDelete = await request(
      "DELETE",
      `/api/products/${productId}/market-offers/${researcherOfferId}`,
      { token: researcherToken }
    );
    check("研究员删除价格返回 403（删除限管理员）", researcherDelete.status === 403, researcherDelete.status);
    const adminDelete = await request("DELETE", `/api/products/${productId}/market-offers/${researcherOfferId}`, {
      token
    });
    check("管理员删除价格返回 204", adminDelete.status === 204, adminDelete.status);
    const deletedOffer = await request(
      "GET",
      `/api/products/${productId}/market-offers/${researcherOfferId}`,
      { token }
    );
    check("删除后查询价格证据返回 404", deletedOffer.status === 404, deletedOffer.status);

    const missingId = "00000000-0000-4000-8000-000000000000";
    const missingProductCreate = await request("POST", `/api/products/${missingId}/market-offers`, {
      token,
      body: {
        value: 1,
        price_type: "LISTING",
        unit_scope: "PIECE",
        weight_g: 357,
        subject_name: "不存在的产品",
        quote: "不存在的产品不该能登记价格"
      }
    });
    check("向不存在的产品登记价格返回 404", missingProductCreate.status === 404, missingProductCreate.status);
    const missingProductRebuild = await request("POST", `/api/products/${missingId}/market-offers/rebuild`, {
      token,
      body: {}
    });
    check("对不存在的产品重建价格返回 404", missingProductRebuild.status === 404, missingProductRebuild.status);
    const missingOfferGet = await request("GET", `/api/products/${productId}/market-offers/${missingId}`, { token });
    check("查询不存在的价格证据返回 404", missingOfferGet.status === 404, missingOfferGet.status);
    const missingOfferPatch = await request("PATCH", `/api/products/${productId}/market-offers/${missingId}`, {
      token,
      body: { manual_note: "不存在的价格不该能改" }
    });
    check("修正不存在的价格证据返回 404", missingOfferPatch.status === 404, missingOfferPatch.status);
    const missingProductSummary = await request("GET", `/api/products/${missingId}/price-summary`, { token });
    check(
      "只读汇总不对不存在的产品编造数据（返回空汇总，product_name 为 null）",
      missingProductSummary.status === 200 &&
        missingProductSummary.payload?.total_offers === 0 &&
        missingProductSummary.payload?.counted_offers === 0 &&
        missingProductSummary.payload?.product_name === null,
      missingProductSummary.payload
    );
    const missingSource = await request("POST", `/api/products/${productId}/market-offers`, {
      token,
      body: {
        value: 1,
        price_type: "LISTING",
        unit_scope: "PIECE",
        weight_g: 357,
        subject_name: "挂不存在来源的价格",
        quote: "来源不存在就不该能挂",
        source_id: missingId
      }
    });
    check(
      "挂不存在的来源返回 400 且回传 source_id",
      missingSource.status === 400 && Boolean(missingSource.payload?.error?.details?.source_id),
      missingSource.payload?.error
    );

    const otherProduct = await request("POST", "/api/products", {
      token,
      body: { ...TARGET_PRODUCT, product_name: "龙德记冒烟对照产品", brand_id: null }
    });
    check("创建对照产品返回 201", otherProduct.status === 201, otherProduct.status);
    otherProductId = otherProduct.payload?.id;
    const crossProductSource = await request("POST", `/api/products/${otherProductId}/market-offers`, {
      token,
      body: {
        value: 15000,
        price_type: "LISTING",
        unit_scope: "PIECE",
        weight_g: 357,
        subject_name: "龙德记六星孔雀",
        quote: "跨产品挂来源不该成功",
        source_id: sourceIds[SOURCE_A_URL]
      }
    });
    check(
      "跨产品挂来源被拒（否则「多来源印证」可以伪造）",
      crossProductSource.status === 400 &&
        String(crossProductSource.payload?.error?.message ?? "").includes("不属于该产品"),
      crossProductSource.payload?.error
    );
    const otherSummary = await request("GET", `/api/products/${otherProductId}/price-summary`, { token });
    check(
      "对照产品价格汇总为空（价格证据不跨产品泄漏）",
      otherSummary.status === 200 && otherSummary.payload?.total_offers === 0,
      { status: otherSummary.status, total: otherSummary.payload?.total_offers }
    );
  } finally {
    if (otherProductId) {
      const removedOther = await request("DELETE", `/api/products/${otherProductId}`, { token });
      console.log(
        `\n[清理] 删除对照产品 → ${
          removedOther.status === 204 || removedOther.status === 200 ? "已删除" : `状态 ${removedOther.status}`
        }`
      );
    }
    if (productId) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `\n[清理] 删除冒烟产品（级联删除价格证据 / 来源 / 抽取 / 研究任务 / 搜索策略 / 候选）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from sources) as sources, (select count(*)::int from market_offers) as offers, (select count(*)::int from comparable_candidates) as candidates"
    );
    console.log(
      `[清理] 开发库当前：products=${totals.rows[0]?.products} · sources=${totals.rows[0]?.sources} · market_offers=${totals.rows[0]?.offers} · comparable_candidates=${totals.rows[0]?.candidates}`
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
