/**
 * Phase 11 端到端冒烟（规格 §6 配方哲学 / §46 Agent 8 / §6.1 比例红线 / §57 验收 / §62-15 版本与人工确认）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase11.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（配方哲学随产品级联删除）与临时账号，
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员 + 16 行 Value Code 字典），并校验 formula_philosophies = 0。
 *
 * 本阶段压的是四条硬约束：
 *   1) §6.1：没有确切比例时，正文 / 设计目标 / 成交层解释里一个比例字样都不能出现；
 *      已录入事实里自带的「60%」也不许抄进正文 —— 且登记比例里的原料必须逐字可回查，否则直接 400；
 *   2) §46：五个分量只能引用本产品已录入字段与 Value DNA，冒烟逐字回查 citations，并验证跨产品不串号；
 *   3) §6.2 / §57：事实齐备的产品必须能回答「这款茶是怎么设计的」，事实不足的产品留空写缺口（不合格也不硬写）；
 *   4) §62-15：重新生成只新增版本、历史版本全部保留；人工确认只改确认字段，不改正文、不升版本。
 * 因此脚本用「事实齐备产品」与「几乎没有事实的极简产品」两类输入，去压「齐备不等于可以乱讲、不足也不等于可以编」。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase11-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase11-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** §6.3 固定的五个分量与顺序：接口返回必须逐字对齐，不得重排。 */
const COMPONENT_ORDER = ["backbone", "aroma", "sweetness", "body", "finish"];
/** §6.3 / §35.4 的存储字段映射（合同里必须逐条对上）。 */
const COMPONENT_STORAGE = {
  backbone: "backbone_component",
  aroma: "aroma_component",
  sweetness: "sweetness_component",
  body: "body_component",
  finish: "finish_component"
};
const COMPONENT_SHORT = {
  backbone: "骨架",
  aroma: "香气",
  sweetness: "回甘",
  body: "汤感",
  finish: "收口"
};
/** §46 Agent 8 的五项输出（顺序固定）。 */
const AGENT8_OUTPUT_KEYS = [
  "formula_strategy",
  "ingredient_roles",
  "taste_roles",
  "design_goal",
  "sales_explanation"
];
/** §6.1 / §46 的红线布尔：全为 true 才算合同成立。 */
const REDLINE_KEYS = [
  "no_fabricated_ratio",
  "no_new_ingredient",
  "design_logic_without_ratio",
  "gap_stays_empty",
  "evidence_only_from_own_product",
  "rhetoric_allowed_for_roles_only",
  "sales_tone_allowed"
];
const DOWNSTREAM_PHASES = [];
const ENGINE_LIMITS = {
  maxVersionsPerProduct: 20,
  minWrittenComponentsForStrategy: 2,
  maxDnaRefsPerComponent: 3,
  maxRatioEntries: 20,
  defaultPageSize: 20,
  maxPageSize: 100
};
/** 与 `containsRatioExpression()` 同一口径：百分比 / 百分之 / 占比。 */
const RATIO_PATTERN = /(\d+(?:\.\d+)?\s*%)|(百分之\s*[0-9０-９一二三四五六七八九十百])|占比/;

/** 事实齐备的产品：五个分量都能找到已录入事实（与 Phase 10 / API 测试 fixture 同口径）。 */
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

/** 几乎没有事实的产品：只保留身份与规格，用来验证「缺事实 = 分量留空 + 缺口」。 */
const THIN_PRODUCT = {
  product_name: "龙德记试样茶",
  year: 2026,
  tea_type: "普洱生茶",
  weight_g: 357,
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

/** 用于 §6.1 比例登记的产品：原料类字段里逐字写着「布朗山」。 */
const RATIO_PRODUCT = {
  product_name: "龙德记配比试样茶",
  year: 2026,
  tea_type: "普洱生茶",
  origin_city: "西双版纳",
  mountain: "布朗山",
  raw_material: "大树春茶",
  thickness: "厚",
  huigan: "快",
  weight_g: 357,
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

/** 拼配描述里已经写明完整配比（§6.1 已知配方事实）。 */
const BLEND_PRODUCT = {
  product_name: "龙德记拼配试样茶",
  year: 2026,
  tea_type: "普洱生茶",
  origin_city: "西双版纳",
  mountain: "布朗山",
  village: "易武",
  blend_description: "布朗山 60%，易武 40%",
  thickness: "厚",
  huigan: "快",
  weight_g: 357,
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
};

/** 拼配描述里只写了一个比例：不足以构成配比，必须按「未知比例」处理且正文不引用它。 */
const PARTIAL_BLEND_PRODUCT = {
  product_name: "龙德记单点拼配茶",
  year: 2026,
  tea_type: "普洱生茶",
  mountain: "布朗山",
  blend_description: "布朗山 60%",
  thickness: "厚",
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

/** 逐字回查：`citations` 形如 `product.mountain=布朗山`，值必须原样出现在分量正文里。 */
function citationProblems(component) {
  const problems = [];
  const joined = (component.texts ?? []).join("\n");
  for (const citation of component.citations ?? []) {
    const index = citation.indexOf("=");
    if (index <= 0) {
      problems.push(`${component.key}: 引用格式异常 ${citation}`);
      continue;
    }
    const ref = citation.slice(0, index);
    const value = citation.slice(index + 1);
    if (!ref.startsWith("product.") && !ref.startsWith("dna.")) {
      problems.push(`${component.key}: 引用了非本产品字段 ${ref}`);
      continue;
    }
    if (!joined.includes(value)) {
      problems.push(`${component.key}: 引用值不在正文里 ${citation}`);
    }
  }
  return problems;
}

function componentOf(record, key) {
  return (record?.components ?? []).find((component) => component.key === key) ?? null;
}

/** 一版配方哲学里所有会露给前台的正文（分量 + 设计逻辑 + 设计目标 + 成交层解释）。 */
function foregroundTexts(record) {
  return [
    ...(record?.components ?? []).flatMap((component) => component.texts ?? []),
    record?.formula_strategy ?? "",
    record?.design_goal ?? "",
    record?.sales_explanation ?? ""
  ];
}

function ratioHits(record) {
  return foregroundTexts(record).filter((text) => RATIO_PATTERN.test(text));
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  const createdProductIds = [];
  const createdUserEmails = [];
  const missingId = "00000000-0000-4000-8000-000000000000";

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
    request("GET", `/api/products/${productId}/formula-philosophy`, { token: authToken });
  const versionsOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/formula-philosophy/versions`, { token: authToken });
  const recordOf = (productId, recordId, authToken = token) =>
    request("GET", `/api/products/${productId}/formula-philosophy/${recordId}`, { token: authToken });
  const generate = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/formula-philosophy/generate`, {
      token: authToken,
      body
    });
  const patch = (productId, recordId, body, authToken = token) =>
    request("PATCH", `/api/products/${productId}/formula-philosophy/${recordId}`, {
      token: authToken,
      body
    });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    const healthPhase = String(health.payload?.phase ?? "");
    check(
      "健康检查文案已推进到 Phase 12 及之后（配方哲学仍是其中一环）",
      Number(/Phase\s*(\d+)/.exec(healthPhase)?.[1] ?? 0) >= 12 && healthPhase.includes("已交付"),
      healthPhase
    );

    check(
      "未登录不能读配方哲学合同",
      (await request("GET", "/api/formula-philosophy/contract")).status === 401
    );
    check(
      "未登录不能读配方哲学标签",
      (await request("GET", "/api/formula-philosophy/labels")).status === 401
    );
    check("未登录不能读配方哲学库", (await request("GET", "/api/formula-philosophy")).status === 401);
    check(
      "未登录不能读配方哲学总览",
      (await request("GET", `/api/products/${missingId}/formula-philosophy`)).status === 401
    );
    check(
      "未登录不能生成配方哲学",
      (await request("POST", `/api/products/${missingId}/formula-philosophy/generate`, { body: {} }))
        .status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("返回 access_token", typeof token === "string" && token.length > 10);

    console.log("\n[2] §6 / §46 合同自检：五分量顺序 + §46 五项输出 + 红线 + 下游只登记");
    const contractResponse = await request("GET", "/api/formula-philosophy/contract", { token });
    check("配方哲学合同返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const engine = contractResponse.payload?.engine;
    check("合同引用 §6 / §46", contract?.spec_ref === "§6 / §46", contract?.spec_ref);
    check(
      "五个分量齐备且顺序固定（§6.3，不得增删或重排）",
      JSON.stringify((contract?.components ?? []).map((component) => component.key)) ===
        JSON.stringify(COMPONENT_ORDER),
      (contract?.components ?? []).map((component) => component.key)
    );
    check(
      "每个分量都落到 §6.3 / §35.4 的存储字段（前端不会只剩一个代号）",
      (contract?.components ?? []).every(
        (component) => component.storage_field === COMPONENT_STORAGE[component.key]
      ),
      (contract?.components ?? []).map((component) => [component.key, component.storage_field])
    );
    check(
      "每个分量都写明定义 / 最少事实 / §46 输出 / 允许引用的字段（且只允许 product.* 与 dna.*）",
      (contract?.components ?? []).every(
        (component) =>
          typeof component.label === "string" &&
          component.label.length > 0 &&
          typeof component.short_label === "string" &&
          component.short_label.length > 0 &&
          typeof component.definition === "string" &&
          component.definition.length > 0 &&
          typeof component.requirement === "string" &&
          component.requirement.length > 0 &&
          typeof component.agent8_output === "string" &&
          component.agent8_output.length > 0 &&
          (component.evidence_refs ?? []).length > 0 &&
          (component.evidence_refs ?? []).every(
            (ref) => ref.startsWith("product.") || ref.startsWith("dna.")
          )
      )
    );
    check(
      "§46 五项输出齐备且顺序固定（formula_strategy / ingredient_roles / taste_roles / design_goal / sales_explanation）",
      JSON.stringify((contract?.agent8_outputs ?? []).map((item) => item.key)) ===
        JSON.stringify(AGENT8_OUTPUT_KEYS),
      (contract?.agent8_outputs ?? []).map((item) => item.key)
    );
    check(
      "§46 五项输出都写明含义与存储落点（ingredient_roles / taste_roles 由五分量推导，不新增字段口径）",
      (contract?.agent8_outputs ?? []).every(
        (item) =>
          typeof item.meaning === "string" &&
          item.meaning.length > 0 &&
          typeof item.storage === "string" &&
          item.storage.length > 0
      )
    );
    check(
      "§46 的成交层解释单独标成 RHETORIC 层（不得携带新事实）",
      (contract?.agent8_outputs ?? []).find((item) => item.key === "sales_explanation")?.layer ===
        "RHETORIC"
    );
    check(
      "§6.1 / §46 的七条红线布尔全部为 true（不编比例 / 不新增原料 / 无比例也写设计逻辑 / 留空 / 只用本产品证据 / 修辞只说角色 / 允许强成交语气）",
      REDLINE_KEYS.every((key) => contract?.[key] === true),
      REDLINE_KEYS.map((key) => [key, contract?.[key]])
    );
    check(
      "§57 验收口径下发：至少 2 个分量写实 + 没有编比例",
      contract?.acceptance?.min_written_components === 2 &&
        String(contract?.acceptance?.question ?? "").includes("设计逻辑") &&
        String(contract?.acceptance?.question ?? "").includes("不编比例"),
      contract?.acceptance
    );
    const rules = contract?.rules ?? [];
    check("合同八条规则齐备", rules.length === 8, rules.length);
    check(
      "规则写明「五个分量与顺序不得增删重排」与「没有比例时不创造比例、已录入事实里的百分比也不得抄进正文」（§6.1 / §6.3）",
      rules.some((rule) => rule.includes("不得增删或重排")) &&
        rules.some((rule) => rule.includes("绝对不创造比例") && rule.includes("也不得抄进正文")),
      rules
    );
    check(
      "规则写明「没有某个原料绝对不新增原料」与「事实不足留空写缺口」（§46 / §62-7）",
      rules.some((rule) => rule.includes("绝对不新增原料")) &&
        rules.some((rule) => rule.includes("留空") && rule.includes("缺口"))
    );
    check(
      "规则写明「本阶段只交付设计逻辑，不代写成交文案」（§60）",
      rules.some((rule) => rule.includes("Phase 12") && rule.includes("不代写"))
    );
    const downstream = contractResponse.payload?.downstream ?? [];
    check(
      "下游交接已全部交付：Phase 12 / 14 交付后不再登记",
      JSON.stringify(downstream.map((item) => item.phase)) === JSON.stringify(DOWNSTREAM_PHASES),
      downstream.map((item) => item.phase)
    );
    check(
      "下游交接为空（Phase 12 / 14 已交付后不再登记，不得显示为未交付）",
      downstream.length === 0 &&
        downstream.every((item) => item.status === "PENDING" && item.deliverable.length > 0)
    );
    check("引擎信息：五个分量", engine?.component_count === 5, engine?.component_count);
    check(
      "引擎信息：合同与接口同一份限制口径（20 版 / 2 个写实分量 / 3 条 DNA / 20 项比例 / 分页 20-100）",
      JSON.stringify(engine?.limits) === JSON.stringify(ENGINE_LIMITS),
      engine?.limits
    );
    check(
      "引擎信息：§46 五项输出与两条红线同样下发到引擎块",
      JSON.stringify((engine?.agent8_outputs ?? []).map((item) => item.key)) ===
        JSON.stringify(AGENT8_OUTPUT_KEYS) &&
        engine?.no_fabricated_ratio === true &&
        engine?.no_new_ingredient === true &&
        engine?.design_logic_without_ratio === true &&
        engine?.gap_stays_empty === true
    );
    check(
      "引擎信息：合同口径说明写明「没有比例时不编比例、没有原料时不新增原料」（§6 / §46）",
      String(engine?.note ?? "").includes("不编比例") && String(engine?.note ?? "").includes("不新增原料"),
      engine?.note
    );

    console.log("\n[3] 标签口径：分量 / §46 输出 / 验收 / 状态文案全部由后端下发");
    const labelsResponse = await request("GET", "/api/formula-philosophy/labels", { token });
    check("标签接口返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check(
      "标签：五个分量齐备且顺序一致",
      JSON.stringify((labels?.components ?? []).map((component) => component.key)) ===
        JSON.stringify(COMPONENT_ORDER)
    );
    check("标签：§46 五项输出齐备", (labels?.agent8_outputs ?? []).length === 5);
    check("标签：八条规则齐备（前端不另写一套文案）", (labels?.rules ?? []).length === 8);
    check(
      "标签：分量状态把 GAP 写成「事实不足（留空）」而不是「待补充」",
      String(labels?.component_status_labels?.GAP ?? "").includes("留空") &&
        String(labels?.component_status_labels?.WRITTEN ?? "").length > 0,
      labels?.component_status_labels
    );
    check(
      "标签：两种状态都带展示色（ok / danger）",
      typeof labels?.component_status_tones?.WRITTEN === "string" &&
        typeof labels?.component_status_tones?.GAP === "string",
      labels?.component_status_tones
    );
    check(
      "标签：§57 验收问题原样下发",
      String(labels?.acceptance?.question ?? "").includes("§6.1 / §57"),
      labels?.acceptance?.question
    );
    check(
      "标签：限制口径与合同一致",
      JSON.stringify(labels?.limits) === JSON.stringify(ENGINE_LIMITS),
      labels?.limits
    );

    console.log("\n[4] 极简产品：缺事实 → 五分量留空写缺口 + §57 验收不通过");
    const thinProductId = await createProduct("极简产品（只录入身份与规格）", THIN_PRODUCT);
    // 产品创建会自动跑规则引擎生成 Value DNA；这里主动清空，确保走「无 DNA」这条更严格的路径（§11 / §62-7）。
    await client.query("update products set value_dna = '{}'::jsonb where id = $1", [thinProductId]);
    const thinOverview = await overviewOf(thinProductId);
    check("读取极简产品配方哲学总览返回 200", thinOverview.status === 200, thinOverview.status);
    check(
      "尚未生成时 record = null、版本列表为空",
      thinOverview.payload?.record === null && (thinOverview.payload?.versions ?? []).length === 0
    );
    check(
      "尚未生成时缺口清单列出全部五个分量",
      JSON.stringify(thinOverview.payload?.missing_components ?? []) ===
        JSON.stringify(COMPONENT_ORDER),
      thinOverview.payload?.missing_components
    );
    check(
      "尚未生成产品结构时，总览明确给出架构上下文为空（前端据此提示先跑产品结构）",
      thinOverview.payload?.architecture === null
    );
    check("可以生成（未触及 20 版上限）", thinOverview.payload?.can_generate === true);
    check("读不存在的产品配方哲学返回 404", (await overviewOf(missingId)).status === 404);

    const thinGenerated = await generate(thinProductId, {});
    check("生成极简产品配方哲学返回 201", thinGenerated.status === 201, thinGenerated.status);
    const thinRecord = thinGenerated.payload;
    check("新版本号为 1", thinRecord?.version === 1, thinRecord?.version);
    check(
      "五个分量都在（缺口多不等于少给分量）",
      JSON.stringify((thinRecord?.components ?? []).map((component) => component.key)) ===
        JSON.stringify(COMPONENT_ORDER)
    );
    check(
      "没有事实的五个分量一律 GAP 留空（written = 0 / gap = 5）",
      thinRecord?.component_counts?.written === 0 && thinRecord?.component_counts?.gap === 5,
      thinRecord?.component_counts
    );
    check(
      "GAP 分量正文必须是空数组，不得用形容词补圆（§11 / §62-7）",
      (thinRecord?.components ?? [])
        .filter((component) => component.status === "GAP")
        .every((component) => (component.texts ?? []).length === 0)
    );
    check(
      "每个 GAP 分量都要写清缺什么事实（不能只标缺口就完事）",
      (thinRecord?.components ?? [])
        .filter((component) => component.status === "GAP")
        .every(
          (component) =>
            typeof component.gap === "string" &&
            component.gap.length > 0 &&
            (component.citations ?? []).length === 0
        )
    );
    check(
      "缺口指回具体字段（例如骨架要先补山头 / 产区 / 用料）",
      String(componentOf(thinRecord, "backbone")?.gap ?? "").includes("未录入相关事实，先补") &&
        String(componentOf(thinRecord, "backbone")?.gap ?? "").includes("product.mountain"),
      componentOf(thinRecord, "backbone")?.gap
    );
    check(
      "写实分量不足 2 个时，设计逻辑与设计目标一起留空（宁缺毋滥，不编一句像样的废话）",
      thinRecord?.formula_strategy === "" &&
        thinRecord?.design_goal === "" &&
        thinRecord?.sales_explanation === "" &&
        thinRecord?.design_logic_ready === false
    );
    check(
      "§57 验收不通过（写实分量 0 个，不足 2 个）",
      thinRecord?.acceptance?.passed === false &&
        thinRecord?.acceptance?.written_components === 0 &&
        thinRecord?.acceptance?.required_min_components === 2 &&
        thinRecord?.acceptance?.coverage_passed === false,
      thinRecord?.acceptance
    );
    check(
      "没有确认比例时 no_fabricated_ratio = true（没编出比例，只是没料可写）",
      thinRecord?.acceptance?.no_fabricated_ratio === true
    );
    check(
      "缺口清单写明「写实的分量只有 0 个，不足 2 个」（§6.2 / §57）",
      (thinRecord?.evidence_gaps ?? []).some(
        (gap) => gap.includes("不足 2 个") && gap.includes("这款茶是怎么设计的")
      ),
      thinRecord?.evidence_gaps
    );
    check(
      "缺口清单写明「未确认配方比例」（§6.1）",
      (thinRecord?.evidence_gaps ?? []).some((gap) => gap.includes("未确认配方比例"))
    );
    check(
      "缺口清单写明尚未生成产品结构与价值 DNA（跨阶段上下文缺口可见）",
      (thinRecord?.evidence_gaps ?? []).some((gap) => gap.includes("尚未生成产品结构")) &&
        (thinRecord?.evidence_gaps ?? []).some((gap) => gap.includes("尚未生成价值 DNA"))
    );
    check(
      "GAP 分量的 evidence_refs / fact_refs 不产生证据（没有事实就没有引用）",
      (thinRecord?.components ?? []).every((component) => (component.evidence_refs ?? []).length === 0) &&
        (thinRecord?.fact_refs ?? []).length === 0 &&
        (thinRecord?.value_dna_refs ?? []).length === 0
    );
    check(
      "单版同样登记下游交接（事实审核全部 PENDING）",
      JSON.stringify((thinRecord?.downstream ?? []).map((item) => item.phase)) ===
        JSON.stringify(DOWNSTREAM_PHASES) &&
        (thinRecord?.downstream ?? []).every((item) => item.status === "PENDING")
    );
    check(
      "刚生成的记录默认未人工确认（确认是人的动作）",
      thinRecord?.is_confirmed === false &&
        thinRecord?.confirmed_by === null &&
        thinRecord?.confirmed_at === null
    );
    check(
      "没有比例时 ratio 口径干净：ratio_data = null、来源与证据都为空（§6.1）",
      thinRecord?.ratio?.known_ratio === false &&
        thinRecord?.ratio?.ratio_data === null &&
        thinRecord?.ratio?.ratio_source === null &&
        (thinRecord?.ratio?.ratio_evidence ?? []).length === 0,
      thinRecord?.ratio
    );

    console.log("\n[5] 事实齐备产品：五分量写实 + §57 验收通过 + 正文零比例字样");
    const fullProductId = await createProduct("事实齐备产品（六星孔雀口径）", FULL_PRODUCT);
    // 先跑 Phase 10 产品结构：配方哲学把它当上下文引用，缺口清单不该再出现「尚未生成产品结构」。
    const architecture = await request("POST", `/api/products/${fullProductId}/architecture/generate`, {
      token,
      body: {}
    });
    check("先跑产品结构返回 201（配方哲学的上下文）", architecture.status === 201, architecture.status);
    const fullGenerated = await generate(fullProductId, { notes: "冒烟：事实齐备版本" });
    check("生成事实齐备产品配方哲学返回 201", fullGenerated.status === 201, fullGenerated.status);
    const fullRecord = fullGenerated.payload;
    check("新版本号为 1", fullRecord?.version === 1, fullRecord?.version);
    check(
      "五个分量全部写实（written = 5 / gap = 0）",
      fullRecord?.component_counts?.written === 5 && fullRecord?.component_counts?.gap === 0,
      fullRecord?.component_counts
    );
    check(
      "每个写实分量都带正文与缺口为 null（WRITTEN 与 GAP 互斥）",
      (fullRecord?.components ?? []).every(
        (component) =>
          component.status === "WRITTEN" &&
          (component.texts ?? []).length > 0 &&
          component.gap === null &&
          component.layer === "INTERPRETATION"
      )
    );
    check(
      "§57 验收通过（设计逻辑成稿 + 一个比例字样都没有）",
      fullRecord?.acceptance?.passed === true &&
        fullRecord?.acceptance?.design_logic_ready === true &&
        fullRecord?.acceptance?.no_fabricated_ratio === true &&
        fullRecord?.acceptance?.coverage_passed === true,
      fullRecord?.acceptance
    );
    check(
      "设计逻辑（formula_strategy）写出「不是把料混起来，而是让每一类原料承担自己的任务」（§6.2 / §46）",
      String(fullRecord?.formula_strategy ?? "").includes("让每一类原料承担自己的任务") &&
        String(fullRecord?.formula_strategy ?? "").includes("不是靠堆原料"),
      fullRecord?.formula_strategy
    );
    check(
      "设计目标写清次序「先定骨架、再定香气、再定回甘」（§6.2）",
      String(fullRecord?.design_goal ?? "").includes("先定骨架、再定香气、再定回甘") &&
        String(fullRecord?.design_goal ?? "").includes("骨架 → 香气 → 回甘 → 汤感 → 收口"),
      fullRecord?.design_goal
    );
    check(
      "成交层解释是 RHETORIC 口径（价值不在原料表，而在设计逻辑），且不携带新事实（§24 / §46）",
      String(fullRecord?.sales_explanation ?? "").includes("价值不在原料表") &&
        String(fullRecord?.sales_explanation ?? "").includes("设计逻辑"),
      fullRecord?.sales_explanation
    );
    check(
      "§46 ingredient_roles / taste_roles 每条都带 evidence_ref（可点回本产品字段）",
      (fullRecord?.ingredient_roles ?? []).length > 0 &&
        (fullRecord?.ingredient_roles ?? []).every(
          (role) => role.evidence_ref.startsWith("product.") || role.evidence_ref.startsWith("dna.")
        ) &&
        (fullRecord?.taste_roles ?? []).every(
          (role) => role.evidence_ref.startsWith("product.") || role.evidence_ref.startsWith("dna.")
        )
    );
    check(
      "§6.1：没有确认比例时，正文 / 设计目标 / 成交层解释里一个比例字样都没有",
      ratioHits(fullRecord).length === 0,
      ratioHits(fullRecord)
    );
    check(
      "正文里逐字写着已录入事实（骨架指向布朗山、香气指向烟香明显）",
      String(componentOf(fullRecord, "backbone")?.texts?.[0] ?? "").includes("布朗山") &&
        (componentOf(fullRecord, "aroma")?.texts ?? []).some((text) => text.includes("烟香明显")),
      componentOf(fullRecord, "aroma")?.texts
    );
    check(
      "单版事实引用全部是 product.*（DNA 引用另计，不混进 fact_refs）",
      (fullRecord?.fact_refs ?? []).every((ref) => ref.startsWith("product.")) &&
        (fullRecord?.value_dna_refs ?? []).every((ref) => ref.startsWith("dna."))
    );
    check(
      "生成时传入的备注被保存（§62-15 备注与版本同存）",
      fullRecord?.notes === "冒烟：事实齐备版本",
      fullRecord?.notes
    );
    check(
      "引用产品结构上下文：架构版本号与验收结论随配方哲学一起回读（§5 / §45 只作上下文）",
      fullRecord?.architecture_version === 1 && fullRecord?.architecture_acceptance_passed === true,
      [fullRecord?.architecture_version, fullRecord?.architecture_acceptance_passed]
    );
    check(
      "有产品结构与 Value DNA 时，缺口清单里不再出现这两条上下文缺口",
      !(fullRecord?.evidence_gaps ?? []).some((gap) => gap.includes("尚未生成产品结构")) &&
        !(fullRecord?.evidence_gaps ?? []).some((gap) => gap.includes("尚未生成价值 DNA")),
      fullRecord?.evidence_gaps
    );
    check(
      "缺口清单只剩「未确认配方比例」这一条（有比例就消失，不硬凑缺口）",
      (fullRecord?.evidence_gaps ?? []).length === 1 &&
        String(fullRecord?.evidence_gaps?.[0] ?? "").includes("未确认配方比例"),
      fullRecord?.evidence_gaps
    );
    const snapshot = await client.query(
      "select formula_philosophy->>'formula_strategy' as strategy from products where id = $1",
      [fullProductId]
    );
    check(
      "最新一版同时写回 products.formula_philosophy 快照（§35.4，权威来源仍是版本表）",
      snapshot.rows[0]?.strategy === fullRecord?.formula_strategy,
      snapshot.rows[0]?.strategy
    );

    console.log("\n[6] §46 / §62-5：五分量只引用本产品已录入事实，跨产品不串号");
    const writtenComponents = (fullRecord?.components ?? []).filter(
      (component) => component.status === "WRITTEN"
    );
    check(
      "每个写实分量都带 citations（可逐条回查到字段来源）",
      writtenComponents.length === 5 &&
        writtenComponents.every((component) => (component.citations ?? []).length > 0),
      writtenComponents.map((component) => [component.key, (component.citations ?? []).length])
    );
    check(
      "citations 的字段只可能是 product.* / dna.*，且引用值逐字出现在正文里（§46 不允许新增原料或配方事实）",
      writtenComponents.every((component) => citationProblems(component).length === 0),
      writtenComponents.flatMap((component) => citationProblems(component))
    );
    check(
      "证据字段不重复（同一分量不会把同一个字段算两遍）",
      writtenComponents.every(
        (component) =>
          (component.evidence_refs ?? []).length === new Set(component.evidence_refs ?? []).size
      )
    );
    check(
      "分量的 evidence_refs 与 citations 同源（没有「引用了但正文里没有」的字段）",
      writtenComponents.every((component) => {
        const fromCitations = new Set(
          (component.citations ?? []).map((item) => item.slice(0, item.indexOf("=")))
        );
        return (component.evidence_refs ?? []).every((ref) => fromCitations.has(ref));
      })
    );
    check(
      "同一分量最多引用 3 条 Value DNA（避免单分量被 DNA 刷满）",
      writtenComponents.every(
        (component) =>
          new Set((component.citations ?? []).filter((item) => item.startsWith("dna."))).size <=
          ENGINE_LIMITS.maxDnaRefsPerComponent
      )
    );
    check(
      "跨产品不串号：极简产品的配方哲学与证据里不出现另一款产品的事实",
      (() => {
        const dump = JSON.stringify(thinRecord);
        return !dump.includes("布朗山") && !dump.includes("大树春茶") && !dump.includes("烟香明显");
      })()
    );
    check(
      "空产品不会因为另一款产品写实就跟着「变齐」（两个产品各算各的）",
      (thinRecord?.component_counts?.written ?? -1) === 0 &&
        (fullRecord?.component_counts?.written ?? -1) === 5
    );

    console.log("\n[7] §6.1 比例红线：未录入的原料不认，已写明的配比要带逐字证据");
    const ratioProductId = await createProduct("比例登记产品（原料字段写着布朗山）", RATIO_PRODUCT);
    const unknownIngredient = await generate(ratioProductId, {
      ratio_data: { 冰岛: "50%" }
    });
    check(
      "登记的配比里出现未录入原料时直接 400（不得新增原料，§6.1 / §46）",
      unknownIngredient.status === 400,
      unknownIngredient.status
    );
    check(
      "400 的错误明细写明「逐字查不到」（研究员知道该补哪个字段）",
      JSON.stringify(unknownIngredient.payload ?? {}).includes("逐字查不到"),
      unknownIngredient.payload
    );
    const requestedRatio = await generate(ratioProductId, {
      notes: "冒烟：人工登记比例",
      ratio_data: { 布朗山: "60%" }
    });
    check("登记可逐字回查的比例返回 201", requestedRatio.status === 201, requestedRatio.status);
    const ratioRecord = requestedRatio.payload;
    check(
      "known_ratio = true 且来源标为产品负责人登记（REQUEST）",
      ratioRecord?.ratio?.known_ratio === true && ratioRecord?.ratio?.ratio_source === "REQUEST",
      ratioRecord?.ratio
    );
    check(
      "比例数据被规范成百分比（60 → 60%）",
      JSON.stringify(ratioRecord?.ratio?.ratio_data) === JSON.stringify({ 布朗山: "60%" }),
      ratioRecord?.ratio?.ratio_data
    );
    check(
      "比例证据逐字指向已录入字段（product.mountain=布朗山）",
      (ratioRecord?.ratio?.ratio_evidence ?? []).includes("product.mountain=布朗山"),
      ratioRecord?.ratio?.ratio_evidence
    );
    check(
      "确认比例后设计逻辑里写明配比与来源（§6.1：已知比例可以使用）",
      String(ratioRecord?.formula_strategy ?? "").includes("已确认的配方比例是 布朗山 60%") &&
        String(ratioRecord?.formula_strategy ?? "").includes("产品负责人登记"),
      ratioRecord?.formula_strategy
    );
    check(
      "确认比例时 §57 验收仍然通过（no_fabricated_ratio 走 known_ratio 分支）",
      ratioRecord?.acceptance?.passed === true &&
        ratioRecord?.acceptance?.no_fabricated_ratio === true
    );
    check(
      "确认比例后缺口清单不再出现「未确认配方比例」",
      !(ratioRecord?.evidence_gaps ?? []).some((gap) => gap.includes("未确认配方比例")),
      ratioRecord?.evidence_gaps
    );

    const blendProductId = await createProduct("拼配描述写明配比的产品", BLEND_PRODUCT);
    const blendGenerated = await generate(blendProductId, {});
    check("拼配描述里写明配比的产品生成返回 201", blendGenerated.status === 201, blendGenerated.status);
    const blendRecord = blendGenerated.payload;
    check(
      "已知比例来自拼配描述（source = BLEND_DESCRIPTION），两个原料都识别到了（§6.1）",
      blendRecord?.ratio?.known_ratio === true &&
        blendRecord?.ratio?.ratio_source === "BLEND_DESCRIPTION" &&
        JSON.stringify(Object.keys(blendRecord?.ratio?.ratio_data ?? {}).sort()) ===
          JSON.stringify(["布朗山", "易武"]),
      blendRecord?.ratio
    );
    check(
      "拼配描述的比例证据逐字指向该字段（product.blend_description=布朗山 60%，易武 40%）",
      (blendRecord?.ratio?.ratio_evidence ?? []).includes(
        "product.blend_description=布朗山 60%，易武 40%"
      ),
      blendRecord?.ratio?.ratio_evidence
    );
    check(
      "§57 验收通过且设计逻辑里写明来源是「已录入的拼配描述」",
      blendRecord?.acceptance?.passed === true &&
        String(blendRecord?.formula_strategy ?? "").includes("已录入的拼配描述"),
      blendRecord?.formula_strategy
    );

    const partialProductId = await createProduct("拼配描述只写一处比例的产品", PARTIAL_BLEND_PRODUCT);
    const partialGenerated = await generate(partialProductId, {});
    check("只有一处比例字样的产品生成返回 201", partialGenerated.status === 201, partialGenerated.status);
    const partialRecord = partialGenerated.payload;
    check(
      "只有一处比例不算配比：按「未知比例」处理（§6.1）",
      partialRecord?.ratio?.known_ratio === false && partialRecord?.ratio?.ratio_data === null,
      partialRecord?.ratio
    );
    check(
      "嘴上说不编比例、正文也不许抄比例：已录入事实里的「60%」被剔除在正文之外",
      ratioHits(partialRecord).length === 0 &&
        !(componentOf(partialRecord, "backbone")?.texts ?? []).some((text) =>
          text.includes("60%")
        )
    );
    check(
      "缺口清单提示「拼配描述里出现了比例字样，但不足以构成完整配比」（§6.1）",
      (partialRecord?.evidence_gaps ?? []).some((gap) => gap.includes("不足以构成完整配比")),
      partialRecord?.evidence_gaps
    );
    check(
      "同一条事实里没有比例字样时照样写实（布朗山仍然负责骨架）",
      componentOf(partialRecord, "backbone")?.status === "WRITTEN" &&
        String(componentOf(partialRecord, "backbone")?.texts?.[0] ?? "").includes("布朗山")
    );

    console.log("\n[8] §62-15 版本与人工确认：重新生成只新增版本，确认不改正文");
    const regenerate = await generate(fullProductId, { notes: "冒烟：第二版" });
    check(
      "再次生成返回 201 且版本号为 2",
      regenerate.status === 201 && regenerate.payload?.version === 2,
      regenerate.payload?.version
    );
    check(
      "第一版的备注原样保留（历史版本不被覆盖）",
      (await recordOf(fullProductId, fullRecord?.id)).payload?.notes === "冒烟：事实齐备版本"
    );
    check(
      "版本列表倒序且全部保留（v2 / v1）",
      JSON.stringify((await versionsOf(fullProductId)).payload?.items?.map((item) => item.version)) ===
        JSON.stringify([2, 1])
    );
    const confirm = await patch(fullProductId, regenerate.payload?.id, { is_confirmed: true });
    check("人工确认返回 200", confirm.status === 200, confirm.status);
    check(
      "确认后记下确认人（为审计留下痕迹）且不改版本号",
      confirm.payload?.is_confirmed === true &&
        typeof confirm.payload?.confirmed_by === "string" &&
        confirm.payload?.version === 2,
      [confirm.payload?.confirmed_by, confirm.payload?.version]
    );
    check(
      "确认不改五个分量正文（确认的是同一版配方哲学）",
      JSON.stringify((confirm.payload?.components ?? []).map((component) => component.texts)) ===
        JSON.stringify((regenerate.payload?.components ?? []).map((component) => component.texts))
    );
    const noted = await patch(fullProductId, regenerate.payload?.id, { notes: "研究员复核：事实与设计逻辑一致" });
    check(
      "追加备注返回 200 且不把确认状态冲掉（局部更新）",
      noted.status === 200 &&
        noted.payload?.notes === "研究员复核：事实与设计逻辑一致" &&
        noted.payload?.is_confirmed === true
    );
    const reverted = await patch(fullProductId, regenerate.payload?.id, { is_confirmed: false });
    check(
      "确认可以回退，且回退后确认人与时间一并清空（不留脏状态）",
      reverted.status === 200 &&
        reverted.payload?.is_confirmed === false &&
        reverted.payload?.confirmed_by === null &&
        reverted.payload?.confirmed_at === null
    );
    check(
      "人工确认与回退都不升版本（版本列表仍只有 2 版）",
      (await versionsOf(fullProductId)).payload?.items?.length === 2
    );

    console.log("\n[9] 「配方哲学」库：一行一产品取最新版 + 筛选 / 排序 / 分页");
    const matrix = await request("GET", "/api/formula-philosophy?pageSize=100", { token });
    check("配方哲学库返回 200", matrix.status === 200, matrix.status);
    const rows = matrix.payload?.items ?? [];
    check(
      "一行一款产品（同一产品不会出现多行）",
      createdProductIds.every(
        (id) => rows.filter((row) => row.product_id === id).length === 1
      ),
      createdProductIds.map((id) => rows.filter((row) => row.product_id === id).length)
    );
    check(
      "矩阵取的是最新一版（事实齐备产品 version = 2）",
      rows.find((row) => row.product_id === fullProductId)?.version === 2
    );
    check(
      "矩阵行自带写实数 / 缺口数 / 比例状态 / 验收结论（前端不必再算一遍）",
      rows.every(
        (row) =>
          typeof row.written_components === "number" &&
          row.written_components + row.gap_components === COMPONENT_ORDER.length &&
          typeof row.known_ratio === "boolean" &&
          typeof row.acceptance_passed === "boolean" &&
          row.spec_ref === "§6 / §46"
      )
    );
    check(
      "矩阵行区分「验收通过 / 还没成设计逻辑」与「有没有比例」",
      rows.find((row) => row.product_id === fullProductId)?.acceptance_passed === true &&
        rows.find((row) => row.product_id === thinProductId)?.acceptance_passed === false &&
        rows.find((row) => row.product_id === ratioProductId)?.known_ratio === true &&
        rows.find((row) => row.product_id === thinProductId)?.known_ratio === false
    );
    const sortedByWritten = await request("GET", "/api/formula-philosophy?sort=-written_components", {
      token
    });
    const writtenCounts = (sortedByWritten.payload?.items ?? []).map((row) => row.written_components);
    check(
      "按写实分量数倒序可用（单调不增）",
      sortedByWritten.status === 200 &&
        writtenCounts.every((value, index) => index === 0 || writtenCounts[index - 1] >= value),
      writtenCounts
    );
    const sortedByGap = await request("GET", "/api/formula-philosophy?sort=-gap_components", { token });
    const gapCounts = (sortedByGap.payload?.items ?? []).map((row) => row.gap_components);
    check(
      "按缺口分量数倒序可用（单调不增）",
      sortedByGap.status === 200 &&
        gapCounts.every((value, index) => index === 0 || gapCounts[index - 1] >= value),
      gapCounts
    );
    const byComponent = await request(
      "GET",
      "/api/formula-philosophy?component=backbone&pageSize=100",
      { token }
    );
    check(
      "按分量筛选：只返回骨架写实的产品，且必含事实齐备产品、不含极简产品",
      byComponent.status === 200 &&
        (byComponent.payload?.items ?? []).some((row) => row.product_id === fullProductId) &&
        !(byComponent.payload?.items ?? []).some((row) => row.product_id === thinProductId)
    );
    const byQuery = await request("GET", "/api/formula-philosophy?q=孔雀&pageSize=100", { token });
    check(
      "按名称搜索可用（命中六星孔雀，排掉试样茶）",
      byQuery.status === 200 &&
        (byQuery.payload?.items ?? []).some((row) => row.product_id === fullProductId) &&
        !(byQuery.payload?.items ?? []).some((row) => row.product_id === thinProductId)
    );
    const byProduct = await request(
      "GET",
      `/api/formula-philosophy?product_id=${thinProductId}`,
      { token }
    );
    check(
      "按产品筛选可用（只返回该产品一行）",
      byProduct.status === 200 &&
        (byProduct.payload?.items ?? []).length === 1 &&
        byProduct.payload?.items?.[0]?.product_id === thinProductId
    );
    const missingOnly = await request("GET", "/api/formula-philosophy?missing=true&pageSize=100", {
      token
    });
    check(
      "筛选「尚未生成配方哲学」：五个产品都已生成，因此都不出现",
      missingOnly.status === 200 &&
        !(missingOnly.payload?.items ?? []).some((row) => createdProductIds.includes(row.product_id)),
      missingOnly.payload?.total
    );
    const ratioOnly = await request("GET", "/api/formula-philosophy?known_ratio=true&pageSize=100", {
      token
    });
    check(
      "筛选「只看已确认比例」：登记过比例的进、没登记的不进",
      ratioOnly.status === 200 &&
        (ratioOnly.payload?.items ?? []).some((row) => row.product_id === ratioProductId) &&
        (ratioOnly.payload?.items ?? []).some((row) => row.product_id === blendProductId) &&
        !(ratioOnly.payload?.items ?? []).some((row) => row.product_id === fullProductId)
    );
    const noRatio = await request("GET", "/api/formula-philosophy?known_ratio=false&pageSize=100", {
      token
    });
    check(
      "筛选「只看未确认比例」：false 不会被当成 true（返回的正是没登记比例的那批）",
      noRatio.status === 200 &&
        (noRatio.payload?.items ?? []).some((row) => row.product_id === fullProductId) &&
        (noRatio.payload?.items ?? []).some((row) => row.product_id === thinProductId) &&
        !(noRatio.payload?.items ?? []).some((row) => row.product_id === ratioProductId) &&
        !(noRatio.payload?.items ?? []).some((row) => row.product_id === blendProductId)
    );
    const creatorMode = await request(
      "GET",
      `/api/formula-philosophy?mode=CATEGORY_CREATOR&product_id=${fullProductId}`,
      { token }
    );
    check(
      "按 §17 模式筛选 CATEGORY_CREATOR：没有可靠锚点的产品全部归到自建高端标准",
      creatorMode.status === 200 && creatorMode.payload?.total === 1,
      creatorMode.payload?.total
    );
    const benchmarkMode = await request(
      "GET",
      `/api/formula-philosophy?mode=BENCHMARK&product_id=${fullProductId}`,
      { token }
    );
    check(
      "按 §17 模式筛选 BENCHMARK：没有达标锚点的产品不会混进来",
      benchmarkMode.status === 200 && benchmarkMode.payload?.total === 0,
      benchmarkMode.payload?.total
    );
    const pagedFirst = await request("GET", "/api/formula-philosophy?pageSize=1&page=1", { token });
    check(
      "分页可用：每页 1 条且回传 totalPages",
      (pagedFirst.payload?.items ?? []).length === 1 &&
        pagedFirst.payload?.totalPages === pagedFirst.payload?.total,
      [pagedFirst.payload?.total, pagedFirst.payload?.totalPages]
    );
    check(
      "非法 mode 返回 400（strict 校验，不做沉默兜底）",
      (await request("GET", "/api/formula-philosophy?mode=NOPE", { token })).status === 400
    );
    check(
      "非法排序参数返回 400",
      (await request("GET", "/api/formula-philosophy?sort=price_desc", { token })).status === 400
    );
    check(
      "非法分量参数返回 400",
      (await request("GET", "/api/formula-philosophy?component=nose", { token })).status === 400
    );
    check(
      "非法布尔参数返回 400（known_ratio 只接受 true / false 这类字符串）",
      (await request("GET", "/api/formula-philosophy?known_ratio=maybe", { token })).status === 400
    );
    check(
      "分页超过上限返回 400",
      (await request("GET", "/api/formula-philosophy?pageSize=101", { token })).status === 400
    );
    check(
      "多余查询参数返回 400（strict schema）",
      (await request("GET", "/api/formula-philosophy?status=READY", { token })).status === 400
    );

    console.log("\n[10] 权限矩阵与边界：只读可看不可写，研究员可写");
    const viewerToken = await (async () => {
      const registered = await request("POST", "/api/auth/register", {
        token,
        body: {
          email: VIEWER_EMAIL,
          password: ROLE_PASSWORD,
          name: "冒烟只读",
          role: "VIEWER"
        }
      });
      check("创建只读账号返回 201", registered.status === 201, registered.status);
      createdUserEmails.push(VIEWER_EMAIL);
      return registered.payload?.tokens?.access_token;
    })();
    check("只读账号可以读配方哲学总览", (await overviewOf(thinProductId, viewerToken)).status === 200);
    check(
      "只读账号可以读配方哲学库",
      (await request("GET", "/api/formula-philosophy", { token: viewerToken })).status === 200
    );
    check(
      "只读账号不能生成配方哲学",
      (await generate(thinProductId, { notes: "只读尝试" }, viewerToken)).status === 403
    );
    check(
      "只读账号不能人工确认配方哲学",
      (await patch(thinProductId, thinRecord?.id, { is_confirmed: true }, viewerToken)).status === 403
    );

    const researcherToken = await (async () => {
      const registered = await request("POST", "/api/auth/register", {
        token,
        body: {
          email: RESEARCHER_EMAIL,
          password: ROLE_PASSWORD,
          name: "冒烟研究员",
          role: "RESEARCHER"
        }
      });
      check("创建研究员账号返回 201", registered.status === 201, registered.status);
      createdUserEmails.push(RESEARCHER_EMAIL);
      return registered.payload?.tokens?.access_token;
    })();
    const researcherGenerated = await generate(thinProductId, { notes: "研究员补跑一版" }, researcherToken);
    check("研究员可以生成配方哲学", researcherGenerated.status === 201, researcherGenerated.status);
    const researcherConfirm = await patch(
      thinProductId,
      researcherGenerated.payload?.id,
      { is_confirmed: true },
      researcherToken
    );
    check("研究员可以人工确认配方哲学", researcherConfirm.status === 200, researcherConfirm.status);
    check(
      "写入只新增版本，历史版本全部保留（v2 / v1）",
      JSON.stringify((await versionsOf(thinProductId)).payload?.items?.map((item) => item.version)) ===
        JSON.stringify([2, 1])
    );
    check(
      "人工确认不随新版本丢失（v2 仍为已确认）",
      (await overviewOf(thinProductId)).payload?.versions?.some(
        (item) => item.version === 2 && item.is_confirmed === true
      )
    );

    check(
      "生成时传多余字段返回 400（strict schema）",
      (await generate(thinProductId, { trigger: "USER_OPT_OUT" })).status === 400
    );
    check(
      "备注超过 2000 字返回 400",
      (await generate(thinProductId, { notes: "长".repeat(2001) })).status === 400
    );
    check(
      "PATCH 传多余字段返回 400",
      (await patch(thinProductId, thinRecord?.id, { is_confirmed: true, status: "WRITTEN" })).status === 400
    );
    check(
      "PATCH 备注超过 2000 字返回 400",
      (await patch(thinProductId, thinRecord?.id, { notes: "长".repeat(2001) })).status === 400
    );
    check("给不存在的产品生成配方哲学返回 404", (await generate(missingId)).status === 404);
    check("读不存在产品的版本列表返回 404", (await versionsOf(missingId)).status === 404);
    check(
      "读不存在的配方哲学版本返回 404",
      (await recordOf(thinProductId, missingId)).status === 404
    );
    check(
      "跨产品调阅版本不串号（用别的产品的 id 查不到）",
      (await recordOf(fullProductId, thinRecord?.id)).status === 404
    );
    check(
      "对不存在的版本做人工确认返回 404",
      (await patch(fullProductId, missingId, { is_confirmed: true })).status === 404
    );

    console.log("\n[11] §58-7：价值映射里的配方哲学故事改由 Phase 11 正文接管（不再 HANDOFF）");
    const thinLatestVersion = (await versionsOf(thinProductId)).payload?.items?.[0]?.version ?? 0;
    const thinValueCodes = await request("POST", `/api/products/${thinProductId}/value-codes/generate`, {
      token,
      body: {}
    });
    check("极简产品生成价值映射返回 201", thinValueCodes.status === 201, thinValueCodes.status);
    const thinStory = thinValueCodes.payload?.stories?.formula_philosophy_story;
    check(
      "写实分量不足 2 个时故事留空写缺口（不用简化版代替，§60）",
      thinStory?.status === "GAP" &&
        thinStory?.text === null &&
        thinStory?.handoff_phase === null &&
        String(thinStory?.gap ?? "").includes(`第 ${thinLatestVersion} 版`),
      thinStory
    );
    const fullValueCodes = await request("POST", `/api/products/${fullProductId}/value-codes/generate`, {
      token,
      body: {}
    });
    check("事实齐备产品生成价值映射返回 201", fullValueCodes.status === 201, fullValueCodes.status);
    const fullStory = fullValueCodes.payload?.stories?.formula_philosophy_story;
    check(
      "配方哲学故事直接取设计逻辑正文（status = READY，正文逐字一致）",
      fullStory?.status === "READY" && fullStory?.text === regenerate.payload?.formula_strategy,
      { status: fullStory?.status, same: fullStory?.text === regenerate.payload?.formula_strategy }
    );
    check(
      "故事不再登记交接 Phase（handoff_phase = null），缺口为空",
      fullStory?.handoff_phase === null && fullStory?.gap === null,
      { handoff: fullStory?.handoff_phase, gap: fullStory?.gap }
    );
    check(
      "故事备注写明取自第几版（可回查到具体版本，§62-15）",
      String(fullStory?.note ?? "").includes("第 2 版"),
      fullStory?.note
    );
  } finally {
    for (const productId of createdProductIds) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `[清理] 删除冒烟产品 ${productId}（级联删除配方哲学）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from sources) as sources, (select count(*)::int from market_offers) as offers, (select count(*)::int from comparable_candidates) as candidates, (select count(*)::int from value_anchors) as anchors, (select count(*)::int from category_creator_profiles) as creator_profiles, (select count(*)::int from product_value_codes) as value_profiles, (select count(*)::int from product_architectures) as architectures, (select count(*)::int from formula_philosophies) as philosophies, (select count(*)::int from value_codes) as value_codes"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：products=${row?.products} · sources=${row?.sources} · market_offers=${row?.offers} · comparable_candidates=${row?.candidates} · value_anchors=${row?.anchors} · category_creator_profiles=${row?.creator_profiles} · product_value_codes=${row?.value_profiles} · product_architectures=${row?.architectures} · formula_philosophies=${row?.philosophies} · value_codes=${row?.value_codes}`
    );
    check(
      "冒烟结束后业务表清零（只保留 seed 与 16 行 Value Code 字典）",
      row?.products === 0 &&
        row?.sources === 0 &&
        row?.offers === 0 &&
        row?.candidates === 0 &&
        row?.anchors === 0 &&
        row?.creator_profiles === 0 &&
        row?.value_profiles === 0 &&
        row?.architectures === 0 &&
        row?.philosophies === 0 &&
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
