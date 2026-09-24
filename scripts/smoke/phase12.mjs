/**
 * Phase 12 端到端冒烟（规格 §21 强成交话术 / §22 Level 5 王者话术 / §23 成交冲击力评分 /
 * §26 九种输出 / §27 三分钟八段 / §33 价值重点 / §34 生成侧不自动增强 / §47 Agent 9 / §57 验收 / §62-15）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase12.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（强成交话术随产品级联删除）与临时账号，
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员 + 16 行 Value Code 字典），并校验 copy_outputs = 0。
 *
 * 本阶段压的是六条硬约束：
 *   1) §21 / §22 / §26 / §27：五档强度、九种输出、Level 5 七项与三分钟八段的顺序与口径只能来自 schema，
 *      前端不许自己写一套，也不许重排（合同自检逐条对齐）；
 *   2) §22 / §58-9 / §62-10：没有可靠价格锚点时，价格高度叙事必须逐字改用 §22 标准句，且不得挂锚点 id、
 *      不得把话术降级成平庸版本（「没有对标」不等于「说得弱」）；
 *   3) §23 / §57：事实不足机械压分（< 4 条 → 上限 84 / 74 / 68 / 55），分数必须与逐字回查到的事实条数同源，
 *      没录几条事实却喊满分在系统里不可能出现；
 *   4) §47 / §62-5：正文只允许落在本产品已录入事实与上游成稿上，冒烟逐字回查 citations，并验证跨产品不串号；
 *   5) §34：生成侧只落「生成稿」——生成出的版本 intensify_rounds 恒为 0，「强化」是 Phase 13 的独立动作
 *      （POST /copy/intensify 只新增版本，不就地改写），生成永远不等于强化；
 *   6) §62-15：重新生成只新增版本、历史版本全部保留；人工确认只改确认字段，不改正文、不升版本。
 * 因此脚本用「事实齐备产品」「极简产品」「从未生成的产品」三类输入，去压「写得狠 ≠ 可以编」。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase12-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase12-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** §21 固定的五档强度与顺序：接口返回必须逐字对齐，不得重排。 */
const INTENSITY_ORDER = [1, 2, 3, 4, 5];
/** §21 每档的短标签（前端筛选与按钮文案都读这一份）。 */
const INTENSITY_SHORT = { 1: "研究", 2: "专业", 3: "强势", 4: "爆款", 5: "王者" };
/** §21 每档的完整标签（Level N｜短标签），接口下发时必须逐字对齐。 */
const INTENSITY_LABELS = {
  1: "Level 1｜研究",
  2: "Level 2｜专业",
  3: "Level 3｜强销售",
  4: "Level 4｜直播爆款",
  5: "Level 5｜王者"
};
/**
 * §23 / §57 事实不足时的分数上限：回查到 ≥ 4 条事实不压分，3 / 2 / 1 / 0 条分别压到 84 / 74 / 68 / 55。
 * 冒烟自己抄一份常量，才能独立验证「总分 = min(八项机械分, 上限)」这条机械公式。
 */
const IMPACT_CAP = { 0: 55, 1: 68, 2: 74, 3: 84 };
const capOf = (factsUsed) => (factsUsed >= 4 ? 100 : (IMPACT_CAP[factsUsed] ?? 55));
/** §23 八项评分与顺序。 */
const IMPACT_ITEM_KEYS = [
  "hook",
  "product_identity",
  "high_value_sense",
  "price_or_standard_anchor",
  "differentiation",
  "imagery",
  "memory_point",
  "closing"
];
/** §23 分档下限：< 70 自动重写 / 70 可用 / 80 优秀 / 90 核心主播稿。 */
const BAND_MINS = [0, 70, 80, 90];
/** §22 Level 5 七项强制与顺序。 */
const LEVEL5_KEYS = [
  "rhetorical_question",
  "identity_definition",
  "price_height_story",
  "product_architecture_story",
  "style_identity",
  "quotable_lines",
  "closing"
];
/** §26 九种输出与顺序。 */
const OUTPUT_KEYS = [
  "core_quotes",
  "backup_quotes",
  "sec15",
  "sec30",
  "sec60",
  "min3",
  "level5_release",
  "dealer_copy",
  "objections"
];
/** §27 三分钟八段时序与顺序。 */
const MIN3_KEYS = [
  "hook",
  "identity",
  "value_track",
  "value_logic",
  "structure_or_formula",
  "palate",
  "who_for",
  "closing"
];
/** §33 价值重点八项与顺序。 */
const VALUE_FOCUS_KEYS = [
  "identity",
  "market_price",
  "material",
  "mountain",
  "formula_philosophy",
  "style",
  "time",
  "collection"
];
/** §47 Agent 9 的十五项输出与顺序。 */
const AGENT9_KEYS = [
  "one_liner",
  "core_quotes",
  "backup_quotes",
  "opening_hook",
  "selling_points",
  "value_story",
  "product_architecture_story",
  "formula_philosophy",
  "sec15",
  "sec30",
  "sec60",
  "min3",
  "level5_release",
  "dealer_copy",
  "objections"
];
/** §7 / §34 牛逼化按钮：四档按钮 → 五档强度的映射。 */
const INTENSIFY_BUTTONS = [
  { level: "NORMAL", copy_intensity: 2 },
  { level: "STRONG", copy_intensity: 3 },
  { level: "VIRAL", copy_intensity: 4 },
  { level: "KING", copy_intensity: 5 }
];
/** §21 / §22 / §23 / §24 / §25 / §34 / §62 的红线布尔：全为 true 才算合同成立。 */
const REDLINE_KEYS = [
  "no_anchor_not_weak",
  "no_new_fact",
  "rnd_requires_confirmation",
  "price_story_only_with_anchor",
  "rhetoric_allowed",
  "red_blocks_publish",
  "no_manual_style",
  "keep_all_versions"
];
/** §26 / §33 / §47 的限额口径（与 `SALES_COPY_LIMITS` 同源）。 */
const ENGINE_LIMITS = {
  maxVersionsPerProduct: 20,
  coreQuoteCount: 5,
  backupQuoteCount: 20,
  sellingPointCount: 7,
  maxObjections: 8,
  minLevel5QuotableLines: 3,
  minRecordedFacts: 4,
  minQuoteLength: 6,
  maxQuoteLength: 120,
  maxTextLength: 8000,
  defaultPageSize: 20,
  maxPageSize: 100
};
/** §22 / §58-9：没有可靠价格锚点时逐字使用的标准句。 */
const NO_ANCHOR_SENTENCE =
  "这款茶不是用别人现成的价格给自己撑腰，而是先把自己的产品标准立起来。";
/** §58-10：可独立传播的金句口径（6–48 字、自带收束、不以指代词开头）。 */
const QUOTABLE_MAX_LENGTH = 48;

/** 事实齐备的产品：十三格骨架与上游成稿都能找到已录入事实（与 Phase 10 / 11 fixture 同口径）。 */
const FULL_PRODUCT = {
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
  tree_type: "大树",
  season: "春茶",
  grade: "特级",
  dry_leaf_aroma: "烟香明显",
  hot_cup_aroma: "蜜香",
  entry_taste: "浓强",
  thickness: "厚",
  huigan: "快",
  salivation: "强",
  cha_qi: "明显",
  middle_stage: "中段稳定",
  late_stage: "尾水甜",
  endurance: "12 泡以上",
  kill_green_method: "铁锅杀青",
  rolling_method: "手工揉捻",
  drying_method: "日光晒干",
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

/** 几乎没有事实的产品：只保留身份与规格，用来验证「缺事实 = 压分 + 缺口 + 切自建标准」。 */
const THIN_PRODUCT = {
  product_name: "龙德记试样茶",
  year: 2026,
  tea_type: "普洱生茶",
  weight_g: 357,
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

/** 从头到尾不生成的第三款产品：用来验证「未生成的产品也要出现在话术库里」（一行全是 null）。 */
const UNWRITTEN_PRODUCT = {
  product_name: "龙德记未生成试样茶",
  year: 2026,
  tea_type: "普洱熟茶",
  weight_g: 200,
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

/** §58-10 的可传播金句口径（与 `salesCopyQuotableLines()` 同一套机械条件）。 */
function quotableLines(lines) {
  return lines.filter((line) => {
    const text = String(line).trim();
    if (text.length < ENGINE_LIMITS.minQuoteLength || text.length > QUOTABLE_MAX_LENGTH) {
      return false;
    }
    if (!/[。？！!?]$/.test(text)) {
      return false;
    }
    return !/^(它|这个|这款茶也|上述)/.test(text);
  });
}

/** 一版成稿的全部正文（与 `salesCopyTexts()` 同一份口径）。 */
function recordTexts(record) {
  const headline = record.headline;
  return [
    headline.one_liner,
    headline.opening_hook,
    headline.identity_definition,
    headline.price_or_standard_story,
    headline.value_story,
    headline.product_architecture_story,
    headline.formula_philosophy_story,
    headline.style_identity,
    headline.differentiation,
    headline.imagery,
    headline.memory_point,
    headline.who_for,
    headline.closing,
    ...record.quotes.core_quotes,
    ...record.quotes.backup_quotes,
    ...record.selling_points,
    record.scripts.sec15,
    record.scripts.sec30,
    record.scripts.sec60,
    record.scripts.min3.text,
    ...record.scripts.min3.segments.map((segment) => segment.text),
    record.level5_release,
    record.dealer_copy,
    ...record.objections.flatMap((item) => [item.objection, item.response])
  ]
    .map((text) => String(text).trim())
    .filter((text) => text.length > 0);
}

/**
 * 逐字回查（独立实现，故意不调 API 里那份判定）：
 * 引用清单里的每一条都必须能在这款产品的 `products` 行（或它自己的 Value DNA）里原样取到，
 * 且取到的值必须逐字出现在本版正文里。任何一条对不上都说明「稿子里出现了没录入的东西」（§24 / §47 / §62-5）。
 */
async function citationProblems(record, client) {
  const problems = [];
  const joined = recordTexts(record).join("\n");
  // brand_name 在产品侧是白名单字段，但存在 brands 表上，所以一并取回来（其余字段列名与引用名逐字相同）。
  const row = (
    await client.query(
      "select p.*, b.name as brand_name_ref from products p left join brands b on b.id = p.brand_id where p.id = $1",
      [record.product_id]
    )
  ).rows[0];
  if (!row) {
    return [`找不到产品 ${record.product_id}`];
  }
  /** 产品上的 Value DNA 以 JSON 存在 `products.value_dna` 一列里（键为 11 个维度名）。 */
  const dna = row.value_dna ?? null;

  for (const ref of record.fact_refs ?? []) {
    if (!ref.startsWith("product.")) {
      problems.push(`引用了非本产品字段 ${ref}`);
      continue;
    }
    const field = ref.slice("product.".length);
    if (field !== "brand_name" && !(field in row)) {
      problems.push(`引用了白名单外的字段 ${ref}`);
      continue;
    }
    const value = field === "brand_name" ? row.brand_name_ref : row[field];
    if (value === null || value === undefined || String(value).trim().length === 0) {
      problems.push(`引用了未录入字段 ${ref}`);
      continue;
    }
    if (!joined.includes(String(value))) {
      problems.push(`引用值不在正文里 ${ref}=${String(value)}`);
    }
  }

  for (const ref of record.value_dna_refs ?? []) {
    if (!ref.startsWith("dna.")) {
      problems.push(`引用了非 Value DNA 字段 ${ref}`);
      continue;
    }
    const dimension = ref.slice("dna.".length);
    const items = Array.isArray(dna?.[dimension]) ? dna[dimension] : [];
    if (items.length === 0) {
      problems.push(`引用了不存在的 Value DNA 维度 ${ref}`);
      continue;
    }
    if (!items.some((item) => joined.includes(String(item).trim()))) {
      problems.push(`Value DNA 引用值不在正文里 ${ref}=${items.join(" / ")}`);
    }
  }
  return problems;
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  const createdProductIds = [];
  const createdUserEmails = [];
  const missingId = "00000000-0000-4000-8000-000000000000";
  const notAUuid = "not-a-uuid";

  async function createProduct(label, payload) {
    const created = await request("POST", "/api/products", {
      token,
      body: { ...payload, brand_id: null }
    });
    check(`创建产品「${label}」返回 201`, created.status === 201, created.status);
    const id = created.payload?.id;
    if (id) {
      createdProductIds.push(id);
    }
    return id;
  }

  const overviewOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/copy`, { token: authToken });
  const versionsOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/copy/versions`, { token: authToken });
  const recordOf = (productId, recordId, authToken = token) =>
    request("GET", `/api/products/${productId}/copy/${recordId}`, { token: authToken });
  const generate = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/copy/generate`, { token: authToken, body });
  const patch = (productId, recordId, body, authToken = token) =>
    request("PATCH", `/api/products/${productId}/copy/${recordId}`, { token: authToken, body });
  const library = (query = "", authToken = token) =>
    request("GET", `/api/sales-copy${query}`, { token: authToken });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    const healthPhase = String(health.payload?.phase ?? "");
    check(
      "健康检查文案已推进到 Phase 12 及之后（强成交话术仍是其中一环）",
      Number(/Phase\s*(\d+)/.exec(healthPhase)?.[1] ?? 0) >= 12 && healthPhase.includes("已交付"),
      healthPhase
    );
    check(
      "未登录不能读强成交话术合同",
      (await request("GET", "/api/sales-copy/contract")).status === 401
    );
    check("未登录不能读强成交话术标签", (await request("GET", "/api/sales-copy/labels")).status === 401);
    check("未登录不能读强成交话术库", (await request("GET", "/api/sales-copy")).status === 401);
    check(
      "未登录不能读强成交话术总览",
      (await request("GET", `/api/products/${missingId}/copy`)).status === 401
    );
    check(
      "未登录不能生成强成交话术",
      (await request("POST", `/api/products/${missingId}/copy/generate`, { body: {} })).status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("返回 access_token", typeof token === "string" && token.length > 10);

    console.log("\n[2] §21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 合同自检");
    const contractResponse = await request("GET", "/api/sales-copy/contract", { token });
    check("强成交话术合同返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const engine = contractResponse.payload?.engine;
    const downstream = contractResponse.payload?.downstream ?? [];
    check(
      "合同引用 §21–§34 / §47 / §48（一条基线，不分叉；§34 / §48 是 Phase 13 接上的强化口径）",
      contract?.spec_ref === "§21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §48",
      contract?.spec_ref
    );
    check(
      "五档强度齐备且顺序固定（研究 / 专业 / 强销售 / 直播爆款 / 王者，§21 不得增删或重排）",
      JSON.stringify((contract?.levels ?? []).map((level) => level.level)) ===
        JSON.stringify(INTENSITY_ORDER),
      (contract?.levels ?? []).map((level) => level.level)
    );
    check(
      "五档短标签逐字对齐（研究 / 专业 / 强势 / 爆款 / 王者）",
      (contract?.levels ?? []).every((level) => level.short_label === INTENSITY_SHORT[level.level]),
      (contract?.levels ?? []).map((level) => [level.level, level.short_label])
    );
    check("默认档位是 Level 4（爆款，§21）", contract?.default_level === 4, contract?.default_level);
    check(
      "每档都写明定义 / 要求 / tone / 是否王者档（前端不另写文案）",
      (contract?.levels ?? []).every(
        (level) =>
          typeof level.label === "string" &&
          level.label.length > 0 &&
          typeof level.definition === "string" &&
          level.definition.length > 0 &&
          typeof level.requirement === "string" &&
          level.requirement.length > 0 &&
          typeof level.tone === "string" &&
          level.tone.length > 0 &&
          level.is_king === (level.level === 5)
      )
    );
    check(
      "§7 / §34 牛逼化按钮四档齐备且顺序固定（NORMAL / STRONG / VIRAL / KING）",
      JSON.stringify((contract?.intensify_button?.levels ?? []).map((item) => item.level)) ===
        JSON.stringify(INTENSIFY_BUTTONS.map((item) => item.level)),
      (contract?.intensify_button?.levels ?? []).map((item) => item.level)
    );
    check(
      "牛逼化按钮映射到 §21 的 2 / 3 / 4 / 5 档，且写明「不得增加新事实」（§34 / §48）",
      INTENSIFY_BUTTONS.every(
        (expected) =>
          (contract?.intensify_button?.levels ?? []).find((item) => item.level === expected.level)
            ?.copy_intensity === expected.copy_intensity
      ) &&
        String(contract?.intensify_button?.note ?? "").includes("不得增加任何新事实"),
      (contract?.intensify_button?.levels ?? []).map((item) => [item.level, item.copy_intensity])
    );
    check(
      "「再狠一点」最多自动增强 3 轮（§34）",
      contract?.intensify_button?.max_auto_rounds === 3,
      contract?.intensify_button?.max_auto_rounds
    );
    check(
      "§23 八项评分齐备且顺序固定（开场抓人 / 产品身份 / 高价值感 / 价格或标准锚定 / 差异化 / 画面感 / 记忆点 / 成交收口）",
      JSON.stringify((contract?.impact_score?.items ?? []).map((item) => item.key)) ===
        JSON.stringify(IMPACT_ITEM_KEYS),
      (contract?.impact_score?.items ?? []).map((item) => item.key)
    );
    check(
      "§23 八项权重合计 100（满分不可自定义）",
      contract?.impact_score?.max === 100 &&
        (contract?.impact_score?.items ?? []).reduce((sum, item) => sum + item.weight, 0) === 100,
      (contract?.impact_score?.items ?? []).map((item) => [item.key, item.weight])
    );
    check(
      "§23 每项权重 = 各条机械判定条件点数之和（评分不可被主观印象改写）",
      (contract?.impact_score?.items ?? []).every(
        (item) =>
          (item.criteria ?? []).length > 0 &&
          (item.criteria ?? []).reduce((sum, criterion) => sum + criterion.points, 0) === item.weight &&
          (item.criteria ?? []).every(
            (criterion) =>
              typeof criterion.key === "string" &&
              typeof criterion.check === "string" &&
              criterion.check.length > 0
          )
      ),
      (contract?.impact_score?.items ?? []).map((item) => [
        item.key,
        item.weight,
        (item.criteria ?? []).reduce((sum, criterion) => sum + criterion.points, 0)
      ])
    );
    check(
      "§23 分档齐备且下限固定（< 70 自动重写 / 70 可用 / 80 优秀 / 90 核心主播稿）",
      JSON.stringify((contract?.impact_score?.bands ?? []).map((band) => band.min)) ===
        JSON.stringify(BAND_MINS),
      (contract?.impact_score?.bands ?? []).map((band) => [band.band, band.min])
    );
    check(
      "§23 只有 Level 4 / 5 有硬性门槛（85 / 90），其余档位为 null",
      contract?.impact_score?.min_score_by_intensity?.["4"] === 85 &&
        contract?.impact_score?.min_score_by_intensity?.["5"] === 90 &&
        contract?.impact_score?.min_score_by_intensity?.["3"] === undefined,
      contract?.impact_score?.min_score_by_intensity
    );
    check(
      "§22 Level 5 七项齐备且顺序固定（强反问 / 身份定义 / 价格高度 / 产品结构 / 风格身份证 / ≥3 句金句 / 成交收口）",
      JSON.stringify((contract?.level5_requirements ?? []).map((item) => item.key)) ===
        JSON.stringify(LEVEL5_KEYS) &&
        contract?.level5_requirement_count === LEVEL5_KEYS.length,
      (contract?.level5_requirements ?? []).map((item) => item.key)
    );
    check(
      "§22 七项都写明原文要求与机械判定条件（不含主观形容词）",
      (contract?.level5_requirements ?? []).every(
        (item) =>
          typeof item.label === "string" &&
          item.label.length > 0 &&
          typeof item.requirement === "string" &&
          item.requirement.length > 0 &&
          typeof item.check === "string" &&
          item.check.length > 0
      )
    );
    check(
      "§22 无锚点标准句逐字固定（前端与后端共用同一句）",
      contract?.no_anchor_standard_sentence === NO_ANCHOR_SENTENCE,
      contract?.no_anchor_standard_sentence
    );
    check(
      "§26 九种输出齐备且顺序固定（5 句核心金句 / 20 句备用金句 / 15 秒 / 30 秒 / 60 秒 / 3 分钟 / Level 5 发布稿 / 经销商版 / 异议处理）",
      JSON.stringify((contract?.outputs ?? []).map((item) => item.key)) ===
        JSON.stringify(OUTPUT_KEYS),
      (contract?.outputs ?? []).map((item) => item.key)
    );
    check(
      "§26 九种输出都写明要求与成稿落点（主播知道去哪拿去念）",
      (contract?.outputs ?? []).every(
        (item) =>
          typeof item.label === "string" &&
          item.label.length > 0 &&
          typeof item.requirement === "string" &&
          item.requirement.length > 0 &&
          typeof item.source === "string" &&
          item.source.length > 0
      )
    );
    check(
      "§47 Agent 9 十五项输出齐备且顺序固定（第一项是一句话定位）",
      JSON.stringify((contract?.agent9_outputs ?? []).map((item) => item.key)) ===
        JSON.stringify(AGENT9_KEYS),
      (contract?.agent9_outputs ?? []).map((item) => item.key)
    );
    check(
      "§47 十五项输出都写明落点字段",
      (contract?.agent9_outputs ?? []).every(
        (item) =>
          typeof item.label === "string" &&
          item.label.length > 0 &&
          typeof item.source === "string" &&
          item.source.length > 0
      )
    );
    check(
      "§27 三分钟八段时序齐备且顺序固定（炸场钩子 → 身份 → 价值轨道 → 价值逻辑 → 结构或配方 → 口感 → 适合谁 → 收口）",
      JSON.stringify((contract?.min3_timeline ?? []).map((item) => item.key)) ===
        JSON.stringify(MIN3_KEYS),
      (contract?.min3_timeline ?? []).map((item) => item.key)
    );
    check(
      "§27 八段都写明时间轴与这一段必须讲什么",
      (contract?.min3_timeline ?? []).every(
        (item) =>
          typeof item.time_range === "string" &&
          /\d{2}:\d{2}/.test(item.time_range) &&
          typeof item.label === "string" &&
          item.label.length > 0 &&
          typeof item.requirement === "string" &&
          item.requirement.length > 0
      )
    );
    check(
      "§33 价值重点八项齐备且默认全选（用户可以取消其中几项）",
      JSON.stringify((contract?.value_focus ?? []).map((item) => item.key)) ===
        JSON.stringify(VALUE_FOCUS_KEYS) &&
        JSON.stringify(contract?.default_value_focus ?? []) === JSON.stringify(VALUE_FOCUS_KEYS),
      { meta: (contract?.value_focus ?? []).map((item) => item.key), def: contract?.default_value_focus }
    );
    check(
      "§33 模式控件只给 AUTO / BENCHMARK / CATEGORY_CREATOR（模式永远由 §17 判定）",
      JSON.stringify(contract?.modes ?? []) === JSON.stringify(["AUTO", "BENCHMARK", "CATEGORY_CREATOR"]),
      contract?.modes
    );
    check(
      "§26 / §33 / §47 限额下发（20 版 / 5 句 / 20 句 / 7 卖点 / 8 异议 / 3 句金句 / 4 条事实 / 分页 100）",
      Object.entries(ENGINE_LIMITS).every(([key, value]) => contract?.limits?.[key] === value),
      contract?.limits
    );
    check(
      "§17 / §22 / §24 / §25 / §34 / §57 / §62 的八条红线布尔全部为 true（无锚点不弱化 / 不新增事实 / 研发需确认 / 价格高度需锚点 / 允许修辞 / RED 禁发布 / 不做说明书 / 所有版本必须保留）",
      REDLINE_KEYS.every((key) => contract?.[key] === true),
      REDLINE_KEYS.map((key) => [key, contract?.[key]])
    );
    const rules = contract?.rules ?? [];
    check("合同十条规则齐备", rules.length === 10, rules.length);
    check(
      "规则写明「五档不得增删或重排」与「九种输出必须齐全」（§21 / §26）",
      rules.some((rule) => rule.includes("不得增删或重排")) &&
        rules.some((rule) => rule.includes("九种输出")),
      rules
    );
    check(
      "规则写明「Level 4 ≥ 85、Level 5 ≥ 90，< 70 自动重写」与「Level 5 七项必须全部落地」（§22 / §23）",
      rules.some((rule) => rule.includes("Level 4 ≥ 85") && rule.includes("Level 5 ≥ 90")) &&
        rules.some((rule) => rule.includes("七项强制全部落地")),
      rules
    );
    check(
      "规则逐字写明 §22 标准句（没有可靠价格锚点时改用标准句，且不写任何具体价格故事）",
      rules.some((rule) => rule.includes(NO_ANCHOR_SENTENCE)),
      rules
    );
    check(
      "规则写明「只有 RND_CONFIRMED 才允许提研发关系」与「禁止虚构硬事实与承诺」（§25 / §47）",
      rules.some((rule) => rule.includes("RND_CONFIRMED") && rule.includes("复刻")) &&
        rules.some((rule) => rule.includes("禁止虚构") && rule.includes("承诺"))
    );
    check(
      "规则写明「前台文案不得变成说明书」与「研究层谨慎只能写在 evidence_gaps」（§62-11）",
      rules.some((rule) => rule.includes("说明书") && rule.includes("evidence_gaps"))
    );
    check(
      "规则写明「最多自动增强 3 次」与「所有版本必须保留」（§34 / §62-15）",
      rules.some((rule) => rule.includes("最多自动增强 3 次")) &&
        rules.some((rule) => rule.includes("所有版本必须保留"))
    );
    check(
      "本阶段是纯规则引擎：engine.strategy = RULE_BASED 且 ai_wired = false（强化同样不调 AI）",
      engine?.strategy === "RULE_BASED" && engine?.ai_wired === false,
      { strategy: engine?.strategy, ai: engine?.ai_wired }
    );
    check(
      "Agent 9 / Agent 10 已登记且三个 Prompt 键写在合同里（SALES_COPYWRITER / COPY_INTENSIFIER / FACT_REVIEWER）",
      String(engine?.name ?? "").includes("Agent 9") &&
        String(engine?.name ?? "").includes("Agent 10") &&
        JSON.stringify(engine?.prompt_keys ?? []) ===
          JSON.stringify(["SALES_COPYWRITER", "COPY_INTENSIFIER", "FACT_REVIEWER"]),
      { name: engine?.name, keys: engine?.prompt_keys }
    );
    check(
      "engine.note 写明「不调用 AI、不新增任何事实」，且「再狠一点」已接线（Phase 13）",
      String(engine?.note ?? "").includes("不新增任何事实") &&
        String(engine?.note ?? "").includes("Phase 13"),
      engine?.note
    );
    check(
      "下游只登记不实现：Phase 13 / 14 交付后不再登记任何下游，不留未交付占位",
      JSON.stringify(downstream.map((item) => item.phase)) === JSON.stringify([]) &&
        downstream.every((item) => item.status === "PENDING") &&
        downstream.every((item) => typeof item.deliverable === "string" && item.deliverable.length > 0),
      downstream
    );

    console.log("\n[3] 标签接口：五档 / 牛逼化按钮 / 八项评分 / Level 5 七项 / 九种输出 / 八段时序");
    const labelsResponse = await request("GET", "/api/sales-copy/labels", { token });
    check("强成交话术标签返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check(
      "五档强度与合同逐字一致（前端筛选与按钮不另写文案）",
      JSON.stringify((labels?.levels ?? []).map((level) => level.level)) ===
        JSON.stringify(INTENSITY_ORDER) &&
        INTENSITY_ORDER.every((level) => labels?.level_labels?.[String(level)] === INTENSITY_LABELS[level]) &&
        INTENSITY_ORDER.every(
          (level) => labels?.intensity_short_labels?.[String(level)] === INTENSITY_SHORT[level]
        ) &&
        labels?.level_tones?.["1"] === "neutral" &&
        labels?.level_tones?.["2"] === "info" &&
        labels?.level_tones?.["3"] === "warn" &&
        labels?.level_tones?.["4"] === "brand" &&
        labels?.level_tones?.["5"] === "ok",
      { labels: labels?.level_labels, short: labels?.intensity_short_labels, tones: labels?.level_tones }
    );
    check(
      "牛逼化按钮四档下发（含文案映射）",
      JSON.stringify((labels?.intensify_button ?? []).map((item) => item.level)) ===
        JSON.stringify(INTENSIFY_BUTTONS.map((item) => item.level)),
      (labels?.intensify_button ?? []).map((item) => item.level)
    );
    check(
      "§23 八项评分与分档标签下发（八项 / 四档）",
      JSON.stringify((labels?.impact_score_items ?? []).map((item) => item.key)) ===
        JSON.stringify(IMPACT_ITEM_KEYS) &&
        JSON.stringify((labels?.impact_score_band_meta ?? []).map((band) => band.band)) ===
          JSON.stringify(["REWRITE", "USABLE", "EXCELLENT", "CORE"]) &&
        Object.keys(labels?.impact_score_bands ?? {}).length === 4,
      { items: labels?.impact_score_items?.length, bands: labels?.impact_score_band_meta?.length }
    );
    check(
      "§22 Level 5 七项下发（数组与按 key 索引的两种形态都在）",
      JSON.stringify((labels?.level5_requirements ?? []).map((item) => item.key)) ===
        JSON.stringify(LEVEL5_KEYS) &&
        Object.keys(labels?.level5_requirement_meta ?? {}).length === LEVEL5_KEYS.length
    );
    check(
      "§26 九种输出 / §47 十五项 / §27 八段 / §33 八项标签齐备",
      JSON.stringify((labels?.outputs ?? []).map((item) => item.key)) === JSON.stringify(OUTPUT_KEYS) &&
        JSON.stringify((labels?.agent9_outputs ?? []).map((item) => item.key)) ===
          JSON.stringify(AGENT9_KEYS) &&
        JSON.stringify((labels?.min3_timeline ?? []).map((item) => item.key)) ===
          JSON.stringify(MIN3_KEYS) &&
        JSON.stringify((labels?.value_focus ?? []).map((item) => item.key)) ===
          JSON.stringify(VALUE_FOCUS_KEYS)
    );
    check(
      "标签里的限额与标准句与合同同源（前端不会算出另一套上限）",
      Object.entries(ENGINE_LIMITS).every(([key, value]) => labels?.limits?.[key] === value) &&
        labels?.no_anchor_standard_sentence === NO_ANCHOR_SENTENCE
    );

    console.log("\n[4] 事实稀疏产品：切 §22 自建标准句 + 分数与明细同源 + 缺口清单只报缺什么");
    const thinProductId = await createProduct("极简产品（几乎没有事实）", THIN_PRODUCT);
    const fullProductId = await createProduct("事实齐备产品", FULL_PRODUCT);
    const unwrittenProductId = await createProduct("未生成产品", UNWRITTEN_PRODUCT);

    const thinBefore = await overviewOf(thinProductId);
    check("读强成交话术总览返回 200", thinBefore.status === 200, thinBefore.status);
    check(
      "未生成时 record = null、九种输出全部记 MISSING（前端能直接排产）",
      thinBefore.payload?.record === null &&
        JSON.stringify(thinBefore.payload?.missing_outputs ?? []) === JSON.stringify(OUTPUT_KEYS),
      thinBefore.payload?.missing_outputs
    );
    check(
      "没有可靠价格锚点时模式落在 CATEGORY_CREATOR，且正文侧只把对标当标准用（§17 / §44）",
      thinBefore.payload?.mode === "CATEGORY_CREATOR" &&
        thinBefore.payload?.anchor?.has_reliable_price_anchor === false &&
        thinBefore.payload?.anchor?.primary_anchor_id === null &&
        thinBefore.payload?.anchor?.usage === "STANDARD_ONLY",
      thinBefore.payload?.anchor
    );
    check(
      "总览如实上报上游未就绪（产品结构 / 配方哲学 / 自建标准 / 价值映射）",
      thinBefore.payload?.upstream?.architecture_acceptance_passed === false &&
        thinBefore.payload?.upstream?.philosophy_acceptance_passed === false &&
        thinBefore.payload?.upstream?.category_creator_ready === false &&
        thinBefore.payload?.upstream?.value_codes_ready === false,
      thinBefore.payload?.upstream
    );
    check(
      "默认强度取产品录入值（Level 4，§10.5）",
      thinBefore.payload?.default_intensity === 4,
      thinBefore.payload?.default_intensity
    );
    check("未生成时 can_generate = true 且没有阻塞原因", thinBefore.payload?.can_generate === true && thinBefore.payload?.block_reason === null);

    const thinGenerated = await generate(thinProductId, { intensity: 4 });
    check("生成极简产品强成交话术返回 201", thinGenerated.status === 201, thinGenerated.status);
    const thinRecord = thinGenerated.payload;
    const thinFacts = thinRecord?.impact_score?.facts_used;
    const thinRawPoints = (thinRecord?.impact_score?.items ?? []).reduce((sum, item) => sum + item.points, 0);
    check(
      "回查事实条数与引用清单同源（facts_used = 产品事实引用 + Value DNA 引用，前端不必另算一遍）",
      thinFacts === (thinRecord?.fact_refs ?? []).length + (thinRecord?.value_dna_refs ?? []).length &&
        thinFacts >= 1,
      {
        facts: thinFacts,
        facts_refs: (thinRecord?.fact_refs ?? []).length,
        dna_refs: (thinRecord?.value_dna_refs ?? []).length
      }
    );
    check(
      "§23 / §57 总分机械同源：total = min(八项明细之和, 事实不足上限 84 / 74 / 68 / 55)",
      thinRecord?.impact_score?.total === Math.min(thinRawPoints, capOf(thinFacts)),
      {
        total: thinRecord?.impact_score?.total,
        items_sum: thinRawPoints,
        cap: capOf(thinFacts),
        facts_used: thinFacts
      }
    );
    check(
      "§23 note 与被压分的机械结论同源（压没压、压到多少、为什么压都写清楚）",
      String(thinRecord?.impact_score?.note ?? "").includes(`逐字回查到 ${thinFacts} 条已录入事实`) &&
        (thinFacts < ENGINE_LIMITS.minRecordedFacts
          ? String(thinRecord?.impact_score?.note ?? "").includes("硬性压到") &&
            String(thinRecord?.impact_score?.note ?? "").includes(String(ENGINE_LIMITS.minRecordedFacts))
          : String(thinRecord?.impact_score?.note ?? "").includes("未被事实不足压分")),
      { facts_used: thinFacts, note: thinRecord?.impact_score?.note }
    );
    check(
      "压分不等于停止评分：八项明细照旧逐条给出通过 / 未过",
      JSON.stringify((thinRecord?.impact_score?.items ?? []).map((item) => item.key)) ===
        JSON.stringify(IMPACT_ITEM_KEYS) &&
        (thinRecord?.impact_score?.items ?? []).every((item) => (item.criteria ?? []).length > 0)
    );
    check(
      "Level 4 有 85 分硬门槛：required 与分数同源（到了才算过，没到不许硬发布）",
      thinRecord?.impact_score?.required === 85 &&
        thinRecord?.impact_score?.passed === (Number(thinRecord?.impact_score?.total) >= 85),
      { required: thinRecord?.impact_score?.required, total: thinRecord?.impact_score?.total, passed: thinRecord?.impact_score?.passed }
    );
    check(
      "§22 七项只对 Level 5 强制：Level 4 记 required = false（但仍逐项记账，前端能看出差哪几项）",
      thinRecord?.level5?.required === false &&
        (thinRecord?.level5?.requirements ?? []).length === LEVEL5_KEYS.length
    );
    check(
      "§22 / §58-9：没有可靠价格锚点时价格高度叙事逐字等于标准句（不降级成平庸版，也不许编价格）",
      thinRecord?.headline?.price_or_standard_story === NO_ANCHOR_SENTENCE,
      thinRecord?.headline?.price_or_standard_story
    );
    check(
      "没有可靠价格锚点时不得挂上锚点 id（§62-10）",
      thinRecord?.anchor?.primary_anchor_id === null &&
        thinRecord?.anchor?.has_reliable_price_anchor === false
    );
    check(
      "Level 5 自检里「价格高度」这一项的证据就是 §22 标准句（判定与正文同源）",
      (thinRecord?.level5?.requirements ?? []).find((item) => item.key === "price_height_story")
        ?.evidence === NO_ANCHOR_SENTENCE,
      (thinRecord?.level5?.requirements ?? []).find((item) => item.key === "price_height_story")
    );
    const thinGaps = thinRecord?.evidence_gaps ?? [];
    check(
      "证据缺口清单只报缺什么，且按 §62-13 顺序列出锚点与 Phase 10 / 11 / 8 / 9 四层上游",
      thinGaps.some((gap) => gap.includes("没有可靠价格锚点")) &&
        thinGaps.some((gap) => gap.includes("Phase 10")) &&
        thinGaps.some((gap) => gap.includes("Phase 11")) &&
        thinGaps.some((gap) => gap.includes("Phase 8")) &&
        thinGaps.some((gap) => gap.includes("Phase 9")),
      thinGaps
    );
    check(
      "事实条数达到 §57 的 4 条门槛时不误报「事实不足」（缺口清单不会凭空多出一条）",
      thinFacts >= ENGINE_LIMITS.minRecordedFacts &&
        !thinGaps.some((gap) => gap.includes("已录入事实只有")),
      { facts_used: thinFacts, gaps: thinGaps }
    );
    check(
      "§24 合规扫描照常执行：修辞不判红线，禁止承诺 / 受限研发措辞 / 虚构硬事实三项都为空",
      thinRecord?.compliance?.risk === "GREEN" &&
        (thinRecord?.compliance?.forbidden_promises ?? []).length === 0 &&
        (thinRecord?.compliance?.restricted_phrases ?? []).length === 0 &&
        (thinRecord?.compliance?.fabricated_categories ?? []).length === 0,
      { risk: thinRecord?.compliance?.risk, note: thinRecord?.compliance?.note }
    );
    const thinCitationProblems = await citationProblems(thinRecord, client);
    check(
      "逐字回查通过：引用清单里的每一条都能在产品事实 / Value DNA 里取到，且原样出现在正文里",
      thinCitationProblems.length === 0,
      thinCitationProblems
    );
    check(
      "跨产品不串号：极简产品的引用里不出现另一个产品的山头 / 原料",
      !JSON.stringify(thinRecord?.fact_refs ?? []).includes("布朗山") &&
        !JSON.stringify(thinRecord?.fact_refs ?? []).includes("大树春茶"),
      thinRecord?.fact_refs
    );
    check(
      "§26 九种输出的交付状态齐备且顺序固定",
      JSON.stringify((thinRecord?.output_statuses ?? []).map((item) => item.key)) ===
        JSON.stringify(OUTPUT_KEYS)
    );
    check(
      "§34 生成侧不自动增强：生成出的版本 intensify_rounds 恒为 0（强化是 Phase 13 的独立动作）",
      thinRecord?.intensify_rounds === 0 && thinRecord?.intensity === 4
    );
    check(
      "十三格骨架全部产出（一句话定位 / 开场钩子 / 身份定义 / 价值故事 / 结构 / 配方 / 风格 / 差异化 / 画面感 / 记忆点 / 适合谁 / 收口）",
      [
        "one_liner",
        "opening_hook",
        "identity_definition",
        "price_or_standard_story",
        "value_story",
        "product_architecture_story",
        "formula_philosophy_story",
        "style_identity",
        "differentiation",
        "imagery",
        "memory_point",
        "who_for",
        "closing"
      ].every((key) => typeof thinRecord?.headline?.[key] === "string" && thinRecord.headline[key].length > 0)
    );
    check(
      "§57 验收结论与明细同源（四项结论逐项对齐，passed 由四项推导，不是各算各的）",
      thinRecord?.acceptance?.impact_score === thinRecord?.impact_score?.total &&
        thinRecord?.acceptance?.level5_passed === thinRecord?.level5?.satisfied &&
        thinRecord?.acceptance?.compliance_passed === (thinRecord?.compliance?.risk !== "RED") &&
        thinRecord?.acceptance?.passed ===
          (thinRecord?.acceptance?.score_passed === true &&
            thinRecord?.acceptance?.outputs_complete === true &&
            thinRecord?.acceptance?.level5_passed === true &&
            thinRecord?.acceptance?.compliance_passed === true),
      thinRecord?.acceptance
    );

    console.log("\n[5] 模式控件：没有可靠价格锚点就不许写成 Benchmark Mode（§17 / §62-10）");
    const forcedThin = await generate(thinProductId, { mode: "BENCHMARK" });
    check(
      "没有可靠价格锚点却要求 BENCHMARK → 400（宁可报错，也不许把自建标准写成对标）",
      forcedThin.status === 400,
      forcedThin.payload
    );
    check(
      "400 的明细写明请求模式 / 实际模式 / 判定原因（研究员知道该补哪一层证据）",
      forcedThin.payload?.error?.details?.requested_mode === "BENCHMARK" &&
        forcedThin.payload?.error?.details?.resolved_mode === "CATEGORY_CREATOR" &&
        typeof forcedThin.payload?.error?.details?.reason === "string" &&
        forcedThin.payload.error.details.reason.length > 0,
      forcedThin.payload?.error
    );
    const forcedFull = await generate(fullProductId, { mode: "BENCHMARK" });
    check(
      "事实齐备但没有对标的产品同样不许写成 BENCHMARK → 400",
      forcedFull.status === 400,
      forcedFull.payload?.error?.details
    );
    check(
      "被拒绝的请求不产生任何版本（错误的模式判定不留痕）",
      ((await versionsOf(thinProductId)).payload?.items ?? []).length === 1 &&
        ((await versionsOf(fullProductId)).payload?.items ?? []).length === 0
    );

    console.log("\n[6] 事实齐备产品：Level 5 王者稿必须九种输出齐全、七项落地、§57 验收通过");
    const fullGenerated = await generate(fullProductId, { intensity: 5, notes: "冒烟：王者稿" });
    check("生成事实齐备产品强成交话术返回 201", fullGenerated.status === 201, fullGenerated.status);
    const fullRecord = fullGenerated.payload;
    check("本版强度 = Level 5（王者）", fullRecord?.intensity === 5, fullRecord?.intensity);
    check(
      "成交冲击力 ≥ 90 且落在「核心主播稿」档（§23）",
      fullRecord?.impact_score?.total >= 90 &&
        fullRecord?.impact_score?.band === "CORE" &&
        fullRecord?.impact_score?.band_label === "核心主播稿",
      { total: fullRecord?.impact_score?.total, band: fullRecord?.impact_score?.band }
    );
    check(
      "回查事实条数 ≥ 4（没有被事实不足压分）",
      fullRecord?.impact_score?.facts_used >= ENGINE_LIMITS.minRecordedFacts &&
        !String(fullRecord?.impact_score?.note ?? "").includes("压到"),
      { facts: fullRecord?.impact_score?.facts_used, note: fullRecord?.impact_score?.note }
    );
    check(
      "§23 王者的分也是机械算出来的：total = min(八项明细之和, 100) 且明细逐项可追溯",
      fullRecord?.impact_score?.total ===
        Math.min(
          (fullRecord?.impact_score?.items ?? []).reduce((sum, item) => sum + item.points, 0),
          100
        ) &&
        (fullRecord?.impact_score?.items ?? []).every(
          (item) =>
            (item.criteria ?? []).length > 0 &&
            item.points ===
              (item.criteria ?? []).reduce(
                (sum, criterion) => sum + (criterion.passed ? criterion.points : 0),
                0
              )
        ),
      {
        total: fullRecord?.impact_score?.total,
        items_sum: (fullRecord?.impact_score?.items ?? []).reduce((sum, item) => sum + item.points, 0)
      }
    );
    check(
      "§22 Level 5 七项强制全部落地（required = true 且 missing 为空）",
      fullRecord?.level5?.required === true &&
        fullRecord?.level5?.satisfied === true &&
        JSON.stringify(fullRecord?.level5?.missing ?? []) === JSON.stringify([]),
      { required: fullRecord?.level5?.required, missing: fullRecord?.level5?.missing }
    );
    check(
      "§26 九种输出全部 DONE（缺一项就不算交付）",
      (fullRecord?.output_statuses ?? []).length === OUTPUT_KEYS.length &&
        (fullRecord?.output_statuses ?? []).every((item) => item.status === "DONE"),
      (fullRecord?.output_statuses ?? []).map((item) => [item.key, item.status])
    );
    check(
      "§26 金句数量达标（≥ 5 句核心 + ≥ 20 句备用）",
      (fullRecord?.quotes?.core_quotes ?? []).length >= ENGINE_LIMITS.coreQuoteCount &&
        (fullRecord?.quotes?.backup_quotes ?? []).length >= ENGINE_LIMITS.backupQuoteCount,
      {
        core: (fullRecord?.quotes?.core_quotes ?? []).length,
        backup: (fullRecord?.quotes?.backup_quotes ?? []).length
      }
    );
    check(
      "§47 七大卖点正好七条（不多不少）",
      (fullRecord?.selling_points ?? []).length === ENGINE_LIMITS.sellingPointCount,
      (fullRecord?.selling_points ?? []).length
    );
    check(
      "§27 三分钟八段齐备且顺序固定，全文非空",
      JSON.stringify((fullRecord?.scripts?.min3?.segments ?? []).map((segment) => segment.key)) ===
        JSON.stringify(MIN3_KEYS) &&
        (fullRecord?.scripts?.min3?.text ?? "").length > 0
    );
    check(
      "四种时长稿（15 秒 / 30 秒 / 60 秒 / 3 分钟）都有正文",
      ["sec15", "sec30", "sec60"].every(
        (key) => typeof fullRecord?.scripts?.[key] === "string" && fullRecord.scripts[key].length > 0
      ) && (fullRecord?.scripts?.min3?.text ?? "").length > 0
    );
    check(
      "§57 验收通过（分数 / 九种输出 / Level 5 / 合规四项全过）",
      fullRecord?.acceptance?.passed === true &&
        fullRecord?.acceptance?.score_passed === true &&
        fullRecord?.acceptance?.outputs_complete === true &&
        (fullRecord?.acceptance?.missing_outputs ?? []).length === 0 &&
        fullRecord?.acceptance?.level5_passed === true &&
        fullRecord?.acceptance?.compliance_passed === true,
      fullRecord?.acceptance
    );
    check(
      "§24 合规 GREEN：修辞不判红线，一个字都没有编",
      fullRecord?.compliance?.risk === "GREEN" &&
        (fullRecord?.compliance?.forbidden_promises ?? []).length === 0 &&
        (fullRecord?.compliance?.restricted_phrases ?? []).length === 0 &&
        (fullRecord?.compliance?.fabricated_categories ?? []).length === 0,
      { risk: fullRecord?.compliance?.risk, note: fullRecord?.compliance?.note }
    );
    const fullCitationProblems = await citationProblems(fullRecord, client);
    check(
      "逐字回查通过：引用清单里的每一条都能在产品事实 / Value DNA 里取到，且原样出现在正文里",
      fullCitationProblems.length === 0,
      fullCitationProblems
    );
    check(
      "生成备注落库（人工可回溯这一版为什么生成）",
      fullRecord?.notes === "冒烟：王者稿"
    );

    console.log("\n[7] §22 Level 5 七项逐项含义（金句 ≥ 3 句可独立传播 / 收口必须让人带走决定）");
    const lv5Requirements = fullRecord?.level5?.requirements ?? [];
    const lv5Of = (key) => lv5Requirements.find((item) => item.key === key);
    check(
      "七项顺序与合同固定顺序一致（前端按同一份顺序渲染）",
      JSON.stringify(lv5Requirements.map((item) => item.key)) === JSON.stringify(LEVEL5_KEYS),
      lv5Requirements.map((item) => item.key)
    );
    check(
      "强反问：开场钩子必须是问句，且证据就是开场钩子原文",
      lv5Of("rhetorical_question")?.status === "DONE" &&
        lv5Of("rhetorical_question")?.evidence === fullRecord?.headline?.opening_hook &&
        /[？?]/.test(fullRecord?.headline?.opening_hook ?? ""),
      lv5Of("rhetorical_question")
    );
    check(
      "身份定义：必须给出「谁」的身份句，而不是形容词堆叠",
      lv5Of("identity_definition")?.status === "DONE" &&
        String(lv5Of("identity_definition")?.evidence ?? "").includes("身份"),
      lv5Of("identity_definition")?.evidence
    );
    check(
      "价格高度：没有可靠价格锚点时证据就是 §22 标准句（不许编具体价格故事）",
      lv5Of("price_height_story")?.status === "DONE" &&
        lv5Of("price_height_story")?.evidence === NO_ANCHOR_SENTENCE,
      lv5Of("price_height_story")
    );
    check(
      "产品结构叙事 / 风格身份证：两格都必须有正文（§5 / §4.2）",
      lv5Of("product_architecture_story")?.status === "DONE" &&
        lv5Of("product_architecture_story")?.evidence ===
          fullRecord?.headline?.product_architecture_story &&
        lv5Of("style_identity")?.status === "DONE" &&
        lv5Of("style_identity")?.evidence === fullRecord?.headline?.style_identity
    );
    check(
      "金句：至少 3 句满足 §58-10 的可独立传播口径（6–48 字 / 自带收束 / 不以指代词开头）",
      quotableLines([
        ...(fullRecord?.quotes?.core_quotes ?? []),
        ...(fullRecord?.quotes?.backup_quotes ?? [])
      ]).length >= ENGINE_LIMITS.minLevel5QuotableLines &&
        lv5Of("quotable_lines")?.status === "DONE",
      quotableLines([
        ...(fullRecord?.quotes?.core_quotes ?? []),
        ...(fullRecord?.quotes?.backup_quotes ?? [])
      ]).length
    );
    check(
      "成交收口：必须让人带走一个决定，而不是客套收尾（§22）",
      lv5Of("closing")?.status === "DONE" &&
        lv5Of("closing")?.evidence === fullRecord?.headline?.closing &&
        /(带走|决定|记住|想清楚|判断)/.test(fullRecord?.headline?.closing ?? ""),
      fullRecord?.headline?.closing
    );
    check(
      "七项都给出证据原文：DONE 时非空、MISSING 时为 null（判定与正文同源）",
      lv5Requirements.every((item) =>
        item.status === "DONE"
          ? typeof item.evidence === "string" && item.evidence.length > 0
          : item.evidence === null
      ),
      lv5Requirements.map((item) => [item.key, item.status])
    );
    check(
      "不到 Level 5 的版本也逐项记账（Level 4 极简产品同样能看到差距在哪）",
      (thinRecord?.level5?.requirements ?? []).length === LEVEL5_KEYS.length &&
        (thinRecord?.level5?.requirements ?? []).every((item) =>
          ["DONE", "MISSING"].includes(item.status)
        )
    );

    console.log("\n[8] 强成交话术库：跨产品矩阵 / 筛选 / 排序 / 分页（未生成的产品也要出现）");
    const matrix = await library("?page=1&pageSize=20");
    check("读强成交话术库返回 200", matrix.status === 200, matrix.status);
    const matrixRows = matrix.payload?.items ?? [];
    check(
      "三款产品全部出现（未生成的也占一行，方便排产）",
      matrixRows.length === 3 && matrix.payload?.total === 3,
      { items: matrixRows.length, total: matrix.payload?.total }
    );
    check(
      "每一行都写明 spec_ref 与分页信息（前端不猜口径）",
      matrixRows.every((row) => row.spec_ref === "§21 / §26 / §47") &&
        matrix.payload?.page === 1 &&
        matrix.payload?.pageSize === 20 &&
        matrix.payload?.totalPages === 1
    );
    const fullRow = matrixRows.find((row) => row.product_id === fullProductId);
    check(
      "已生成的行给出模式 / 强度 / 分数 / 分档 / 四项结论 / 一句话定位 / 生成时间",
      fullRow?.mode === "CATEGORY_CREATOR" &&
        fullRow?.intensity === 5 &&
        fullRow?.impact_score >= 90 &&
        fullRow?.band === "CORE" &&
        fullRow?.acceptance_passed === true &&
        fullRow?.outputs_complete === true &&
        fullRow?.level5_passed === true &&
        fullRow?.compliance_passed === true &&
        typeof fullRow?.one_liner === "string" &&
        fullRow.one_liner.length > 0 &&
        typeof fullRow?.generated_at === "string",
      fullRow
    );
    const unwrittenRow = matrixRows.find((row) => row.product_id === unwrittenProductId);
    const level5TrueRows = matrixRows.filter((row) => row.level5_passed === true);
    const missingTrueRows = matrixRows.filter((row) => row.record_id === null);
    const anchorTrueRows = matrixRows.filter((row) => row.has_reliable_price_anchor === true);
    check(
      "未生成的行整行判空（版本 / 强度 / 分数 / 一句话定位 / 生成时间都是 null，九种输出全记 MISSING）",
      unwrittenRow?.record_id === null &&
        unwrittenRow?.version === null &&
        unwrittenRow?.intensity === null &&
        unwrittenRow?.impact_score === null &&
        unwrittenRow?.band === null &&
        unwrittenRow?.one_liner === null &&
        unwrittenRow?.generated_at === null &&
        unwrittenRow?.is_confirmed === false &&
        unwrittenRow?.outputs_complete === false &&
        JSON.stringify(unwrittenRow?.missing_outputs ?? []) === JSON.stringify(OUTPUT_KEYS),
      unwrittenRow
    );
    check(
      "未生成的行也给出 §17 模式结论（现算，不留空）",
      ["BENCHMARK", "CATEGORY_CREATOR"].includes(unwrittenRow?.mode),
      unwrittenRow?.mode
    );
    check(
      "筛选 ?intensity=5 只返回王者档那一行",
      (await library("?intensity=5")).payload?.total === 1 &&
        (await library("?intensity=5")).payload?.items?.[0]?.product_id === fullProductId
    );
    check(
      "筛选 ?level5=true 只返回 Level 5 七项全过的版本；?level5=false 返回其余（含未生成）",
      level5TrueRows.length >= 1 &&
        level5TrueRows.every((row) => row.impact_score !== null) &&
        (await library("?level5=true")).payload?.total === level5TrueRows.length &&
        (await library("?level5=true")).payload?.items?.every((row) => row.level5_passed === true) &&
        (await library("?level5=false")).payload?.total === matrixRows.length - level5TrueRows.length &&
        (await library("?level5=false")).payload?.items?.every((row) => row.level5_passed === false),
      {
        level5_true: level5TrueRows.length,
        level5_true_filtered: (await library("?level5=true")).payload?.total,
        level5_false_filtered: (await library("?level5=false")).payload?.total
      }
    );
    check(
      "筛选 ?has_anchor=true / false 与 §17 锚点结论同口径（本冒烟没有任何可靠锚点）",
      anchorTrueRows.length === 0 &&
        (await library("?has_anchor=true")).payload?.total === 0 &&
        (await library("?has_anchor=false")).payload?.total === matrixRows.length &&
        (await library("?has_anchor=false")).payload?.items?.every(
          (row) => row.has_reliable_price_anchor === false
        )
    );
    check(
      "筛选 ?missing=true / false 是完整二分（未生成 vs 已写成稿，两边加起来正好是全量）",
      missingTrueRows.length >= 1 &&
        missingTrueRows.length < matrixRows.length &&
        (await library("?missing=true")).payload?.total === missingTrueRows.length &&
        (await library("?missing=true")).payload?.items?.every((row) => row.record_id === null) &&
        (await library("?missing=false")).payload?.total === matrixRows.length - missingTrueRows.length &&
        (await library("?missing=false")).payload?.items?.every((row) => row.record_id !== null),
      {
        missing_true: missingTrueRows.length,
        missing_true_filtered: (await library("?missing=true")).payload?.total,
        missing_false_filtered: (await library("?missing=false")).payload?.total
      }
    );
    check(
      "筛选 ?mode=CATEGORY_CREATOR 命中全部（没有可靠锚点的茶一律自建标准）；?mode=BENCHMARK 为空",
      (await library("?mode=CATEGORY_CREATOR")).payload?.total === 3 &&
        (await library("?mode=BENCHMARK")).payload?.total === 0
    );
    check(
      "关键词 ?q= 命中产品名（运营按名字找稿）",
      (await library("?q=六星孔雀")).payload?.total === 1 &&
        (await library("?q=六星孔雀")).payload?.items?.[0]?.product_id === fullProductId
    );
    const sorted = await library("?sort=-impact_score");
    check(
      "排序 ?sort=-impact_score：高分在前，未生成的整行沉底（排产优先看已写成稿）",
      sorted.payload?.items?.[0]?.product_id === fullProductId &&
        sorted.payload?.items?.[2]?.impact_score === null,
      (sorted.payload?.items ?? []).map((row) => [row.product_name, row.impact_score])
    );
    const paged = await library("?page=1&pageSize=1");
    check(
      "分页生效（pageSize = 1 时只回一行，total / totalPages 仍按全量算）",
      (paged.payload?.items ?? []).length === 1 &&
        paged.payload?.total === 3 &&
        paged.payload?.totalPages === 3,
      paged.payload
    );

    console.log("\n[9] §62-15：重新生成只新增版本，人工确认只改确认字段");
    const thinV1 = ((await versionsOf(thinProductId)).payload?.items ?? [])[0];
    const thinRegenerated = await generate(thinProductId, {
      intensity: 3,
      value_focus: ["identity", "style"]
    });
    check("重新生成返回 201（新版本，而不是覆盖旧版）", thinRegenerated.status === 201, thinRegenerated.status);
    const thinVersions = await versionsOf(thinProductId);
    check(
      "版本列表最新在前且历史版本全部保留（v2 / v1）",
      JSON.stringify((thinVersions.payload?.items ?? []).map((item) => item.version)) ===
        JSON.stringify([2, 1]),
      (thinVersions.payload?.items ?? []).map((item) => item.version)
    );
    check(
      "每一版各自的强度 / 分数 / 分档独立冻结（不随新版本漂，§62-15）",
      thinVersions.payload?.items?.[0]?.intensity === 3 &&
        thinVersions.payload?.items?.[1]?.intensity === 4 &&
        thinVersions.payload?.items?.[1]?.impact_score === thinV1?.impact_score &&
        thinVersions.payload?.items?.[1]?.band === thinV1?.band,
      thinVersions.payload?.items
    );
    check(
      "总览与版本接口一致：record 是最新一版（v2），versions 里两版都在",
      (await overviewOf(thinProductId)).payload?.record?.version === 2 &&
        ((await overviewOf(thinProductId)).payload?.versions ?? []).length === 2
    );
    const thinRecordV2 = thinRegenerated.payload;
    check(
      "§33 价值重点按请求落库（只勾两项也如实记账，不偷偷补齐）",
      JSON.stringify(thinRecordV2?.value_focus ?? []) === JSON.stringify(["identity", "style"]),
      thinRecordV2?.value_focus
    );
    const beforeHeadline = JSON.stringify(thinRecordV2?.headline ?? {});
    const beforeScore = thinRecordV2?.impact_score?.total;
    const beforeQuotes = JSON.stringify(thinRecordV2?.quotes ?? {});

    const confirmed = await patch(thinProductId, thinRecordV2?.id, { is_confirmed: true });
    check("人工确认返回 200", confirmed.status === 200, confirmed.status);
    check(
      "确认后 is_confirmed = true 且确认人与确认时间落库（谁批的能查到）",
      confirmed.payload?.is_confirmed === true &&
        typeof confirmed.payload?.confirmed_by === "string" &&
        typeof confirmed.payload?.confirmed_at === "string",
      { by: confirmed.payload?.confirmed_by, at: confirmed.payload?.confirmed_at }
    );
    check(
      "人工确认不改正文、不改分数、不升版本（§62-15）",
      confirmed.payload?.version === 2 &&
        JSON.stringify(confirmed.payload?.headline ?? {}) === beforeHeadline &&
        confirmed.payload?.impact_score?.total === beforeScore &&
        JSON.stringify(confirmed.payload?.quotes ?? {}) === beforeQuotes,
      { version: confirmed.payload?.version, score: confirmed.payload?.impact_score?.total }
    );
    check(
      "人工确认后历史版本仍全部保留（v2 已确认 / v1 未确认）",
      (await versionsOf(thinProductId)).payload?.items?.some(
        (item) => item.version === 2 && item.is_confirmed === true
      ) &&
        (await versionsOf(thinProductId)).payload?.items?.some(
          (item) => item.version === 1 && item.is_confirmed === false
        )
    );
    const noted = await patch(thinProductId, thinRecordV2?.id, { notes: "主播稿已人工确认" });
    check(
      "追加备注返回 200 且备注落库、版本与正文都不受影响",
      noted.status === 200 &&
        noted.payload?.notes === "主播稿已人工确认" &&
        noted.payload?.version === 2 &&
        JSON.stringify(noted.payload?.headline ?? {}) === beforeHeadline,
      noted.payload?.notes
    );
    const reread = await recordOf(thinProductId, thinRecordV2?.id);
    check(
      "单版调阅返回的是落库时冻结的结论（与生成时逐字一致，不会因今日事实变化而漂）",
      reread.status === 200 &&
        JSON.stringify(reread.payload?.headline ?? {}) === beforeHeadline &&
        reread.payload?.impact_score?.total === beforeScore &&
        reread.payload?.level5?.required === false
    );
    check(
      "跨产品调阅版本不串号（拿别的产品的 id 查不到这一版）",
      (await recordOf(fullProductId, thinRecordV2?.id)).status === 404
    );
    check(
      "对不存在的版本做人工确认返回 404",
      (await patch(thinProductId, missingId, { is_confirmed: true })).status === 404
    );

    console.log("\n[10] 权限矩阵：读需登录，写限 ADMIN / RESEARCHER（主播稿对外口径不能乱改）");
    const viewerRegistered = await request("POST", "/api/auth/register", {
      token,
      body: {
        email: VIEWER_EMAIL,
        password: ROLE_PASSWORD,
        name: "冒烟只读用户",
        role: "VIEWER"
      }
    });
    check("创建只读账号返回 201", viewerRegistered.status === 201, viewerRegistered.status);
    createdUserEmails.push(VIEWER_EMAIL);
    const viewerToken = viewerRegistered.payload?.tokens?.access_token;
    check(
      "只读账号可以读合同 / 标签 / 话术库 / 单产品总览（主播与经销商本来就要看）",
      (await request("GET", "/api/sales-copy/contract", { token: viewerToken })).status === 200 &&
        (await request("GET", "/api/sales-copy/labels", { token: viewerToken })).status === 200 &&
        (await library("", viewerToken)).status === 200 &&
        (await overviewOf(fullProductId, viewerToken)).status === 200
    );
    check(
      "只读账号不能生成强成交话术（403）",
      (await generate(unwrittenProductId, {}, viewerToken)).status === 403
    );
    check(
      "只读账号不能人工确认（403）",
      (await patch(thinProductId, thinRecordV2?.id, { is_confirmed: true }, viewerToken)).status === 403
    );

    const researcherRegistered = await request("POST", "/api/auth/register", {
      token,
      body: {
        email: RESEARCHER_EMAIL,
        password: ROLE_PASSWORD,
        name: "冒烟研究员",
        role: "RESEARCHER"
      }
    });
    check("创建研究员账号返回 201", researcherRegistered.status === 201, researcherRegistered.status);
    createdUserEmails.push(RESEARCHER_EMAIL);
    const researcherToken = researcherRegistered.payload?.tokens?.access_token;
    const researcherGenerated = await generate(
      unwrittenProductId,
      { mode: "CATEGORY_CREATOR" },
      researcherToken
    );
    check("研究员可以生成强成交话术（201）", researcherGenerated.status === 201, researcherGenerated.status);
    check(
      "显式指定 CATEGORY_CREATOR 且与 §17 判定一致时放行，模式按判定落库（不按请求覆盖）",
      researcherGenerated.payload?.mode_at_generation === "CATEGORY_CREATOR" &&
        researcherGenerated.payload?.preference === "AUTO" &&
        researcherGenerated.payload?.anchor?.has_reliable_price_anchor === false,
      {
        mode: researcherGenerated.payload?.mode_at_generation,
        preference: researcherGenerated.payload?.preference
      }
    );
    const researcherConfirmed = await patch(
      unwrittenProductId,
      researcherGenerated.payload?.id,
      { is_confirmed: true },
      researcherToken
    );
    check("研究员可以人工确认（200）", researcherConfirmed.status === 200, researcherConfirmed.status);
    check(
      "研究员生成的是 v1（新产品的第一条版本，不与别的产品共用版本号）",
      researcherGenerated.payload?.version === 1
    );

    console.log("\n[11] 边界：strict 校验 / 非法参数 / 404");
    check(
      "生成时传多余字段返回 400（strict schema）",
      (await generate(thinProductId, { trigger: "USER_OPT_OUT" })).status === 400
    );
    check(
      "强度超出 1–5 返回 400",
      (await generate(thinProductId, { intensity: 6 })).status === 400
    );
    check(
      "价值重点传空数组返回 400（至少要勾一项，§33）",
      (await generate(thinProductId, { value_focus: [] })).status === 400
    );
    check(
      "价值重点传未知项返回 400",
      (await generate(thinProductId, { value_focus: ["color"] })).status === 400
    );
    check(
      "模式传未知值返回 400",
      (await generate(thinProductId, { mode: "NOPE" })).status === 400
    );
    check(
      "生成备注超过 2000 字返回 400",
      (await generate(thinProductId, { notes: "长".repeat(2001) })).status === 400
    );
    check(
      "PATCH 传多余字段返回 400（人工确认只能改确认与备注）",
      (await patch(thinProductId, thinRecordV2?.id, { is_confirmed: true, headline: {} })).status === 400
    );
    check(
      "PATCH 备注超过 2000 字返回 400",
      (await patch(thinProductId, thinRecordV2?.id, { notes: "长".repeat(2001) })).status === 400
    );
    check(
      "话术库非法布尔返回 400（known_ratio=maybe 这类写法不给后门）",
      (await library("?has_anchor=maybe")).status === 400
    );
    check("话术库非法强度返回 400", (await library("?intensity=6")).status === 400);
    check("话术库非法排序返回 400", (await library("?sort=price_desc")).status === 400);
    check("话术库非法模式返回 400", (await library("?mode=AUTO")).status === 400);
    check("话术库分页超过上限返回 400", (await library("?pageSize=101")).status === 400);
    check("话术库多余查询参数返回 400（strict schema）", (await library("?status=READY")).status === 400);
    check("话术库产品 id 非法 UUID 返回 400", (await library("?product_id=not-a-uuid")).status === 400);
    check("给不存在的产品生成强成交话术返回 404", (await generate(missingId)).status === 404);
    check("读不存在产品的总览返回 404", (await overviewOf(missingId)).status === 404);
    check("读不存在产品的版本列表返回 404", (await versionsOf(missingId)).status === 404);
    check("读不存在产品的单版返回 404", (await recordOf(missingId, missingId)).status === 404);
    check(
      "产品 id 不是 UUID 时按「没找到这个资源」处理（404，不是 500，更不会串到别的产品的稿子）",
      (await overviewOf(notAUuid)).status === 404 &&
        (await versionsOf(notAUuid)).status === 404 &&
        JSON.stringify((await overviewOf(notAUuid)).payload ?? {}).includes("NOT_FOUND"),
      {
        overview: (await overviewOf(notAUuid)).status,
        versions: (await versionsOf(notAUuid)).status
      }
    );
  } finally {
    for (const productId of createdProductIds) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `[清理] 删除冒烟产品 ${productId}（级联删除强成交话术）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from sources) as sources, (select count(*)::int from market_offers) as offers, (select count(*)::int from comparable_candidates) as candidates, (select count(*)::int from value_anchors) as anchors, (select count(*)::int from category_creator_profiles) as creator_profiles, (select count(*)::int from product_value_codes) as value_profiles, (select count(*)::int from product_architectures) as architectures, (select count(*)::int from formula_philosophies) as philosophies, (select count(*)::int from copy_outputs) as copy_outputs, (select count(*)::int from value_codes) as value_codes"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：products=${row?.products} · sources=${row?.sources} · market_offers=${row?.offers} · comparable_candidates=${row?.candidates} · value_anchors=${row?.anchors} · category_creator_profiles=${row?.creator_profiles} · product_value_codes=${row?.value_profiles} · product_architectures=${row?.architectures} · formula_philosophies=${row?.philosophies} · copy_outputs=${row?.copy_outputs} · value_codes=${row?.value_codes}`
    );
    check(
      "冒烟结束后业务表清零（只保留 seed 与 16 行 Value Code 字典，copy_outputs 级联清空）",
      row?.products === 0 &&
        row?.sources === 0 &&
        row?.offers === 0 &&
        row?.candidates === 0 &&
        row?.anchors === 0 &&
        row?.creator_profiles === 0 &&
        row?.value_profiles === 0 &&
        row?.architectures === 0 &&
        row?.philosophies === 0 &&
        row?.copy_outputs === 0 &&
        row?.value_codes === 16,
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
