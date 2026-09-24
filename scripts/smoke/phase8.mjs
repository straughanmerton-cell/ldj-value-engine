/**
 * Phase 8 端到端冒烟（规格 §4.2 自建高端标准模式 / §17 无锚点强制逻辑 / §29 成交表达口径 / §24 三层标记）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase8.mjs
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（自建标准随产品级联删除）与临时账号，
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员），并校验 category_creator_profiles = 0。
 *
 * 为什么不需要灌来源：本阶段不依赖抓取与候选池，只依赖两点——
 *   1) 模式判定直接复用 Phase 7 的锚点引擎（没有锚点 → 必须进入自建标准）；
 *   2) 标准由产品自身已录入事实推出（事实不足 → 输出缺口清单）。
 * 因此脚本刻意只用「极简产品」与「事实齐备产品」两类输入，验证两条硬约束：
 * 没有对标不等于没有内容，事实不够就不许写文案。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-phase8-viewer@longdeji.local";
const RESEARCHER_EMAIL = "smoke-phase8-researcher@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

const AXIS_ORDER = ["FRAME", "DEPTH", "IDENTITY", "FIRST_IMPRESSION", "FINISH", "CRAFT"];

/** 事实齐备的产品：六个标准轴都能拿到 ≥2 条事实，自建标准可以成立（与 API 测试 fixture 同口径）。 */
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

/** 几乎没有事实的产品：只保留身份与规格，用来验证「事实不足就写缺口」。 */
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

function itemOf(items, predicate) {
  return (items ?? []).find(predicate);
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  const createdProductIds = [];
  const createdUserEmails = [];
  const missingId = "00000000-0000-4000-8000-000000000000";

  /** 创建冒烟产品（统一走 API，确保产品创建时的规则引擎也参与）。 */
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

  async function overviewOf(productId) {
    return request("GET", `/api/products/${productId}/category-creator`, { token });
  }

  async function generate(productId, body = {}) {
    return request("POST", `/api/products/${productId}/category-creator/generate`, { token, body });
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

    console.log("\n[2] §4.2 合同自检：两触发条件 + 六标准轴 + 三层标记 + 六条红线 + 下游只登记");
    const contract = await request("GET", "/api/category-creator/contract", { token });
    check("自建标准合同返回 200", contract.status === 200, contract.status);
    const body = contract.payload?.contract;
    check("合同引用 §4.2 / §17 / §29", body?.spec_ref === "§4.2 / §17 / §29", body?.spec_ref);
    check(
      "两个触发条件齐全且顺序固定（没有可靠锚点 → 用户选择不使用对标）",
      JSON.stringify((body?.triggers ?? []).map((item) => item.trigger)) ===
        JSON.stringify(["NO_RELIABLE_ANCHOR", "USER_OPT_OUT"]),
      (body?.triggers ?? []).map((item) => item.trigger)
    );
    check(
      "两个触发条件都写明判定口径（前端不会只剩触发码）",
      (body?.triggers ?? []).length === 2 &&
        (body?.triggers ?? []).every((item) => item.label?.length > 0 && item.condition?.length > 0)
    );
    check(
      "六个标准轴齐备且顺序固定（骨架 → 底气 → 身份 → 第一口 → 后半程 → 工艺）",
      JSON.stringify((body?.axes ?? []).map((item) => item.axis)) === JSON.stringify(AXIS_ORDER),
      (body?.axes ?? []).map((item) => item.axis)
    );
    check(
      "六个标准轴都有中文名（骨架 / 底气 / 身份 / 第一口 / 后半程 / 工艺）",
      ["骨架", "底气", "身份", "第一口", "后半程", "工艺"].every((label) =>
        (body?.axes ?? []).some((item) => String(item.label).includes(label))
      ),
      (body?.axes ?? []).map((item) => item.label)
    );
    check("成交表达最低门槛为 2 轴有事实", body?.min_supported_axes === 2, body?.min_supported_axes);
    check(
      "表达分层为 FACT / INTERPRETATION / RHETORIC（§24）",
      JSON.stringify(body?.layers) === JSON.stringify(["FACT", "INTERPRETATION", "RHETORIC"]),
      body?.layers
    );
    check("红线：没有对标不等于文案变弱（not_weak_copy = true）", body?.not_weak_copy === true, body?.not_weak_copy);
    check("红线：不得硬凑竞品（no_fake_benchmark = true）", body?.no_fake_benchmark === true, body?.no_fake_benchmark);
    check(
      "红线：未录入的轴写「未录入」而不是补全（unknown_is_written_as_unknown = true）",
      body?.unknown_is_written_as_unknown === true,
      body?.unknown_is_written_as_unknown
    );
    check(
      "六条规则齐全（强制进入 / 不硬凑 / 不变弱 / 只引用已录入事实 / 三层标记 / 下游不代劳）",
      (body?.rules ?? []).length === 6 &&
        (body?.rules ?? []).some((rule) => rule.includes("必须进入 Category Creator Mode")) &&
        (body?.rules ?? []).some((rule) => rule.includes("不得硬凑竞品")) &&
        (body?.rules ?? []).some((rule) => rule.includes("没有对标不等于文案变弱")) &&
        (body?.rules ?? []).some((rule) => rule.includes("只能引用已录入事实")) &&
        (body?.rules ?? []).some((rule) => rule.includes("FACT / INTERPRETATION / RHETORIC")) &&
        (body?.rules ?? []).some((rule) => rule.includes("Phase 10 / 11 / 12")),
      body?.rules
    );
    const downstream = contract.payload?.downstream ?? [];
    check(
      "下游交接已全部交付：清单为空，不得把已交付阶段留在清单里（§60）",
      downstream.length === 0,
      downstream.map((item) => item.phase)
    );
    check(
      "空清单不产生任何 PENDING 占位条目（不得显示为未交付）",
      downstream.every((item) => item.status === "PENDING" && item.deliverable?.length > 0)
    );
    const engine = contract.payload?.engine;
    check("引擎自检模式为 CATEGORY_CREATOR", engine?.mode === "CATEGORY_CREATOR", engine?.mode);
    check(
      "引擎自检口径与合同一致（2 轴门槛 + 三条红线）",
      engine?.min_supported_axes === 2 &&
        engine?.not_weak_copy === true &&
        engine?.no_fake_benchmark === true &&
        engine?.unknown_is_written_as_unknown === true,
      engine
    );
    check(
      "引擎说明写明「没有现成对标 ≠ 没有价值可讲」",
      String(engine?.note ?? "").includes("没有现成对标 ≠ 没有价值可讲"),
      engine?.note
    );
    check("未登录读自建标准合同返回 401", (await request("GET", "/api/category-creator/contract")).status === 401);

    const labels = await request("GET", "/api/category-creator/labels", { token });
    check("前端文案标签接口返回 200", labels.status === 200, labels.status);
    check("六轴中文名由后端统一提供", Object.keys(labels.payload?.axis_labels ?? {}).length === 6);
    check(
      "UNKNOWN 状态文案写明「不得书写」",
      String(labels.payload?.axis_status_labels?.UNKNOWN ?? "").includes("不得书写"),
      labels.payload?.axis_status_labels?.UNKNOWN
    );
    check(
      "INSUFFICIENT 文案写明「不得输出成交表达」",
      String(labels.payload?.readiness_labels?.INSUFFICIENT ?? "").includes("不得输出成交表达"),
      labels.payload?.readiness_labels?.INSUFFICIENT
    );
    check("标签接口同时回传六条规则", (labels.payload?.rules ?? []).length === 6);

    console.log("\n[3] §17 没有锚点：总览直接落到自建标准模式，且尚未生成任何版本");
    const thinProductId = await createProduct("龙德记试样茶", THIN_PRODUCT);
    check("返回产品 id", typeof thinProductId === "string" && thinProductId.length > 10, thinProductId);
    const thinOverview = await overviewOf(thinProductId);
    check("总览返回 200", thinOverview.status === 200, thinOverview.status);
    check("mode = CATEGORY_CREATOR", thinOverview.payload?.mode === "CATEGORY_CREATOR", thinOverview.payload?.mode);
    check(
      "resolved_by = NO_RELIABLE_ANCHOR（复用 Phase 7 判定，不另建一套阈值）",
      thinOverview.payload?.resolved_by === "NO_RELIABLE_ANCHOR",
      thinOverview.payload?.resolved_by
    );
    check(
      "模式理由写明「不得硬凑竞品或降低阈值」",
      String(thinOverview.payload?.mode_reason ?? "").includes("不得硬凑竞品") &&
        String(thinOverview.payload?.mode_reason ?? "").includes("降低阈值"),
      thinOverview.payload?.mode_reason
    );
    check(
      "建议触发条件为 NO_RELIABLE_ANCHOR",
      thinOverview.payload?.suggested_trigger === "NO_RELIABLE_ANCHOR",
      thinOverview.payload?.suggested_trigger
    );
    check("尚未生成时 profile 为 null 且版本列表为空", thinOverview.payload?.profile === null && (thinOverview.payload?.versions ?? []).length === 0);
    check("can_generate = true（事实不足也允许生成完整标准文档）", thinOverview.payload?.can_generate === true);
    check("总览引用 §4.2 / §17 / §29", thinOverview.payload?.spec_ref === "§4.2 / §17 / §29", thinOverview.payload?.spec_ref);
    check(
      "查不存在的产品自建标准返回 404",
      (await overviewOf(missingId)).status === 404
    );

    // §9 口径：产品创建会自动跑规则引擎生成 Value DNA。这里先确认它确实生成了，
    // 再把 DNA 清成空对象，用来验证「空 Value DNA 视同未生成」的归一逻辑（否则空 DNA 会静默参与标准）。
    const dnaBefore = await client.query("select value_dna from products where id = $1", [thinProductId]);
    const autoDna = dnaBefore.rows[0]?.value_dna;
    check(
      "产品创建已自动生成价值 DNA（§9 规则引擎）",
      Array.isArray(autoDna?.identity) && autoDna.identity.length > 0,
      autoDna
    );
    await client.query("update products set value_dna = '{}'::jsonb where id = $1", [thinProductId]);
    const dnaAfter = await client.query("select value_dna from products where id = $1", [thinProductId]);
    check(
      "已把价值 DNA 置为空对象（模拟「尚未生成」的 11 维全空结构）",
      JSON.stringify(dnaAfter.rows[0]?.value_dna) === "{}",
      dnaAfter.rows[0]?.value_dna
    );

    console.log("\n[4] 事实不足时生成 v1：输出缺口清单，不出成交表达（不写弱化版文案）");
    const first = await generate(thinProductId, { notes: "第一轮：事实尚未录入" });
    check("生成返回 201", first.status === 201, first.status);
    const thinProfile = first.payload;
    check("版本号为 1", thinProfile?.version === 1, thinProfile?.version);
    check(
      "触发条件记为 NO_RELIABLE_ANCHOR，生成时模式为 CATEGORY_CREATOR",
      thinProfile?.trigger === "NO_RELIABLE_ANCHOR" && thinProfile?.mode_at_generation === "CATEGORY_CREATOR",
      { trigger: thinProfile?.trigger, mode: thinProfile?.mode_at_generation }
    );
    check("六个标准轴齐备且顺序固定", JSON.stringify((thinProfile?.standard?.items ?? []).map((item) => item.axis)) === JSON.stringify(AXIS_ORDER));
    check("标准成立度为 INSUFFICIENT（事实不足）", thinProfile?.readiness === "INSUFFICIENT", thinProfile?.readiness);
    check("拿到事实的轴为 0", thinProfile?.supported_axes === 0, thinProfile?.supported_axes);
    check("总轴数为 6", thinProfile?.total_axes === 6, thinProfile?.total_axes);
    const unknowns = (thinProfile?.standard?.items ?? []).filter((item) => item.status === "UNKNOWN");
    check("至少 4 个轴为 UNKNOWN", unknowns.length >= 4, unknowns.length);
    check(
      "UNKNOWN 轴一律不写文案（statement = null）",
      unknowns.every((item) => item.statement === null),
      unknowns.map((item) => item.statement)
    );
    check(
      "UNKNOWN 轴都给出缺口说明（缺口清单是标准的组成部分）",
      unknowns.every((item) => typeof item.gap === "string" && item.gap.length > 0)
    );
    check(
      "每个轴都写明「必须成立什么」与层级标记 INTERPRETATION（§24）",
      (thinProfile?.standard?.items ?? []).every(
        (item) => item.requirement?.length > 0 && item.layer === "INTERPRETATION"
      )
    );
    check(
      "标准总结写明「自建标准尚未成立」",
      String(thinProfile?.standard?.summary ?? "").includes("自建标准尚未成立"),
      thinProfile?.standard?.summary
    );
    check("sales_line_ready = false", thinProfile?.value_logic?.sales_line_ready === false);
    check(
      "不输出 SALES_LINE 段（宁可少讲，不得编）",
      (thinProfile?.value_logic?.items ?? []).some((item) => item.stage === "SALES_LINE") === false,
      (thinProfile?.value_logic?.items ?? []).map((item) => item.stage)
    );
    check(
      "价值逻辑链里没有 RHETORIC 层",
      (thinProfile?.value_logic?.items ?? []).some((item) => item.layer === "RHETORIC") === false
    );
    check(
      "FACT / INTERPRETATION / VALUE 三段仍在（缺的是成交段，不是整条链）",
      JSON.stringify((thinProfile?.value_logic?.items ?? []).map((item) => item.stage)) ===
        JSON.stringify(["FACT", "INTERPRETATION", "VALUE"]),
      (thinProfile?.value_logic?.items ?? []).map((item) => item.stage)
    );
    check("缺口清单至少 6 条", (thinProfile?.evidence_gaps ?? []).length >= 6, thinProfile?.evidence_gaps?.length);
    check(
      "空价值 DNA 视同未生成：缺口清单照实提示，且不引用 dna.*（§9）",
      (thinProfile?.evidence_gaps ?? []).some((gap) => gap.includes("价值 DNA")) &&
        (thinProfile?.value_dna_refs ?? []).length === 0,
      { gaps: thinProfile?.evidence_gaps, refs: thinProfile?.value_dna_refs }
    );
    check(
      "风格身份证留白而不是编造（time_story = null，§19 属 Phase 9）",
      thinProfile?.style_identity?.time_story === null
    );
    check(
      "明确不声称三条齐全（不借老茶 / 不写未录入 / 不因无对标而降强度）",
      (thinProfile?.style_identity?.not_claiming ?? []).length === 3,
      thinProfile?.style_identity?.not_claiming
    );
    check(
      "身份证第一口 / 中段 / 收尾均为空（事实不足不留说法）",
      thinProfile?.style_identity?.first_impression === null &&
        thinProfile?.style_identity?.mid_palate === null &&
        thinProfile?.style_identity?.finish === null
    );
    check(
      "本版下游交接同样为空（Phase 10 / 11 已交付后不再登记，§60）",
      (thinProfile?.downstream ?? []).length === 0 &&
        (thinProfile?.downstream ?? []).every((item) => item.status === "PENDING")
    );
    check("生成后总览带出最新版与版本列表", (await overviewOf(thinProductId)).payload?.profile?.id === thinProfile?.id);

    console.log("\n[5] 补事实后重新生成：版本 +1、成立度提升、旧版本仍可查（§62-15）");
    const patched = await request("PATCH", `/api/products/${thinProductId}`, {
      token,
      body: {
        mountain: "布朗山",
        origin_region: "勐海",
        raw_material: "大树春茶",
        season: "春茶",
        dry_leaf_aroma: "烟香明显",
        hot_cup_aroma: "蜜香",
        entry_taste: "浓强",
        thickness: "厚",
        huigan: "快",
        salivation: "强",
        cha_qi: "明显",
        kill_green_method: "铁锅杀青",
        rolling_method: "手工揉捻"
      }
    });
    check("补录事实返回 200", patched.status === 200, patched.status);

    const second = await generate(thinProductId, { notes: "第二轮：补齐产区 / 原料 / 感官 / 工艺事实" });
    check("重新生成返回 201", second.status === 201, second.status);
    check("版本号为 2（只新增版本，不改写历史）", second.payload?.version === 2, second.payload?.version);
    check(
      "成立度提升到 READY / PARTIAL",
      ["READY", "PARTIAL"].includes(second.payload?.readiness),
      second.payload?.readiness
    );
    check(
      "拿到事实的轴比上一版更多",
      (second.payload?.supported_axes ?? 0) > (thinProfile?.supported_axes ?? 0),
      { before: thinProfile?.supported_axes, after: second.payload?.supported_axes }
    );
    check(
      "补事实后开始输出成交表达（没有对标不等于文案变弱）",
      second.payload?.value_logic?.sales_line_ready === true &&
        (second.payload?.value_logic?.items ?? []).some((item) => item.stage === "SALES_LINE")
    );
    const salesLineText = itemOf(second.payload?.value_logic?.items, (item) => item.stage === "SALES_LINE")?.text ?? "";
    check(
      "成交表达直接说出「找不到完全一样的对标」且属于 RHETORIC 层",
      salesLineText.includes("找不到完全一样的对标") &&
        itemOf(second.payload?.value_logic?.items, (item) => item.stage === "SALES_LINE")?.layer === "RHETORIC",
      salesLineText
    );
    check(
      "未录入的树龄不得出现在成交表达里（§62-7）",
      !salesLineText.includes("树龄"),
      salesLineText
    );
    check(
      "已录入事实被逐条引用（含 product.mountain）",
      (second.payload?.fact_refs ?? []).includes("product.mountain"),
      second.payload?.fact_refs
    );

    const versions = await request("GET", `/api/products/${thinProductId}/category-creator/versions`, { token });
    check("版本列表返回 200", versions.status === 200, versions.status);
    check(
      "版本倒序且保留两版（[2, 1]）",
      JSON.stringify((versions.payload?.items ?? []).map((item) => item.version)) === JSON.stringify([2, 1]),
      (versions.payload?.items ?? []).map((item) => item.version)
    );
    check(
      "旧版本仍标记为 INSUFFICIENT（历史结论不被篡改）",
      itemOf(versions.payload?.items, (item) => item.version === 1)?.readiness === "INSUFFICIENT"
    );
    const oldProfile = await request("GET", `/api/products/${thinProductId}/category-creator/${thinProfile?.id}`, {
      token
    });
    check("单版自建标准可单独调阅（返回 200）", oldProfile.status === 200, oldProfile.status);
    check(
      "调阅旧版本仍然没有成交表达",
      oldProfile.payload?.readiness === "INSUFFICIENT" && oldProfile.payload?.value_logic?.sales_line_ready === false
    );
    check(
      "总览默认给最新一版",
      (await overviewOf(thinProductId)).payload?.profile?.version === 2
    );

    console.log("\n[6] 人工确认：只改确认状态，不新增版本、不删除历史（§62-15）");
    const confirmed = await request("PATCH", `/api/products/${thinProductId}/category-creator/${thinProfile?.id}`, {
      token,
      body: { is_confirmed: true, notes: "研究员已核对六轴口径" }
    });
    check("人工确认返回 200", confirmed.status === 200, confirmed.status);
    check("is_confirmed = true 且记下确认时间", confirmed.payload?.is_confirmed === true && confirmed.payload?.confirmed_at !== null);
    check("确认不改变版本号（v1 仍是 v1）", confirmed.payload?.version === 1, confirmed.payload?.version);
    check("确认不改写标准正文（readiness 仍是 INSUFFICIENT）", confirmed.payload?.readiness === "INSUFFICIENT");
    const afterConfirm = await request("GET", `/api/products/${thinProductId}/category-creator/versions`, { token });
    check(
      "确认后仍只有两版，且 v1 被标记为已确认",
      (afterConfirm.payload?.items ?? []).length === 2 &&
        itemOf(afterConfirm.payload?.items, (item) => item.version === 1)?.is_confirmed === true
    );
    const unconfirmed = await request("PATCH", `/api/products/${thinProductId}/category-creator/${thinProfile?.id}`, {
      token,
      body: { is_confirmed: false }
    });
    check(
      "取消确认可回退（is_confirmed = false 且清空确认人）",
      unconfirmed.payload?.is_confirmed === false &&
        unconfirmed.payload?.confirmed_at === null &&
        unconfirmed.payload?.confirmed_by === null
    );

    console.log("\n[7] 产品负责人指定自建标准：触发条件记为 USER_OPT_OUT + 模式来源 MANUAL_PREFERENCE");
    const optOutProductId = await createProduct("龙德记六星孔雀（人工指定自建标准）", {
      ...FULL_PRODUCT,
      product_name: "龙德记六星孔雀（人工指定自建标准）",
      benchmark_mode_preference: "CATEGORY_CREATOR"
    });
    const optOutOverview = await overviewOf(optOutProductId);
    check("产品偏好为 CATEGORY_CREATOR", optOutOverview.payload?.preference === "CATEGORY_CREATOR", optOutOverview.payload?.preference);
    check("mode = CATEGORY_CREATOR", optOutOverview.payload?.mode === "CATEGORY_CREATOR", optOutOverview.payload?.mode);
    check(
      "resolved_by = MANUAL_PREFERENCE（人工偏好，不是无锚点强制）",
      optOutOverview.payload?.resolved_by === "MANUAL_PREFERENCE",
      optOutOverview.payload?.resolved_by
    );
    check(
      "建议触发条件为 USER_OPT_OUT",
      optOutOverview.payload?.suggested_trigger === "USER_OPT_OUT",
      optOutOverview.payload?.suggested_trigger
    );
    check(
      "模式理由写明「指定进入自建高端标准模式」",
      String(optOutOverview.payload?.mode_reason ?? "").includes("自建高端标准模式"),
      optOutOverview.payload?.mode_reason
    );
    const optOutProfile = await generate(optOutProductId, { notes: "产品负责人选择不使用对标" });
    check("生成成功", optOutProfile.status === 201, optOutProfile.status);
    check(
      "触发条件记为 USER_OPT_OUT",
      optOutProfile.payload?.trigger === "USER_OPT_OUT",
      optOutProfile.payload?.trigger
    );
    check(
      "事实齐备时生成 READY 标准（人工弃用对标同样不许变弱）",
      optOutProfile.payload?.readiness === "READY",
      optOutProfile.payload?.readiness
    );
    check(
      "六个轴全部有事实与文案",
      (optOutProfile.payload?.standard?.items ?? []).every(
        (item) => item.status !== "UNKNOWN" && item.statement !== null && item.evidence_refs.length > 0
      ),
      (optOutProfile.payload?.standard?.items ?? []).map((item) => item.status)
    );
    check(
      "风格身份证用产区 + 辨识度命名（含布朗山）",
      String(optOutProfile.payload?.style_identity?.identity_name ?? "").includes("布朗山"),
      optOutProfile.payload?.style_identity?.identity_name
    );
    check("已确认状态默认为 false", optOutProfile.payload?.is_confirmed === false);
    check(
      "写入的备注被保留（版本可追溯）",
      optOutProfile.payload?.notes === "产品负责人选择不使用对标"
    );
    const explicitTrigger = await generate(optOutProductId, { trigger: "NO_RELIABLE_ANCHOR" });
    check(
      "生成入参可显式覆盖触发条件（v2 记为 NO_RELIABLE_ANCHOR）",
      explicitTrigger.payload?.trigger === "NO_RELIABLE_ANCHOR" && explicitTrigger.payload?.version === 2,
      { trigger: explicitTrigger.payload?.trigger, version: explicitTrigger.payload?.version }
    );
    check(
      "非法触发条件返回 400",
      (await generate(optOutProductId, { trigger: "MAGIC" })).status === 400
    );
    check(
      "生成请求多余字段返回 400（schema 严格）",
      (await generate(optOutProductId, { trigger: "USER_OPT_OUT", product: "x" })).status === 400
    );
    check(
      "人工维护多余字段返回 400（schema 严格）",
      (
        await request("PATCH", `/api/products/${optOutProductId}/category-creator/${optOutProfile.payload?.id}`, {
          token,
          body: { readiness: "READY" }
        })
      ).status === 400
    );

    console.log("\n[8] 权限与边界：读需登录，写限 ADMIN / RESEARCHER，不存在就如实报不存在");
    for (const [name, options] of [
      ["自建标准合同", { method: "GET", path: "/api/category-creator/contract" }],
      ["自建标准标签", { method: "GET", path: "/api/category-creator/labels" }],
      ["自建标准总览", { method: "GET", path: `/api/products/${thinProductId}/category-creator` }],
      ["自建标准版本列表", { method: "GET", path: `/api/products/${thinProductId}/category-creator/versions` }],
      ["生成自建标准", { method: "POST", path: `/api/products/${thinProductId}/category-creator/generate`, body: {} }],
      [
        "单版自建标准",
        { method: "GET", path: `/api/products/${thinProductId}/category-creator/${thinProfile?.id}` }
      ],
      [
        "人工确认自建标准",
        {
          method: "PATCH",
          path: `/api/products/${thinProductId}/category-creator/${thinProfile?.id}`,
          body: { is_confirmed: true }
        }
      ]
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
    check(
      "只读账号可以看自建标准总览",
      (await request("GET", `/api/products/${thinProductId}/category-creator`, { token: viewerToken })).status === 200
    );
    check(
      "只读账号不能生成自建标准（否则能改标准口径）",
      (
        await request("POST", `/api/products/${thinProductId}/category-creator/generate`, {
          token: viewerToken,
          body: {}
        })
      ).status === 403
    );
    check(
      "只读账号不能人工确认自建标准",
      (
        await request("PATCH", `/api/products/${thinProductId}/category-creator/${thinProfile?.id}`, {
          token: viewerToken,
          body: { is_confirmed: true }
        })
      ).status === 403
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
    const researcherGenerate = await request("POST", `/api/products/${thinProductId}/category-creator/generate`, {
      token: researcherToken,
      body: { notes: "研究员重建一版" }
    });
    check("研究员可以生成自建标准", researcherGenerate.status === 201, researcherGenerate.status);
    const researcherConfirm = await request(
      "PATCH",
      `/api/products/${thinProductId}/category-creator/${researcherGenerate.payload?.id}`,
      { token: researcherToken, body: { is_confirmed: true } }
    );
    check("研究员可以人工确认自建标准", researcherConfirm.status === 200, researcherConfirm.status);
    check(
      "研究员确认后记下确认人",
      typeof researcherConfirm.payload?.confirmed_by === "string" && researcherConfirm.payload?.confirmed_by.length > 10
    );

    check(
      "给不存在的产品生成自建标准返回 404",
      (
        await request("POST", `/api/products/${missingId}/category-creator/generate`, {
          token,
          body: {}
        })
      ).status === 404
    );
    check(
      "给不存在的产品读版本列表返回 404",
      (await request("GET", `/api/products/${missingId}/category-creator/versions`, { token })).status === 404
    );
    check(
      "读不存在的自建标准版本返回 404",
      (await request("GET", `/api/products/${thinProductId}/category-creator/${missingId}`, { token })).status === 404
    );
    check(
      "确认不存在的自建标准版本返回 404",
      (
        await request("PATCH", `/api/products/${thinProductId}/category-creator/${missingId}`, {
          token,
          body: { is_confirmed: true }
        })
      ).status === 404
    );
    check(
      "跨产品调阅版本不串号（用别的产品的 id 查不到）",
      (
        await request("GET", `/api/products/${optOutProductId}/category-creator/${thinProfile?.id}`, { token })
      ).status === 404
    );

    const thinVersions = await request("GET", `/api/products/${thinProductId}/category-creator/versions`, { token });
    check(
      "只读 / 研究员写入都只新增版本，历史版本全部保留（v1 / v2 / v3）",
      JSON.stringify((thinVersions.payload?.items ?? []).map((item) => item.version)) ===
        JSON.stringify([3, 2, 1]),
      (thinVersions.payload?.items ?? []).map((item) => item.version)
    );
  } finally {
    for (const productId of createdProductIds) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `[清理] 删除冒烟产品 ${productId}（级联删除自建标准）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from products) as products, (select count(*)::int from sources) as sources, (select count(*)::int from market_offers) as offers, (select count(*)::int from comparable_candidates) as candidates, (select count(*)::int from value_anchors) as anchors, (select count(*)::int from category_creator_profiles) as profiles"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：products=${row?.products} · sources=${row?.sources} · market_offers=${row?.offers} · comparable_candidates=${row?.candidates} · value_anchors=${row?.anchors} · category_creator_profiles=${row?.profiles}`
    );
    check(
      "冒烟结束后业务表清零（只保留 seed）",
      row?.products === 0 &&
        row?.sources === 0 &&
        row?.offers === 0 &&
        row?.candidates === 0 &&
        row?.anchors === 0 &&
        row?.profiles === 0,
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
