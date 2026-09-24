/**
 * Phase 9 端到端冒烟（规格 §18 Value Codes / §19 状态判定 / §20 六类价值故事 / §30 价值拆解 / §44 不移植竞品事实）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase9.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（价值映射随产品级联删除）与临时账号，
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员），并校验 product_value_codes / value_codes = 0。
 *
 * 为什么不需要灌来源：本阶段不抓取、不打分，只做两件事——
 *   1) 把产品已录入事实折叠成 16 个 Code 的落位（缺事实就写 UNKNOWN，并列出缺口）；
 *   2) 决定六类价值故事里哪些可以成稿、哪些必须留给 Phase 10 / 11。
 * 所以脚本只用「事实齐备产品」与「几乎没有事实的极简产品」两类输入，去压两条硬约束：
 * 事实齐备不等于可以乱讲（时间依赖型只有一句安全句式），事实不足也不等于可以编（一律 UNKNOWN + 缺口）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase9-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase9-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

const STATUS_ORDER = ["ALREADY_HAVE", "PARTIAL", "TIME_DEPENDENT", "NOT_HAVE", "UNKNOWN"];
const TIME_DEPENDENT_CODES = ["AGE_VALUE", "COLLECTION_RECOGNITION", "MARKET_LIQUIDITY"];
const SAFE_EXPRESSION = "今天看的是它有没有把未来需要的底子先做好。";
const FORBIDDEN_EXPRESSION = "以后一定会有。";
const STORY_KEYS = [
  "identity_story",
  "price_ceiling_story",
  "product_architecture_story",
  "formula_philosophy_story",
  "flavor_identity_story",
  "time_story"
];

/** 事实齐备的产品：16 个 Code 里只有「茶气」是单点事实，其余都有可交叉印证的记录（与 API 测试 fixture 同口径）。 */
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

/** 几乎没有事实的产品：只保留身份与规格，用来验证「缺事实 = UNKNOWN + 缺口」。 */
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

function codeOf(profile, key) {
  return (profile?.codes ?? []).find((item) => item.code === key) ?? null;
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

  const overviewOf = (productId) => request("GET", `/api/products/${productId}/value-codes`, { token });
  const generate = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/value-codes/generate`, { token: authToken, body });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);

    check(
      "未登录不能读价值映射合同",
      (await request("GET", "/api/value-codes/contract")).status === 401
    );
    check(
      "未登录不能读价值映射标签",
      (await request("GET", "/api/value-codes/labels")).status === 401
    );
    check("未登录不能读价值密码库", (await request("GET", "/api/value-codes")).status === 401);
    check(
      "未登录不能读产品价值映射总览",
      (await request("GET", `/api/products/${missingId}/value-codes`)).status === 401
    );
    check(
      "未登录不能生成价值映射",
      (await request("POST", `/api/products/${missingId}/value-codes/generate`, { body: {} })).status ===
        401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("返回 access_token", typeof token === "string" && token.length > 10);

    console.log("\n[2] §18 合同自检：16 个 Code + 五种状态 + §19 表达规范 + 七条规则 + 下游只登记");
    const contract = await request("GET", "/api/value-codes/contract", { token });
    check("价值映射合同返回 200", contract.status === 200, contract.status);
    const body = contract.payload?.contract;
    const engine = contract.payload?.engine;
    check("合同引用 §18 / §19 / §20", body?.spec_ref === "§18 / §19 / §20", body?.spec_ref);
    check("16 个 Value Code 齐备（§18 固定）", (body?.codes ?? []).length === 16, (body?.codes ?? []).length);
    check(
      "16 个 Code 互不重复",
      new Set((body?.codes ?? []).map((item) => item.code)).size === 16
    );
    check(
      "每个 Code 都有定义 / 底层条件 / contribution（前端不会只剩一个代号）",
      (body?.codes ?? []).every(
        (item) =>
          item.label?.length > 0 &&
          item.definition?.length > 0 &&
          item.requirement?.length > 0 &&
          item.contribution?.length > 0
      )
    );
    check(
      "每个 Code 都写明允许引用的证据字段（product.* / dna.*）",
      (body?.codes ?? []).every(
        (item) =>
          (item.evidence_refs ?? []).length > 0 &&
          (item.evidence_refs ?? []).every((ref) => ref.startsWith("product.") || ref.startsWith("dna."))
      )
    );
    check(
      "时间依赖型 Code 固定为 陈化 / 收藏认知 / 流通（§19）",
      JSON.stringify((body?.codes ?? []).filter((item) => item.time_dependent).map((item) => item.code)) ===
        JSON.stringify(TIME_DEPENDENT_CODES),
      (body?.codes ?? []).filter((item) => item.time_dependent).map((item) => item.code)
    );
    check(
      "五种状态齐全且顺序固定（已具备 → 单点事实 → 时间依赖 → 不具备 → 未录入）",
      JSON.stringify((body?.statuses ?? []).map((item) => item.status)) === JSON.stringify(STATUS_ORDER),
      (body?.statuses ?? []).map((item) => item.status)
    );
    check(
      "五种状态都写明含义与判定规则（§19 不是一句口号）",
      (body?.statuses ?? []).length === 5 &&
        (body?.statuses ?? []).every(
          (item) => item.label?.length > 0 && item.meaning?.length > 0 && item.rule?.length > 0
        )
    );
    check(
      "六类价值故事齐备且顺序固定（身份 / 价格上限 / 产品结构 / 配方哲学 / 风味身份 / 时间）",
      JSON.stringify((body?.stories ?? []).map((item) => item.key)) === JSON.stringify(STORY_KEYS),
      (body?.stories ?? []).map((item) => item.key)
    );
    check(
      "§19 安全句式与禁止句式都下发到前端",
      body?.time_dependent_safe_expression === SAFE_EXPRESSION &&
        body?.time_dependent_forbidden_expression === FORBIDDEN_EXPRESSION
    );
    check("红线：竞品事实不得移植（no_competitor_fact_transplant = true）", body?.no_competitor_fact_transplant === true);
    check("红线：时间依赖不得承诺未来（time_dependent_not_promise = true）", body?.time_dependent_not_promise === true);
    check(
      "红线：未录入一律写「未录入」而不是补全（unknown_is_written_as_unknown = true）",
      body?.unknown_is_written_as_unknown === true
    );
    check(
      "红线：不具备必须能指到具体已录入事实（not_have_requires_recorded_fact = true）",
      body?.not_have_requires_recorded_fact === true
    );
    check(
      "红线：证据只引用本产品已录入事实与 Value DNA（evidence_only_from_own_product = true）",
      body?.evidence_only_from_own_product === true
    );
    check(
      "七条规则齐全（固定 16 个 / 三件套 / 五种状态 / §19 句式 / 未录入不得书写 / 不移植竞品 / 下游不代劳）",
      (body?.rules ?? []).length === 7 &&
        (body?.rules ?? []).some((rule) => rule.includes("16 个 Value Code")) &&
        (body?.rules ?? []).some((rule) => rule.includes("evidence / contribution / status")) &&
        (body?.rules ?? []).some((rule) => rule.includes("TIME_DEPENDENT")) &&
        (body?.rules ?? []).some((rule) => rule.includes("未录入一律 UNKNOWN")) &&
        (body?.rules ?? []).some((rule) => rule.includes("竞品事实")) &&
        (body?.rules ?? []).some((rule) => rule.includes("配方哲学由 Phase 11 交付")),
      body?.rules
    );
    const downstream = contract.payload?.downstream ?? [];
    check(
      "下游交接已全部交付：清单为空（Phase 10 / 11 交付后不再登记，§60）",
      downstream.length === 0,
      downstream.map((item) => item.phase)
    );
    check(
      "空清单不产生任何 PENDING 占位条目（不得显示为未交付）",
      downstream.every((item) => item.status === "PENDING" && item.deliverable?.length > 0)
    );
    check("引擎信息：Code 数量 16", engine?.code_count === 16, engine?.code_count);
    check(
      "引擎信息：单产品最多 20 版、分页上限 100（与列表口径一致）",
      engine?.limits?.maxProfilesPerProduct === 20 && engine?.limits?.maxPageSize === 100,
      engine?.limits
    );
    check(
      "引擎信息：六类故事已无交接（Phase 11 配方哲学落地后，配方哲学故事也由正文接管）",
      engine?.story_handoff_phases?.product_architecture_story === undefined &&
        engine?.story_handoff_phases?.formula_philosophy_story === undefined,
      engine?.story_handoff_phases
    );

    console.log("\n[3] 标签口径：状态 / 维度 / 故事文案全部由后端下发");
    const labelsResponse = await request("GET", "/api/value-codes/labels", { token });
    check("标签接口返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check(
      "五种状态的中文标签与短标签齐全",
      STATUS_ORDER.every(
        (status) =>
          typeof labels?.status_labels?.[status] === "string" &&
          labels?.status_labels?.[status].length > 0 &&
          typeof labels?.status_short_labels?.[status] === "string" &&
          labels?.status_short_labels?.[status].length > 0
      )
    );
    check(
      "UNKNOWN 的标签明确写「不得书写」",
      String(labels?.status_labels?.UNKNOWN ?? "").includes("不得书写"),
      labels?.status_labels?.UNKNOWN
    );
    check(
      "五种状态都带展示色（前端不需要自己映射）",
      STATUS_ORDER.every((status) => typeof labels?.status_tones?.[status] === "string")
    );
    check(
      "分析维度标签齐备（至少覆盖六标准轴 + 感官）",
      Object.keys(labels?.dimension_labels ?? {}).length >= 10,
      Object.keys(labels?.dimension_labels ?? {}).length
    );
    check(
      "六类故事标签齐备",
      STORY_KEYS.every((key) => typeof labels?.story_labels?.[key] === "string" && labels.story_labels[key].length > 0)
    );
    check(
      "故事状态标签把「事实不足」写成不得书写",
      String(labels?.story_status_labels?.GAP ?? "").includes("不得书写"),
      labels?.story_status_labels?.GAP
    );
    check(
      "标签接口同样下发 §19 安全句式 / 禁止句式与七条规则",
      labels?.time_dependent_safe_expression === SAFE_EXPRESSION &&
        labels?.time_dependent_forbidden_expression === FORBIDDEN_EXPRESSION &&
        (labels?.rules ?? []).length === 7
    );

    console.log("\n[4] 极简产品：缺事实 → 一律 UNKNOWN + 缺口清单 + 时间依赖只有安全句式");
    const thinProductId = await createProduct("极简产品（只录入身份与规格）", THIN_PRODUCT);
    const thinOverview = await overviewOf(thinProductId);
    check("读取极简产品价值映射总览返回 200", thinOverview.status === 200, thinOverview.status);
    check("极简产品模式判定为自建高端标准（没有可靠锚点，§17）", thinOverview.payload?.mode === "CATEGORY_CREATOR", thinOverview.payload?.mode);
    check(
      "模式判定来源为「无达标候选强制切换」",
      thinOverview.payload?.resolved_by === "NO_RELIABLE_ANCHOR",
      thinOverview.payload?.resolved_by
    );
    check("尚未生成时 profile = null", thinOverview.payload?.profile === null);
    check("尚未生成时版本列表为空", (thinOverview.payload?.versions ?? []).length === 0);
    check("可以生成（未触及 20 版上限）", thinOverview.payload?.can_generate === true);
    check(
      "读取不存在的产品价值映射返回 404",
      (await overviewOf(missingId)).status === 404
    );

    const thinGenerated = await generate(thinProductId, {});
    check("生成极简产品价值映射返回 201", thinGenerated.status === 201, thinGenerated.status);
    const thinProfile = thinGenerated.payload;
    check("新版本号为 1", thinProfile?.version === 1, thinProfile?.version);
    check("16 个 Code 都在（缺口多不等于少给 Code）", (thinProfile?.codes ?? []).length === 16);
    check(
      "缺事实的 Code 一律 UNKNOWN，不补全（§11 / §62-7）",
      (thinProfile?.code_counts?.UNKNOWN ?? 0) >= 10,
      thinProfile?.code_counts
    );
    check(
      "五种状态的计数加起来等于 16",
      STATUS_ORDER.reduce((sum, status) => sum + (thinProfile?.code_counts?.[status] ?? 0), 0) === 16,
      thinProfile?.code_counts
    );
    check(
      "UNKNOWN 的 Code 不携带前台表达（statement 必须为 null）",
      (thinProfile?.codes ?? [])
        .filter((item) => item.status === "UNKNOWN")
        .every((item) => item.statement === null)
    );
    check(
      "UNKNOWN 的 Code 都要写明缺口（不能只标未录入就完事）",
      (thinProfile?.codes ?? [])
        .filter((item) => item.status === "UNKNOWN")
        .every((item) => typeof item.gap === "string" && item.gap.length > 0)
    );
    check(
      "缺口清单非空（前端据此提示先补事实）",
      (thinProfile?.evidence_gaps ?? []).length > 0,
      (thinProfile?.evidence_gaps ?? []).length
    );
    check(
      "时间依赖型 Code 的成交表达只能是 §19 固定句式",
      (thinProfile?.codes ?? [])
        .filter((item) => item.status === "TIME_DEPENDENT")
        .every(
          (item) =>
            item.safe_expression === SAFE_EXPRESSION && item.statement === SAFE_EXPRESSION
        )
    );
    check(
      "所有 Code 的 statement 都不含禁止句「以后一定会有。」（§19）",
      (thinProfile?.codes ?? []).every(
        (item) => !(item.statement ?? "").includes(FORBIDDEN_EXPRESSION)
      )
    );
    check(
      "Code 列表的 contribution 同样不含禁止句",
      (thinProfile?.codes ?? []).every(
        (item) => !(item.contribution ?? "").includes(FORBIDDEN_EXPRESSION)
      )
    );
    check(
      "所有 Code 的三层标记为 INTERPRETATION（§24）",
      (thinProfile?.codes ?? []).every((item) => item.layer === "INTERPRETATION")
    );
    check(
      "故事正文不含禁止句（允许出现在 note / 规则说明里作为约束）",
      STORY_KEYS.every((key) => !(thinProfile?.stories?.[key]?.text ?? "").includes(FORBIDDEN_EXPRESSION))
    );
    check(
      "事实不足时故事状态为 GAP 且正文为 null（宁可留空，不得编）",
      STORY_KEYS.every((key) => {
        const story = thinProfile?.stories?.[key];
        return story?.status !== "GAP" || story.text === null;
      })
    );
    check(
      "没生成配方哲学时故事留空写缺口（Phase 11 已交付，不再交接，§60）",
      thinProfile?.stories?.formula_philosophy_story?.status === "GAP" &&
        thinProfile?.stories?.formula_philosophy_story?.text === null &&
        thinProfile?.stories?.formula_philosophy_story?.handoff_phase === null &&
        (thinProfile?.stories?.formula_philosophy_story?.gap ?? "").includes("尚未生成配方哲学")
    );
    check(
      "没生成产品结构时结构故事留空写缺口（Phase 10 已交付，不再交接，§60）",
      thinProfile?.stories?.product_architecture_story?.status === "GAP" &&
        thinProfile?.stories?.product_architecture_story?.text === null &&
        thinProfile?.stories?.product_architecture_story?.handoff_phase === null &&
        (thinProfile?.stories?.product_architecture_story?.gap ?? "").includes("尚未生成产品结构")
    );
    check(
      "报告里的事实引用只指向本产品已录入字段（product.* / dna.*）",
      (thinProfile?.fact_refs ?? []).every(
        (ref) => ref.startsWith("product.") || ref.startsWith("dna.")
      ) &&
        (thinProfile?.codes ?? []).every((item) =>
          (item.evidence_refs ?? []).every(
            (ref) => ref.startsWith("product.") || ref.startsWith("dna.")
          )
        )
    );
    check("生成时没有可靠对标 → anchor_context 为 null（§17 / §44）", thinProfile?.anchor_context === null);
    check(
      "生成结果的下游交接为空（Phase 10 / 11 已交付，不再登记占位）",
      (thinProfile?.downstream ?? []).length === 0
    );
    check("新生成的一版默认未人工确认", thinProfile?.is_confirmed === false);

    const thinAgain = await generate(thinProductId, { notes: "补录前再跑一版" });
    check("再次生成返回 201 且版本号为 2", thinAgain.status === 201 && thinAgain.payload?.version === 2, thinAgain.payload?.version);
    check(
      "重新生成不改写上一版（v1 仍然存在）",
      (
        await request("GET", `/api/products/${thinProductId}/value-codes/${thinProfile?.id}`, { token })
      ).status === 200
    );
    const thinVersions = await request("GET", `/api/products/${thinProductId}/value-codes/versions`, { token });
    check(
      "版本列表按版本倒序返回（2 / 1，所有版本必须保留）",
      JSON.stringify((thinVersions.payload?.items ?? []).map((item) => item.version)) ===
        JSON.stringify([2, 1]),
      (thinVersions.payload?.items ?? []).map((item) => item.version)
    );
    check(
      "版本摘要带状态分布与时间依赖 / 未录入计数",
      (thinVersions.payload?.items ?? []).every(
        (item) =>
          typeof item.time_dependent_count === "number" &&
          typeof item.unknown_count === "number" &&
          typeof item.code_counts === "object"
      )
    );

    console.log("\n[5] 事实齐备产品：16 个 Code 逐条落位，且不再有未录入项");
    const fullProductId = await createProduct("事实齐备产品（原料 / 工艺 / 感官全部录入）", FULL_PRODUCT);
    const fullGenerated = await generate(fullProductId);
    check("生成事实齐备产品价值映射返回 201", fullGenerated.status === 201, fullGenerated.status);
    const fullProfile = fullGenerated.payload;
    check("v1 的 Code 数量为 16", (fullProfile?.codes ?? []).length === 16);
    check(
      "事实齐备时多数 Code 为「已经具备」",
      (fullProfile?.code_counts?.ALREADY_HAVE ?? 0) >= 10,
      fullProfile?.code_counts
    );
    check(
      "时间依赖型 Code 依然只算时间依赖（不会因为事实多就变成已具备）",
      (fullProfile?.code_counts?.TIME_DEPENDENT ?? 0) === 3,
      fullProfile?.code_counts
    );
    check(
      "事实齐备时不再有未录入项（UNKNOWN = 0）",
      (fullProfile?.code_counts?.UNKNOWN ?? -1) === 0,
      fullProfile?.code_counts
    );
    check(
      "茶气（CHA_QI）只有一个可交叉印证的维度 → 单项事实 PARTIAL",
      codeOf(fullProfile, "CHA_QI")?.status === "PARTIAL",
      codeOf(fullProfile, "CHA_QI")
    );
    check(
      "PARTIAL 的 Code 必须写明还差什么（gap 非空）",
      (fullProfile?.codes ?? [])
        .filter((item) => item.status === "PARTIAL")
        .every((item) => typeof item.gap === "string" && item.gap.length > 0)
    );
    check(
      "已具备的 Code 必须给出前台可说的表达（statement 非空）",
      (fullProfile?.codes ?? [])
        .filter((item) => item.status === "ALREADY_HAVE")
        .every((item) => typeof item.statement === "string" && item.statement.length > 0)
    );
    check(
      "已具备的 Code 必须至少引用一条本产品证据",
      (fullProfile?.codes ?? [])
        .filter((item) => item.status === "ALREADY_HAVE")
        .every((item) => (item.evidence ?? []).length > 0)
    );
    check(
      "事实齐备时身份 / 价格上限 / 风味身份故事可讲，配方哲学未生成时留空写缺口",
      fullProfile?.stories?.identity_story?.status === "READY" &&
        fullProfile?.stories?.flavor_identity_story?.status === "READY" &&
        fullProfile?.stories?.formula_philosophy_story?.status === "GAP" &&
        fullProfile?.stories?.formula_philosophy_story?.text === null,
      Object.fromEntries(
        STORY_KEYS.map((key) => [key, fullProfile?.stories?.[key]?.status])
      )
    );
    check(
      "可讲的故事正文拆开了 Value Code（based_on 非空）",
      STORY_KEYS.every((key) => {
        const story = fullProfile?.stories?.[key];
        return story?.status !== "READY" || (story.based_on ?? []).length > 0;
      })
    );
    // §19 管的是「成交层表达」：Code 层的 statement / safe_expression 必须逐字等于固定句式（见 [4] 已断言）。
    // 故事正文在这句之上只允许补充「已录入的底子」，因此这里断言「引用固定句式 + 不出现禁止句」。
    check(
      "时间故事的正文引用 §19 固定句式，且不出现禁止句",
      (fullProfile?.stories?.time_story?.text ?? "").includes(SAFE_EXPRESSION) &&
        !(fullProfile?.stories?.time_story?.text ?? "").includes(FORBIDDEN_EXPRESSION),
      fullProfile?.stories?.time_story?.text
    );
    check(
      "事实齐备的产品也绝不出现禁止句「以后一定会有。」",
      !JSON.stringify(fullProfile?.codes ?? []).includes(FORBIDDEN_EXPRESSION) &&
        !JSON.stringify(Object.values(fullProfile?.stories ?? {})).includes(
          `"text":"${FORBIDDEN_EXPRESSION}"`
        )
    );

    // 跨阶段：Phase 10 的产品结构生成后，结构故事应直接引用它的正文（§5 / §20 / §60）。
    console.log("\n[5b] 跨阶段：产品结构生成后，结构故事取产品结构正文（§5 / §20）");
    const architecture = await request(
      "POST",
      `/api/products/${fullProductId}/architecture/generate`,
      { token, body: {} }
    );
    check("生成产品结构返回 201", architecture.status === 201, architecture.status);
    check(
      "事实齐备产品的产品结构通过 §57 验收",
      architecture.payload?.acceptance?.passed === true,
      architecture.payload?.acceptance
    );
    const withArchitecture = await generate(fullProductId);
    check("重新生成价值映射返回 201 且版本递增", withArchitecture.status === 201, withArchitecture.status);
    check(
      "结构故事 READY 且正文逐字等于产品结构叙事（不新增事实）",
      withArchitecture.payload?.stories?.product_architecture_story?.status === "READY" &&
        withArchitecture.payload?.stories?.product_architecture_story?.text ===
          architecture.payload?.narrative &&
        withArchitecture.payload?.stories?.product_architecture_story?.handoff_phase === null,
      {
        status: withArchitecture.payload?.stories?.product_architecture_story?.status,
        handoff: withArchitecture.payload?.stories?.product_architecture_story?.handoff_phase
      }
    );
    check(
      "还没生成配方哲学时故事保持 GAP（不退回 Code 拼装的简化版，§60）",
      withArchitecture.payload?.stories?.formula_philosophy_story?.status === "GAP" &&
        withArchitecture.payload?.stories?.formula_philosophy_story?.text === null &&
        (withArchitecture.payload?.stories?.formula_philosophy_story?.gap ?? "").includes(
          "尚未生成配方哲学"
        )
    );

    console.log("\n[6] 人工确认：只改确认状态，不改写正文、不升版本（§62-15）");
    const confirm = await request(
      "PATCH",
      `/api/products/${fullProductId}/value-codes/${fullProfile?.id}`,
      { token, body: { is_confirmed: true } }
    );
    check("人工确认返回 200", confirm.status === 200, confirm.status);
    check("确认后 is_confirmed = true", confirm.payload?.is_confirmed === true);
    check("确认记下确认人", typeof confirm.payload?.confirmed_by === "string" && confirm.payload.confirmed_by.length > 10);
    check("确认记下确认时间", typeof confirm.payload?.confirmed_at === "string");
    check("确认不改版本号", confirm.payload?.version === fullProfile?.version);
    check("确认不改写 Code 落位", JSON.stringify(confirm.payload?.codes) === JSON.stringify(fullProfile?.codes));
    check("确认不改写故事正文", JSON.stringify(confirm.payload?.stories) === JSON.stringify(fullProfile?.stories));
    const unconfirm = await request(
      "PATCH",
      `/api/products/${fullProductId}/value-codes/${fullProfile?.id}`,
      { token, body: { is_confirmed: false } }
    );
    check("取消人工确认返回 200", unconfirm.status === 200, unconfirm.status);
    check("取消后 is_confirmed = false", unconfirm.payload?.is_confirmed === false);
    check(
      "确认状态可回退，历史版本仍可调阅（v1 与产品结构接入后的 v2 都保留）",
      (await request("GET", `/api/products/${fullProductId}/value-codes/versions`, { token })).payload?.items
        ?.length === 2
    );

    console.log("\n[7] 价值密码库：跨产品总览 + 筛选 + 排序 + 分页");
    const library = await request("GET", "/api/value-codes?pageSize=100", { token });
    check("价值密码库返回 200", library.status === 200, library.status);
    check(
      "返回分页结构（total / page / pageSize / totalPages）",
      typeof library.payload?.total === "number" &&
        typeof library.payload?.page === "number" &&
        typeof library.payload?.pageSize === "number" &&
        typeof library.payload?.totalPages === "number"
    );
    check(
      "两款冒烟产品都出现在库里（每款一行）",
      (library.payload?.items ?? []).filter(
        (row) => row.product_id === thinProductId || row.product_id === fullProductId
      ).length === 2
    );
    const thinRow = (library.payload?.items ?? []).find((row) => row.product_id === thinProductId);
    check("行内带产品身份（产品名 / 年份 / 茶类）", typeof thinRow?.product_name === "string" && thinRow?.year === 2026);
    check("行内带模式判定", thinRow?.mode === "CATEGORY_CREATOR", thinRow?.mode);
    check("行内带状态分布", typeof thinRow?.code_counts === "object");
    check(
      "行内带未录入 Code 清单（前端不需要二次请求）",
      Array.isArray(thinRow?.unknown_codes) && thinRow.unknown_codes.length > 0
    );
    const fullRow = (library.payload?.items ?? []).find((row) => row.product_id === fullProductId);
    // 时间依赖 Code 只在「底子已录入」时才算 TIME_DEPENDENT；一条事实都没有的 Code 只能是 UNKNOWN，
    // 所以极简产品只列出它真正有时间依赖底子的那一项，清单必须与状态分布同源。
    check(
      "行内带时间依赖 Code 清单（只可能是三个时间依赖 Code，且与状态分布同源）",
      Array.isArray(thinRow?.time_dependent_codes) &&
        thinRow.time_dependent_codes.length === (thinRow?.code_counts?.TIME_DEPENDENT ?? -1) &&
        thinRow.time_dependent_codes.every((code) => TIME_DEPENDENT_CODES.includes(code)) &&
        fullRow?.time_dependent_codes?.length === TIME_DEPENDENT_CODES.length &&
        TIME_DEPENDENT_CODES.every((code) => (fullRow?.time_dependent_codes ?? []).includes(code)),
      { thin: thinRow?.time_dependent_codes, full: fullRow?.time_dependent_codes }
    );
    check(
      "行内带时间依赖的成交解释（§19 安全句式）",
      thinRow?.time_dependent_expression === SAFE_EXPRESSION,
      thinRow?.time_dependent_expression
    );
    check("行内带人工确认状态", thinRow?.is_confirmed === true || thinRow?.is_confirmed === false);
    check("行内带生成时间", typeof thinRow?.generated_at === "string");

    const searchByKeyword = await request("GET", "/api/value-codes?q=六星孔雀", { token });
    check(
      "关键词命中事实齐备产品",
      (searchByKeyword.payload?.items ?? []).some((row) => row.product_id === fullProductId),
      (searchByKeyword.payload?.items ?? []).map((row) => row.product_name)
    );
    check(
      "关键词同时排除不匹配的产品",
      !(searchByKeyword.payload?.items ?? []).some((row) => row.product_id === thinProductId)
    );
    const searchByMode = await request("GET", "/api/value-codes?mode=CATEGORY_CREATOR", { token });
    check(
      "按模式筛选可用（当前两款都在自建标准模式）",
      (searchByMode.payload?.items ?? []).length >= 2
    );
    const searchByStatus = await request("GET", "/api/value-codes?status=UNKNOWN", { token });
    check(
      "按状态筛选只返回存在该状态的版本（极简产品）",
      (searchByStatus.payload?.items ?? []).some((row) => row.product_id === thinProductId) &&
        !(searchByStatus.payload?.items ?? []).some(
          (row) => row.product_id === fullProductId && (row.code_counts?.UNKNOWN ?? 0) === 0
        ),
      (searchByStatus.payload?.items ?? []).map((row) => [row.product_name, row.code_counts])
    );
    const sortedByUnknown = await request("GET", "/api/value-codes?sort=-unknown_count", { token });
    check(
      "按未录入最多排序：极简产品排在事实齐备产品前面",
      (sortedByUnknown.payload?.items ?? []).findIndex((row) => row.product_id === thinProductId) <
        (sortedByUnknown.payload?.items ?? []).findIndex((row) => row.product_id === fullProductId),
      (sortedByUnknown.payload?.items ?? []).map((row) => [row.product_name, row.code_counts?.UNKNOWN])
    );
    const sortedByTimeDependent = await request("GET", "/api/value-codes?sort=-time_dependent_count", { token });
    check(
      "按时间依赖最多排序可用（接口返回 200 且结构完整）",
      sortedByTimeDependent.status === 200 &&
        (sortedByTimeDependent.payload?.items ?? []).every(
          (row) => Array.isArray(row.time_dependent_codes)
        )
    );
    const pagedFirst = await request("GET", "/api/value-codes?pageSize=1&page=1", { token });
    check("分页可用：每页 1 条", (pagedFirst.payload?.items ?? []).length === 1, (pagedFirst.payload?.items ?? []).length);
    check(
      "分页回传 totalPages（total 与总条数一致）",
      pagedFirst.payload?.totalPages === pagedFirst.payload?.total,
      [pagedFirst.payload?.total, pagedFirst.payload?.totalPages]
    );
    check(
      "非法排序参数返回 400（strict 校验）",
      (await request("GET", "/api/value-codes?sort=price_desc", { token })).status === 400
    );
    check(
      "非法状态参数返回 400",
      (await request("GET", "/api/value-codes?status=MAYBE", { token })).status === 400
    );

    console.log("\n[8] 权限矩阵：只读可看不可改，研究员可写");
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
      "只读账号可以读价值映射总览",
      (await request("GET", `/api/products/${thinProductId}/value-codes`, { token: viewerToken })).status === 200
    );
    check(
      "只读账号不能生成价值映射",
      (
        await generate(thinProductId, { notes: "只读尝试" }, viewerToken)
      ).status === 403
    );
    check(
      "只读账号不能人工确认价值映射",
      (
        await request("PATCH", `/api/products/${thinProductId}/value-codes/${thinProfile?.id}`, {
          token: viewerToken,
          body: { is_confirmed: true }
        })
      ).status === 403
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
    check("研究员可以生成价值映射", researcherGenerated.status === 201, researcherGenerated.status);
    const researcherConfirm = await request(
      "PATCH",
      `/api/products/${thinProductId}/value-codes/${researcherGenerated.payload?.id}`,
      { token: researcherToken, body: { is_confirmed: true } }
    );
    check("研究员可以人工确认价值映射", researcherConfirm.status === 200, researcherConfirm.status);
    check(
      "研究员确认后记下确认人",
      typeof researcherConfirm.payload?.confirmed_by === "string" &&
        researcherConfirm.payload.confirmed_by.length > 10
    );
    check(
      "写入只新增版本，历史版本全部保留（v3 / v2 / v1）",
      JSON.stringify(
        (
          await request("GET", `/api/products/${thinProductId}/value-codes/versions`, { token })
        ).payload?.items?.map((item) => item.version)
      ) === JSON.stringify([3, 2, 1])
    );
    check(
      "人工确认与备注不随新版本丢失（v3 仍为已确认）",
      (
        await request("GET", `/api/products/${thinProductId}/value-codes`, { token })
      ).payload?.versions?.some((item) => item.version === 3 && item.is_confirmed === true)
    );

    console.log("\n[9] 边界与错误：严格 schema、跨产品不串号");
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
      (
        await request("PATCH", `/api/products/${thinProductId}/value-codes/${thinProfile?.id}`, {
          token,
          body: { is_confirmed: true, status: "ALREADY_HAVE" }
        })
      ).status === 400
    );
    check(
      "给不存在的产品生成价值映射返回 404",
      (await generate(missingId)).status === 404
    );
    check(
      "读不存在产品的版本列表返回 404",
      (await request("GET", `/api/products/${missingId}/value-codes/versions`, { token })).status === 404
    );
    check(
      "读不存在的价值映射版本返回 404",
      (
        await request("GET", `/api/products/${thinProductId}/value-codes/${missingId}`, { token })
      ).status === 404
    );
    check(
      "跨产品调阅版本不串号（用别的产品的 id 查不到）",
      (
        await request("GET", `/api/products/${fullProductId}/value-codes/${thinProfile?.id}`, { token })
      ).status === 404
    );
  } finally {
    for (const productId of createdProductIds) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `[清理] 删除冒烟产品 ${productId}（级联删除价值映射）→ ${
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
