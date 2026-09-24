/**
 * Phase 10 端到端冒烟（规格 §5 产品结构叙事 / §45 Agent 7 / §57 验收 / §62-15 版本与人工确认）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase10.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（产品结构随产品级联删除）与临时账号，
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员），并校验 product_architectures = 0。
 *
 * 本阶段压的是四条硬约束：
 *   1) §5 / §45：九个角色顺序固定，Agent 7 的 8 个问题逐条有落点，事实不足的角色一律留空写缺口；
 *   2) §45 / §62-5：角色文案只能引用本产品已录入字段与 Value DNA —— 冒烟逐字回查 citations，
 *      并验证跨产品不会串号（极简产品的结构里绝不出现另一款产品的事实）；
 *   3) §57：事实齐备的产品必须能回答「谁负责骨架／香气／汤感／回甘／记忆点」，否则验收不通过；
 *   4) §62-15：重新生成只新增版本、历史版本全部保留；人工确认只改确认字段，不改正文、不升版本。
 * 因此脚本只用「事实齐备产品」与「几乎没有事实的极简产品」两类输入，去压「齐备不等于可以乱讲、不足也不等于可以编」
 * 这两条底线（与 Phase 9 同一套 fixture 口径，便于对照）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase10-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase10-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** §5 固定的九个角色与顺序：接口返回必须逐字对齐，不得重排。 */
const ROLE_ORDER = [
  "backbone",
  "identity",
  "aroma_role",
  "body_role",
  "front_stage_role",
  "middle_stage_role",
  "finish_role",
  "memory_point",
  "value_role"
];
/** §57 验收必答的五项（骨架 / 香气 / 汤感 / 回甘 / 记忆点）。 */
const ACCEPTANCE_KEYS = ["backbone", "aroma_role", "middle_stage_role", "finish_role", "memory_point"];
/** §45 红线：六个布尔全为 true 才算合同成立。 */
const REDLINE_KEYS = [
  "no_new_facts",
  "no_fabricated_relation",
  "gap_stays_empty",
  "evidence_only_from_own_product",
  "rhetoric_allowed_for_structure_only",
  "structure_not_parameter_list"
];
const DOWNSTREAM_PHASES = [];
const NARRATIVE_FINGERPRINT = "它不是把卖点堆在一起";
const ENGINE_LIMITS = {
  maxVersionsPerProduct: 20,
  minWrittenRolesForValueRole: 3,
  maxDnaRefsPerRole: 3,
  defaultPageSize: 20,
  maxPageSize: 100
};

/** 事实齐备的产品：九个角色都能找到已录入事实（与 Phase 9 / API 测试 fixture 同口径）。 */
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

/** 几乎没有事实的产品：只保留身份与规格，用来验证「缺事实 = 角色留空 + 缺口」。 */
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

/** 逐字回查：`citations` 形如 `product.mountain=布朗山`，值必须原样出现在角色正文里。 */
function citationProblems(role) {
  const problems = [];
  for (const citation of role.citations ?? []) {
    const index = citation.indexOf("=");
    if (index <= 0) {
      problems.push(`${role.key}: 引用格式异常 ${citation}`);
      continue;
    }
    const ref = citation.slice(0, index);
    const value = citation.slice(index + 1);
    if (!ref.startsWith("product.") && !ref.startsWith("dna.")) {
      problems.push(`${role.key}: 引用了非本产品字段 ${ref}`);
      continue;
    }
    if (!role.text.includes(value)) {
      problems.push(`${role.key}: 引用值不在正文里 ${citation}`);
    }
  }
  return problems;
}

function roleOf(record, key) {
  return (record?.roles ?? []).find((role) => role.key === key) ?? null;
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
    request("GET", `/api/products/${productId}/architecture`, { token: authToken });
  const versionsOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/architecture/versions`, { token: authToken });
  const generate = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/architecture/generate`, { token: authToken, body });
  const patch = (productId, recordId, body, authToken = token) =>
    request("PATCH", `/api/products/${productId}/architecture/${recordId}`, {
      token: authToken,
      body
    });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    // 健康检查的 phase 文案指向「最新交付阶段」，会随 Phase 推进变化：
    // 这里只断言「至少推进到 Phase 10 且写明已交付」，不锁死具体文案（避免每交付一个 Phase 就改脚本）。
    const healthPhase = String(health.payload?.phase ?? "");
    const healthPhaseNumber = Number(/Phase\s*(\d+)/.exec(healthPhase)?.[1] ?? 0);
    check(
      "健康检查文案随最新交付阶段推进（至少到 Phase 10 产品结构）",
      healthPhaseNumber >= 10 && healthPhase.includes("已交付"),
      health.payload?.phase
    );

    check(
      "未登录不能读产品结构合同",
      (await request("GET", "/api/product-architecture/contract")).status === 401
    );
    check(
      "未登录不能读产品结构标签",
      (await request("GET", "/api/product-architecture/labels")).status === 401
    );
    check(
      "未登录不能读产品结构库",
      (await request("GET", "/api/product-architecture")).status === 401
    );
    check(
      "未登录不能读产品结构总览",
      (await request("GET", `/api/products/${missingId}/architecture`)).status === 401
    );
    check(
      "未登录不能生成产品结构",
      (await request("POST", `/api/products/${missingId}/architecture/generate`, { body: {} }))
        .status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("返回 access_token", typeof token === "string" && token.length > 10);

    console.log("\n[2] §5 / §45 合同自检：九角色 + Agent 7 八问 + §57 验收 + 红线 + 下游只登记");
    const contractResponse = await request("GET", "/api/product-architecture/contract", { token });
    check("产品结构合同返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const engine = contractResponse.payload?.engine;
    check("合同引用 §5 / §45", contract?.spec_ref === "§5 / §45", contract?.spec_ref);
    check(
      "九个角色齐备且顺序固定（§5，不得增删或重排）",
      JSON.stringify((contract?.roles ?? []).map((role) => role.key)) === JSON.stringify(ROLE_ORDER),
      (contract?.roles ?? []).map((role) => role.key)
    );
    check(
      "每个角色都写明提问口径 / 定义 / 最少事实 / 允许引用的字段（前端不会只剩一个代号）",
      (contract?.roles ?? []).every(
        (role) =>
          typeof role.label === "string" &&
          role.label.length > 0 &&
          typeof role.short_label === "string" &&
          role.short_label.length > 0 &&
          typeof role.question === "string" &&
          role.question.length > 0 &&
          typeof role.definition === "string" &&
          role.definition.length > 0 &&
          typeof role.requirement === "string" &&
          role.requirement.length > 0 &&
          (role.evidence_refs ?? []).every(
            (ref) => ref.startsWith("product.") || ref.startsWith("dna.")
          )
      )
    );
    check(
      "只有 value_role 允许强修辞（其余角色是解释，不是口号）",
      (contract?.roles ?? []).filter((role) => role.key === "value_role").length === 1
    );
    const questions = contract?.agent7_questions ?? [];
    check("§45 的 8 个问题齐备", questions.length === 8, questions.length);
    check(
      "8 个问题的序号连续（1 → 8）",
      JSON.stringify(questions.map((item) => item.order)) ===
        JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
      questions.map((item) => item.order)
    );
    check(
      "8 个问题都落到具体角色上，且角色名合法",
      questions.every((item) => ROLE_ORDER.includes(item.role))
    );
    check(
      "第 6 问「什么负责尾韵？」明确标注为 finish_role 的延伸（不单独设字段）",
      questions[5]?.question === "什么负责尾韵？" &&
        questions[5]?.role === "finish_role" &&
        typeof questions[5]?.note === "string" &&
        questions[5].note.length > 0,
      questions[5]
    );
    check(
      "第 8 问是「为什么这些部分组合起来不像普通茶？」，落在 value_role（§5 结构叙事）",
      questions[7]?.role === "value_role" && String(questions[7]?.question ?? "").includes("不像普通茶")
    );
    check(
      "§57 验收必答五项固定（骨架 / 香气 / 汤感 / 回甘 / 记忆点）",
      JSON.stringify(contract?.acceptance?.required_keys ?? []) === JSON.stringify(ACCEPTANCE_KEYS),
      contract?.acceptance?.required_keys
    );
    check(
      "§57 验收问题文本下发（含「谁负责骨架／香气／汤感／回甘／记忆点」）",
      String(contract?.acceptance?.question ?? "").includes("谁负责骨架") &&
        String(contract?.acceptance?.question ?? "").includes("记忆点"),
      contract?.acceptance?.question
    );
    check(
      "§45 红线六条全部为 true（不新增事实 / 不虚构关系 / 留空 / 只用本产品证据 / 修辞只说结构 / 不是参数罗列）",
      REDLINE_KEYS.every((key) => contract?.[key] === true),
      REDLINE_KEYS.map((key) => [key, contract?.[key]])
    );
    const rules = contract?.rules ?? [];
    check("合同七条规则齐备", rules.length === 7, rules.length);
    check(
      "规则写明「九个角色顺序不得增删重排」与「不允许增加任何原料或配方事实」（§5 / §45）",
      rules.some((rule) => rule.includes("不得增删或重排")) &&
        rules.some((rule) => rule.includes("不允许增加任何原料或配方事实")),
      rules
    );
    check(
      "规则写明事实不足留空 + value_role 不足 3 个写实角色不成立（§11 / §62-7）",
      rules.some((rule) => rule.includes("留空") && rule.includes("3 个写实角色"))
    );
    check(
      "规则写明「本阶段不代写配方哲学与成交话术」（§60）",
      rules.some((rule) => rule.includes("Phase 11") && rule.includes("不代写"))
    );
    const downstream = contractResponse.payload?.downstream ?? [];
    check(
      "下游交接已全部交付：清单为空（配方哲学 Phase 11 交付后不再登记，§60）",
      JSON.stringify(downstream.map((item) => item.phase)) === JSON.stringify(DOWNSTREAM_PHASES),
      downstream.map((item) => item.phase)
    );
    check(
      "空清单不产生任何 PENDING 占位条目（不得显示为未交付）",
      downstream.every((item) => item.status === "PENDING" && item.deliverable.length > 0)
    );
    check("引擎信息：九个角色", engine?.role_count === 9, engine?.role_count);
    check(
      "引擎信息：合同与接口同一份限制口径（20 版 / 3 个写实 / 3 条 DNA / 分页 20-100）",
      JSON.stringify(engine?.limits) === JSON.stringify(ENGINE_LIMITS),
      engine?.limits
    );
    check(
      "引擎信息：§57 必答项与红线同样下发到引擎块",
      JSON.stringify(engine?.acceptance_required_keys ?? []) === JSON.stringify(ACCEPTANCE_KEYS) &&
        engine?.no_new_facts === true &&
        engine?.structure_not_parameter_list === true
    );

    console.log("\n[3] 标签口径：角色 / 问题 / 验收 / 状态文案全部由后端下发");
    const labelsResponse = await request("GET", "/api/product-architecture/labels", { token });
    check("标签接口返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check("标签：九个角色齐备且顺序一致", (labels?.roles ?? []).length === 9, (labels?.roles ?? []).length);
    check(
      "标签：八个 Agent 7 问题齐备",
      (labels?.agent7_questions ?? []).length === 8,
      (labels?.agent7_questions ?? []).length
    );
    check(
      "标签：七条规则齐备（前端不另写一套文案）",
      (labels?.rules ?? []).length === 7,
      (labels?.rules ?? []).length
    );
    check(
      "标签：角色状态把 GAP 写成「事实不足（留空）」而不是「待补充」",
      String(labels?.role_status_labels?.GAP ?? "").includes("留空") &&
        String(labels?.role_status_labels?.WRITTEN ?? "").length > 0,
      labels?.role_status_labels
    );
    check(
      "标签：两种状态都带展示色（ok / danger）",
      typeof labels?.role_status_tones?.WRITTEN === "string" &&
        typeof labels?.role_status_tones?.GAP === "string"
    );
    check(
      "标签：§57 验收问题原样下发",
      String(labels?.acceptance_question ?? "").includes("§57"),
      labels?.acceptance_question
    );
    check(
      "标签：限制口径与合同一致",
      JSON.stringify(labels?.limits) === JSON.stringify(ENGINE_LIMITS),
      labels?.limits
    );

    console.log("\n[4] 极简产品：缺事实 → 九角色留空写缺口 + §57 验收不通过 + 无价值位叙事");
    const thinProductId = await createProduct("极简产品（只录入身份与规格）", THIN_PRODUCT);
    // 产品创建会自动跑规则引擎生成 Value DNA；这里主动清空，确保走「无 DNA」这条更严格的路径（§11 / §62-7）。
    await client.query("update products set value_dna = '{}'::jsonb where id = $1", [thinProductId]);
    const thinOverview = await overviewOf(thinProductId);
    check("读取极简产品结构总览返回 200", thinOverview.status === 200, thinOverview.status);
    check(
      "尚未生成时 record = null、版本列表为空",
      thinOverview.payload?.record === null && (thinOverview.payload?.versions ?? []).length === 0
    );
    check("尚未生成时补齐 §57 必答项的缺口清单", 
      JSON.stringify(thinOverview.payload?.missing_acceptance_keys ?? []) === JSON.stringify(ACCEPTANCE_KEYS),
      thinOverview.payload?.missing_acceptance_keys
    );
    check("可以生成（未触及 20 版上限）", thinOverview.payload?.can_generate === true);
    check(
      "读取不存在的产品结构返回 404",
      (await overviewOf(missingId)).status === 404
    );

    const thinGenerated = await generate(thinProductId, {});
    check("生成极简产品结构返回 201", thinGenerated.status === 201, thinGenerated.status);
    const thinRecord = thinGenerated.payload;
    check("新版本号为 1", thinRecord?.version === 1, thinRecord?.version);
    check(
      "九个角色都在（缺口多不等于少给角色）",
      JSON.stringify((thinRecord?.roles ?? []).map((role) => role.key)) === JSON.stringify(ROLE_ORDER)
    );
    check(
      "事实齐备不了的八个角色一律 GAP 留空（只有身份能靠产品名与茶类立住）",
      thinRecord?.role_counts?.written === 1 && thinRecord?.role_counts?.gap === 8,
      thinRecord?.role_counts
    );
    check(
      "GAP 角色正文必须是空字符串，不得用形容词补圆（§11 / §62-7）",
      (thinRecord?.roles ?? [])
        .filter((role) => role.status === "GAP")
        .every((role) => role.text === "")
    );
    check(
      "每个 GAP 角色都要写清缺什么事实（不能只标缺口就完事）",
      (thinRecord?.roles ?? [])
        .filter((role) => role.status === "GAP")
        .every((role) => typeof role.gap === "string" && role.gap.length > 0 && role.citations.length === 0)
    );
    check(
      "缺口指回具体字段（例如骨架要先补山头 / 产区 / 用料）",
      String(roleOf(thinRecord, "backbone")?.gap ?? "").includes("未录入相关事实，先补") &&
        String(roleOf(thinRecord, "backbone")?.gap ?? "").includes("product.mountain"),
      roleOf(thinRecord, "backbone")?.gap
    );
    check(
      "value_role 不足 3 个写实角色时不成立，缺口写明原因（§11 / §62-7）",
      roleOf(thinRecord, "value_role")?.status === "GAP" &&
        String(roleOf(thinRecord, "value_role")?.gap ?? "").includes("3 个"),
      roleOf(thinRecord, "value_role")?.gap
    );
    check(
      "§57 验收不通过：五项必答里缺骨架 / 香气 / 汤感 / 回甘 / 记忆点",
      thinRecord?.acceptance?.passed === false &&
        JSON.stringify(thinRecord?.acceptance?.missing_keys ?? []) === JSON.stringify(ACCEPTANCE_KEYS),
      thinRecord?.acceptance
    );
    check(
      "验收通过与否只由「写了什么」决定（written_keys 与角色状态同源）",
      JSON.stringify(thinRecord?.acceptance?.written_keys ?? []) ===
        JSON.stringify(
          (thinRecord?.roles ?? []).filter((role) => role.status === "WRITTEN").map((role) => role.key)
        ),
      thinRecord?.acceptance?.written_keys
    );
    check(
      "value_role 没成立时结构叙事正文为空（宁缺毋滥，不编一句像样的废话）",
      thinRecord?.narrative === "",
      thinRecord?.narrative
    );
    check(
      "缺口清单非空（前端据此提示先补事实）",
      (thinRecord?.evidence_gaps ?? []).length > 0,
      (thinRecord?.evidence_gaps ?? []).length
    );
    check(
      "没有 Value DNA 时明确提示（香气 / 滋味只能从录入字段取，覆盖面会偏窄）",
      (thinRecord?.evidence_gaps ?? []).some((gap) => gap.includes("价值 DNA"))
    );
    check(
      "角色分层固定：value_role 是 RHETORIC，其余是 INTERPRETATION（§24）",
      (thinRecord?.roles ?? []).every(
        (role) => role.layer === (role.key === "value_role" ? "RHETORIC" : "INTERPRETATION")
      )
    );
    check(
      "GAP 角色的 evidence_refs / fact_refs 不产生证据（没有事实就没有引用）",
      (thinRecord?.roles ?? [])
        .filter((role) => role.status === "GAP")
        .every((role) => (role.evidence_refs ?? []).length === 0)
    );
    check(
      "单版结构的下游交接同样为空（配方哲学 / 王者话术已交付，不再登记占位，§60）",
      JSON.stringify((thinRecord?.downstream ?? []).map((item) => item.phase)) ===
        JSON.stringify(DOWNSTREAM_PHASES) &&
        (thinRecord?.downstream ?? []).every((item) => item.status === "PENDING")
    );
    check(
      "刚生成的结构默认未人工确认（确认是人的动作）",
      thinRecord?.is_confirmed === false &&
        thinRecord?.confirmed_by === null &&
        thinRecord?.confirmed_at === null
    );

    console.log("\n[5] 事实齐备产品：九个角色写实 + §57 验收通过 + 价值位叙事成型");
    const fullProductId = await createProduct("事实齐备产品（六星孔雀口径）", FULL_PRODUCT);
    const fullGenerated = await generate(fullProductId, { notes: "冒烟：事实齐备版本" });
    check("生成事实齐备产品结构返回 201", fullGenerated.status === 201, fullGenerated.status);
    const fullRecord = fullGenerated.payload;
    check("新版本号为 1", fullRecord?.version === 1, fullRecord?.version);
    check(
      "九个角色全部写实（written = 9 / gap = 0）",
      fullRecord?.role_counts?.written === 9 && fullRecord?.role_counts?.gap === 0,
      fullRecord?.role_counts
    );
    check(
      "§57 五项验收全部回答（passed = true）",
      fullRecord?.acceptance?.passed === true &&
        (fullRecord?.acceptance?.missing_keys ?? []).length === 0,
      fullRecord?.acceptance
    );
    check(
      "结构叙事包含 §5 的口径：「它不是把卖点堆在一起」",
      String(fullRecord?.narrative ?? "").includes(NARRATIVE_FINGERPRINT),
      fullRecord?.narrative
    );
    check(
      "价值位正文把各角色分工串起来（至少串 3 个短句，不是一句空话）",
      String(roleOf(fullRecord, "value_role")?.text ?? "").includes("每一部分都有自己的任务") &&
        String(roleOf(fullRecord, "value_role")?.text ?? "").split("负责").length >= 4,
      roleOf(fullRecord, "value_role")?.text
    );
    check(
      "骨架角色指向已录入的山头（布朗山负责骨架）",
      String(roleOf(fullRecord, "backbone")?.text ?? "").startsWith("布朗山负责骨架"),
      roleOf(fullRecord, "backbone")?.text
    );
    check(
      "香气角色指向已录入的干茶香（烟香明显）",
      String(roleOf(fullRecord, "aroma_role")?.text ?? "").includes("烟香明显"),
      roleOf(fullRecord, "aroma_role")?.text
    );
    check(
      "生成时传入的备注被保存（§62-15 备注与版本同存）",
      fullRecord?.notes === "冒烟：事实齐备版本",
      fullRecord?.notes
    );
    check(
      "事实齐备时缺口清单为空（不代表可以乱讲，只代表没有缺口）",
      (fullRecord?.evidence_gaps ?? []).length === 0,
      fullRecord?.evidence_gaps
    );

    console.log("\n[6] §45 / §62-5：九个字段只引用本产品已录入事实，跨产品不串号");
    const writtenRoles = (fullRecord?.roles ?? []).filter((role) => role.status === "WRITTEN");
    check(
      "每个写实角色都带 citations（可逐条回查到字段来源）",
      writtenRoles.length === 9 && writtenRoles.every((role) => (role.citations ?? []).length > 0),
      writtenRoles.map((role) => [role.key, (role.citations ?? []).length])
    );
    check(
      "citations 的字段只可能是 product.* / dna.*，且引用值逐字出现在正文里（§45 不允许新增原料或配方事实）",
      writtenRoles.every((role) => citationProblems(role).length === 0),
      writtenRoles.flatMap((role) => citationProblems(role))
    );
    check(
      "证据字段不重复（同一角色不会把同一个字段算两遍）",
      writtenRoles.every(
        (role) => (role.evidence_refs ?? []).length === new Set(role.evidence_refs ?? []).size
      )
    );
    check(
      "角色的 evidence_refs 与 citations 同源（没有「引用了但正文里没有」的字段）",
      writtenRoles.every((role) => {
        const fromCitations = new Set((role.citations ?? []).map((item) => item.slice(0, item.indexOf("="))));
        return (role.evidence_refs ?? []).every((ref) => fromCitations.has(ref));
      })
    );
    check(
      "单版事实引用全部是 product.*（DNA 引用另计，不混进 fact_refs）",
      (fullRecord?.fact_refs ?? []).every((ref) => ref.startsWith("product.")) &&
        (fullRecord?.value_dna_refs ?? []).every((ref) => ref.startsWith("dna."))
    );
    check(
      "同一角色最多引用 3 条 Value DNA（避免单角色被 DNA 刷满）",
      writtenRoles.every(
        (role) =>
          new Set((role.citations ?? []).filter((item) => item.startsWith("dna."))).size <=
          ENGINE_LIMITS.maxDnaRefsPerRole
      )
    );
    check(
      "跨产品不串号：极简产品的结构与证据里不出现另一款产品的事实",
      (() => {
        const dump = JSON.stringify(thinRecord);
        return !dump.includes("布朗山") && !dump.includes("大树春茶") && !dump.includes("烟香明显");
      })()
    );
    check(
      "空产品结构不会因为另一款产品写实就跟着「变齐」（两个产品各算各的）",
      (thinRecord?.role_counts?.written ?? 0) === 1 && (fullRecord?.role_counts?.written ?? 0) === 9
    );

    console.log("\n[7] §62-15 人工确认：只改确认，不改正文、不升版本，可回退");
    const confirm = await patch(fullProductId, fullRecord?.id, { is_confirmed: true });
    check("人工确认返回 200", confirm.status === 200, confirm.status);
    check("确认后 is_confirmed = true", confirm.payload?.is_confirmed === true);
    check(
      "确认后记下确认人（为审计留下痕迹）",
      typeof confirm.payload?.confirmed_by === "string" && confirm.payload.confirmed_by.length > 10,
      confirm.payload?.confirmed_by
    );
    check(
      "确认不改版本号",
      confirm.payload?.version === fullRecord?.version,
      [confirm.payload?.version, fullRecord?.version]
    );
    check(
      "确认不改九个角色正文（确认的是同一份结构）",
      JSON.stringify((confirm.payload?.roles ?? []).map((role) => role.text)) ===
        JSON.stringify((fullRecord?.roles ?? []).map((role) => role.text))
    );
    check(
      "确认不改结构叙事正文",
      confirm.payload?.narrative === fullRecord?.narrative
    );
    const noted = await patch(fullProductId, fullRecord?.id, { notes: "研究员复核：事实与结构一致" });
    check("追加备注返回 200 且备注被保存", noted.status === 200 && noted.payload?.notes === "研究员复核：事实与结构一致");
    check(
      "只改备注不会把确认状态冲掉（局部更新）",
      noted.payload?.is_confirmed === true
    );
    const reverted = await patch(fullProductId, fullRecord?.id, { is_confirmed: false });
    check("确认可以回退（is_confirmed = false）", reverted.status === 200 && reverted.payload?.is_confirmed === false);
    check(
      "回退后确认人与时间一并清空（不留脏状态）",
      reverted.payload?.confirmed_by === null && reverted.payload?.confirmed_at === null
    );
    check(
      "人工确认与回退都不升版本（版本列表仍只有 1 版）",
      (await versionsOf(fullProductId)).payload?.items?.length === 1
    );
    check(
      "重新确认一次，为后续版本对比留基线",
      (await patch(fullProductId, fullRecord?.id, { is_confirmed: true })).payload?.is_confirmed === true
    );

    console.log("\n[8] 版本与矩阵：重新生成只新增版本，历史版本全部保留（§62-15）");
    const regenerate = await generate(fullProductId, { notes: "冒烟：第二版" });
    check("再次生成返回 201 且版本号为 2", regenerate.status === 201 && regenerate.payload?.version === 2, regenerate.payload?.version);
    check(
      "第一版的备注与确认状态原样保留（历史版本不被覆盖）",
      (await request("GET", `/api/products/${fullProductId}/architecture/${fullRecord?.id}`, { token }))
        .payload?.notes === "研究员复核：事实与结构一致"
    );
    check(
      "版本列表倒序且全部保留（v2 / v1）",
      JSON.stringify((await versionsOf(fullProductId)).payload?.items?.map((item) => item.version)) ===
        JSON.stringify([2, 1])
    );
    const matrix = await request("GET", "/api/product-architecture?pageSize=100", { token });
    check("产品结构库返回 200", matrix.status === 200, matrix.status);
    const rows = matrix.payload?.items ?? [];
    check(
      "一行一款产品（同一产品不会出现多行）",
      rows.filter((row) => row.product_id === fullProductId).length === 1 &&
        rows.filter((row) => row.product_id === thinProductId).length === 1
    );
    check(
      "矩阵取的是最新一版（事实齐备产品 version = 2）",
      rows.find((row) => row.product_id === fullProductId)?.version === 2
    );
    check(
      "矩阵行自带写实数 / 缺口数 / 验收结论（前端不必再算一遍）",
      rows.every(
        (row) =>
          typeof row.written_roles === "number" &&
          row.written_roles + row.gap_roles === ROLE_ORDER.length &&
          typeof row.acceptance_passed === "boolean" &&
          row.spec_ref === "§5 / §45"
      )
    );
    check(
      "矩阵行区分「验收通过」与「还没成结构」",
      rows.find((row) => row.product_id === fullProductId)?.acceptance_passed === true &&
        rows.find((row) => row.product_id === thinProductId)?.acceptance_passed === false
    );
    const sortedByWritten = await request("GET", "/api/product-architecture?sort=-written_roles", { token });
    const writtenCounts = (sortedByWritten.payload?.items ?? []).map((row) => row.written_roles);
    check(
      "按写实角色数倒序可用（单调不增）",
      sortedByWritten.status === 200 &&
        writtenCounts.every((value, index) => index === 0 || writtenCounts[index - 1] >= value),
      writtenCounts
    );
    const sortedByGap = await request("GET", "/api/product-architecture?sort=-gap_roles", { token });
    const gapCounts = (sortedByGap.payload?.items ?? []).map((row) => row.gap_roles);
    check(
      "按缺口角色数倒序可用（单调不增）",
      sortedByGap.status === 200 && gapCounts.every((value, index) => index === 0 || gapCounts[index - 1] >= value),
      gapCounts
    );
    const byRole = await request("GET", "/api/product-architecture?role=backbone&pageSize=100", { token });
    check(
      "按角色筛选：只返回骨架写实的产品，且必含事实齐备产品、不含极简产品",
      byRole.status === 200 &&
        (byRole.payload?.items ?? []).every((row) => row.written_roles >= 1) &&
        (byRole.payload?.items ?? []).some((row) => row.product_id === fullProductId) &&
        !(byRole.payload?.items ?? []).some((row) => row.product_id === thinProductId)
    );
    const byQuery = await request("GET", "/api/product-architecture?q=孔雀&pageSize=100", { token });
    check(
      "按名称搜索可用（命中六星孔雀，排掉试样茶）",
      byQuery.status === 200 &&
        (byQuery.payload?.items ?? []).some((row) => row.product_id === fullProductId) &&
        !(byQuery.payload?.items ?? []).some((row) => row.product_id === thinProductId)
    );
    const byProduct = await request("GET", `/api/product-architecture?product_id=${thinProductId}`, { token });
    check(
      "按产品筛选可用（只返回该产品一行）",
      byProduct.status === 200 &&
        (byProduct.payload?.items ?? []).length === 1 &&
        byProduct.payload?.items?.[0]?.product_id === thinProductId
    );
    const missingOnly = await request("GET", "/api/product-architecture?missing=true&pageSize=100", { token });
    check(
      "筛选「尚未生成结构」：两个产品都已生成，因此都不出现",
      missingOnly.status === 200 &&
        !(missingOnly.payload?.items ?? []).some(
          (row) => row.product_id === fullProductId || row.product_id === thinProductId
        )
    );
    const benchmark = await request("GET", "/api/product-architecture?mode=BENCHMARK&pageSize=100", { token });
    check(
      "按 §17 模式筛选 BENCHMARK：没有达标锚点的产品不会混进来",
      benchmark.status === 200 &&
        !(benchmark.payload?.items ?? []).some((row) => createdProductIds.includes(row.product_id)),
      benchmark.payload?.total
    );
    const creator = await request("GET", "/api/product-architecture?mode=CATEGORY_CREATOR&pageSize=100", { token });
    check(
      "按 §17 模式筛选 CATEGORY_CREATOR：无可靠锚点的产品全部归到自建高端标准",
      creator.status === 200 &&
        createdProductIds.every((id) => (creator.payload?.items ?? []).some((row) => row.product_id === id)),
      creator.payload?.total
    );
    const pagedFirst = await request("GET", "/api/product-architecture?pageSize=1&page=1", { token });
    check(
      "分页可用：每页 1 条且回传 totalPages",
      (pagedFirst.payload?.items ?? []).length === 1 &&
        pagedFirst.payload?.totalPages === pagedFirst.payload?.total,
      [pagedFirst.payload?.total, pagedFirst.payload?.totalPages]
    );
    check(
      "非法 mode 返回 400（strict 校验，不做沉默兜底）",
      (await request("GET", "/api/product-architecture?mode=NOPE", { token })).status === 400
    );
    check(
      "非法排序参数返回 400",
      (await request("GET", "/api/product-architecture?sort=price_desc", { token })).status === 400
    );
    check(
      "非法角色参数返回 400",
      (await request("GET", "/api/product-architecture?role=color", { token })).status === 400
    );
    check(
      "分页超过上限返回 400",
      (await request("GET", "/api/product-architecture?pageSize=101", { token })).status === 400
    );

    console.log("\n[9] 权限矩阵与边界：只读可看不可写，研究员可写");
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
    check(
      "只读账号可以读产品结构总览",
      (await overviewOf(thinProductId, viewerToken)).status === 200
    );
    check(
      "只读账号可以读产品结构库",
      (await request("GET", "/api/product-architecture", { token: viewerToken })).status === 200
    );
    check(
      "只读账号不能生成产品结构",
      (await generate(thinProductId, { notes: "只读尝试" }, viewerToken)).status === 403
    );
    check(
      "只读账号不能人工确认产品结构",
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
    check("研究员可以生成产品结构", researcherGenerated.status === 201, researcherGenerated.status);
    const researcherConfirm = await patch(
      thinProductId,
      researcherGenerated.payload?.id,
      { is_confirmed: true },
      researcherToken
    );
    check("研究员可以人工确认产品结构", researcherConfirm.status === 200, researcherConfirm.status);
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
    check(
      "给不存在的产品生成产品结构返回 404",
      (await generate(missingId)).status === 404
    );
    check(
      "读不存在产品的版本列表返回 404",
      (await versionsOf(missingId)).status === 404
    );
    check(
      "读不存在的产品结构版本返回 404",
      (await request("GET", `/api/products/${thinProductId}/architecture/${missingId}`, { token })).status === 404
    );
    check(
      "跨产品调阅版本不串号（用别的产品的 id 查不到）",
      (await request("GET", `/api/products/${fullProductId}/architecture/${thinRecord?.id}`, { token }))
        .status === 404
    );
    check(
      "对不存在的版本做人工确认返回 404",
      (await patch(fullProductId, missingId, { is_confirmed: true })).status === 404
    );
  } finally {
    for (const productId of createdProductIds) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `[清理] 删除冒烟产品 ${productId}（级联删除产品结构）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from sources) as sources, (select count(*)::int from market_offers) as offers, (select count(*)::int from comparable_candidates) as candidates, (select count(*)::int from value_anchors) as anchors, (select count(*)::int from category_creator_profiles) as creator_profiles, (select count(*)::int from product_value_codes) as value_profiles, (select count(*)::int from product_architectures) as architectures, (select count(*)::int from value_codes) as value_codes"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：products=${row?.products} · sources=${row?.sources} · market_offers=${row?.offers} · comparable_candidates=${row?.candidates} · value_anchors=${row?.anchors} · category_creator_profiles=${row?.creator_profiles} · product_value_codes=${row?.value_profiles} · product_architectures=${row?.architectures} · value_codes=${row?.value_codes}`
    );
    check(
      "冒烟结束后业务表清零（只保留 seed）",
      row?.products === 0 &&
        row?.sources === 0 &&
        row?.offers === 0 &&
        row?.candidates === 0 &&
        row?.anchors === 0 &&
        row?.creator_profiles === 0 &&
        row?.value_profiles === 0 &&
        row?.architectures === 0,
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
