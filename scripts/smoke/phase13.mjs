/**
 * Phase 13 端到端冒烟（规格 §7 四档递进 / §34「再狠一点」牛逼化按钮 /
 * §48 Agent 10 八项自检 / §62-15 版本只增不删）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase13.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（强成交话术随产品级联删除）与临时账号，
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员 + 16 行 Value Code 字典），并校验 copy_outputs = 0。
 *
 * 本阶段压的是六条硬约束：
 *   1) §7 / §21：按钮四档（普通 / 强势 / 爆款 / 王者）映射到强度 2 / 3 / 4 / 5，**只升不降**——
 *      同一档或更低档必须 400，而不是静默生成一份「写弱一点」的稿子；
 *   2) §34：强化器不接受任何事实输入，新版本正文逐字回查到的引用清单必须是源版本的子集，
 *      `added_facts` 必须为空数组（多一条就拒绝落库）；
 *   3) §62-15：强化 = 新增版本。源版本原封不动保留，正文 / 评分 / 轮次全部可回溯；
 *   4) §48：八项自检逐条可以查到判定依据，分数与 §23 评分同源，Level 4 / 5 分数线 85 / 90；
 *   5) §48：最多自动强化 3 轮，第 3 轮之后必须人工处理（400 + details.max_auto_rounds = 3）；
 *   6) 权限与边界：读需登录、写限 ADMIN / RESEARCHER，strict 校验不给后门。
 * 因此脚本用「事实齐备产品」「极简产品」两类输入，去压「写得狠 ≠ 可以编，也 ≠ 可以偷偷改写历史版本」。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase13-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase13-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** §7 / §34 牛逼化按钮四档与顺序。 */
const INTENSIFY_LEVELS = ["NORMAL", "STRONG", "VIRAL", "KING"];
/** §7 按钮档位 → §21 成交强度。 */
const INTENSIFY_MAPPING = { NORMAL: 2, STRONG: 3, VIRAL: 4, KING: 5 };
/** §7 按钮文案（与后端 `INTENSIFY_BUTTON_LABELS` 同源）。 */
const INTENSIFY_LABELS = { NORMAL: "普通", STRONG: "强势", VIRAL: "爆款", KING: "王者" };
/** §48 自动强化轮次上限。 */
const MAX_AUTO_ROUNDS = 3;
/** §48 Agent 10 八项自检与顺序（最后一项是负向检查）。 */
const SELF_CHECK_KEYS = [
  "opening_hook",
  "identity",
  "value_height",
  "product_structure",
  "quotes",
  "memory_point",
  "closing_push",
  "no_manual_tone"
];
/** §23 / §48 分数线：只有 Level 4 / Level 5 有硬性下限。 */
const MIN_SCORE = { 4: 85, 5: 90 };
/** §21 五档短标签（前端与按钮文案都读同一份）。 */
const INTENSITY_SHORT = { 1: "研究", 2: "专业", 3: "强势", 4: "爆款", 5: "王者" };
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

/** 事实齐备的产品：十三格骨架与上游成稿都能找到已录入事实（与 Phase 10 / 11 / 12 fixture 同口径）。 */
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

/** 几乎没有事实的产品：用来验证「缺事实的稿子同样可以强化，但强化不会凭空补事实」。 */
const THIN_PRODUCT = {
  product_name: "龙德记试样茶",
  year: 2026,
  tea_type: "普洱生茶",
  weight_g: 357,
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
 * 且取到的值必须逐字出现在本版正文里（§24 / §34 / §47 / §62-5）。
 */
async function citationProblems(record, client) {
  const problems = [];
  const joined = recordTexts(record).join("\n");
  const row = (
    await client.query(
      "select p.*, b.name as brand_name_ref from products p left join brands b on b.id = p.brand_id where p.id = $1",
      [record.product_id]
    )
  ).rows[0];
  if (!row) {
    return [`找不到产品 ${record.product_id}`];
  }
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

/** 强化前后的引用清单对比：新版本多出来的引用必须为空（§34 的机械红线）。 */
function addedRefs(source, next) {
  return (next ?? []).filter((ref) => !(source ?? []).includes(ref));
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
  const intensify = (productId, body, authToken = token) =>
    request("POST", `/api/products/${productId}/copy/intensify`, { token: authToken, body });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    const healthPhase = String(health.payload?.phase ?? "");
    // 与 phase10.mjs 同口径：只断言「至少推进到 Phase 13 且写明已交付」，不锁死具体文案
    // （避免每交付一个 Phase 都回来改历史脚本；Phase 13 不是最后一个 Phase）。
    const healthPhaseNumber = Number(/Phase\s*(\d+)/.exec(healthPhase)?.[1] ?? 0);
    check(
      "健康检查文案随最新交付阶段推进（至少到 Phase 13 牛逼化强化器）",
      healthPhaseNumber >= 13 && healthPhase.includes("已交付"),
      healthPhase
    );
    check(
      "未登录不能点「再狠一点」（401）",
      (await intensify(missingId, { level: "KING" })).status === 401
    );
    check(
      "未登录不能读强成交话术合同 / 标签",
      (await request("GET", "/api/sales-copy/contract")).status === 401 &&
        (await request("GET", "/api/sales-copy/labels")).status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("登录响应带回 access_token", typeof token === "string" && token.length > 0);

    console.log("\n[2] §7 / §34 / §48 合同口径自检（按钮四档 / 只升不降 / 八项自检 / 不新增事实）");
    const contractResponse = await request("GET", "/api/sales-copy/contract", { token });
    check("强成交话术合同返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const engine = contractResponse.payload?.engine;
    const downstream = contractResponse.payload?.downstream ?? [];
    const button = contract?.intensify_button;
    check(
      "合同 spec_ref 已包含 §34 / §48（强化器与自检口径写进合同，不散落在前端）",
      String(contract?.spec_ref ?? "").includes("§34") &&
        String(contract?.spec_ref ?? "").includes("§48"),
      contract?.spec_ref
    );
    check(
      "§7 牛逼化按钮四档与顺序固定（NORMAL / STRONG / VIRAL / KING）",
      JSON.stringify((button?.levels ?? []).map((item) => item.level)) ===
        JSON.stringify(INTENSIFY_LEVELS),
      (button?.levels ?? []).map((item) => item.level)
    );
    check(
      "§7 四档映射为 Level 2 / 3 / 4 / 5（普通 / 强势 / 爆款 / 王者）",
      INTENSIFY_LEVELS.every((level) => button?.mapping?.[level] === INTENSIFY_MAPPING[level]) &&
        INTENSIFY_LEVELS.every((level) => button?.levels?.some((item) => item.label === INTENSIFY_LABELS[level])),
      button?.mapping
    );
    check(
      "§48 最多自动增强 3 轮（合同下发 max_auto_rounds = 3）",
      button?.max_auto_rounds === MAX_AUTO_ROUNDS,
      button?.max_auto_rounds
    );
    check(
      "§48 Agent 10 八项自检与顺序固定，且最后一项「说明书味太重」是负向检查",
      JSON.stringify((button?.self_check ?? []).map((item) => item.key)) ===
        JSON.stringify(SELF_CHECK_KEYS) &&
        (button?.self_check ?? []).filter((item) => item.negative).length === 1 &&
        (button?.self_check ?? []).at(-1)?.negative === true,
      (button?.self_check ?? []).map((item) => [item.key, item.negative])
    );
    check(
      "§48 八项自检每一项都写明复用 §23 的哪几条机械判定（不另写一套主观标准）",
      (button?.self_check ?? []).every(
        (item) => (item.criteria ?? []).length > 0 || item.key === "no_manual_tone"
      )
    );
    check(
      "§34 机械闸门写进合同：新版本的引用清单必须是源版本的子集，一条都不许丢",
      String(button?.fact_rule ?? "").includes("子集") &&
        String(button?.fact_rule ?? "").includes("不增加新事实"),
      button?.fact_rule
    );
    check(
      "合同规则写明「最多自动增强 3 次」且「所有版本必须保留」（§34 / §62-15）",
      (contract?.rules ?? []).some((rule) => rule.includes("最多自动增强 3 次")) &&
        (contract?.rules ?? []).some((rule) => rule.includes("所有版本必须保留"))
    );
    check(
      "本阶段仍是纯规则引擎：engine.strategy = RULE_BASED 且 ai_wired = false（强化也不调 AI）",
      engine?.strategy === "RULE_BASED" && engine?.ai_wired === false,
      { strategy: engine?.strategy, ai: engine?.ai_wired }
    );
    check(
      "engine.note 写明「再狠一点」已接线、不调用 AI、不新增任何事实",
      String(engine?.note ?? "").includes("再狠一点") &&
        String(engine?.note ?? "").includes("不新增任何事实"),
      engine?.note
    );
    check(
      "下游只登记不实现：Phase 14 交付后不再登记，下游交接为空",
      JSON.stringify(downstream.map((item) => item.phase)) === JSON.stringify([]) &&
        downstream.every((item) => item.status === "PENDING")
    );

    const labelsResponse = await request("GET", "/api/sales-copy/labels", { token });
    check("强成交话术标签返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check(
      "标签下发四档按钮文案（普通 / 强势 / 爆款 / 王者）与限额口径",
      INTENSIFY_LEVELS.every((level) => labels?.intensify_button_labels?.[level] === INTENSIFY_LABELS[level]) &&
        Object.entries(ENGINE_LIMITS).every(([key, value]) => labels?.limits?.[key] === value),
      labels?.intensify_button_labels
    );
    check(
      "标签里的无锚点标准句与合同同源（强化后同样逐字保留）",
      labels?.no_anchor_standard_sentence === NO_ANCHOR_SENTENCE
    );

    console.log("\n[3] 四档逐级强化：Level 1 → 2 → 3 → 4，每一档都落成新版本");
    const ladderProductId = await createProduct("事实齐备产品·逐级强化", FULL_PRODUCT);
    const ladderV1 = await generate(ladderProductId, { intensity: 1, notes: "冒烟：强化起点" });
    check("生成 Level 1 起点版本返回 201", ladderV1.status === 201, ladderV1.status);
    check(
      "起点版本：v1 / Level 1 / 增强轮次 0",
      ladderV1.payload?.version === 1 &&
        ladderV1.payload?.intensity === 1 &&
        ladderV1.payload?.intensify_rounds === 0,
      {
        version: ladderV1.payload?.version,
        intensity: ladderV1.payload?.intensity,
        rounds: ladderV1.payload?.intensify_rounds
      }
    );

    const r1 = await intensify(ladderProductId, { level: "NORMAL" });
    check("点「普通」返回 201（强化 = 新增版本，不是就地改写）", r1.status === 201, r1.status);
    const r1Body = r1.payload;
    check(
      "强化结论：source_intensity 1 → intensity 2，round 1 / 3，spec_ref = §7 / §34 / §48",
      r1Body?.source_intensity === 1 &&
        r1Body?.intensity === 2 &&
        r1Body?.round === 1 &&
        r1Body?.max_auto_rounds === MAX_AUTO_ROUNDS &&
        r1Body?.spec_ref === "§7 / §34 / §48",
      {
        source: r1Body?.source_intensity,
        intensity: r1Body?.intensity,
        round: r1Body?.round,
        spec: r1Body?.spec_ref
      }
    );
    check(
      "强化结论里的「源版本」是那份 Level 1 的 v1（版本号 / 强度 / 分数 / 分档逐条对齐）",
      r1Body?.previous?.version === 1 &&
        r1Body?.previous?.intensity === 1 &&
        r1Body?.previous?.impact_score === ladderV1.payload?.impact_score?.total &&
        r1Body?.previous?.band === ladderV1.payload?.impact_score?.band,
      r1Body?.previous
    );
    check(
      "新版本 v2：强度 2、增强轮次 1，且与结论里的 intensity / round 同源",
      r1Body?.record?.version === 2 &&
        r1Body?.record?.intensity === r1Body?.intensity &&
        r1Body?.record?.intensify_rounds === r1Body?.round,
      { version: r1Body?.record?.version, rounds: r1Body?.record?.intensify_rounds }
    );
    check(
      "§34 不增加新事实：added_facts 为空数组",
      Array.isArray(r1Body?.added_facts) && r1Body.added_facts.length === 0,
      r1Body?.added_facts
    );
    check(
      "强化后的引用清单是源版本的子集（既没多出来、也没丢）",
      addedRefs(ladderV1.payload?.fact_refs, r1Body?.record?.fact_refs).length === 0 &&
        addedRefs(r1Body?.record?.fact_refs, ladderV1.payload?.fact_refs).length === 0 &&
        addedRefs(ladderV1.payload?.value_dna_refs, r1Body?.record?.value_dna_refs).length === 0 &&
        addedRefs(r1Body?.record?.value_dna_refs, ladderV1.payload?.value_dna_refs).length === 0
    );
    check(
      "强化不改口径：生成时的模式 / 偏好 / 锚点结论与源版本一致（§17 / §62-10）",
      r1Body?.record?.mode_at_generation === ladderV1.payload?.mode_at_generation &&
        r1Body?.record?.preference === ladderV1.payload?.preference &&
        r1Body?.record?.anchor?.has_reliable_price_anchor ===
          ladderV1.payload?.anchor?.has_reliable_price_anchor
    );
    check(
      "§48 自检：八项逐条给出结论与判定依据，分数与 §23 评分同源",
      (r1Body?.self_check?.items ?? []).length === SELF_CHECK_KEYS.length &&
        JSON.stringify((r1Body?.self_check?.items ?? []).map((item) => item.key)) ===
          JSON.stringify(SELF_CHECK_KEYS) &&
        r1Body?.self_check?.score === r1Body?.record?.impact_score?.total &&
        r1Body?.self_check?.passed ===
          ((r1Body?.self_check?.missing ?? []).length === 0 && r1Body?.self_check?.score_passed === true)
    );
    check(
      "Level 2 不设硬性分数线：required_score = null，但八项自检照常逐条记账（§48）",
      r1Body?.self_check?.required_score === null &&
        r1Body?.self_check?.score_passed === true
    );
    check(
      "强化确实动了正文（changed_elements 非空，便于人工抽查改了哪一格）",
      (r1Body?.changed_elements ?? []).length > 0,
      r1Body?.changed_elements
    );

    const r2 = await intensify(ladderProductId, { level: "STRONG" });
    check(
      "点「强势」：v2（Level 2）→ v3（Level 3），round 2 / 3",
      r2.status === 201 &&
        r2.payload?.source_intensity === 2 &&
        r2.payload?.intensity === 3 &&
        r2.payload?.round === 2 &&
        r2.payload?.record?.version === 3 &&
        r2.payload?.record?.intensify_rounds === 2,
      { status: r2.status, round: r2.payload?.round, intensity: r2.payload?.intensity }
    );
    check(
      "第二次强化同样不增加事实：added_facts 为空，引用清单仍是源版本子集",
      (r2.payload?.added_facts ?? [null]).length === 0 &&
        addedRefs(r1Body?.record?.fact_refs, r2.payload?.record?.fact_refs).length === 0
    );

    const r3 = await intensify(ladderProductId, { level: "VIRAL" });
    check(
      "点「爆款」：v3（Level 3）→ v4（Level 4），round 3 / 3，并带出 Level 4 的 85 分门槛",
      r3.status === 201 &&
        r3.payload?.intensity === 4 &&
        r3.payload?.round === 3 &&
        r3.payload?.record?.version === 4 &&
        r3.payload?.self_check?.required_score === MIN_SCORE[4],
      {
        status: r3.status,
        intensity: r3.payload?.intensity,
        round: r3.payload?.round,
        required: r3.payload?.self_check?.required_score
      }
    );
    check(
      "Level 4 强化后 §48 自检结论与分数阈值同源（score_passed 与 required_score 一致）",
      r3.payload?.self_check?.score_passed ===
        (r3.payload?.self_check?.score ?? 0) >= MIN_SCORE[4] &&
        r3.payload?.self_check?.passed ===
          ((r3.payload?.self_check?.missing ?? []).length === 0 &&
            r3.payload?.self_check?.score_passed === true)
    );
    check(
      "§48 前 3 轮的动作逐格可查：第 3 轮确实还可以继续改写（changed_elements 非空）",
      (r3.payload?.changed_elements ?? []).length > 0,
      r3.payload?.changed_elements
    );

    console.log("\n[4] 闸门一：最多自动强化 3 轮（第 4 次必须人工处理）");
    const fourth = await intensify(ladderProductId, { level: "KING" });
    check("第 4 次强化返回 400（不是静默生成一份「再狠一点」）", fourth.status === 400, fourth.status);
    check(
      "400 的 details 写清轮次上限与源版本状态（level / source_intensity / source_intensify_rounds / total_versions / max_auto_rounds）",
      fourth.payload?.error?.details?.max_auto_rounds === MAX_AUTO_ROUNDS &&
        fourth.payload?.error?.details?.source_intensify_rounds === MAX_AUTO_ROUNDS &&
        fourth.payload?.error?.details?.source_intensity === 4 &&
        fourth.payload?.error?.details?.level === "KING" &&
        typeof fourth.payload?.error?.details?.total_versions === "number",
      fourth.payload?.error?.details
    );
    check(
      "被拒绝的强化不产生任何新版本（版本数仍是 4）",
      ((await versionsOf(ladderProductId)).payload?.items ?? []).length === 4
    );

    console.log("\n[5] 闸门二：只升不降（同一档 / 更低档一律 400）");
    // 单独的起点产品：否则上一段的轮次上限会先命中，压不到真正的「方向」闸门。
    const flatProductId = await createProduct("事实齐备产品·只升不降", FULL_PRODUCT);
    const flatV1 = await generate(flatProductId, { intensity: 5, notes: "冒烟：只升不降起点" });
    check(
      "生成 Level 5 起点版本返回 201（起点越狠，越能压「只升不降」）",
      flatV1.status === 201 && flatV1.payload?.intensity === 5,
      { status: flatV1.status, intensity: flatV1.payload?.intensity }
    );
    const kingOnLevel5 = await intensify(flatProductId, { level: "KING" });
    check(
      "已经 Level 5 时再点「王者」返回 400（同一档不算强化）",
      kingOnLevel5.status === 400,
      kingOnLevel5.status
    );
    const strongOnLevel5 = await intensify(flatProductId, { level: "STRONG" });
    check(
      "点「强势」（Level 3）方向朝下同样 400，「写弱一点」不是一个动作（§7 / §34）",
      strongOnLevel5.status === 400 && strongOnLevel5.payload?.error?.details?.source_intensity === 5,
      { status: strongOnLevel5.status, details: strongOnLevel5.payload?.error?.details }
    );
    check(
      "降档 400 的报错里写明「这一版已经是 Level N」（人工一眼看懂为什么被拒）",
      String(strongOnLevel5.payload?.error?.message ?? "").includes("Level 5"),
      strongOnLevel5.payload?.error?.message
    );

    console.log("\n[6] Level 5 王者强化：Level 2 → 4 → 5，七项强制与 §48 自检必须过");
    const kingProductId = await createProduct("事实齐备产品·王者强化", FULL_PRODUCT);
    const kingV1 = await generate(kingProductId, { intensity: 2, notes: "冒烟：王者强化起点" });
    check("生成 Level 2 起点版本返回 201", kingV1.status === 201, kingV1.status);
    const kingR1 = await intensify(kingProductId, { level: "VIRAL" });
    check(
      "第一轮：Level 2 → Level 4（round 1），required_score = 85",
      kingR1.status === 201 &&
        kingR1.payload?.intensity === 4 &&
        kingR1.payload?.round === 1 &&
        kingR1.payload?.self_check?.required_score === MIN_SCORE[4],
      { status: kingR1.status, intensity: kingR1.payload?.intensity }
    );
    const kingR2Response = await intensify(kingProductId, { level: "KING" });
    check(
      "第二轮：Level 4 → Level 5（round 2），required_score = 90",
      kingR2Response.status === 201,
      { status: kingR2Response.status, error: kingR2Response.payload?.error?.message }
    );
    const kingR2 = kingR2Response.payload;
    check(
      "王者强化结论：intensity 5 / round 2 / self_check.required_score = 90",
      kingR2?.intensity === 5 &&
        kingR2?.round === 2 &&
        kingR2?.self_check?.required_score === MIN_SCORE[5],
      { intensity: kingR2?.intensity, round: kingR2?.round }
    );
    const kingRecord = kingR2?.record;
    check(
      "§22 Level 5 七项强制全部落地（required / satisfied / missing 为空）",
      kingRecord?.level5?.required === true &&
        kingRecord?.level5?.satisfied === true &&
        JSON.stringify(kingRecord?.level5?.missing ?? []) === JSON.stringify([]) &&
        JSON.stringify((kingRecord?.level5?.requirements ?? []).map((item) => item.key)) ===
          JSON.stringify(LEVEL5_KEYS),
      { required: kingRecord?.level5?.required, missing: kingRecord?.level5?.missing }
    );
    check(
      "§48 八项自检全部通过，且分数 ≥ 90（Level 5 门槛）",
      kingR2?.self_check?.passed === true &&
        kingR2?.self_check?.missing.length === 0 &&
        kingR2?.self_check?.score >= MIN_SCORE[5] &&
        (kingR2?.self_check?.items ?? []).every((item) => item.passed === true),
      { score: kingR2?.self_check?.score, missing: kingR2?.self_check?.missing }
    );
    check(
      "§26 九种输出齐备 / §57 验收通过 / §24 合规 GREEN",
      JSON.stringify((kingRecord?.output_statuses ?? []).map((item) => item.key)) ===
        JSON.stringify(OUTPUT_KEYS) &&
        (kingRecord?.output_statuses ?? []).every((item) => item.status === "DONE") &&
        kingRecord?.acceptance?.passed === true &&
        kingRecord?.compliance?.risk === "GREEN",
      { acceptance: kingRecord?.acceptance?.passed, risk: kingRecord?.compliance?.risk }
    );
    check(
      "§58-10 可独立传播金句 ≥ 3 句（强化后金句密度不能被写丢）",
      quotableLines([
        ...(kingRecord?.quotes?.core_quotes ?? []),
        ...(kingRecord?.quotes?.backup_quotes ?? [])
      ]).length >= ENGINE_LIMITS.minLevel5QuotableLines
    );
    check(
      "§22 无锚点时价格高度叙事仍逐字是标准句（强化不会把标准句换成编出来的价格故事）",
      kingRecord?.anchor?.has_reliable_price_anchor === false &&
        kingRecord?.headline?.price_or_standard_story === NO_ANCHOR_SENTENCE,
      kingRecord?.headline?.price_or_standard_story
    );
    check(
      "王者强化同样一条事实都没新增（added_facts 为空 + 引用清单是子集）",
      (kingR2?.added_facts ?? [null]).length === 0 &&
        addedRefs(kingR1.payload?.record?.fact_refs, kingRecord?.fact_refs).length === 0 &&
        addedRefs(kingR1.payload?.record?.value_dna_refs, kingRecord?.value_dna_refs).length === 0
    );
    const kingCitationProblems = await citationProblems(kingRecord, client);
    check(
      "逐字回查通过：强化后的王者稿引用清单每一条都能在产品事实里取到，且原样出现在正文里",
      kingCitationProblems.length === 0,
      kingCitationProblems
    );
    check(
      "强化后的正文不再与源版本逐字相同（Level 2 → Level 5 必须真的更狠）",
      JSON.stringify(recordTexts(kingRecord)) !==
        JSON.stringify(recordTexts(kingR1.payload?.record))
    );
    check(
      "王者强化不改写上游口径：价值重点与生成时模式沿用源版本",
      JSON.stringify(kingRecord?.value_focus) === JSON.stringify(kingR1.payload?.record?.value_focus) &&
        kingRecord?.mode_at_generation === kingR1.payload?.record?.mode_at_generation
    );

    console.log("\n[7] §62-15 版本治理：源版本原封不动保留，强化只增不改");
    const kingVersions = (await versionsOf(kingProductId)).payload?.items ?? [];
    check(
      "强化产生 3 条版本：v1（生成）/ v2（第 1 轮）/ v3（第 2 轮）",
      kingVersions.length === 3 &&
        JSON.stringify(kingVersions.map((item) => item.version)) === JSON.stringify([3, 2, 1]),
      kingVersions.map((item) => [item.version, item.intensity, item.intensify_rounds])
    );
    check(
      "版本列表逐条带回增强轮次（0 / 1 / 2），前端不会把强化版本显示成生成稿",
      JSON.stringify(kingVersions.map((item) => item.intensify_rounds)) === JSON.stringify([2, 1, 0]),
      kingVersions.map((item) => item.intensify_rounds)
    );
    const kingV1After = await recordOf(kingProductId, kingV1.payload?.id);
    check(
      "源版本 v1 重新调阅后逐字未变（强度 / 轮次 / 分数 / 正文都与生成时一致）",
      kingV1After.status === 200 &&
        kingV1After.payload?.intensity === 2 &&
        kingV1After.payload?.intensify_rounds === 0 &&
        kingV1After.payload?.impact_score?.total === kingV1.payload?.impact_score?.total &&
        kingV1After.payload?.headline?.opening_hook === kingV1.payload?.headline?.opening_hook
    );
    const kingV2After = await recordOf(kingProductId, kingR1.payload?.record?.id);
    check(
      "中间版本 v2 也逐字保留（第 1 轮的 Level 4 稿仍可对照）",
      kingV2After.status === 200 &&
        kingV2After.payload?.intensity === 4 &&
        kingV2After.payload?.intensify_rounds === 1
    );
    check(
      "产品总览的最新一版就是强化产出的 v3（不用翻版本列表也知道当前用哪一版）",
      (await overviewOf(kingProductId)).payload?.record?.version === 3
    );

    console.log("\n[8] 指定历史版本强化：源版本由 record_id 决定，新版本号仍取最大 + 1");
    const fromV1 = await intensify(kingProductId, {
      level: "KING",
      record_id: kingV1.payload?.id,
      notes: "冒烟：拿 Level 2 起点直接冲王者"
    });
    check("指定 v1 强化返回 201", fromV1.status === 201, fromV1.status);
    check(
      "源版本 = v1（Level 2 / 轮次 0），新版本 = v4（版本号取最大 + 1，不覆盖任何历史版本）",
      fromV1.payload?.previous?.version === 1 &&
        fromV1.payload?.previous?.intensity === 2 &&
        fromV1.payload?.round === 1 &&
        fromV1.payload?.record?.version === 4 &&
        fromV1.payload?.record?.intensify_rounds === 1,
      {
        previous: fromV1.payload?.previous,
        version: fromV1.payload?.record?.version,
        rounds: fromV1.payload?.record?.intensify_rounds
      }
    );
    check(
      "人工备注覆盖自动备注（运营可以记一句「为什么这一版要这样强化」）",
      fromV1.payload?.record?.notes === "冒烟：拿 Level 2 起点直接冲王者",
      fromV1.payload?.record?.notes
    );
    check(
      "不传备注时自动写清「第几轮 / 由哪一版强化到哪一档 / 改了几处 / 有没有新增事实」",
      String(kingR1.payload?.record?.notes ?? "").includes("第 1 轮") &&
        String(kingR1.payload?.record?.notes ?? "").includes("未新增任何事实"),
      kingR1.payload?.record?.notes
    );
    const autoNote = String(kingR2?.record?.notes ?? "");
    check(
      "自动备注里写明 §48 自检结论（通过 / 未达标都能回溯）",
      autoNote.includes("§48") && autoNote.includes("第 2 轮"),
      autoNote
    );

    console.log("\n[9] 事实稀疏产品：能强化，但强化不会凭空补事实");
    const thinProductId = await createProduct("极简产品（几乎没有事实）", THIN_PRODUCT);
    const thinV1 = await generate(thinProductId, { intensity: 2 });
    const thinR1 = await intensify(thinProductId, { level: "VIRAL" });
    check("极简产品强化返回 201（缺事实不是不能强化，而是不许补事实）", thinR1.status === 201, thinR1.status);
    check(
      "极简产品强化后 added_facts 仍为空数组，引用清单是源版本子集",
      (thinR1.payload?.added_facts ?? [null]).length === 0 &&
        addedRefs(thinV1.payload?.fact_refs, thinR1.payload?.record?.fact_refs).length === 0
    );
    check(
      "极简产品强化后价格高度叙事仍是 §22 标准句（缺锚点不许编价格故事）",
      thinR1.payload?.record?.headline?.price_or_standard_story === NO_ANCHOR_SENTENCE
    );
    check(
      "极简产品强化到「爆款」不会顺手谎报王者：Level 5 未被触发（required = false），七项仍逐项记账",
      thinR1.payload?.record?.level5?.required === false &&
        (thinR1.payload?.record?.level5?.requirements ?? []).length === LEVEL5_KEYS.length,
      {
        required: thinR1.payload?.record?.level5?.required,
        requirements: (thinR1.payload?.record?.level5?.requirements ?? []).length
      }
    );
    check(
      "极简产品的 §48 自检不造假：通过与否、缺项、分数三者互相推导（缺项 = 未通过的项）",
      thinR1.payload?.self_check?.score === thinR1.payload?.record?.impact_score?.total &&
        thinR1.payload?.self_check?.passed ===
          (thinR1.payload?.self_check?.score_passed === true &&
            (thinR1.payload?.self_check?.missing ?? []).length === 0) &&
        JSON.stringify(thinR1.payload?.self_check?.missing ?? []) ===
          JSON.stringify(
            (thinR1.payload?.self_check?.items ?? [])
              .filter((item) => item.passed !== true)
              .map((item) => item.key)
          ),
      {
        score: thinR1.payload?.self_check?.score,
        total: thinR1.payload?.record?.impact_score?.total,
        passed: thinR1.payload?.self_check?.passed,
        missing: thinR1.payload?.self_check?.missing
      }
    );

    console.log("\n[10] 边界：strict 校验 / 非法参数 / 404 / 权限");
    check(
      "按钮档位传未知值返回 400（不给「MAX」这类档位开后门）",
      (await intensify(thinProductId, { level: "MAX" })).status === 400
    );
    check(
      "不传 level 返回 400（强化必须明确点哪一档）",
      (await intensify(thinProductId, {})).status === 400
    );
    check(
      "强化时传多余字段返回 400（强化器不接受任何事实输入，§34）",
      (await intensify(thinProductId, { level: "VIRAL", facts: ["树龄 300 年"] })).status === 400
    );
    check(
      "record_id 不是 UUID 返回 400",
      (await intensify(thinProductId, { level: "VIRAL", record_id: notAUuid })).status === 400
    );
    check(
      "备注超过 2000 字返回 400",
      (await intensify(thinProductId, { level: "VIRAL", notes: "长".repeat(2001) })).status === 400
    );
    check(
      "给不存在的产品强化返回 404",
      (await intensify(missingId, { level: "VIRAL" })).status === 404
    );
    check(
      "产品 id 不是 UUID 时按「没找到这个资源」处理（404，不是 500）",
      (await intensify(notAUuid, { level: "VIRAL" })).status === 404
    );
    check(
      "指定的版本不存在返回 404（不会退化成「那就强化最新版吧」）",
      (await intensify(thinProductId, { level: "VIRAL", record_id: missingId })).status === 404
    );
    check(
      "拿另一个产品的版本 id 强化返回 404（不能跨产品串号）",
      (await intensify(thinProductId, { level: "VIRAL", record_id: kingV1.payload?.id })).status === 404
    );
    const neverProductId = await createProduct("从未生成的产品", THIN_PRODUCT);
    check(
      "从未生成过的产品点「再狠一点」返回 400 且提示先生成一版（§34）",
      (await intensify(neverProductId, { level: "KING" })).status === 400
    );

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
      "只读账号可以读合同 / 标签 / 总览（主播与经销商本来就要看）",
      (await request("GET", "/api/sales-copy/contract", { token: viewerToken })).status === 200 &&
        (await request("GET", "/api/sales-copy/labels", { token: viewerToken })).status === 200 &&
        (await overviewOf(kingProductId, viewerToken)).status === 200
    );
    check(
      "只读账号不能点「再狠一点」（403）",
      (await intensify(kingProductId, { level: "KING" }, viewerToken)).status === 403
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
    const researcherIntensify = await intensify(
      thinProductId,
      { level: "KING" },
      researcherToken
    );
    check(
      "研究员可以点「再狠一点」（201）",
      researcherIntensify.status === 201,
      { status: researcherIntensify.status, error: researcherIntensify.payload?.error?.message }
    );
    check(
      "研究员强化出的版本同样只升不增事实（权限不改变 §34 红线）",
      researcherIntensify.payload?.intensity === 5 &&
        (researcherIntensify.payload?.added_facts ?? [null]).length === 0
    );

    console.log("\n[11] 版本上限：单产品 20 版封顶（§62-15）");
    const capProductId = await createProduct("版本上限产品", THIN_PRODUCT);
    for (let index = 0; index < ENGINE_LIMITS.maxVersionsPerProduct; index += 1) {
      const created = await generate(capProductId, { intensity: 1 });
      if (created.status !== 201) {
        check(`生成第 ${index + 1} 版`, false, created.status);
        break;
      }
    }
    const capVersions = (await versionsOf(capProductId)).payload?.items ?? [];
    check(
      `单产品生成 ${ENGINE_LIMITS.maxVersionsPerProduct} 版后版本数封顶`,
      capVersions.length === ENGINE_LIMITS.maxVersionsPerProduct,
      capVersions.length
    );
    const capIntensify = await intensify(capProductId, { level: "VIRAL" });
    check(
      "达到版本上限后强化返回 400（先归档历史版本再加，不许撑爆版本表）",
      capIntensify.status === 400 &&
        capIntensify.payload?.error?.details?.total_versions ===
          ENGINE_LIMITS.maxVersionsPerProduct,
      { status: capIntensify.status, details: capIntensify.payload?.error?.details }
    );
    check(
      "版本上限被拒后版本数不变（拒绝不留半成品）",
      ((await versionsOf(capProductId)).payload?.items ?? []).length ===
        ENGINE_LIMITS.maxVersionsPerProduct
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
