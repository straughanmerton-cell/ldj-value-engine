/**
 * 卖点一页纸（HANDCARD）端到端冒烟（客户 2026-09-26 追加需求 / 规格 §10 / §11 / §22 / §47 /
 * §53 / §57 / §60 / §62-5 / §62-15）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/handcard.mjs
 *
 * 注意：事实审核在 `AI_PROVIDER != mock` 时会真调一次模型（几十秒），除此之外都是纯规则链路。
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的产品（成稿 / 审核结论 / 证据行级联删除）与
 *       临时账号，并校验业务表清零（只保留 seed 与 16 行 Value Code 字典）。
 *
 * 本脚本压的是五条硬约束：
 *   1) §60 / §53：导出闸门只有一条口径——没有「事实审核通过 + 人工审批通过」的成稿时硬 409，
 *      不许产出「看起来能用其实没审过」的文件；
 *   2) §62-15：一页纸是**只读派生排版**，02 段逐字来自成稿的 §47 七条卖点，03 / 04 段逐字来自
 *      产品主档案已录入字段，页面不新增任何事实、不可编辑；
 *   3) §11：没录入的字段整行**不出现**，不生成「未知 / 待补充」占位；
 *   4) §62-5：一页纸不出现任何外部链接（对标只用于讲价格高度，不把竞品事实搬进龙德记的纸）；
 *   5) 交付层只读：任何登录角色都能导出同一份纸，写权限与闸门都不因角色而变。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-handcard-viewer@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** 合同口径（与 `DELIVERY_SPEC_REF` 同源）。 */
const SPEC_REF = "§51 / §52 / §53 / §57 / §62-14 / §62-15";
/** 一页纸的四段：编号即页面徽标，顺序不许变。 */
const HANDCARD_SECTIONS = [
  { index: "01", label: "产品介绍" },
  { index: "02", label: "核心卖点" },
  { index: "03", label: "口感特点" },
  { index: "04", label: "补充清单" }
];
/** §47 七条卖点：一条不删、不合并。 */
const SELLING_POINT_COUNT = 7;
/** 事实齐备的产品：能一路走到「可交付」（与 Phase 12–15 fixture 同口径）。 */
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
/** 一页纸 04 段必须是「录入了才有这一行」的字段样本：这里只验没录入的树龄不出现。 */
const RECORDED_FACT = { label: "树型", value: "大树" };
const UNRECORDED_FACT_LABEL = "树龄";
/** §10.4 已录入的感官值：03 段必须逐字带上。 */
const RECORDED_SENSORY = ["烟香明显", "蜜香", "浓强", "12 泡以上"];
/** 事实齐备产品里没有录入的感官值：03 段不许凭空出现「兰花香」这类没记过的结论。 */

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

/** 与 `escapeHandcardHtml()` 同源的转义：用来在 HTML 里逐字找回成稿原文。 */
function escapeHandcardHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 每次现场生成的只有时间戳；比对两次导出的正文时要先抹掉它。 */
function withoutGeneratedAt(text) {
  return String(text ?? "").replace(/生成于 [^<]*/u, "生成于（每次现场生成）");
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  const createdProductIds = [];
  const createdUserEmails = [];
  const missingId = "00000000-0000-4000-8000-000000000000";
  const notAUuid = "not-a-uuid";

  const createProduct = async (payload) => {
    const created = await request("POST", "/api/products", {
      token,
      body: { ...payload, brand_id: null }
    });
    const id = created.payload?.id;
    if (id) {
      createdProductIds.push(id);
    }
    return { status: created.status, id, payload: created.payload };
  };
  const exportOf = (productId, query = "", authToken = token) =>
    request("GET", `/api/products/${productId}/delivery/export${query}`, { token: authToken });
  const generateCopy = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/copy/generate`, { token: authToken, body });
  const generateReview = (productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/fact-review/generate`, { token: authToken, body });
  const decide = (action, productId, body = {}, authToken = token) =>
    request("POST", `/api/products/${productId}/fact-review/${action}`, { token: authToken, body });
  const dealerCenterOf = (productId, authToken = token) =>
    request("GET", `/api/products/${productId}/dealer-center`, { token: authToken });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    check(
      "未登录不能读交付合同 / 标签 / 导出（401）",
      (await request("GET", "/api/delivery/contract")).status === 401 &&
        (await request("GET", "/api/delivery/labels")).status === 401 &&
        (await exportOf(missingId)).status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("登录响应带回 access_token", typeof token === "string" && token.length > 0);

    console.log("\n[2] §60 交付合同自检（导出格式 / 一页纸四段 / 闸门口径）");
    const contractResponse = await request("GET", "/api/delivery/contract", { token });
    check("GET /api/delivery/contract 返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const exportMeta = contract?.export;
    check(
      "导出格式三档：Markdown / 纯文本 / 卖点一页纸（.html）",
      JSON.stringify((exportMeta?.formats ?? []).map((item) => item.key)) ===
        JSON.stringify(["MARKDOWN", "TEXT", "HANDCARD"]) &&
        exportMeta.formats[2].label === "卖点一页纸" &&
        exportMeta.formats[2].extension === ".html" &&
        exportMeta.formats[2].content_type === "text/html; charset=utf-8",
      exportMeta?.formats
    );
    check(
      "一页纸四段（01 产品介绍 / 02 核心卖点 / 03 口感特点 / 04 补充清单）在合同里逐段可读",
      JSON.stringify(
        (exportMeta?.handcard_sections ?? []).map((section) => [section.index, section.label])
      ) ===
        JSON.stringify(HANDCARD_SECTIONS.map((section) => [Number(section.index), section.label])),
      exportMeta?.handcard_sections
    );
    check(
      "合同 spec_ref 与 schema 层同源",
      contract?.spec_ref === SPEC_REF,
      contract?.spec_ref
    );

    console.log("\n[3] 参数与闸门边界（未成稿一律 409，非法参数 400，找不到 404）");
    const thin = await createProduct({
      product_name: "龙德记试样茶",
      year: 2026,
      tea_type: "普洱生茶",
      weight_g: 357,
      benchmark_mode_preference: "AUTO",
      copy_intensity_default: 5
    });
    check("创建「没有成稿」的冒烟产品返回 201", thin.status === 201, thin.status);
    const thinExport = await exportOf(thin.id, "?format=handcard&scope=all");
    check(
      "没有成稿时导出 409，且 details 里给得出「卡在哪一步 + 下一步」",
      thinExport.status === 409 &&
        thinExport.payload?.error?.details?.gate_label === "还没有成稿" &&
        typeof thinExport.payload?.error?.details?.next_action === "string" &&
        thinExport.payload?.content === undefined,
      thinExport.payload?.error?.details?.gate_label
    );
    check(
      "非法参数 400：format 只收小写枚举 / scope 只收 host|dealer|all / 不接受多余参数",
      (await exportOf(thin.id, "?format=HANDCARD&scope=all")).status === 400 &&
        (await exportOf(thin.id, "?format=handcard&scope=ALL")).status === 400 &&
        (await exportOf(thin.id, "?format=handcard&scope=all&nope=1")).status === 400
    );
    check(
      "不存在的产品 / 非 UUID 产品 id：导出 404（不是 500，也不返回半截文件）",
      (await exportOf(missingId, "?format=handcard")).status === 404 &&
        (await exportOf(notAUuid, "?format=handcard")).status === 404
    );

    console.log("\n[4] 事实齐备产品走完整闸门（生成成稿 → 送审 → 人工审批）");
    const full = await createProduct(FULL_PRODUCT);
    check("创建事实齐备的冒烟产品返回 201", full.status === 201, full.status);
    const generate = await generateCopy(full.id, {});
    check(
      "生成 Level 5 成稿返回 201，且 §47 七条卖点一条不少",
      (generate.status === 201 || generate.status === 200) &&
        (generate.payload?.selling_points ?? []).length === SELLING_POINT_COUNT &&
        generate.payload?.acceptance?.level5_passed === true,
      {
        status: generate.status,
        selling_points: generate.payload?.selling_points?.length,
        level5_passed: generate.payload?.acceptance?.level5_passed
      }
    );
    const afterCopy = await exportOf(full.id, "?format=handcard");
    check(
      "有未审成稿时导出仍 409，gate_label = 「待事实审核」（不许提前透露正文，§53）",
      afterCopy.status === 409 &&
        afterCopy.payload?.error?.details?.gate_label === "待事实审核" &&
        afterCopy.payload?.content === undefined,
      afterCopy.payload?.error?.details?.gate_label
    );
    const review = await generateReview(full.id, {});
    check(
      "事实审核返回 201，且这一版可发布（publishable = true，无 RED 句）",
      review.status === 201 && review.payload?.review?.publishable === true,
      { status: review.status, publishable: review.payload?.review?.publishable }
    );
    const afterReview = await exportOf(full.id, "?format=handcard");
    check(
      "审核通过但还没人工审批：导出 409，gate_label = 「待人工审批」",
      afterReview.status === 409 &&
        afterReview.payload?.error?.details?.gate_label === "待人工审批",
      afterReview.payload?.error?.details?.gate_label
    );
    const approved = await decide("approve", full.id, { note: "冒烟：人工复核通过" });
    check("人工审批通过返回 200", approved.status === 200, approved.status);

    console.log("\n[5] 卖点一页纸导出（§47 七条上纸 / §11 没录的不出现 / §62-5 无外链）");
    const handcard = await exportOf(full.id, "?format=handcard&scope=all");
    const view = handcard.payload;
    check("闸门通过后导出返回 200", handcard.status === 200, handcard.status);
    check(
      "交付形态：format = HANDCARD / content_type = text/html; charset=utf-8 / chars 与正文长度一致",
      view?.format === "HANDCARD" &&
        view?.content_type === "text/html; charset=utf-8" &&
        view?.chars === String(view?.content ?? "").length,
      { format: view?.format, content_type: view?.content_type, chars: view?.chars }
    );
    check(
      "文件名 = 「产品名_卖点一页纸_v1.html」（与成稿版本绑定，不覆盖历史版本）",
      typeof view?.filename === "string" &&
        view.filename === `${FULL_PRODUCT.product_name}_卖点一页纸_v1.html`,
      view?.filename
    );
    const html = String(view?.content ?? "");
    check(
      "单文件 HTML：以 <!DOCTYPE html> 开头、lang = zh-CN、无外部脚本、无外链（§62-5）",
      html.startsWith("<!DOCTYPE html>") &&
        html.includes('lang="zh-CN"') &&
        !html.includes("<script") &&
        !html.includes("http://") &&
        !html.includes("https://")
    );
    check(
      "四段全部上纸：01 产品介绍 / 02 核心卖点 / 03 口感特点 / 04 补充清单（编号徽标 01–04）",
      HANDCARD_SECTIONS.every(
        (section) => html.includes(section.label) && html.includes(`>${section.index}<`)
      ),
      HANDCARD_SECTIONS.filter((section) => !html.includes(section.label))
    );
    check(
      "页脚写明这是只读派生排版（改稿要回系统重新生成版本并重新送审，§53 / §62-15）",
      html.includes("只读派生排版") && html.includes("改稿请回系统重新生成版本并重新送审")
    );

    const dealer = await dealerCenterOf(full.id);
    const sellingPoints = (dealer.payload?.slots ?? []).find(
      (slot) => slot.key === "selling_points"
    )?.items ?? [];
    check(
      "02 段逐字取成稿 §47 七条卖点（一条不删、不合并）",
      sellingPoints.length === SELLING_POINT_COUNT &&
        sellingPoints.every((item) => html.includes(escapeHandcardHtml(item.text))),
      {
        count: sellingPoints.length,
        missing: sellingPoints
          .filter((item) => !html.includes(escapeHandcardHtml(item.text)))
          .map((item) => item.text)
      }
    );
    check(
      "03 段逐字取已录入的 §10.4 感官值（没记过的口感不许出现）",
      RECORDED_SENSORY.every((value) => html.includes(value)),
      RECORDED_SENSORY.filter((value) => !html.includes(value))
    );
    check(
      "04 段只摆已录入字段：树型在纸上；没录入的树龄整行不出现（§11：不生成占位）",
      html.includes(RECORDED_FACT.label) &&
        html.includes(RECORDED_FACT.value) &&
        !html.includes(UNRECORDED_FACT_LABEL),
      { has_tree_type: html.includes(RECORDED_FACT.label), has_tree_age: html.includes(UNRECORDED_FACT_LABEL) }
    );

    console.log("\n[6] 一页纸与其它导出同源（同一版成稿 / 与 scope 无关）");
    const markdown = await exportOf(full.id, "?format=markdown&scope=all");
    check(
      "Markdown 导出同样 200，且与一页纸指向同一版成稿与同一次审核",
      markdown.status === 200 &&
        markdown.payload?.copy_version === view?.copy_version &&
        markdown.payload?.copy_record_id === view?.copy_record_id &&
        markdown.payload?.review_version === view?.review_version
    );
    const handcardHostScope = await exportOf(full.id, "?format=handcard&scope=host");
    check(
      "一页纸是一张纸：换 scope 不改变正文（只影响 Markdown / 纯文本的资料来源）",
      handcardHostScope.status === 200 &&
        withoutGeneratedAt(handcardHostScope.payload?.content) === withoutGeneratedAt(html),
      handcardHostScope.status
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
    const viewerExport = await exportOf(full.id, "?format=handcard", viewerToken);
    check(
      "只读角色导出的纸与管理员逐字相同（闸门与角色无关，§53 / §57）",
      viewerExport.status === 200 &&
        withoutGeneratedAt(viewerExport.payload?.content) === withoutGeneratedAt(html),
      viewerExport.status
    );
    check(
      "只读角色不能生成话术 / 送审 / 审批（403：能读不等于能改）",
      (await generateCopy(full.id, {}, viewerToken)).status === 403 &&
        (await generateReview(full.id, {}, viewerToken)).status === 403 &&
        (await decide("approve", full.id, {}, viewerToken)).status === 403
    );

    console.log("\n[7] 清理冒烟数据并校验业务表清零");
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
      "select (select count(*)::int from products) as products, (select count(*)::int from copy_outputs) as copy_outputs, (select count(*)::int from generated_claims) as generated_claims, (select count(*)::int from claim_evidence) as claim_evidence, (select count(*)::int from value_codes) as value_codes"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：products=${row?.products} · copy_outputs=${row?.copy_outputs} · generated_claims=${row?.generated_claims} · claim_evidence=${row?.claim_evidence} · value_codes=${row?.value_codes}`
    );
    check(
      "冒烟结束后业务表清零（只保留 seed 与 16 行 Value Code 字典；一页纸是派生视图，不新增表）",
      row?.products === 0 &&
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
