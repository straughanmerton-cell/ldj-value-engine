/**
 * Phase 14 端到端冒烟（规格 §24 三层标记 / §25 研发证据 / §49 十三项审核焦点 /
 * §53 逐句标注与人工审批 / §57 版本冻结 / §62-14 AI 只能加严 / §62-15 版本只增不删）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase14.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（强成交话术与事实审核随产品级联删除）
 *       与临时账号，开发库最终只保留 seed（品牌「龙德记」+ 管理员 + 16 行 Value Code 字典），
 *       并校验 products / copy_outputs / generated_claims / claim_evidence 全部为 0。
 *
 * 本阶段压的是六条硬约束：
 *   1) §24：逐句必须标成 FACT / INTERPRETATION / RHETORIC 三层，修辞不因「不是字面事实」被判 RED；
 *   2) §49：十三项审核焦点与三档风险逐句落位，无据断言 / 收益承诺 / 凭空价格 / 编配方一律 RED；
 *   3) §53：每一句都要有 句子 / Claim Type / Risk / Evidence / 修改建议，Evidence 只能逐字回查；
 *   4) §53 / §57：RED 阻断审批——存在阻断句时审批接口 400 并把阻断句回给前端，审批状态不许被改绿；
 *   5) §62-15：重新审核只新增版本，历史审核结论原样可查；审批与否决都留痕，版本只增不删；
 *   6) §62-14：AI（Agent 11）只能加严；Mock / 失败时整份回落纯规则引擎，红线结论不变。
 *
 * 因此脚本用「事实齐备产品」「极简产品（注入红线句）」两类输入，去压「审核口径只有一份、
 * 审批闸门不可绕过、历史结论不可改写」这三件最容易被实现偷掉的事。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase14-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase14-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** §24 三层标记与顺序。 */
const CLAIM_TYPES = ["FACT", "INTERPRETATION", "RHETORIC"];
/** §49 三档风险与顺序。 */
const RISK_LEVELS = ["GREEN", "YELLOW", "RED"];
/** 人工审批状态三档。 */
const STATUSES = ["PENDING", "APPROVED", "REJECTED"];
/** 证据类型四档（与 `claim_evidence.evidence_kind` 同源）。 */
const EVIDENCE_KINDS = ["PRODUCT_FACT", "VALUE_DNA", "UPSTREAM_COPY", "RND_REFERENCE"];
/** §49 十三项重点审核项（逐字照抄规格，不允许缩水）。 */
const FOCUS_ITEMS = [
  "对标关系",
  "研发关系",
  "配方",
  "原料",
  "树龄",
  "山头",
  "年份",
  "历史",
  "价格",
  "市场第一",
  "最贵",
  "唯一",
  "投资回报"
];
/** §53 逐句表格五列。 */
const SENTENCE_COLUMNS = ["句子", "Claim Type", "Risk", "Evidence", "修改建议"];
/** 合同口径（与 `FACT_REVIEW_SPEC_REF` 同源）。 */
const SPEC_REF = "§24 / §25 / §49 / §53";
/** 总览口径（与 `factReviewOverviewSchema.spec_ref` 同源）。 */
const OVERVIEW_SPEC_REF = "§24 / §49 / §53";
/** §62-15：同一版成稿最多保留 20 次事实审核。 */
const MAX_VERSIONS_PER_COPY = 20;
/** §49 / §53：一段同时踩四条红线的句子，用来验证逐句判定与审批闸门。 */
const RED_SENTENCE =
  "这款茶是全国第一。这饼茶必涨，买了就是稳赚。它已经卖到 8888 元。我们就是按 2003 六星孔雀的配方做的。";

/** 事实齐备的产品：多数句子能逐字回查到出处（与 Phase 10 / 11 / 12 / 13 fixture 同口径）。 */
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

/** 几乎没有事实的产品：用来验证「缺出处写缺口」，并且承载注入的红线句。 */
const THIN_PRODUCT = {
  product_name: "龙德记试样茶",
  year: 2026,
  tea_type: "普洱生茶",
  weight_g: 357,
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 5
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

/**
 * 直接把一句红线写进**已落库的成稿**。
 *
 * 目的不是伪造数据，而是让「审核对象是一版冻结的成稿」这条链路可被验证：
 * 真实产品不会写出「全国第一」，但审核器必须在有人写出来时抓住它（§49）。
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
    request("GET", `/api/products/${productId}/fact-review`, { token: authToken });
  const versionsOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/fact-review/versions`, { token: authToken });
  const reviewOf = (productId, reviewId, authToken = token) =>
    request("GET", `/api/products/${productId}/fact-review/${reviewId}`, { token: authToken });
  const generateReview = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/fact-review/generate`, { token: authToken, body });
  const decide = (action, productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/fact-review/${action}`, { token: authToken, body });
  const generateCopy = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/copy/generate`, { token: authToken, body });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    const healthPhase = String(health.payload?.phase ?? "");
    // 与 phase10 / phase13 同口径：只断言「至少推进到 Phase 14 且写明已交付」，
    // 不锁死具体文案（Phase 15 交付后这里仍应通过）。
    const healthPhaseNumber = Number(/Phase\s*(\d+)/.exec(healthPhase)?.[1] ?? 0);
    check(
      "健康检查文案至少推进到 Phase 14（事实审核与人工审批）",
      healthPhaseNumber >= 14 && healthPhase.includes("已交付"),
      healthPhase
    );
    check(
      "未登录不能读合同 / 标签 / 总览 / 单次审核",
      (await request("GET", "/api/fact-review/contract")).status === 401 &&
        (await request("GET", "/api/fact-review/labels")).status === 401 &&
        (await overviewOf(missingId)).status === 401 &&
        (await reviewOf(missingId, missingId)).status === 401
    );
    check(
      "未登录不能送审 / 审批（401）",
      (await generateReview(missingId)).status === 401 &&
        (await decide("approve", missingId)).status === 401 &&
        (await decide("reject", missingId)).status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("登录响应带回 access_token", typeof token === "string" && token.length > 0);

    console.log("\n[2] §24 / §49 / §53 合同口径自检（三层标记 / 十三项焦点 / 五列 / 硬闸门）");
    const contractResponse = await request("GET", "/api/fact-review/contract", { token });
    check("事实审核合同返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const engine = contractResponse.payload?.engine;
    const downstream = contractResponse.payload?.downstream ?? [];
    const limits = contractResponse.payload?.limits;
    check(
      "合同 spec_ref 锁定 §24 / §25 / §49 / §53（口径只从 schema 层读，前端不自造）",
      contract?.spec_ref === SPEC_REF,
      contract?.spec_ref
    );
    check(
      "§24 三层标记与顺序固定（FACT / INTERPRETATION / RHETORIC）",
      JSON.stringify((contract?.claim_types ?? []).map((item) => item.key)) ===
        JSON.stringify(CLAIM_TYPES),
      (contract?.claim_types ?? []).map((item) => item.key)
    );
    check(
      "§49 三档风险与顺序固定（GREEN / YELLOW / RED）",
      JSON.stringify((contract?.risk_levels ?? []).map((item) => item.key)) ===
        JSON.stringify(RISK_LEVELS),
      (contract?.risk_levels ?? []).map((item) => item.key)
    );
    check(
      "§49 十三项重点审核项逐字照抄规格（不缺项、不缩水）",
      JSON.stringify(contract?.focus_items) === JSON.stringify(FOCUS_ITEMS),
      contract?.focus_items
    );
    check(
      "§53 逐句表格五列固定（句子 / Claim Type / Risk / Evidence / 修改建议）",
      JSON.stringify(contract?.sentence_columns) === JSON.stringify(SENTENCE_COLUMNS),
      contract?.sentence_columns
    );
    check(
      "审批状态只有 PENDING / APPROVED / REJECTED（不存在「差不多算过了」这一档）",
      JSON.stringify((contract?.statuses ?? []).map((item) => item.key)) ===
        JSON.stringify(STATUSES),
      (contract?.statuses ?? []).map((item) => item.key)
    );
    check(
      "证据类型四档齐全（产品已录入字段 / Value DNA / 上游成稿 / 研发记录）",
      JSON.stringify((contract?.evidence_kinds ?? []).map((item) => item.key)) ===
        JSON.stringify(EVIDENCE_KINDS),
      (contract?.evidence_kinds ?? []).map((item) => item.key)
    );
    check(
      "合同十条规则写清三层标记 / 十三项焦点 / RED 阻断 / 版本保留（§24 / §49 / §53 / §62-15）",
      (contract?.rules ?? []).length === 10 &&
        contract.rules.some((rule) => rule.includes("三层标记")) &&
        contract.rules.some((rule) => rule.includes("十三项重点")) &&
        contract.rules.some((rule) => rule.includes("RED 禁止审批")) &&
        contract.rules.some((rule) => rule.includes("所有版本必须保留")),
      (contract?.rules ?? []).length
    );
    check(
      "五个红线布尔全部为 true：修辞不算造假 / RED 阻断审批 / 研发需确认 / AI 只能加严 / 版本保留",
      contract?.rhetoric_not_fraud === true &&
        contract?.red_blocks_approval === true &&
        contract?.rnd_requires_confirmation === true &&
        contract?.ai_can_only_tighten === true &&
        contract?.keep_all_versions === true,
      {
        rhetoric: contract?.rhetoric_not_fraud,
        red: contract?.red_blocks_approval,
        rnd: contract?.rnd_requires_confirmation,
        ai: contract?.ai_can_only_tighten,
        versions: contract?.keep_all_versions
      }
    );
    check(
      "§62-14 引擎口径：FACT_REVIEWER 已接线（ai_wired = true）且规则引擎是硬闸门",
      engine?.prompt_key === "FACT_REVIEWER" &&
        engine?.ai_wired === true &&
        engine?.rule_engine_authoritative === true,
      engine
    );
    check(
      "已交付阶段不再登记下游：Phase 15 交付后下游交接为空数组（§62-15）",
      Array.isArray(downstream) && downstream.length === 0,
      downstream
    );
    check(
      "§62-15 同一版成稿最多 20 次事实审核（超出必须先生成新版话术）",
      limits?.maxVersionsPerCopy === MAX_VERSIONS_PER_COPY,
      limits
    );

    const labelsResponse = await request("GET", "/api/fact-review/labels", { token });
    check("事实审核标签返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check(
      "标签下发三层 / 三档 / 审批状态 / 证据类型的中文口径（前端不另写一套文案）",
      Object.keys(labels?.claim_type_labels ?? {}).join(",") === CLAIM_TYPES.join(",") &&
        Object.keys(labels?.risk_level_labels ?? {}).join(",") === RISK_LEVELS.join(",") &&
        Object.keys(labels?.status_labels ?? {}).join(",") === STATUSES.join(",") &&
        Object.keys(labels?.evidence_kind_labels ?? {}).join(",") === EVIDENCE_KINDS.join(","),
      labels?.claim_type_labels
    );
    check(
      "标签里的十三项焦点与五列与合同同源（§49 / §53）",
      JSON.stringify(labels?.focus_items) === JSON.stringify(FOCUS_ITEMS) &&
        JSON.stringify(labels?.sentence_columns) === JSON.stringify(SENTENCE_COLUMNS)
    );
    check(
      "三层标记带判定口径：FACT 必须逐字找到出处、RHETORIC 允许极限但不得暗示可核验事实（§24）",
      String(labels?.claim_type_hints?.FACT ?? "").includes("逐字") &&
        String(labels?.claim_type_hints?.RHETORIC ?? "").includes("可核验事实") &&
        String(labels?.risk_level_hints?.RED ?? "").includes("禁止发布"),
      labels?.claim_type_hints
    );

    console.log("\n[3] 没有成稿时不得空跑审核（§53）");
    const emptyProductId = await createProduct("事实审核·无成稿产品", THIN_PRODUCT);
    const emptyOverview = await overviewOf(emptyProductId);
    check("无成稿时总览返回 200", emptyOverview.status === 200, emptyOverview.status);
    check(
      "总览明确「不可审核」并给出中文原因，不是空白页，也不是一个骗人的绿灯",
      emptyOverview.payload?.can_review === false &&
        emptyOverview.payload?.copy_record_id === null &&
        emptyOverview.payload?.copy_version === null &&
        typeof emptyOverview.payload?.block_reason === "string" &&
        emptyOverview.payload.block_reason.includes("主播稿") &&
        emptyOverview.payload?.review === null &&
        (emptyOverview.payload?.versions ?? []).length === 0,
      { can_review: emptyOverview.payload?.can_review, block: emptyOverview.payload?.block_reason }
    );
    check(
      "总览口径 spec_ref = §24 / §49 / §53，审批状态默认 PENDING 且不指向任何审核版本",
      emptyOverview.payload?.spec_ref === OVERVIEW_SPEC_REF &&
        emptyOverview.payload?.approval?.status === "PENDING" &&
        emptyOverview.payload?.approval?.reviewed_version === null
    );
    const emptyGenerate = await generateReview(emptyProductId);
    check(
      "没有成稿时运行审核返回 400（不许审核一个不存在的对象）",
      emptyGenerate.status === 400 &&
        emptyGenerate.payload?.error?.code === "VALIDATION_ERROR",
      { status: emptyGenerate.status, code: emptyGenerate.payload?.error?.code }
    );

    console.log("\n[4] 生成一版王者话术 → 首次逐句事实审核（§49 / §53）");
    const fullProductId = await createProduct("事实审核·事实齐备产品", FULL_PRODUCT);
    const copyResponse = await generateCopy(fullProductId, {
      intensity: 5,
      notes: "冒烟：Phase 14 送审稿"
    });
    check("先生成一版 Level 5 强成交话术（201）", copyResponse.status === 201, copyResponse.status);
    const copyId = copyResponse.payload?.id;
    const copyVersion = copyResponse.payload?.version;
    check(
      "成稿版本为 v1 且拿到落库 id（审核对象就是一版已冻结的成稿）",
      typeof copyId === "string" && copyVersion === 1,
      { copyId, copyVersion }
    );

    const pendingOverview = await overviewOf(fullProductId);
    check(
      "有成稿后总览可审核，并指向最新一版成稿；此时还没有审核结论",
      pendingOverview.payload?.can_review === true &&
        pendingOverview.payload?.copy_record_id === copyId &&
        pendingOverview.payload?.copy_version === copyVersion &&
        pendingOverview.payload?.block_reason === null &&
        pendingOverview.payload?.review === null &&
        (pendingOverview.payload?.versions ?? []).length === 0
    );

    const firstResponse = await generateReview(fullProductId);
    check("运行一次事实审核返回 201", firstResponse.status === 201, {
      status: firstResponse.status,
      error: firstResponse.payload?.error?.message
    });
    const review = firstResponse.payload?.review;
    const evidence = firstResponse.payload?.evidence ?? [];
    check(
      "第一次审核的版本序号为 1，并指向被审的那一版成稿（§53 / §62-15）",
      review?.version === 1 &&
        review?.copy_version === copyVersion &&
        review?.copy_output_id === copyId &&
        typeof review?.id === "string",
      { version: review?.version, copy_version: review?.copy_version }
    );
    check(
      "审核结论 spec_ref 与合同同源（§24 / §25 / §49 / §53）",
      review?.spec_ref === SPEC_REF,
      review?.spec_ref
    );
    check(
      "纯规则引擎先跑一遍：Mock AI Provider 下 engine = RULE、warnings 为空",
      review?.engine === "RULE" && (review?.warnings ?? []).length === 0,
      { engine: review?.engine, warnings: review?.warnings }
    );
    check(
      "事实齐备的成稿逐句无 RED：publishable = true、blocking_sentences 为空、合规不是 RED（§49 / §53）",
      review?.summary?.red === 0 &&
        (review?.blocking_sentences ?? []).length === 0 &&
        review?.publishable === true &&
        review?.compliance?.risk !== "RED",
      { red: review?.summary?.red, risk: review?.compliance?.risk }
    );
    check(
      "逐句结论非空且句数足够（> 20 句），三档风险计数覆盖全部句子（§53）",
      Array.isArray(review?.sentences) &&
        review.sentences.length > 20 &&
        review.summary.green + review.summary.yellow + review.summary.red ===
          review.sentences.length,
      { sentences: review?.sentences?.length, summary: review?.summary }
    );
    check(
      "三层标记计数与逐句一致，且三层都真实落位（§24：修辞不会被算成造假）",
      CLAIM_TYPES.every(
        (type) =>
          review.claim_counts[type] ===
          (review.sentences ?? []).filter((sentence) => sentence.claim_type === type).length
      ) &&
        review.claim_counts.FACT + review.claim_counts.INTERPRETATION + review.claim_counts.RHETORIC ===
          review.sentences.length &&
        CLAIM_TYPES.every((type) => review.claim_counts[type] > 0),
      review?.claim_counts
    );
    check(
      "句序从 1 连续编号：前端 §53 表格与审核结果一一对应，不跳号",
      (review?.sentences ?? []).every((sentence, position) => sentence.index === position + 1)
    );
    check(
      "每一句都有 Claim Type 与 Risk（三层 / 三档，没有漏判）",
      (review?.sentences ?? []).every(
        (sentence) =>
          CLAIM_TYPES.includes(sentence.claim_type) && RISK_LEVELS.includes(sentence.risk)
      )
    );
    check(
      "YELLOW 句必须给出 issue 与修改建议（不是红线也要讲清要确认什么，§49 / §53）",
      (review?.sentences ?? [])
        .filter((sentence) => sentence.risk === "YELLOW")
        .every(
          (sentence) =>
            typeof sentence.issue === "string" &&
            sentence.issue.length > 0 &&
            typeof sentence.suggestion === "string" &&
            sentence.suggestion.length > 0
        )
    );
    check(
      "整体风险由逐句风险与 §24 合规风险共同推导（§49）",
      review?.overall_risk ===
        (review.summary.red > 0 || review.compliance.risk === "RED"
          ? "RED"
          : review.summary.yellow > 0 || review.compliance.risk === "YELLOW"
            ? "YELLOW"
            : "GREEN"),
      { overall: review?.overall_risk, summary: review?.summary, compliance: review?.compliance?.risk }
    );

    console.log("\n[5] §53 逐句表与证据行：Evidence 只能逐字回查");
    check(
      "逐字回查到已录入事实（facts_used > 0），并落成证据行",
      review?.facts_used > 0 && evidence.length > 0,
      { facts_used: review?.facts_used, evidence: evidence.length }
    );
    check(
      "证据行全部可点回本产品资料（traceable = true），且挂在一句具体的审核结论上",
      evidence.every(
        (item) =>
          item.traceable === true &&
          item.excerpt.trim().length > 0 &&
          item.source_ref.trim().length > 0 &&
          (review.sentences ?? []).some((sentence) => sentence.index > 0) &&
          typeof item.claim_id === "string"
      )
    );
    check(
      "证据类型落在四档白名单内（PRODUCT_FACT / VALUE_DNA / UPSTREAM_COPY / RND_REFERENCE）",
      evidence.every((item) => EVIDENCE_KINDS.includes(item.evidence_kind)),
      [...new Set(evidence.map((item) => item.evidence_kind))]
    );
    const claimIds = new Set(evidence.map((item) => item.claim_id));
    const evidenceRefs = evidence
      .map((item) => `${item.source_ref}=${item.excerpt}`)
      .sort();
    const sentenceRefs = (review?.sentences ?? [])
      .flatMap((sentence) => sentence.evidence_refs)
      .sort();
    check(
      "每一句的 evidence_refs 与落库证据行逐字对齐（source_ref=excerpt，两处永远同源）",
      JSON.stringify(evidenceRefs) === JSON.stringify(sentenceRefs),
      { evidence: evidenceRefs.length, sentence_refs: sentenceRefs.length }
    );
    check(
      "证据行只挂在有出处的句子上：claim_id 去重数 = 带出处的句子数（不空挂、不串行）",
      claimIds.size ===
        (review?.sentences ?? []).filter((sentence) => sentence.evidence_refs.length > 0).length,
      {
        claims: claimIds.size,
        sentences_with_refs: (review?.sentences ?? []).filter(
          (sentence) => sentence.evidence_refs.length > 0
        ).length
      }
    );
    check(
      "FACT 句里至少有一条能落到具体出处（否则就是编事实，§24）",
      (review?.sentences ?? [])
        .filter((sentence) => sentence.claim_type === "FACT")
        .some((sentence) => sentence.evidence_refs.length > 0)
    );
    check(
      "缺出处的事实断言进证据缺口清单，供研究员补齐（§49 / §57）",
      Array.isArray(review?.evidence_gaps) &&
        review.evidence_gaps.every((gap) => gap.includes("缺少逐字出处"))
    );

    console.log("\n[6] §53 / §57 人工审批：先否决再通过，两次都留痕");
    const rejectResponse = await decide("reject", fullProductId, {
      note: "冒烟：第一次送审人工否决"
    });
    check(
      "人工否决返回 200，且不改写任何逐句结论（§62-15）",
      rejectResponse.status === 200 &&
        JSON.stringify(rejectResponse.payload?.review?.sentences) ===
          JSON.stringify(review.sentences),
      rejectResponse.status
    );
    const rejectedOverview = await overviewOf(fullProductId);
    check(
      "否决后总览显示 REJECTED，并指向被否决的那一次审核（版本号 + 备注 + 时间齐全）",
      rejectedOverview.payload?.approval?.status === "REJECTED" &&
        rejectedOverview.payload?.approval?.reviewed_version === 1 &&
        rejectedOverview.payload?.approval?.note === "冒烟：第一次送审人工否决" &&
        typeof rejectedOverview.payload?.approval?.reviewed_by === "string" &&
        typeof rejectedOverview.payload?.approval?.reviewed_at === "string",
      rejectedOverview.payload?.approval
    );

    const approveResponse = await decide("approve", fullProductId, { note: "冒烟：人工复核通过" });
    check(
      "无 RED 时人工审批通过返回 200，审批对象 = 被审的那一次审核",
      approveResponse.status === 200 && approveResponse.payload?.review?.version === 1,
      approveResponse.status
    );
    const approvedOverview = await overviewOf(fullProductId);
    check(
      "审批通过后总览显示 APPROVED，并指向这一次审核版本（§53）",
      approvedOverview.payload?.approval?.status === "APPROVED" &&
        approvedOverview.payload?.approval?.reviewed_version === 1 &&
        approvedOverview.payload?.approval?.note === "冒烟：人工复核通过" &&
        typeof approvedOverview.payload?.approval?.reviewed_by === "string",
      approvedOverview.payload?.approval
    );
    check(
      "审批只改状态、不重写句子结论（审批前后逐句完全相同，§57）",
      JSON.stringify(approveResponse.payload?.review?.sentences) ===
        JSON.stringify(review.sentences) &&
        approveResponse.payload?.review?.summary?.red === review.summary.red
    );

    console.log("\n[7] §62-14 / §62-15 重新审核：只新增版本，AI 只能加严，旧结论不改写");
    const secondResponse = await generateReview(fullProductId, {
      use_ai: true,
      notes: "冒烟：要求 Agent 11 参与复核"
    });
    check(
      "重新审核返回 201（同一版成稿可以审核多次）",
      secondResponse.status === 201,
      secondResponse.status
    );
    const second = secondResponse.payload?.review;
    check(
      "重新审核只新增版本：版本序号 2，仍指向同一版成稿（§62-15）",
      second?.version === 2 && second?.copy_version === copyVersion,
      { version: second?.version, copy_version: second?.copy_version }
    );
    check(
      "第一次审核的结论原样可查（重新审核不改写历史，§57 / §62-15）",
      JSON.stringify((await reviewOf(fullProductId, review.id)).payload?.review?.sentences) ===
        JSON.stringify(review.sentences)
    );
    check(
      "§62-14 AI 只能加严：Mock / 失败时整份回落纯规则引擎，并留下可读 warning",
      second?.engine === "RULE"
        ? (second?.warnings ?? []).some((warning) => warning.includes("退回纯规则引擎"))
        : second?.sentences?.length === review.sentences.length,
      { engine: second?.engine, warnings: second?.warnings }
    );
    check(
      "送审备注写进审核留痕（人工回看能看到「为什么重审了这一版」）",
      (second?.warnings ?? []).some((warning) => warning.includes("冒烟：要求 Agent 11 参与复核")),
      second?.warnings
    );
    check(
      "AI 参与前后逐句文本与句序完全一致（重新审核不改写原文，§57）",
      JSON.stringify((second?.sentences ?? []).map((sentence) => [sentence.index, sentence.text])) ===
        JSON.stringify(review.sentences.map((sentence) => [sentence.index, sentence.text]))
    );
    check(
      "AI 参与后 RED 只可能更严（不会减少规则引擎判出的红线，§62-14）",
      (second?.summary?.red ?? 0) >= review.summary.red,
      { before: review.summary.red, after: second?.summary?.red }
    );
    check(
      "AI 参与不改变「可发布」结论（回落时与规则结论一致，§62-14）",
      second?.publishable === review.publishable
    );

    const versionsAfterSecond = await versionsOf(fullProductId);
    check(
      "版本列表按「成稿版本 → 审核序号」倒序返回两次审核，全部保留（§62-15）",
      JSON.stringify(
        (versionsAfterSecond.payload?.items ?? []).map((item) => [item.copy_version, item.version])
      ) === JSON.stringify([[copyVersion, 2], [copyVersion, 1]]),
      (versionsAfterSecond.payload?.items ?? []).map((item) => [item.copy_version, item.version])
    );
    check(
      "版本摘要的发布结论由 RED 计数推导（publishable = red === 0，§53）",
      (versionsAfterSecond.payload?.items ?? []).every(
        (item) => item.publishable === (item.red === 0)
      )
    );
    check(
      "新审核不继承上一版审批结论：总览仍指向已审批的 v1，而不是给 v2 亮绿灯（§53）",
      (await overviewOf(fullProductId)).payload?.approval?.status === "APPROVED" &&
        (await overviewOf(fullProductId)).payload?.approval?.reviewed_version === 1
    );

    let capHit = null;
    for (let guard = 0; guard < MAX_VERSIONS_PER_COPY + 2; guard += 1) {
      const created = await generateReview(fullProductId);
      if (created.status !== 201) {
        capHit = created;
        break;
      }
    }
    const cappedVersions = (await versionsOf(fullProductId)).payload?.items ?? [];
    check(
      `同一版成稿审核次数封顶 ${MAX_VERSIONS_PER_COPY}，超出返回 400 而不是覆盖旧版本（§62-15）`,
      capHit?.status === 400 &&
        cappedVersions.length === MAX_VERSIONS_PER_COPY &&
        String(capHit.payload?.error?.message ?? "").includes(String(MAX_VERSIONS_PER_COPY)),
      { status: capHit?.status, versions: cappedVersions.length, message: capHit?.payload?.error?.message }
    );
    check(
      "审核版本号 1…20 全部保留、只增不删（历史结论没有被覆盖或删除）",
      cappedVersions
        .map((item) => item.version)
        .sort((a, b) => a - b)
        .join(",") ===
        Array.from({ length: MAX_VERSIONS_PER_COPY }, (_, index) => index + 1).join(","),
      cappedVersions.map((item) => item.version)
    );
    check(
      "20 次审核都记录在同一版成稿上（copy_version 不漂移，审计链完整）",
      cappedVersions.every((item) => item.copy_version === copyVersion)
    );

    console.log("\n[8] §49 / §53 红线句逐条判 RED 并阻断审批");
    const redProductId = await createProduct("事实审核·红线句产品", THIN_PRODUCT);
    const redCopy = await generateCopy(redProductId, { intensity: 5 });
    check("先生成一版成稿（201）", redCopy.status === 201, redCopy.status);
    await injectRedSentence(client, redCopy.payload?.id, RED_SENTENCE);
    const redReviewResponse = await generateReview(redProductId, { notes: "冒烟：注入红线句" });
    check(
      "注入红线句后审核返回 201（审核抓得住，不放过）",
      redReviewResponse.status === 201,
      redReviewResponse.status
    );
    const redReview = redReviewResponse.payload?.review;
    check(
      "红线句逐条判 RED：绝对化断言 / 收益承诺 / 凭空价格 / 编配方（§49）",
      (redReview?.summary?.red ?? 0) >= 4 &&
        redReview?.overall_risk === "RED" &&
        redReview?.publishable === false,
      { red: redReview?.summary?.red, overall: redReview?.overall_risk }
    );
    check(
      "阻断句清单与逐句 RED 标记一一对应（§53）",
      JSON.stringify(redReview?.blocking_sentences) ===
        JSON.stringify(
          (redReview?.sentences ?? [])
            .filter((sentence) => sentence.risk === "RED")
            .map((sentence) => sentence.text)
        ),
      redReview?.blocking_sentences
    );
    const redIssues = (redReview?.sentences ?? [])
      .filter((sentence) => sentence.risk === "RED")
      .map((sentence) => sentence.issue ?? "");
    check(
      "每一条 RED 都写明命中的红线类别（绝对化断言 / 禁止承诺 / 价格数字 / 研发或配方关系）",
      redIssues.some((issue) => issue.includes("绝对化断言")) &&
        redIssues.some((issue) => issue.includes("禁止承诺")) &&
        redIssues.some((issue) => issue.includes("价格数字")) &&
        redIssues.some((issue) => issue.includes("研发") || issue.includes("配方")),
      redIssues
    );
    check(
      "每一条 RED 都是阻断句并带修改建议（不是只报错不给路，§53 / §58）",
      (redReview?.sentences ?? [])
        .filter((sentence) => sentence.risk === "RED")
        .every(
          (sentence) =>
            sentence.is_blocking === true &&
            typeof sentence.suggestion === "string" &&
            sentence.suggestion.length > 0
        )
    );
    check(
      "publishable = false 且整体风险 RED（只有「逐句无 RED 且合规不是 RED」才有资格送审通过）",
      redReview?.publishable === false && redReview?.overall_risk === "RED"
    );

    const denied = await decide("approve", redProductId, { note: "冒烟：想直接过" });
    check(
      "存在阻断句时审批接口 400，并在 details 里回传发布结论 false（§53 / §57）",
      denied.status === 400 &&
        denied.payload?.error?.code === "VALIDATION_ERROR" &&
        denied.payload?.error?.details?.publishable === false,
      { status: denied.status, details: denied.payload?.error?.details }
    );
    check(
      "400 响应回传被审版本号与全部阻断句原文（前端据此定位到具体句）",
      denied.payload?.error?.details?.reviewed_version === 1 &&
        JSON.stringify(denied.payload?.error?.details?.blocking_sentences) ===
          JSON.stringify(redReview.blocking_sentences),
      denied.payload?.error?.details
    );
    const redOverview = await overviewOf(redProductId);
    check(
      "被拒后审批状态仍是 PENDING（拒绝不留半成品，也不许悄悄改绿）",
      redOverview.payload?.approval?.status === "PENDING" &&
        redOverview.payload?.approval?.reviewed_version === null,
      redOverview.payload?.approval
    );
    const redReject = await decide("reject", redProductId, { note: "冒烟：红线未改写，否决" });
    check(
      "RED 版本允许人工否决并留痕，且否决不改写逐句判定结论（§62-15）",
      redReject.status === 200 &&
        JSON.stringify(redReject.payload?.review?.sentences) ===
          JSON.stringify(redReview.sentences) &&
        (await overviewOf(redProductId)).payload?.approval?.status === "REJECTED"
    );

    console.log("\n[9] 权限与边界：读需登录 / 写限 ADMIN·RESEARCHER / strict 校验 / 404");
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
      "只读账号可以读合同 / 标签 / 总览 / 单次审核（§53 页面本来就要看）",
      (await request("GET", "/api/fact-review/contract", { token: viewerToken })).status === 200 &&
        (await request("GET", "/api/fact-review/labels", { token: viewerToken })).status === 200 &&
        (await overviewOf(fullProductId, viewerToken)).status === 200 &&
        (await reviewOf(fullProductId, review.id, viewerToken)).status === 200
    );
    check(
      "只读账号不能送审 / 审批通过 / 审批否决（403：审批权不能落到只读账号）",
      (await generateReview(fullProductId, {}, viewerToken)).status === 403 &&
        (await decide("approve", fullProductId, {}, viewerToken)).status === 403 &&
        (await decide("reject", fullProductId, {}, viewerToken)).status === 403
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
    const researcherReview = await generateReview(redProductId, {}, researcherToken);
    check(
      "研究员可以运行事实审核（201），且权限不改变任何判定规则（红线照样 RED）",
      researcherReview.status === 201 &&
        researcherReview.payload?.review?.publishable === false &&
        researcherReview.payload?.review?.summary?.red >= 4,
      {
        status: researcherReview.status,
        red: researcherReview.payload?.review?.summary?.red
      }
    );
    check(
      "研究员加审后审批仍未通过（RED 阻止任何人跳过闸门，§53）",
      (await overviewOf(redProductId)).payload?.approval?.status !== "APPROVED"
    );

    check(
      "strict 校验：送审 / 审批收到多余字段一律 400（不给「跳过 RED」的后门）",
      (await generateReview(fullProductId, { skip_red: true })).status === 400 &&
        (await decide("approve", fullProductId, { force: true })).status === 400 &&
        (await decide("reject", redProductId, { force: true })).status === 400
    );
    check(
      "字段类型 / 范围非法返回 400（record_id 非 UUID、version 为 0）",
      (await generateReview(fullProductId, { record_id: notAUuid })).status === 400 &&
        (await decide("approve", fullProductId, { version: 0 })).status === 400
    );
    check(
      "给不存在的产品或非 UUID 产品 id 送审 / 审批返回 404（不是 500，也不静默通过）",
      (await generateReview(missingId)).status === 404 &&
        (await overviewOf(missingId)).status === 404 &&
        (await decide("approve", missingId)).status === 404 &&
        (await generateReview(notAUuid)).status === 404 &&
        (await overviewOf(notAUuid)).status === 404
    );
    check(
      "指定了一版不存在的成稿返回 400（不许退化成「那就审最新版吧」）",
      (await generateReview(fullProductId, { record_id: missingId })).status === 400 &&
        (await generateReview(redProductId, { record_id: copyId })).status === 400,
      "缺 record_id 命中时按校验错误处理，避免审错对象"
    );
    check(
      "审批一个不存在的审核版本返回 404（不默认审批最新版）",
      (await decide("approve", fullProductId, { version: 999 })).status === 404 &&
        (await decide("reject", redProductId, { version: 999 })).status === 404
    );
    check(
      "单次审核 id 不存在返回 404（不会返回空壳页面）",
      (await reviewOf(fullProductId, missingId)).status === 404
    );

    console.log("\n[10] 清理冒烟数据并校验业务表清零");
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
      "冒烟结束后业务表清零（只保留 seed 与 16 行 Value Code 字典；成稿 / 审核结论 / 证据行随产品级联清空）",
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
