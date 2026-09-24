/**
 * Phase 5 端到端冒烟（规格 §13 可比性评分 / §36 高价值茶数据库 / §42 Agent 4 / §54 comparable_candidates）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase5.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（来源 / 抽取 / 研究任务 / 候选随之级联删除）
 *       与临时账号；开发库最终只保留 seed（品牌「龙德记」+ 管理员）。
 *
 * 为什么直接用 pg 灌来源：本地默认 SEARCH_PROVIDER=mock，检索不会返回任何结果，
 * 研究流水线不可能自己产出候选。为了让候选池真正被覆盖，脚本直接在 sources 表写入
 * 「已经抓取并抽取完成」的来源（last_extraction 与真实抽取结果同结构），
 * 而不是伪造搜索结果——研究流水线仍然只读这些来源，不负责编造来源（§62-1）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase5-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase5-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

const SOURCE_A_URL = "https://smoke-phase5.example.com/ldj-peacock-a";
const SOURCE_B_URL = "https://smoke-phase5.example.com/ldj-peacock-b";

/** 目标产品：与 API 测试 fixture 一致，保证「同款自比」可以拿到 88 分。 */
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
  dry_leaf_aroma: "烟香明显",
  entry_taste: "浓强",
  huigan: "快",
  salivation: "强",
  cha_qi: "明显",
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

/** 网页正文（quote 必须能逐字回溯；本脚本不重跑抽取，但留正文便于人工复核证据原话）。 */
function pageText(price) {
  return [
    "龙德记六星孔雀 2026 行情",
    "品牌：龙德记 年份：2026 年 茶类：普洱生茶（生茶）",
    "产地：勐海 布朗山，原料：大树春茶，规格 357g。",
    "香气：烟香明显；入口浓强，回甘快，生津强，茶气明显。",
    `挂牌价 ${price} 元/饼。`
  ].join("\n");
}

/**
 * 已落库的 Agent 3 抽取结果（价格只作原话证据，类型按原文判定为挂牌价）。
 * 两条来源指向同一款茶、只有价格不同：用于验证「来源变多 / 价差不改变相似度」。
 */
function extraction(price) {
  return {
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
        price_type: "LISTING",
        unit_scope: "PIECE",
        weight_g: null,
        observed_at: null,
        note: "冒烟数据：原文写明的是挂牌价"
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
  };
}

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

function firstItem(items) {
  return Array.isArray(items) && items.length > 0 ? items[0] : undefined;
}

function byName(items, name) {
  return (items ?? []).find((item) => item.name === name);
}

function dimensionOf(candidate, dimension) {
  return (candidate?.similarity?.dimensions ?? []).find((entry) => entry.dimension === dimension);
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  let productId;
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

    console.log("\n[2] §13 相似度合同：价格不参与、权重合计 100、十个维度、四个分档");
    const contract = await request("GET", "/api/candidates/contract", { token });
    check("合同自检返回 200", contract.status === 200, contract.status);
    const comparable = contract.payload?.comparable;
    check("comparable.price_in_similarity = false", comparable?.price_in_similarity === false, comparable?.price_in_similarity);
    check("候选池合同 price_in_similarity = false", contract.payload?.pool?.price_in_similarity === false);
    check("引擎自检 price_in_similarity = false", contract.payload?.engine?.price_in_similarity === false);
    check("十个维度已登记", (comparable?.dimensions ?? []).length === 10, comparable?.dimensions?.length);
    check("权重合计 100", comparable?.weight_total === 100, comparable?.weight_total);
    check("引擎侧权重合计同为 100", contract.payload?.engine?.weight_total === 100, contract.payload?.engine?.weight_total);
    check(
      "维度顺序与 §13 一致",
      JSON.stringify((comparable?.dimensions ?? []).map((item) => item.dimension)) ===
        JSON.stringify([
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
        ]),
      (comparable?.dimensions ?? []).map((item) => item.dimension)
    );
    check(
      "任何维度名里都不含价格",
      (comparable?.dimensions ?? []).every((item) => !/price|价格/i.test(item.dimension))
    );
    check("四个分档已登记", Object.keys(comparable?.bands ?? {}).length === 4, comparable?.bands);
    check(
      "候选状态含四个中文标签",
      comparable?.statuses?.PENDING_REVIEW === "待评审" &&
        comparable?.statuses?.APPROVED === "已确认对标" &&
        comparable?.statuses?.REJECTED === "已拒绝" &&
        comparable?.statuses?.ARCHIVED === "已归档",
      comparable?.statuses
    );
    check(
      "去重键字段为 品牌|名称|年份|规格",
      JSON.stringify(contract.payload?.pool?.identity_key_fields) ===
        JSON.stringify(["brand_name", "name", "year", "weight_g", "spec_notes"]),
      contract.payload?.pool?.identity_key_fields
    );
    const anonymousContract = await request("GET", "/api/candidates/contract");
    check("未登录读合同返回 401", anonymousContract.status === 401, anonymousContract.status);
    const anonymousCandidates = await request("GET", "/api/candidates");
    check("未登录读候选池返回 401", anonymousCandidates.status === 401, anonymousCandidates.status);

    console.log("\n[3] 创建冒烟产品");
    const created = await request("POST", "/api/products", {
      token,
      body: { ...TARGET_PRODUCT, brand_id: null }
    });
    check("创建产品返回 201", created.status === 201, created.status);
    productId = created.payload?.id;
    check("返回产品 id", typeof productId === "string" && productId.length > 10);

    console.log("\n[4] 人工登记候选：走同一套十维评分、重复身份键冲突、缺名称被拒");
    const manual = await request("POST", `/api/products/${productId}/candidates`, {
      token,
      body: {
        name: "大益 7542",
        brand_name: "大益",
        year: 2019,
        tea_type: "普洱熟茶",
        mountain: "临沧",
        weight_g: 357,
        notes: "人工登记：渠道报价，仅作参考"
      }
    });
    check("人工登记返回 201", manual.status === 201, manual.status);
    check(
      "身份键 = 大益|大益7542|2019|357|",
      manual.payload?.identity_key === "大益|大益7542|2019|357|",
      manual.payload?.identity_key
    );
    check("生熟相反 + 山头不同 → 拒绝档", manual.payload?.similarity_band === "REJECT", {
      band: manual.payload?.similarity_band,
      total: manual.payload?.similarity_total
    });
    check("人工登记初始状态为待评审", manual.payload?.status === "PENDING_REVIEW", manual.payload?.status);
    check(
      "人工登记不带来源与价格",
      (manual.payload?.source_ids ?? []).length === 0 && (manual.payload?.observed_prices ?? []).length === 0
    );
    check("人工登记保留备注", String(manual.payload?.notes ?? "").includes("人工登记"));
    const manualCandidateId = manual.payload?.id;

    const duplicate = await request("POST", `/api/products/${productId}/candidates`, {
      token,
      body: { name: "大益7542", brand_name: "大益", year: 2019, weight_g: 357 }
    });
    check("重复身份键返回 409 而不是静默覆盖", duplicate.status === 409, duplicate.status);
    check(
      "409 回传已存在的候选 id，便于前端直接跳转",
      duplicate.payload?.error?.details?.candidate_id === manualCandidateId,
      duplicate.payload?.error
    );

    const unnamed = await request("POST", `/api/products/${productId}/candidates`, {
      token,
      body: { brand_name: "大益" }
    });
    check("缺名称返回 400", unnamed.status === 400, unnamed.status);

    console.log("\n[5] 灌入两条「已抓取 + 已抽取」来源（同款茶、价差 3000）");
    const sourceRows = [];
    for (const [url, price] of [
      [SOURCE_A_URL, 12000],
      [SOURCE_B_URL, 15000]
    ]) {
      const body = pageText(price);
      const inserted = await client.query(
        `insert into sources
           (product_id, url, canonical_url, domain, title, source_kind,
            fetch_status, http_status, content_text, content_chars,
            extraction_status, extracted_at, last_extraction)
         values ($1, $2, $3, $4, $5, 'PRICE_PAGE', 'FETCHED', 200, $6, $7, 'EXTRACTED', now(), $8::jsonb)
         returning id`,
        [
          productId,
          url,
          url,
          "smoke-phase5.example.com",
          "龙德记六星孔雀 2026 行情",
          body,
          body.length,
          JSON.stringify(extraction(price))
        ]
      );
      sourceRows.push(inserted.rows[0]?.id);
    }
    check("两条来源均已落库", sourceRows.every((id) => typeof id === "string"), sourceRows);

    console.log("\n[6] 由来源重建候选池（§13 去重 + 十维打分）");
    const rebuilt = await request("POST", `/api/products/${productId}/candidates/rebuild`, {
      token,
      body: {}
    });
    check("重建返回 201", rebuilt.status === 201, rebuilt.status);
    check("新建 1 条候选、未更新", rebuilt.payload?.created === 1 && rebuilt.payload?.updated === 0, {
      created: rebuilt.payload?.created,
      updated: rebuilt.payload?.updated
    });
    check("默认阈值沿用 §13 拒绝线 55", rebuilt.payload?.min_score === 55, rebuilt.payload?.min_score);
    check(
      "统计口径：2 条来源 → 1 条候选",
      rebuilt.payload?.stats?.sources_considered === 2 &&
        rebuilt.payload?.stats?.drafts === 1 &&
        rebuilt.payload?.stats?.merged_multi_source === 1 &&
        rebuilt.payload?.stats?.skipped_no_name === 0,
      rebuilt.payload?.stats
    );
    check("spec_ref 指向 §13 / §36 / §42", rebuilt.payload?.spec_ref === "§13 / §36 / §42", rebuilt.payload?.spec_ref);

    const list = await request("GET", `/api/products/${productId}/candidates?sort=-score`, { token });
    check("产品级候选列表返回 200", list.status === 200, list.status);
    check("候选总数 2（1 条引擎候选 + 1 条人工候选）", list.payload?.total === 2, list.payload?.total);
    const selfCandidate = byName(list.payload?.items, "龙德记六星孔雀");
    check("同款来源合并成一条候选", Boolean(selfCandidate), (list.payload?.items ?? []).map((item) => item.name));
    check("合并来源数 = 2", selfCandidate?.merged_sources === 2, selfCandidate?.merged_sources);
    check("两条来源 id 都被保留", (selfCandidate?.source_ids ?? []).length === 2, selfCandidate?.source_ids);
    check(
      "同款自比总分 88（八维满分，市场定位 7 + 工艺 5 未知按 0 分）",
      selfCandidate?.similarity_total === 88,
      { total: selfCandidate?.similarity_total, band: selfCandidate?.similarity_band }
    );
    check("分档为核心对标", selfCandidate?.similarity_band === "CORE_COMPARABLE", selfCandidate?.similarity_band);
    check(
      "未知维度只有市场定位与工艺（未知 ≠ 相似）",
      JSON.stringify(selfCandidate?.similarity?.unknown_dimensions) === JSON.stringify(["positioning", "craft"]),
      selfCandidate?.similarity?.unknown_dimensions
    );
    check(
      "命中维度共 8 个",
      (selfCandidate?.similarity?.matched_dimensions ?? []).length === 8,
      selfCandidate?.similarity?.matched_dimensions
    );
    check(
      "未知维度按 0 分并给出中文理由",
      ["positioning", "craft"].every((dimension) => {
        const entry = dimensionOf(selfCandidate, dimension);
        return entry?.score === 0 && entry?.matched === false && String(entry?.note ?? "").includes("按 0 分");
      }),
      ["positioning", "craft"].map((dimension) => dimensionOf(selfCandidate, dimension))
    );
    check(
      "滋味维度命中并解释命中了什么",
      String(dimensionOf(selfCandidate, "taste")?.note ?? "").includes("滋味骨架命中"),
      dimensionOf(selfCandidate, "taste")?.note
    );
    check(
      "十维权重与 §13 一致（18/18/15/13/10/8/7/5/3/3）",
      JSON.stringify((selfCandidate?.similarity?.dimensions ?? []).map((entry) => entry.weight)) ===
        JSON.stringify([18, 18, 15, 13, 10, 8, 7, 5, 3, 3]),
      (selfCandidate?.similarity?.dimensions ?? []).map((entry) => entry.weight)
    );
    check(
      "警告里写明「未知不等于相似」",
      (selfCandidate?.similarity?.warnings ?? []).some((warning) => warning.includes("未知不等于相似")),
      selfCandidate?.similarity?.warnings
    );
    check(
      "核心对标提示可用于 §16 高价值锚点",
      (selfCandidate?.similarity?.warnings ?? []).some((warning) => warning.includes("高价值锚点")),
      selfCandidate?.similarity?.warnings
    );

    console.log("\n[7] 价格不参与相似度：价差只留在证据里");
    const prices = (selfCandidate?.observed_prices ?? []).map((entry) => entry.value).sort((left, right) => left - right);
    check("两条观察价原话都被保留", JSON.stringify(prices) === JSON.stringify([12000, 15000]), prices);
    check(
      "观察价类型按原文判定为挂牌价",
      (selfCandidate?.observed_prices ?? []).every((entry) => entry.price_type === "LISTING"),
      (selfCandidate?.observed_prices ?? []).map((entry) => entry.price_type)
    );
    check(
      "观察价保留原文句子",
      (selfCandidate?.observed_prices ?? []).some((entry) => String(entry.quote ?? "").includes("挂牌价 15000"))
    );
    check(
      "相似度明细里不含任何价格数字（12000 / 15000）",
      !/12000|15000/.test(JSON.stringify(selfCandidate?.similarity ?? {})),
      JSON.stringify(selfCandidate?.similarity ?? {}).slice(0, 240)
    );
    const priceEvidence = (selfCandidate?.evidence ?? []).filter((entry) => entry.kind === "PRICE_QUOTE");
    check("价格只作为证据行存在（2 条）", priceEvidence.length === 2, priceEvidence.length);
    check(
      "事实证据保留原话",
      (selfCandidate?.evidence ?? []).some(
        (entry) => entry.kind === "EXTRACTED_FACT" && entry.field === "aroma" && entry.value === "烟香明显"
      ),
      (selfCandidate?.evidence ?? []).map((entry) => `${entry.kind}:${entry.field}`)
    );

    console.log("\n[8] 低于本次构建阈值的候选照样入库但标记拒绝");
    const strict = await request("POST", `/api/products/${productId}/candidates/rebuild`, {
      token,
      body: { min_score: 95 }
    });
    check("阈值 95 的重建返回 201", strict.status === 201, strict.status);
    check("记录本次阈值", strict.payload?.min_score === 95, strict.payload?.min_score);
    check("1 条候选低于阈值", strict.payload?.below_min_score === 1, strict.payload?.below_min_score);
    const strictList = await request("GET", `/api/products/${productId}/candidates?sort=-score`, { token });
    const rejected = byName(strictList.payload?.items, "龙德记六星孔雀");
    check("候选仍入库但标记为拒绝", rejected?.similarity_band === "REJECT", rejected?.similarity_band);
    check("十维原始总分不被阈值改写", rejected?.similarity_total === 88, rejected?.similarity_total);
    check(
      "警告同时给出阈值与原始分档，便于审计",
      (rejected?.similarity?.warnings ?? []).some(
        (warning) => warning.includes("阈值 95") && warning.includes("原始分档 CORE_COMPARABLE")
      ),
      rejected?.similarity?.warnings
    );

    const relaxed = await request("POST", `/api/products/${productId}/candidates/rebuild`, { token, body: {} });
    check("放宽阈值后不再有低于阈值的候选", relaxed.payload?.below_min_score === 0, relaxed.payload?.below_min_score);
    check("分档恢复为核心对标", relaxed.payload?.band_counts?.CORE_COMPARABLE === 1, relaxed.payload?.band_counts);

    console.log("\n[9] 人工评审不被重算覆盖（keep_reviewed）");
    const beforeReview = await request("GET", `/api/products/${productId}/candidates?sort=-score`, { token });
    const reviewTarget = byName(beforeReview.payload?.items, "龙德记六星孔雀");
    const approved = await request("PATCH", `/api/products/${productId}/candidates/${reviewTarget?.id}`, {
      token,
      body: { status: "APPROVED", review_note: "同年同产区同规格，确认作为核心对标" }
    });
    check("评审返回 200", approved.status === 200, approved.status);
    check("状态置为已确认对标", approved.payload?.status === "APPROVED", approved.payload?.status);
    check(
      "记录评审意见与评审人",
      String(approved.payload?.review_note ?? "").includes("核心对标") && typeof approved.payload?.reviewed_by === "string"
    );

    const kept = await request("POST", `/api/products/${productId}/candidates/rebuild`, {
      token,
      body: { keep_reviewed: true }
    });
    check("keep_reviewed=true 时保留 1 条评审结果", kept.payload?.kept_reviewed === 1, kept.payload?.kept_reviewed);
    const afterKeep = await request("GET", `/api/products/${productId}/candidates?sort=-score`, { token });
    const keptCandidate = byName(afterKeep.payload?.items, "龙德记六星孔雀");
    check("重算后状态仍为已确认对标", keptCandidate?.status === "APPROVED", keptCandidate?.status);
    check("重算后总分仍为 88", keptCandidate?.similarity_total === 88, keptCandidate?.similarity_total);

    const reset = await request("POST", `/api/products/${productId}/candidates/rebuild`, {
      token,
      body: { keep_reviewed: false }
    });
    check("keep_reviewed=false 时不保留评审结果", reset.payload?.kept_reviewed === 0, reset.payload?.kept_reviewed);
    const afterReset = await request("GET", `/api/products/${productId}/candidates?sort=-score`, { token });
    const resetCandidate = byName(afterReset.payload?.items, "龙德记六星孔雀");
    check("候选退回待评审", resetCandidate?.status === "PENDING_REVIEW", resetCandidate?.status);
    check("评审意见被清空（可重新评审）", resetCandidate?.review_note === null && resetCandidate?.reviewed_by === null);

    console.log("\n[10] §36 高价值茶数据库：跨产品筛选与排序");
    const global = await request("GET", "/api/candidates?sort=-score", { token });
    check("跨产品候选池返回 200", global.status === 200, global.status);
    check("跨产品池含本轮候选", (global.payload?.total ?? 0) >= 2, global.payload?.total);
    const top = firstItem(global.payload?.items);
    check("回传目标产品名，便于数据库视图展示", top?.product_name === "龙德记六星孔雀", top?.product_name);

    const coreOnly = await request("GET", `/api/candidates?product_id=${productId}&band=CORE_COMPARABLE&sort=-score`, { token });
    check(
      "按分档筛选：核心对标 1 条",
      coreOnly.payload?.total === 1 && firstItem(coreOnly.payload?.items)?.name === "龙德记六星孔雀",
      coreOnly.payload?.total
    );
    const rejectOnly = await request("GET", `/api/candidates?product_id=${productId}&band=REJECT`, { token });
    check(
      "按分档筛选：拒绝档 1 条（人工登记的大益 7542）",
      rejectOnly.payload?.total === 1 && firstItem(rejectOnly.payload?.items)?.name === "大益 7542",
      rejectOnly.payload?.total
    );
    const byKeyword = await request("GET", `/api/candidates?product_id=${productId}&q=大益`, { token });
    check("按关键词筛选命中大益", byKeyword.payload?.total === 1, byKeyword.payload?.total);
    const byMinScore = await request("GET", `/api/candidates?product_id=${productId}&min_score=50`, { token });
    check(
      "按最低分筛选只留高分候选",
      byMinScore.payload?.total === 1 && firstItem(byMinScore.payload?.items)?.similarity_total === 88,
      byMinScore.payload?.total
    );
    const ascending = await request("GET", `/api/candidates?product_id=${productId}&sort=score`, { token });
    check(
      "按分数升序排序",
      JSON.stringify((ascending.payload?.items ?? []).map((item) => item.similarity_total)) === JSON.stringify([3, 88]),
      (ascending.payload?.items ?? []).map((item) => item.similarity_total)
    );
    const paged = await request("GET", `/api/candidates?product_id=${productId}&sort=-score&page=2&pageSize=1`, { token });
    check(
      "分页可用：第 2 页只返回 1 条低分候选",
      (paged.payload?.items ?? []).length === 1 && firstItem(paged.payload?.items)?.similarity_total === 3,
      paged.payload?.items?.length
    );
    const badQuery = await request("GET", "/api/candidates?min_score=140", { token });
    check("非法筛选参数返回 400", badQuery.status === 400, badQuery.status);

    console.log("\n[11] §55 研究流水线：候选池与可比性评分两个阶段已交付");
    const run = await request("POST", `/api/products/${productId}/research/runs`, {
      token,
      body: { use_ai: false, max_queries: 3, max_results_per_query: 2, max_sources: 3, auto_extract: true }
    });
    check("启动研究返回 201", run.status === 201, run.status);
    check("任务成功收口", run.payload?.status === "SUCCEEDED", { status: run.payload?.status, error: run.payload?.error });
    check(
      "本轮阶段覆盖到候选池与相似度",
      ["CANDIDATE_POOL", "SIMILARITY_SCORE"].every((stage) => (run.payload?.stages_run ?? []).includes(stage)),
      run.payload?.stages_run
    );
    check(
      "已交付阶段为 1–15（Phase 15 主播中心 / 经销商中心与导出落地后同步推进）",
      JSON.stringify(run.payload?.implemented_phases) ===
        JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
      run.payload?.implemented_phases
    );
    check("候选总数与重建结果一致", run.payload?.candidates_total === 2, run.payload?.candidates_total);
    check(
      "重跑研究只更新已有候选，不重复建候选",
      // 手工登记的候选不来自来源，重建只覆盖来源派生候选，因此更新数为 1。
      run.payload?.candidates_created === 0 && run.payload?.candidates_updated === 1,
      { created: run.payload?.candidates_created, updated: run.payload?.candidates_updated }
    );
    for (const stage of ["CANDIDATE_POOL", "SIMILARITY_SCORE"]) {
      const entry = (run.payload?.progress ?? []).find((item) => item.stage === stage);
      check(`${stage} 阶段状态为 SUCCEEDED 且标记为已交付`, entry?.status === "SUCCEEDED" && entry?.implemented === true, entry);
    }
    // 已交付阶段会随 Phase 推进变化：Phase 9 的价值映射模块已交付，但研究流水线仍未执行
    // VALUE_CODES 阶段（该阶段由产品内的价值拆解页面单独触发），因此状态必须是 PENDING。
    const valueCodesStage = (run.payload?.progress ?? []).find((item) => item.stage === "VALUE_CODES");
    check(
      "Phase 9 价值映射已交付，但流水线未执行该阶段时状态仍为 PENDING",
      valueCodesStage?.implemented === true && valueCodesStage?.status === "PENDING",
      valueCodesStage
    );
    // 已交付阶段会随 Phase 推进变化：Phase 10 的产品结构模块已交付，但研究流水线仍未执行
    // PRODUCT_ARCHITECTURE 阶段（该阶段由产品内的产品结构页面单独触发），因此状态必须是 PENDING。
    const productArchitectureStage = (run.payload?.progress ?? []).find(
      (item) => item.stage === "PRODUCT_ARCHITECTURE"
    );
    check(
      "Phase 10 产品结构已交付，但流水线未执行该阶段时状态仍为 PENDING",
      productArchitectureStage?.implemented === true && productArchitectureStage?.status === "PENDING",
      productArchitectureStage
    );
    // 已交付阶段会随 Phase 推进变化：Phase 11 的配方哲学模块已交付，但研究流水线仍未执行
    // FORMULA_PHILOSOPHY 阶段（该阶段由产品内的配方哲学页面单独触发），因此状态必须是 PENDING。
    const formulaStage = (run.payload?.progress ?? []).find((item) => item.stage === "FORMULA_PHILOSOPHY");
    check(
      "Phase 11 配方哲学已交付，但流水线未执行该阶段时状态仍为 PENDING",
      formulaStage?.implemented === true && formulaStage?.status === "PENDING",
      formulaStage
    );
    check(
      "相似度阶段明确写入「价格不参与」",
      (run.payload?.progress ?? []).some(
        (item) => item.stage === "SIMILARITY_SCORE" && item.detail?.price_in_similarity === false
      )
    );

    console.log("\n[12] 权限边界与删除");
    const anonymousPatch = await request("PATCH", `/api/products/${productId}/candidates/${reviewTarget?.id}`, {
      body: { status: "APPROVED" }
    });
    check("未登录评审候选返回 401", anonymousPatch.status === 401, anonymousPatch.status);
    const anonymousRebuild = await request("POST", `/api/products/${productId}/candidates/rebuild`, { body: {} });
    check("未登录重建候选池返回 401", anonymousRebuild.status === 401, anonymousRebuild.status);

    const viewer = await request("POST", "/api/auth/register", {
      token,
      body: { email: VIEWER_EMAIL, password: ROLE_PASSWORD, name: "冒烟只读账号", role: "VIEWER" }
    });
    check("管理员创建只读账号返回 201", viewer.status === 201, viewer.status);
    const viewerToken = viewer.payload?.tokens?.access_token;
    if (viewer.status === 201) {
      createdUserEmails.push(VIEWER_EMAIL);
    }
    const viewerRead = await request("GET", `/api/products/${productId}/candidates`, { token: viewerToken });
    check("只读账号可读候选池", viewerRead.status === 200, viewerRead.status);
    const viewerWrite = await request("POST", `/api/products/${productId}/candidates`, {
      token: viewerToken,
      body: { name: "只读用户候选" }
    });
    check("只读账号写候选返回 403", viewerWrite.status === 403, viewerWrite.status);
    const viewerDelete = await request("DELETE", `/api/products/${productId}/candidates/${reviewTarget?.id}`, {
      token: viewerToken
    });
    check("只读账号删除候选返回 403", viewerDelete.status === 403, viewerDelete.status);

    const researcher = await request("POST", "/api/auth/register", {
      token,
      body: { email: RESEARCHER_EMAIL, password: ROLE_PASSWORD, name: "冒烟研究员账号", role: "RESEARCHER" }
    });
    check("管理员创建研究员账号返回 201", researcher.status === 201, researcher.status);
    const researcherToken = researcher.payload?.tokens?.access_token;
    if (researcher.status === 201) {
      createdUserEmails.push(RESEARCHER_EMAIL);
    }
    const researcherCreate = await request("POST", `/api/products/${productId}/candidates`, {
      token: researcherToken,
      body: { name: "研究员登记候选", brand_name: "某厂" }
    });
    check("研究员可写候选", researcherCreate.status === 201, researcherCreate.status);
    const researcherCandidateId = researcherCreate.payload?.id;
    const researcherDelete = await request("DELETE", `/api/products/${productId}/candidates/${researcherCandidateId}`, {
      token: researcherToken
    });
    check("研究员删除候选返回 403（删除限管理员）", researcherDelete.status === 403, researcherDelete.status);
    const adminDelete = await request("DELETE", `/api/products/${productId}/candidates/${researcherCandidateId}`, { token });
    check("管理员删除候选返回 204", adminDelete.status === 204, adminDelete.status);
    const gone = await request("GET", `/api/products/${productId}/candidates/${researcherCandidateId}`, { token });
    check("删除后候选详情返回 404", gone.status === 404, gone.status);

    const manualDelete = await request("DELETE", `/api/products/${productId}/candidates/${manualCandidateId}`, { token });
    check("删除人工登记候选返回 204", manualDelete.status === 204, manualDelete.status);
  } finally {
    if (productId) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `\n[清理] 删除冒烟产品（级联删除来源 / 抽取 / 研究任务 / 搜索策略 / 候选）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    if (productId) {
      const leftovers = await client.query(
        "select count(*)::int as value from comparable_candidates where product_id = $1",
        [productId]
      );
      console.log(`[清理] 该产品残留候选数：${leftovers.rows[0]?.value ?? "?"}`);
    }
    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from comparable_candidates) as candidates, (select count(*)::int from sources) as sources"
    );
    console.log(
      `[清理] 开发库当前：products=${totals.rows[0]?.products} · sources=${totals.rows[0]?.sources} · comparable_candidates=${totals.rows[0]?.candidates}`
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
