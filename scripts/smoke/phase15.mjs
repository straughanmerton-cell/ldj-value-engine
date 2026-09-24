/**
 * Phase 15 端到端冒烟（规格 §31 一级导航 / §51 主播中心十项 / §52 经销商中心十项 /
 * §53 / §57 发布闸门 / §60 导出 / §62-14 一条口径 / §62-15 派生视图不落库）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase15.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（成稿 / 审核结论 / 证据行随产品级联删除）
 *       与临时账号，开发库最终只保留 seed（品牌「龙德记」+ 管理员 + 16 行 Value Code 字典），
 *       并校验 products / copy_outputs / generated_claims / claim_evidence 全部为 0。
 *
 * 本阶段压的是五条硬约束：
 *   1) §51 / §52：两个中心各有**十项**，顺序与原文一致，每一格都给可直接念的原文；
 *   2) §53 / §57：发布闸门只有一条口径（最新一版成稿 + 这一版逐句无 RED + 这一版人工审批通过），
 *      列表 / 详情页 / 导出三处必须给出同一个结论；
 *   3) §53：闸门不过时两个中心仍然 **200**，但十格全空（不许露出未审正文），只有导出硬 409；
 *   4) §62-14：上一版审批通过后新生成一版，必须立刻回到「待事实审核」——不许出现假绿灯；
 *   5) §62-15：导出与两个中心都是**派生视图**，不落库、不改写正文，重新生成只新增版本。
 *
 * 因此脚本用「事实齐备产品（走到可交付）」「注入红线句产品（被 RED 阻断）」「无成稿产品」
 * 「只有一版未审成稿的产品」四类输入，去压「口径只有一份、闸门不可绕过、正文不可提前泄露」。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase15-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase15-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** §51 主播中心十项：key 与 label 逐字照抄规格，顺序不许变。 */
const HOST_SLOTS = [
  "product_identity",
  "one_liner",
  "must_say_three",
  "value_track",
  "product_structure",
  "formula_philosophy",
  "core_quotes",
  "sec60",
  "min3",
  "objections"
];
const HOST_LABELS = [
  "产品身份",
  "一句话定位",
  "今天必讲 3 点",
  "价值赛道 / 产品标准",
  "产品结构",
  "配方哲学",
  "5 句金句",
  "60 秒稿",
  "3 分钟稿",
  "异议回答"
];
/** §52 经销商中心十项：key 与 label 逐字照抄规格，顺序不许变。 */
const DEALER_SLOTS = [
  "positioning",
  "selling_points",
  "why_this_price",
  "market_cognition",
  "primary_anchor",
  "product_structure",
  "formula_philosophy",
  "consumer",
  "how_to_introduce",
  "faq"
];
const DEALER_LABELS = [
  "产品定位",
  "核心卖点",
  "为什么值这个价",
  "同赛道市场认知",
  "主要锚点",
  "产品结构",
  "配方哲学",
  "消费人群",
  "如何介绍",
  "常见问题"
];
/** 发布闸门六态：从上到下就是运营真实的推进顺序。 */
const GATE_LABELS = ["还没有成稿", "待事实审核", "被 RED 阻断", "已被否决", "待人工审批", "可交付"];
const GATE_TONES = ["outline", "info", "danger", "danger", "warn", "ok"];
/** 合同口径（与 `DELIVERY_SPEC_REF` 同源）。 */
const SPEC_REF = "§51 / §52 / §53 / §57 / §62-14 / §62-15";
const HOST_SPEC_REF = "§51 / §53 / §57";
const DEALER_SPEC_REF = "§52 / §53 / §57";
const GATE_SPEC_REF = "§53 / §57 / §62-14";
/** §62-15 / §60：导出格式与范围。 */
const EXPORT_FORMATS = ["MARKDOWN", "TEXT"];
const EXPORT_SCOPES = ["HOST", "DEALER", "ALL"];
const SOURCE_LIST_HINT = "§62-15";
/** §49 / §53：一段同时踩四条红线的句子，用来验证「RED 不外泄正文」。 */
const RED_SENTENCE =
  "这款茶是全国第一。这饼茶必涨，买了就是稳赚。它已经卖到 8888 元。我们就是按 2003 六星孔雀的配方做的。";

/** 事实齐备的产品：能一路走到「可交付」（与 Phase 12 / 13 / 14 fixture 同口径）。 */
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
  copy_intensity_default: 5
};

/** 几乎没有事实的产品：承载注入的红线句，也是「十格该留白就留白」的样本。 */
const THIN_PRODUCT = {
  product_name: "龙德记试样茶",
  year: 2026,
  tea_type: "普洱生茶",
  weight_g: 357,
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 5
};

function thinProduct(name) {
  return {
    ...THIN_PRODUCT,
    product_name: name
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

/**
 * 直接把一句红线写进**已落库的成稿**。
 *
 * 目的不是伪造数据，而是让「闸门必须拦住未审 / 踩线正文」这条链路可被验证：
 * 真实产品不会写出「全国第一」，但发布闸门必须在有人写出来时把它挡在直播间外（§53 / §57）。
 */
async function injectRedSentence(client, recordId, sentence) {
  const rows = await client.query("select record from copy_outputs where id = $1", [recordId]);
  const record = rows.rows[0]?.record;
  if (!record) {
    throw new Error(`成稿不存在，无法注入红线句：${recordId}`);
  }
  record.headline.opening_hook = `${record.headline.opening_hook}${sentence}`;
  await client.query("update copy_outputs set record = $1::jsonb where id = $2", [
    JSON.stringify(record),
    recordId
  ]);
}

/** 十格是否**全部没有正文**（闸门未通过时的唯一合法形态）。 */
function slotsAreEmpty(slots) {
  return (
    Array.isArray(slots) &&
    slots.length === 10 &&
    slots.every(
      (slot) =>
        slot.present === false &&
        slot.chars === 0 &&
        slot.text === null &&
        (slot.lines ?? []).length === 0 &&
        (slot.items ?? []).length === 0
    )
  );
}

/** 十格是否全部有正文（闸门通过时必须十项都有内容）。 */
function slotsAreFull(slots) {
  return (
    Array.isArray(slots) &&
    slots.length === 10 &&
    slots.every(
      (slot) =>
        slot.present === true &&
        slot.chars > 0 &&
        typeof slot.text === "string" &&
        slot.text.length > 0
    )
  );
}

/**
 * 抹掉导出正文里唯一一处「每次现场生成」的内容：导出时间。
 * 其余部分（十项正文、成稿版本、审核次数）必须逐字相同，才能证明导出是只读派生（§62-15）。
 */
function withoutExportTime(text) {
  return String(text ?? "").replace(/^导出时间：.*$/mu, "导出时间：（每次现场生成）");
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

  const hostCenterOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/host-center`, { token: authToken });
  const dealerCenterOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/dealer-center`, { token: authToken });
  const exportOf = (productId, query = "", authToken = token) =>
    request("GET", `/api/products/${productId}/delivery/export${query}`, { token: authToken });
  const hostListOf = (query = "", authToken = token) =>
    request("GET", `/api/host-center${query}`, { token: authToken });
  const generateCopy = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/copy/generate`, { token: authToken, body });
  const generateReview = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/fact-review/generate`, { token: authToken, body });
  const decide = (action, productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/fact-review/${action}`, { token: authToken, body });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    const healthPhase = String(health.payload?.phase ?? "");
    const healthPhaseNumber = Number(/Phase\s*(\d+)/.exec(healthPhase)?.[1] ?? 0);
    check(
      "健康检查文案至少推进到 Phase 15（主播中心 / 经销商中心与导出）",
      healthPhaseNumber >= 15 && healthPhase.includes("已交付"),
      healthPhase
    );
    check(
      "未登录不能读交付合同 / 标签 / 跨产品列表（401）",
      (await request("GET", "/api/delivery/contract")).status === 401 &&
        (await request("GET", "/api/delivery/labels")).status === 401 &&
        (await request("GET", "/api/host-center")).status === 401
    );
    check(
      "未登录不能读主播中心 / 经销商中心 / 导出（401）",
      (await hostCenterOf(missingId)).status === 401 &&
        (await dealerCenterOf(missingId)).status === 401 &&
        (await exportOf(missingId)).status === 401
    );
    check(
      "伪造 token 一律 401（交付层不因为「只读」就放开鉴权）",
      (await request("GET", "/api/host-center", { token: "not-a-real-token" })).status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("登录响应带回 access_token", typeof token === "string" && token.length > 0);

    console.log("\n[2] §51 / §52 / §53 / §60 合同自检（十项 × 2 / 导出格式 / 发布闸门 / 七条铁律）");
    const contractResponse = await request("GET", "/api/delivery/contract", { token });
    check("交付合同返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const downstream = contractResponse.payload?.downstream ?? [];
    const contractLimits = contractResponse.payload?.limits;
    check(
      "合同 spec_ref 锁定 §51 / §52 / §53 / §57 / §62-14 / §62-15（口径只从 schema 层读）",
      contract?.spec_ref === SPEC_REF,
      contract?.spec_ref
    );
    const hostCenterContract = contract?.host_center;
    check(
      "§51 主播中心十项：数量与顺序逐字固定（不缺项、不改序）",
      hostCenterContract?.slot_count === 10 &&
        JSON.stringify((hostCenterContract?.slots ?? []).map((slot) => slot.key)) ===
          JSON.stringify(HOST_SLOTS),
      (hostCenterContract?.slots ?? []).map((slot) => slot.key)
    );
    check(
      "§51 十项中文标签逐字照抄规格（第 4 项就是「价值赛道 / 产品标准」）",
      JSON.stringify((hostCenterContract?.slots ?? []).map((slot) => slot.label)) ===
        JSON.stringify(HOST_LABELS),
      (hostCenterContract?.slots ?? []).map((slot) => slot.label)
    );
    check(
      "§51 每一格都写清「必须拿到什么」与派生来源（§64：主播不用自己琢磨）",
      (hostCenterContract?.slots ?? []).every(
        (slot) => slot.requirement.trim().length > 0 && slot.source.trim().length > 0
      )
    );
    const dealerCenterContract = contract?.dealer_center;
    check(
      "§52 经销商中心十项：数量与顺序逐字固定",
      dealerCenterContract?.slot_count === 10 &&
        JSON.stringify((dealerCenterContract?.slots ?? []).map((slot) => slot.key)) ===
          JSON.stringify(DEALER_SLOTS),
      (dealerCenterContract?.slots ?? []).map((slot) => slot.key)
    );
    check(
      "§52 十项中文标签逐字照抄规格",
      JSON.stringify((dealerCenterContract?.slots ?? []).map((slot) => slot.label)) ===
        JSON.stringify(DEALER_LABELS),
      (dealerCenterContract?.slots ?? []).map((slot) => slot.label)
    );
    check(
      "§52 每一格都写清要求与派生来源（缺比例就如实说缺，不编配比）",
      (dealerCenterContract?.slots ?? []).every(
        (slot) => slot.requirement.trim().length > 0 && slot.source.trim().length > 0
      )
    );
    check(
      "§60 导出两种格式齐备（Markdown .md / 纯文本 .txt，各带 content_type 与用途说明）",
      JSON.stringify((contract?.export?.formats ?? []).map((item) => item.key)) ===
        JSON.stringify(EXPORT_FORMATS) &&
        (contract?.export?.formats ?? []).every(
          (item) =>
            item.extension.startsWith(".") &&
            item.content_type.includes("/") &&
            item.hint.trim().length > 0
        ),
      (contract?.export?.formats ?? []).map((item) => item.key)
    );
    check(
      "§60 导出三种范围齐备（只要主播 / 只要经销商 / 两份完整资料）",
      JSON.stringify((contract?.export?.scopes ?? []).map((item) => item.key)) ===
        JSON.stringify(EXPORT_SCOPES)
    );
    const publishGate = contract?.publish_gate;
    check(
      "§53 / §57 发布闸门四个布尔全为 true：必须最新版 / 必须审批 / RED 禁止发布 / 无成稿无资料",
      publishGate?.requires_approved === true &&
        publishGate?.requires_latest_copy === true &&
        publishGate?.red_blocks_publish === true &&
        publishGate?.no_copy_no_material === true,
      publishGate
    );
    check(
      "§53 五种阻断状态逐条写清（没有成稿 / 没审 / RED / 被否决 / 待审批）",
      (publishGate?.blocking_states ?? []).length === 5 &&
        publishGate.blocking_states.some((item) => item.includes("还没有")) &&
        publishGate.blocking_states.some((item) => item.includes("RED")) &&
        publishGate.blocking_states.some((item) => item.includes("否决")) &&
        publishGate.blocking_states.some((item) => item.includes("没有人工审批")),
      (publishGate?.blocking_states ?? []).length
    );
    check(
      "§62-15 交付层自认是派生视图且版本只增不删（不新增表、不改写正文）",
      contract?.derived_view === true && contract?.keep_all_versions === true,
      { derived_view: contract?.derived_view, keep_all_versions: contract?.keep_all_versions }
    );
    check(
      "§62 交付层上限与合同同源（默认 20 / 单页 100 / 单次导出 12 万字 / 搜索词 200 字）",
      contractLimits?.defaultPageSize === 20 &&
        contractLimits?.maxPageSize === 100 &&
        contractLimits?.maxExportChars === 120000 &&
        contractLimits?.maxQueryLength === 200,
      contractLimits
    );
    check(
      "七条铁律写清十项 / 假绿灯 / 派生不落库 / 不移植竞品事实（§51 / §52 / §53 / §62-5 / §62-15）",
      (contract?.rules ?? []).length === 7 &&
        contract.rules.some((rule) => rule.includes("§51 主播中心十项")) &&
        contract.rules.some((rule) => rule.includes("§52 经销商中心十项")) &&
        contract.rules.some((rule) => rule.includes("假绿灯")) &&
        contract.rules.some((rule) => rule.includes("派生视图不落库")) &&
        contract.rules.some((rule) => rule.includes("不移植竞品事实")),
      (contract?.rules ?? []).length
    );
    check(
      "已交付阶段不再登记下游：Phase 15 交付后下游交接为空数组（§60）",
      Array.isArray(downstream) && downstream.length === 0,
      downstream
    );

    console.log("\n[3] 标签自检：六种闸门状态与十项文案只从 API 下发（前端不另写一套）");
    const labelsResponse = await request("GET", "/api/delivery/labels", { token });
    check("交付标签返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check(
      "标签里的主播中心十项与合同同源（key / label / 顺序）",
      JSON.stringify((labels?.host_center_slots ?? []).map((slot) => slot.key)) ===
        JSON.stringify(HOST_SLOTS) &&
        JSON.stringify((labels?.host_center_slots ?? []).map((slot) => slot.label)) ===
          JSON.stringify(HOST_LABELS)
    );
    check(
      "标签里的经销商中心十项与合同同源（key / label / 顺序）",
      JSON.stringify((labels?.dealer_center_slots ?? []).map((slot) => slot.key)) ===
        JSON.stringify(DEALER_SLOTS) &&
        JSON.stringify((labels?.dealer_center_slots ?? []).map((slot) => slot.label)) ===
          JSON.stringify(DEALER_LABELS)
    );
    const gateStates = labels?.gate_states ?? [];
    check(
      "六种闸门状态齐全且顺序固定（运营从「还没成稿」一路推到「可交付」）",
      JSON.stringify(gateStates.map((item) => item.label)) === JSON.stringify(GATE_LABELS),
      gateStates.map((item) => item.label)
    );
    check(
      "六种状态的色调由 API 下发（outline / info / danger / danger / warn / ok），前端不自己配色",
      JSON.stringify(gateStates.map((item) => item.tone)) === JSON.stringify(GATE_TONES),
      gateStates.map((item) => item.tone)
    );
    check(
      "只有「可交付」是 ready = true，其余五种一律 false（不存在「大概算过了」这一档）",
      gateStates.filter((item) => item.ready === true).length === 1 &&
        gateStates[gateStates.length - 1]?.ready === true &&
        gateStates.slice(0, -1).every((item) => item.ready === false)
    );
    check(
      "不可交付的五种状态都给出中文原因与「下一步去哪」（§64：主播不用自己琢磨）",
      gateStates.slice(0, -1).every(
        (item) =>
          typeof item.reason === "string" &&
          item.reason.trim().length > 0 &&
          typeof item.next_action === "string" &&
          item.next_action.trim().length > 0
      ) && gateStates[gateStates.length - 1]?.reason === null && gateStates[gateStates.length - 1]?.next_action === null
    );
    check(
      "标签里的导出格式 / 范围 / 上限与合同同源（口径只有一份）",
      JSON.stringify((labels?.export_formats ?? []).map((item) => item.key)) ===
        JSON.stringify(EXPORT_FORMATS) &&
        JSON.stringify((labels?.export_scopes ?? []).map((item) => item.key)) ===
          JSON.stringify(EXPORT_SCOPES) &&
        labels?.limits?.maxExportChars === contractLimits?.maxExportChars
    );
    check(
      "标签里的七条铁律与合同逐字一致（前端提示语不另写一份）",
      JSON.stringify(labels?.rules) === JSON.stringify(contract?.rules)
    );

    console.log("\n[4] 还没有成稿：两个中心 200 但十格全空，只有导出硬 409（§53 / §57）");
    const noCopyId = await createProduct("交付·无成稿产品", thinProduct("龙德记试样茶·无成稿"));
    const noCopyHost = await hostCenterOf(noCopyId);
    check("没有成稿时主播中心返回 200（页面能打开，不是空白报错）", noCopyHost.status === 200, noCopyHost.status);
    check(
      "闸门状态 = 「还没有成稿」，原因写明「还没有强成交话术成稿」（§53）",
      noCopyHost.payload?.gate?.reason?.includes("还没有强成交话术成稿") === true &&
        noCopyHost.payload?.gate?.red_count === 0 &&
        (noCopyHost.payload?.gate?.blocking_sentences ?? []).length === 0,
      noCopyHost.payload?.gate?.reason
    );
    check(
      "没有成稿时 ready = false、reason 与 next_action 齐全，copy_record_id 与 copy_version 同时为空",
      noCopyHost.payload?.ready === false &&
        noCopyHost.payload?.gate?.ready === false &&
        typeof noCopyHost.payload?.gate?.reason === "string" &&
        noCopyHost.payload?.gate?.next_action === "去生成强成交话术" &&
        noCopyHost.payload?.copy_record_id === null &&
        noCopyHost.payload?.copy_version === null &&
        noCopyHost.payload?.gate?.review_version === null
    );
    check(
      "闸门不过时主播中心十格全部留空（present = false / chars = 0 / text = null / items = []）",
      slotsAreEmpty(noCopyHost.payload?.slots)
    );
    check(
      "十格即使留空也保留 §51 原文 label 与要求，供运营知道缺什么",
      JSON.stringify((noCopyHost.payload?.slots ?? []).map((slot) => slot.key)) ===
        JSON.stringify(HOST_SLOTS) &&
        (noCopyHost.payload?.slots ?? []).every(
          (slot) => slot.label.trim().length > 0 && slot.requirement.trim().length > 0
        )
    );
    check(
      "主播中心 spec_ref = §51 / §53 / §57（两个中心各自的口径写在响应里）",
      noCopyHost.payload?.spec_ref === HOST_SPEC_REF,
      noCopyHost.payload?.spec_ref
    );
    const noCopyDealer = await dealerCenterOf(noCopyId);
    check(
      "没有成稿时经销商中心同样 200 + 十格全空 + spec_ref = §52 / §53 / §57",
      noCopyDealer.status === 200 &&
        slotsAreEmpty(noCopyDealer.payload?.slots) &&
        noCopyDealer.payload?.spec_ref === DEALER_SPEC_REF &&
        noCopyDealer.payload?.ready === false,
      { status: noCopyDealer.status, spec_ref: noCopyDealer.payload?.spec_ref }
    );
    const noCopyExport = await exportOf(noCopyId);
    check(
      "没有成稿时导出 409，并在 details 里回「卡在哪一步 / 下一步去哪」（§53 / §57）",
      noCopyExport.status === 409 &&
        noCopyExport.payload?.error?.code === "CONFLICT" &&
        noCopyExport.payload?.error?.details?.gate_label === "还没有成稿" &&
        typeof noCopyExport.payload?.error?.details?.gate?.reason === "string" &&
        noCopyExport.payload?.error?.details?.next_action === "去生成强成交话术",
      {
        status: noCopyExport.status,
        gate_label: noCopyExport.payload?.error?.details?.gate_label,
        next_action: noCopyExport.payload?.error?.details?.next_action
      }
    );
    check(
      "导出 409 的 details 里没有正文（不许「先给文件再提示没审」）",
      noCopyExport.payload?.content === undefined &&
        noCopyExport.payload?.error?.details?.content === undefined
    );

    console.log("\n[5] 有成稿但没审：闸门停在「待事实审核」，十格依然全空（§53）");
    const fullId = await createProduct("交付·事实齐备产品", FULL_PRODUCT);
    const firstCopy = await generateCopy(fullId, { intensity: 5, notes: "冒烟：Phase 15 交付稿" });
    check("先生成一版 Level 5 强成交话术（201）", firstCopy.status === 201, firstCopy.status);
    const copyId = firstCopy.payload?.id;
    const copyVersion = firstCopy.payload?.version;
    check(
      "成稿版本为 v1 且拿到落库 id（交付对象永远是一版冻结的成稿）",
      typeof copyId === "string" && copyVersion === 1,
      { copyId, copyVersion }
    );
    const pendingHost = await hostCenterOf(fullId);
    const pendingGate = pendingHost.payload?.gate;
    check(
      "有成稿未审时闸门 = 「待事实审核」（info），不是 RED、也不是「等审批」（§53）",
      pendingGate?.review_version === null &&
        pendingGate?.next_action === "去事实审核" &&
        pendingGate?.reason?.includes("还没有做过逐句事实审核") === true &&
        pendingGate?.ready === false,
      { review_version: pendingGate?.review_version, reason: pendingGate?.reason }
    );
    check(
      "未审时两个中心依然不露一个字的正文，但摘要已经指向那一版成稿（§62-14）",
      pendingHost.payload?.ready === false &&
        slotsAreEmpty(pendingHost.payload?.slots) &&
        pendingHost.payload?.copy_record_id === copyId &&
        pendingHost.payload?.copy_version === copyVersion &&
        pendingHost.payload?.gate?.copy_record_id === copyId,
      {
        record: pendingHost.payload?.copy_record_id,
        ready: pendingHost.payload?.ready
      }
    );
    const pendingDealer = await dealerCenterOf(fullId);
    check(
      "经销商中心与主播中心同源：同一版成稿、同一条闸门、同样十格全空",
      pendingDealer.payload?.gate?.copy_record_id === copyId &&
        pendingDealer.payload?.gate?.ready === false &&
        slotsAreEmpty(pendingDealer.payload?.slots)
    );
    const pendingExport = await exportOf(fullId);
    check(
      "未审时导出 409，并把「还没审」这一条原因写进 details（§57）",
      pendingExport.status === 409 &&
        pendingExport.payload?.error?.details?.gate_label === "待事实审核" &&
        pendingExport.payload?.error?.details?.next_action === "去事实审核",
      {
        status: pendingExport.status,
        gate_label: pendingExport.payload?.error?.details?.gate_label
      }
    );

    console.log("\n[6] 人工审批两步走：先否决再通过，两次都留痕（§53 / §62-15）");
    const cleanReview = await generateReview(fullId);
    check("运行一次事实审核返回 201", cleanReview.status === 201, cleanReview.status);
    check(
      "事实齐备的成稿逐句无 RED：publishable = true、blocking_sentences 为空（§49 / §53）",
      cleanReview.payload?.review?.summary?.red === 0 &&
        (cleanReview.payload?.review?.blocking_sentences ?? []).length === 0 &&
        cleanReview.payload?.review?.publishable === true,
      cleanReview.payload?.review?.summary
    );
    const reviewedHost = await hostCenterOf(fullId);
    check(
      "审完但没人工审批：闸门 = 「待人工审批」（warn），导出仍然 409（§57）",
      reviewedHost.payload?.gate?.review_version === 1 &&
        reviewedHost.payload?.gate?.reason?.includes("还没有人工审批通过") === true &&
        reviewedHost.payload?.gate?.next_action === "去事实审核" &&
        reviewedHost.payload?.gate?.ready === false,
      reviewedHost.payload?.gate?.reason
    );
    check(
      "「待人工审批」时十格仍然全空——审核通过不等于可以对外讲（§53）",
      slotsAreEmpty(reviewedHost.payload?.slots)
    );
    const approvedTooEarly = await exportOf(fullId);
    check(
      "待审批阶段的导出 409，details.gate_label = 「待人工审批」",
      approvedTooEarly.status === 409 &&
        approvedTooEarly.payload?.error?.details?.gate_label === "待人工审批",
      approvedTooEarly.payload?.error?.details?.gate_label
    );

    const rejectResponse = await decide("reject", fullId, { note: "冒烟：第一次送审人工否决" });
    check("人工否决返回 200", rejectResponse.status === 200, rejectResponse.status);
    const rejectedHost = await hostCenterOf(fullId);
    check(
      "否决后闸门 = 「已被否决」（danger），指路「去事实审核」重新送审",
      rejectedHost.payload?.gate?.approval_status === "REJECTED" &&
        rejectedHost.payload?.gate?.ready === false &&
        rejectedHost.payload?.gate?.next_action === "去事实审核" &&
        rejectedHost.payload?.gate?.reason?.includes("已被人工否决") === true,
      rejectedHost.payload?.gate?.reason
    );
    const rejectedExport = await exportOf(fullId, "?scope=dealer");
    check(
      "被否决后任何范围的导出都是 409，不给「只要经销商那份」的后门",
      rejectedExport.status === 409 &&
        rejectedExport.payload?.error?.details?.gate_label === "已被否决",
      rejectedExport.payload?.error?.details?.gate_label
    );

    const approveResponse = await decide("approve", fullId, { note: "冒烟：人工复核通过" });
    check(
      "无 RED 时人工审批通过返回 200，且审批对象就是被审的那一次审核",
      approveResponse.status === 200 && approveResponse.payload?.review?.version === 1,
      approveResponse.status
    );
    const readyHost = await hostCenterOf(fullId);
    check(
      "三个条件同时满足才 ready = true：最新成稿 + 这一版无 RED + 这一版审批通过（§57）",
      readyHost.payload?.ready === true &&
        readyHost.payload?.gate?.ready === true &&
        readyHost.payload?.gate?.approved === true &&
        readyHost.payload?.gate?.publishable === true &&
        readyHost.payload?.gate?.red_count === 0 &&
        readyHost.payload?.gate?.reason === null &&
        readyHost.payload?.gate?.next_action === null,
      readyHost.payload?.gate
    );
    check(
      "发布闸门 spec_ref = §53 / §57 / §62-14（列表 / 中心 / 导出三处只认这一条口径）",
      readyHost.payload?.gate?.spec_ref === GATE_SPEC_REF,
      readyHost.payload?.gate?.spec_ref
    );

    console.log("\n[7] 可交付：两个中心十格全满，导出三套组合都能落地（§51 / §52 / §60）");
    check(
      "闸门通过后主播中心十格全部有正文（present = true / chars > 0 / text 非空）",
      slotsAreFull(readyHost.payload?.slots),
      (readyHost.payload?.slots ?? []).map((slot) => [slot.key, slot.chars])
    );
    check(
      "十格顺序 = §51 原文顺序，标签逐字一致（页面从上到下就是主播上台的顺序）",
      JSON.stringify((readyHost.payload?.slots ?? []).map((slot) => slot.key)) ===
        JSON.stringify(HOST_SLOTS) &&
        JSON.stringify((readyHost.payload?.slots ?? []).map((slot) => slot.label)) ===
          JSON.stringify(HOST_LABELS)
    );
    check(
      "顶部状态条摘要读落库冻结值：成稿版本 / 硬度 / 影响力分数与档位 / Level 5 / 合规风险全部有值",
      readyHost.payload?.copy_version === 1 &&
        readyHost.payload?.intensity === 5 &&
        readyHost.payload?.impact_score > 0 &&
        typeof readyHost.payload?.impact_band_label === "string" &&
        readyHost.payload.impact_band_label.length > 0 &&
        readyHost.payload?.level5_passed === true &&
        readyHost.payload?.compliance_risk !== "RED",
      {
        intensity: readyHost.payload?.intensity,
        score: readyHost.payload?.impact_score,
        band: readyHost.payload?.impact_band_label
      }
    );
    const hostSlots = new Map((readyHost.payload?.slots ?? []).map((slot) => [slot.key, slot]));
    check(
      "「今天必讲 3 点」正好 3 条，且带必讲序号（主播照着念，不用自己挑）",
      (hostSlots.get("must_say_three")?.items ?? []).length === 3 &&
        (hostSlots.get("must_say_three")?.items ?? []).every(
          (item) => item.index > 0 && item.text.trim().length > 0
        )
    );
    check(
      "「5 句金句」正好 5 条（可以单独剪短视频的那五句）",
      (hostSlots.get("core_quotes")?.items ?? []).length === 5
    );
    check(
      "「3 分钟稿」按 §27 八段时序展开：每段都有时间段 + 段名 + 正文 + 这段的要求",
      (hostSlots.get("min3")?.items ?? []).length >= 8 &&
        (hostSlots.get("min3")?.items ?? []).every(
          (item) =>
            typeof item.label === "string" &&
            item.label.trim().length > 0 &&
            item.text.trim().length > 0 &&
            typeof item.detail === "string" &&
            item.detail.trim().length > 0
        ),
      (hostSlots.get("min3")?.items ?? []).length
    );
    check(
      "「异议回答」把「凭什么这么贵」这类问题逐条接住：每条都有标准回答（detail）",
      (hostSlots.get("objections")?.items ?? []).length >= 3 &&
        (hostSlots.get("objections")?.items ?? []).every(
          (item) => item.text.trim().length > 0 && item.detail !== null && item.detail.trim().length > 0
        )
    );
    check(
      "「60 秒稿」有可直接念的整段正文，「产品身份 / 一句话定位」也有首句正文（§51）",
      typeof hostSlots.get("sec60")?.text === "string" &&
        hostSlots.get("sec60").text.length > 0 &&
        (hostSlots.get("product_identity")?.text ?? "").length > 0 &&
        (hostSlots.get("one_liner")?.text ?? "").length > 0
    );
    check(
      "产品结构与配方哲学直接给可念原文（谁负责骨架 / 按什么思路设计，§5 / §6 / §45 / §46）",
      (hostSlots.get("product_structure")?.text ?? "").length > 0 &&
        (hostSlots.get("formula_philosophy")?.text ?? "").length > 0
    );
    check(
      "每一格的 tone 都是 ok（有内容就是绿灯，配色由 API 下发）",
      (readyHost.payload?.slots ?? []).every((slot) => slot.tone === "ok")
    );

    const readyDealer = await dealerCenterOf(fullId);
    check(
      "经销商中心同样十格全满，且与主播中心指向同一版成稿、同一条闸门（§53）",
      readyDealer.status === 200 &&
        slotsAreFull(readyDealer.payload?.slots) &&
        readyDealer.payload?.copy_record_id === copyId &&
        readyDealer.payload?.gate?.ready === true &&
        readyDealer.payload?.spec_ref === DEALER_SPEC_REF,
      { status: readyDealer.status, spec_ref: readyDealer.payload?.spec_ref }
    );
    const dealerSlots = new Map((readyDealer.payload?.slots ?? []).map((slot) => [slot.key, slot]));
    check(
      "经销商十项顺序与标签逐字照抄 §52（第 4 项是「同赛道市场认知」、第 5 项是「主要锚点」）",
      JSON.stringify((readyDealer.payload?.slots ?? []).map((slot) => slot.key)) ===
        JSON.stringify(DEALER_SLOTS) &&
        JSON.stringify((readyDealer.payload?.slots ?? []).map((slot) => slot.label)) ===
          JSON.stringify(DEALER_LABELS)
    );
    check(
      "「同赛道市场认知」带使用纪律：只引用价格高度标准，不搬运对标产品事实（§62-5）",
      (dealerSlots.get("market_cognition")?.lines ?? []).some((line) => line.includes("使用纪律"))
    );
    check(
      "「核心卖点」逐条编号，「常见问题」每条都有标准回答（终端可以直接照着讲）",
      (dealerSlots.get("selling_points")?.items ?? []).length >= 3 &&
        (dealerSlots.get("faq")?.items ?? []).every(
          (item) => item.text.trim().length > 0 && item.detail !== null && item.detail.trim().length > 0
        )
    );
    check(
      "「如何介绍」与「消费人群」都给整段正文（先讲定位、再讲结构、最后讲怎么卖）",
      (dealerSlots.get("how_to_introduce")?.text ?? "").length > 0 &&
        (dealerSlots.get("consumer")?.text ?? "").length > 0
    );

    const exportAll = await exportOf(fullId);
    check("可交付时导出（默认 markdown + all）返回 200", exportAll.status === 200, exportAll.status);
    const exportBody = exportAll.payload;
    check(
      "导出文件名 = 产品名_最终资料包_v{成稿版本}.md（§60）",
      exportBody?.filename === "龙德记六星孔雀_最终资料包_v1.md",
      exportBody?.filename
    );
    check(
      "导出正文同时含两个中心的分区标题与十项小标题（Markdown 层级）",
      exportBody?.content?.includes("## 主播中心（§51 十项）") === true &&
        exportBody?.content?.includes("## 经销商中心（§52 十项）") === true &&
        HOST_LABELS.every((label) => exportBody.content.includes(`### ${label}`)) &&
        DEALER_LABELS.every((label) => exportBody.content.includes(`### ${label}`))
    );
    check(
      "导出正文自带「成稿版本 / 第几次审核 / 导出时间」与「不含任何新事实」的声明（§53 / §62-15）",
      exportBody?.content?.includes("成稿版本：v1") === true &&
        exportBody?.content?.includes("事实审核：第 1 次") === true &&
        exportBody?.content?.includes("导出时间：") === true &&
        exportBody?.content?.includes("不含任何新事实") === true
    );
    check(
      "导出的 chars 与正文逐字一致，且 content_type / review_version / gate.ready 都正确",
      exportBody?.chars === exportBody?.content?.length &&
        exportBody?.content_type === "text/markdown; charset=utf-8" &&
        exportBody?.review_version === 1 &&
        exportBody?.gate?.ready === true &&
        exportBody?.copy_record_id === copyId &&
        exportBody?.spec_ref === SPEC_REF,
      { chars: exportBody?.chars, length: exportBody?.content?.length }
    );
    check(
      "导出生成时间可解析（前端据此显示「导出于 …」）",
      typeof exportBody?.generated_at === "string" &&
        !Number.isNaN(Date.parse(exportBody.generated_at))
    );

    const exportTextHost = await exportOf(fullId, "?format=text&scope=host");
    check(
      "纯文本 + 只要主播：文件名 …_主播中心_v1.txt，正文里没有 Markdown 符号（直接进提词器）",
      exportTextHost.status === 200 &&
        exportTextHost.payload?.filename === "龙德记六星孔雀_主播中心_v1.txt" &&
        exportTextHost.payload?.content?.includes("#") === false &&
        exportTextHost.payload?.content?.includes("**") === false &&
        exportTextHost.payload?.content_type === "text/plain; charset=utf-8",
      exportTextHost.payload?.filename
    );
    check(
      "只要主播那一份不会混进经销商内容（两个范围不会互相串内容）",
      exportTextHost.payload?.content?.includes("【主播中心（§51 十项）】") === true &&
        exportTextHost.payload?.content?.includes("经销商中心") === false
    );

    const exportDealer = await exportOf(fullId, "?scope=dealer");
    check(
      "只要经销商：Markdown 里只有经销商分区，主播分区不出现（文件名 …_经销商中心_v1.md）",
      exportDealer.status === 200 &&
        exportDealer.payload?.filename === "龙德记六星孔雀_经销商中心_v1.md" &&
        exportDealer.payload?.content?.includes("## 经销商中心（§52 十项）") === true &&
        exportDealer.payload?.content?.includes("## 主播中心") === false
    );
    check(
      "两种格式 / 三种范围的组合全部可枚举（2 × 3 = 6 种都返回 200）",
      (
        await Promise.all(
          [
            ["markdown", "host"],
            ["markdown", "dealer"],
            ["markdown", "all"],
            ["text", "host"],
            ["text", "dealer"],
            ["text", "all"]
          ].map(([format, scope]) => exportOf(fullId, `?format=${format}&scope=${scope}`))
        )
      ).every((item) => item.status === 200)
    );
    check(
      "导出参数大小写敏感 + strict 校验：format=Markdown / scope=HOST / 多余字段一律 400（§60）",
      (await exportOf(fullId, "?format=Markdown")).status === 400 &&
        (await exportOf(fullId, "?scope=HOST")).status === 400 &&
        (await exportOf(fullId, "?format=pdf")).status === 400 &&
        (await exportOf(fullId, "?format=markdown&download=1")).status === 400
    );
    check(
      "导出是只读派生：同一版成稿连读两次，除「导出时间」外逐字相同（不落库、不改写正文，§62-15）",
      withoutExportTime((await exportOf(fullId)).payload?.content) === withoutExportTime(exportBody?.content) &&
        (await exportOf(fullId)).payload?.chars === exportBody?.chars
    );

    console.log("\n[8] 假绿灯防线：新生成一版就立刻回到「待事实审核」（§53 / §62-14）");
    const secondCopy = await generateCopy(fullId, { intensity: 5, notes: "冒烟：可交付后再生成一版" });
    check(
      "同一产品再生成一版：版本号递增到 v2，历史版本不被覆盖（§62-15）",
      secondCopy.status === 201 && secondCopy.payload?.version === 2,
      secondCopy.payload?.version
    );
    const regressedHost = await hostCenterOf(fullId);
    check(
      "v2 还没审：闸门立刻回到「待事实审核」，上一版审批通过不算数（§53）",
      regressedHost.payload?.copy_version === 2 &&
        regressedHost.payload?.gate?.review_version === null &&
        regressedHost.payload?.gate?.ready === false &&
        regressedHost.payload?.gate?.next_action === "去事实审核" &&
        regressedHost.payload?.gate?.reason?.includes("还没有做过逐句事实审核") === true,
      {
        version: regressedHost.payload?.copy_version,
        review: regressedHost.payload?.gate?.review_version,
        reason: regressedHost.payload?.gate?.reason
      }
    );
    check(
      "假绿灯场景下十格立刻清空：上一版十个格子里的正文一个字都不许留在页面上",
      slotsAreEmpty(regressedHost.payload?.slots) &&
        slotsAreEmpty((await dealerCenterOf(fullId)).payload?.slots)
    );
    const regressedExport = await exportOf(fullId);
    check(
      "假绿灯场景导出 409（details.gate_label = 「待事实审核」），不吐 v1 的旧文件",
      regressedExport.status === 409 &&
        regressedExport.payload?.error?.details?.gate_label === "待事实审核" &&
        regressedExport.payload?.filename === undefined,
      regressedExport.payload?.error?.details?.gate_label
    );

    console.log("\n[9] 被 RED 阻断：审核照跑、正文照拦、审批照拒（§49 / §53）");
    const redId = await createProduct("交付·红线产品", thinProduct("龙德记试样茶·红线"));
    const redCopy = await generateCopy(redId, { intensity: 5, notes: "冒烟：红线样本" });
    check("红线样本先生成一版成稿（201）", redCopy.status === 201, redCopy.status);
    await injectRedSentence(client, redCopy.payload.id, RED_SENTENCE);
    const redReview = await generateReview(redId);
    check("注入红线后送审返回 201（审核对象就是一版冻结的成稿）", redReview.status === 201, redReview.status);
    const redSummary = redReview.payload?.review?.summary;
    check(
      "四条红线全部命中：red >= 4、publishable = false、blocking_sentences 非空（§49 / §53）",
      redSummary?.red >= 4 &&
        redReview.payload?.review?.publishable === false &&
        (redReview.payload?.review?.blocking_sentences ?? []).length >= 4,
      { red: redSummary?.red, blocking: redReview.payload?.review?.blocking_sentences }
    );
    const redHost = await hostCenterOf(redId);
    check(
      "被 RED 阻断时闸门写明「N 条 RED 阻断句」，并指路「去事实审核改稿」（§53 / §57）",
      redHost.payload?.gate?.ready === false &&
        redHost.payload?.gate?.publishable === false &&
        redHost.payload?.gate?.red_count >= 4 &&
        redHost.payload?.gate?.reason?.includes("RED 阻断句") === true &&
        redHost.payload?.gate?.next_action === "去事实审核改稿",
      redHost.payload?.gate?.reason
    );
    check(
      "闸门回传的阻断句清单与审核结论同源（前端直接列出要改哪几句）",
      JSON.stringify(redHost.payload?.gate?.blocking_sentences) ===
        JSON.stringify(redReview.payload?.review?.blocking_sentences)
    );
    check(
      "踩线正文一个字都不许上页面：两个中心十格照样全空（§53）",
      slotsAreEmpty(redHost.payload?.slots) &&
        slotsAreEmpty((await dealerCenterOf(redId)).payload?.slots)
    );
    const redExport = await exportOf(redId);
    check(
      "RED 产品导出 409，details 里带回阻断句与下一步，且不含任何正文",
      redExport.status === 409 &&
        redExport.payload?.error?.details?.gate_label === "被 RED 阻断" &&
        (redExport.payload?.error?.details?.blocking_sentences ?? []).length >= 4 &&
        redExport.payload?.error?.details?.next_action === "去事实审核改稿" &&
        redExport.payload?.content === undefined,
      redExport.payload?.error?.details?.gate_label
    );
    const redApprove = await decide("approve", redId, { note: "冒烟：红线产品不许审批通过" });
    check(
      "存在 RED 时审批接口 400，并把阻断句回给前端（审批闸门不可绕过，§53）",
      redApprove.status === 400 &&
        (redApprove.payload?.error?.details?.blocking_sentences ?? []).length >= 4,
      { status: redApprove.status, code: redApprove.payload?.error?.code }
    );
    check(
      "RED 产品被拒后仍未审批通过：两个中心与导出全部保持不可交付（§57）",
      (await hostCenterOf(redId)).payload?.gate?.approved === false &&
        (await exportOf(redId, "?scope=host")).status === 409
    );

    console.log("\n[10] 跨产品排产列表 / 权限矩阵 / 边界（§31 / §51 / §53 / §57）");

    /**
     * 先把「事实齐备产品」的 v2 审完并审批通过：列表里必须同时存在「可交付」与「不可交付」两类行，
     * 否则排序与三态筛选都无从验证；这一步本身也压了「重生成 → 重审 → 审批」这条主线能走完。
     */
    const v2Review = await generateReview(fullId);
    const v2Gate = (await hostCenterOf(fullId)).payload?.gate;
    check(
      "v2 第二次送审返回 201：审核次数按「同一版成稿」独立计数（v2 的第 1 次），闸门指向 v2 的这次审核",
      v2Review.status === 201 &&
        v2Review.payload?.review?.version === 1 &&
        v2Gate?.copy_version === 2 &&
        v2Gate?.review_version === 1 &&
        v2Gate?.ready === false,
      {
        status: v2Review.status,
        review_version: v2Review.payload?.review?.version,
        gate_review_version: v2Gate?.review_version
      }
    );
    const v2Approve = await decide("approve", fullId, { note: "冒烟：v2 人工复核通过" });
    check(
      "v2 审批通过后产品重新回到可交付（假绿灯修复不是「一票否决到底」，§53）",
      v2Approve.status === 200 &&
        (await hostCenterOf(fullId)).payload?.ready === true &&
        (await hostCenterOf(fullId)).payload?.copy_version === 2,
      { status: v2Approve.status }
    );

    const listAll = await hostListOf();
    check(
      "跨产品列表返回 200，分页字段为 camelCase（page / pageSize / total / totalPages，§31）",
      listAll.status === 200 &&
        listAll.payload?.page === 1 &&
        listAll.payload?.pageSize === 20 &&
        listAll.payload?.total === 3 &&
        listAll.payload?.totalPages === 1,
      {
        status: listAll.status,
        page: listAll.payload?.page,
        pageSize: listAll.payload?.pageSize,
        total: listAll.payload?.total,
        totalPages: listAll.payload?.totalPages
      }
    );
    const listItems = listAll.payload?.items ?? [];
    check(
      "一行 = 一款产品的最新一版成稿（不聚合历史版本），每行都写明自己的 spec_ref",
      listItems.length === 3 &&
        listItems.every(
          (row) =>
            typeof row.product_id === "string" &&
            typeof row.product_name === "string" &&
            row.spec_ref === HOST_SPEC_REF
        ),
      listItems.map((row) => [row.product_name, row.copy_version, row.spec_ref])
    );
    check(
      "可交付的排在最前（主播每天问的是「今天哪几款能上播、哪几款卡住」）",
      listItems[0]?.ready === true &&
        listItems[0]?.product_name === "龙德记六星孔雀" &&
        listItems.slice(1).every((row) => row.ready === false),
      listItems.map((row) => [row.product_name, row.ready])
    );
    const readyRow = listItems[0];
    const readyDetail = (await hostCenterOf(fullId)).payload;
    check(
      "列表行与详情页同源：成稿版本 / ready / approval_status / publishable / red_count / gate_reason 逐字一致（§62-14）",
      readyRow?.copy_record_id === readyDetail?.copy_record_id &&
        readyRow?.copy_version === readyDetail?.copy_version &&
        readyRow?.ready === readyDetail?.ready &&
        readyRow?.approval_status === readyDetail?.gate?.approval_status &&
        readyRow?.publishable === readyDetail?.gate?.publishable &&
        readyRow?.red_count === readyDetail?.gate?.red_count &&
        readyRow?.gate_reason === readyDetail?.gate?.reason,
      { row_reason: readyRow?.gate_reason, detail_reason: readyDetail?.gate?.reason }
    );
    check(
      "列表行自检字段齐全：一句话定位 / 硬度 / 影响力分数与档位 / Level 5 / 合规风险 / 生成时间（§21–§23 / §57）",
      typeof readyRow?.one_liner === "string" &&
        readyRow.one_liner.length > 0 &&
        readyRow?.intensity === readyDetail?.intensity &&
        readyRow?.impact_score === readyDetail?.impact_score &&
        readyRow?.impact_band === readyDetail?.impact_band &&
        readyRow?.level5_passed === true &&
        readyRow?.compliance_passed === true &&
        typeof readyRow?.generated_at === "string" &&
        !Number.isNaN(Date.parse(readyRow.generated_at)),
      {
        intensity: readyRow?.intensity,
        score: readyRow?.impact_score,
        band: readyRow?.impact_band,
        level5: readyRow?.level5_passed
      }
    );
    const blockedRows = listItems.slice(1);
    check(
      "不可交付的行必须写明卡在哪一步（gate_reason 非空），且不会被偷偷标成可交付",
      blockedRows.length === 2 &&
        blockedRows.every(
          (row) => row.ready === false && String(row.gate_reason ?? "").trim().length > 0 && row.publishable !== true
        ),
      blockedRows.map((row) => [row.product_name, row.ready, row.gate_reason])
    );

    const listReady = await hostListOf("?ready=true");
    check(
      "?ready=true 只回可交付的那一款（三态布尔显式分支，不把 false 当「不限」）",
      listReady.status === 200 &&
        listReady.payload?.total === 1 &&
        (listReady.payload?.items ?? []).length === 1 &&
        listReady.payload?.items?.[0]?.product_name === "龙德记六星孔雀" &&
        listReady.payload?.items?.[0]?.ready === true,
      { status: listReady.status, total: listReady.payload?.total }
    );
    const listNotReady = await hostListOf("?ready=false");
    check(
      "?ready=false 回另外两款，且每一行都带中文卡点（主播一眼看到「去干嘛」）",
      listNotReady.status === 200 &&
        listNotReady.payload?.total === 2 &&
        (listNotReady.payload?.items ?? []).length === 2 &&
        listNotReady.payload?.items?.every(
          (row) => row.ready === false && String(row.gate_reason ?? "").trim().length > 0
        ),
      { status: listNotReady.status, total: listNotReady.payload?.total }
    );
    const listPage2 = await hostListOf("?page=2&pageSize=1");
    check(
      "分页只做切片：total / totalPages 按全量重算（3 款 → 3 页 × 1 条），第 2 页拿到第一条卡住的产品",
      listPage2.status === 200 &&
        listPage2.payload?.page === 2 &&
        listPage2.payload?.pageSize === 1 &&
        listPage2.payload?.total === 3 &&
        listPage2.payload?.totalPages === 3 &&
        (listPage2.payload?.items ?? []).length === 1 &&
        listPage2.payload?.items?.[0]?.ready === false,
      {
        page: listPage2.payload?.page,
        total: listPage2.payload?.total,
        totalPages: listPage2.payload?.totalPages
      }
    );
    const listBeyond = await hostListOf("?page=4&pageSize=1");
    check(
      "翻过尾页返回空 items 但 total 仍然正确（前端据此收敛分页器，不无限翻页）",
      listBeyond.status === 200 &&
        (listBeyond.payload?.items ?? []).length === 0 &&
        listBeyond.payload?.total === 3 &&
        listBeyond.payload?.totalPages === 3,
      { total: listBeyond.payload?.total, items: (listBeyond.payload?.items ?? []).length }
    );
    const listSearch = await hostListOf(`?q=${encodeURIComponent("六星孔雀")}`);
    check(
      "跨产品列表能按产品名搜索（§31：主播排产时按名字找茶）",
      listSearch.status === 200 &&
        listSearch.payload?.total === 1 &&
        listSearch.payload?.items?.[0]?.product_name === "龙德记六星孔雀",
      { total: listSearch.payload?.total }
    );
    const listNoMatch = await hostListOf(`?q=${encodeURIComponent("查无此茶")}`);
    check(
      "搜不到就是空列表（total = 0 / totalPages = 0），不是报错、也不是静默回全量",
      listNoMatch.status === 200 &&
        listNoMatch.payload?.total === 0 &&
        listNoMatch.payload?.totalPages === 0 &&
        (listNoMatch.payload?.items ?? []).length === 0
    );
    check(
      "列表查询严格校验：超长搜索词 / pageSize 越界 / page 越界 / 非布尔 ready / 多余字段一律 400（不模糊兜底）",
      (await hostListOf(`?q=${"长".repeat(201)}`)).status === 400 &&
        (await hostListOf("?pageSize=101")).status === 400 &&
        (await hostListOf("?pageSize=0")).status === 400 &&
        (await hostListOf("?page=0")).status === 400 &&
        (await hostListOf("?ready=maybe")).status === 400 &&
        (await hostListOf("?format=markdown")).status === 400
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
      "交付层只读：任何登录角色都能读合同 / 标签 / 列表 / 两个中心 / 导出（闸门与角色无关，§53 / §57）",
      (await request("GET", "/api/delivery/contract", { token: viewerToken })).status === 200 &&
        (await request("GET", "/api/delivery/labels", { token: viewerToken })).status === 200 &&
        (await hostListOf("", viewerToken)).status === 200 &&
        (await hostCenterOf(fullId, viewerToken)).status === 200 &&
        (await dealerCenterOf(fullId, viewerToken)).status === 200 &&
        (await exportOf(fullId, "", viewerToken)).status === 200
    );
    check(
      "只读账号不能生成话术 / 送审 / 审批（403：交付层的「人人可读」不是把写权限一起放开）",
      (await generateCopy(fullId, {}, viewerToken)).status === 403 &&
        (await generateReview(fullId, {}, viewerToken)).status === 403 &&
        (await decide("approve", fullId, {}, viewerToken)).status === 403
    );
    check(
      "只读账号看不可交付的产品：两个中心照样 200、导出照样 409（结论与角色无关）",
      (await hostCenterOf(redId, viewerToken)).status === 200 &&
        (await dealerCenterOf(redId, viewerToken)).status === 200 &&
        (await exportOf(redId, "", viewerToken)).status === 409
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
    const researcherNotReady = (await hostListOf("?ready=false", researcherToken)).payload?.items ?? [];
    check(
      "研究员看到与管理员逐字相同的排产结论（§62-14：跨角色不出现第二套判断）",
      JSON.stringify(researcherNotReady.map((row) => [row.product_id, row.ready, row.gate_reason])) ===
        JSON.stringify(
          (listNotReady.payload?.items ?? []).map((row) => [row.product_id, row.ready, row.gate_reason])
        ),
      researcherNotReady.map((row) => [row.product_name, row.ready])
    );

    const missingExport = await exportOf(missingId);
    check(
      "不存在的产品 / 非 UUID 产品 id：两个中心与导出一律 404（不是 500，也不静默给空壳页面）",
      (await hostCenterOf(missingId)).status === 404 &&
        (await dealerCenterOf(missingId)).status === 404 &&
        missingExport.status === 404 &&
        (await hostCenterOf(notAUuid)).status === 404 &&
        (await dealerCenterOf(notAUuid)).status === 404 &&
        (await exportOf(notAUuid)).status === 404,
      { missing: missingExport.status }
    );
    check(
      "404 由产品装载统一兜住：导出失败时响应里没有 filename / content（不返回半截文件）",
      missingExport.payload?.error?.code === "NOT_FOUND" &&
        missingExport.payload?.filename === undefined &&
        missingExport.payload?.content === undefined &&
        (await exportOf(notAUuid)).payload?.content === undefined
    );

    console.log("\n[99] 清理冒烟数据并校验业务表清零");
  } finally {
    for (const productId of createdProductIds) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `[清理] 删除冒烟产品 ${productId}（级联删除成稿 / 审核结论 / 证据行）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from sources) as sources, (select count(*)::int from market_offers) as offers, (select count(*)::int from comparable_candidates) as candidates, (select count(*)::int from value_anchors) as anchors, (select count(*)::int from category_creator_profiles) as creator_profiles, (select count(*)::int from product_value_codes) as value_profiles, (select count(*)::int from product_architectures) as architectures, (select count(*)::int from formula_philosophies) as philosophies, (select count(*)::int from copy_outputs) as copy_outputs, (select count(*)::int from generated_claims) as generated_claims, (select count(*)::int from claim_evidence) as claim_evidence, (select count(*)::int from value_codes) as value_codes"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：products=${row?.products} · sources=${row?.sources} · market_offers=${row?.offers} · comparable_candidates=${row?.candidates} · value_anchors=${row?.anchors} · category_creator_profiles=${row?.creator_profiles} · product_value_codes=${row?.value_profiles} · product_architectures=${row?.architectures} · formula_philosophies=${row?.philosophies} · copy_outputs=${row?.copy_outputs} · generated_claims=${row?.generated_claims} · claim_evidence=${row?.claim_evidence} · value_codes=${row?.value_codes}`
    );
    check(
      "冒烟结束后业务表清零（只保留 seed 与 16 行 Value Code 字典；交付层是派生视图，不新增任何表）",
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
        row?.generated_claims === 0 &&
        row?.claim_evidence === 0 &&
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
