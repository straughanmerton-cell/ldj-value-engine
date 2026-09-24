/**
 * Phase 3 端到端冒烟（规格 §9 Value DNA / §39 Agent 1 / §50 Prompt 管理 / §58-1·2·3 红线）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase3.mjs
 *
 * 约束：脚本只使用冒烟数据，结束时删除自己创建的产品；
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";
const SEED_PROMPT_TEXT = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../prompts/fact-normalizer.md"),
  "utf8"
).trim();

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

function flatten(value) {
  return Object.values(value ?? {})
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .join(" ");
}

async function main() {
  let token;
  let createdProductId;

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

    console.log("\n[2] 创建产品并自动生成 Value DNA（§9）");
    const created = await request("POST", "/api/products", {
      token,
      body: {
        product_name: "冒烟产品-六星孔雀",
        year: 2026,
        tea_type: "普洱生茶",
        weight_g: 357,
        mountain: "布朗山",
        raw_material: "布朗山大树春茶",
        copy_intensity_default: 4,
        benchmark_mode_preference: "AUTO"
      }
    });
    check("创建产品返回 201", created.status === 201, created.status);
    createdProductId = created.payload?.id;

    const dna = await request("GET", `/api/products/${createdProductId}/value-dna`, { token });
    check("读取 Value DNA 返回 200", dna.status === 200, dna.status);
    const dimensions = Object.keys(dna.payload?.value_dna ?? {});
    check("返回 11 个 DNA 维度", dimensions.length === 11, dimensions);
    check("origin 维度包含已录入产区", (dna.payload?.value_dna?.origin ?? []).includes("布朗山"));
    check(
      "material 维度包含已录入原料",
      (dna.payload?.value_dna?.material ?? []).includes("布朗山大树春茶")
    );
    check(
      "meta 标注规则引擎与版本",
      dna.payload?.meta?.generator === "RULE_BASED" && dna.payload?.meta?.version >= 1,
      dna.payload?.meta
    );

    console.log("\n[3] §58-1/2/3 红线：未录入的硬事实绝不自动生成");
    const bare = await request("POST", "/api/products", {
      token,
      body: { product_name: "冒烟产品-空白饼", year: 2026, tea_type: "普洱生茶", weight_g: 357 }
    });
    const bareId = bare.payload?.id;
    const bareDna = await request("GET", `/api/products/${bareId}/value-dna`, { token });
    const bareText = flatten(bareDna.payload?.value_dna);
    for (const forbidden of ["300", "古树", "班章", "2003", "复刻", "同款配方", "六星孔雀"]) {
      check(`  未出现禁止自动生成的「${forbidden}」`, !bareText.includes(forbidden), bareText);
    }
    check(
      "missing_dimensions 显式列出空缺维度",
      ["origin", "material", "process", "flavor", "taste"].every((dimension) =>
        (bareDna.payload?.missing_dimensions ?? []).includes(dimension)
      ),
      bareDna.payload?.missing_dimensions
    );
    await request("DELETE", `/api/products/${bareId}`, { token });

    console.log("\n[4] 重新生成与过期检测（§9 / §11）");
    const regenerated = await request("POST", `/api/products/${createdProductId}/value-dna/generate`, {
      token,
      body: { use_ai: false }
    });
    check("规则引擎重新生成返回 200", regenerated.status === 200, regenerated.status);
    check(
      "版本号递增且不改产品 version",
      (regenerated.payload?.meta?.version ?? 0) > (dna.payload?.meta?.version ?? 0) &&
        regenerated.payload?.meta?.product_version === dna.payload?.meta?.product_version,
      { before: dna.payload?.meta, after: regenerated.payload?.meta }
    );

    const fact = await request("POST", `/api/products/${createdProductId}/facts`, {
      token,
      body: { fact_key: "tree_age", fact_value: "树龄 300 年" }
    });
    check("新增事实返回 201", fact.status === 201, fact.status);
    const stale = await request("GET", `/api/products/${createdProductId}/value-dna`, { token });
    check("上游事实变化后 DNA 标记 stale", stale.payload?.stale === true, stale.payload?.stale);
    check(
      "过期不影响读取：新事实尚未并入 DNA",
      !flatten(stale.payload?.value_dna).includes("树龄 300 年")
    );

    console.log("\n[5] Agent 1 事实归一试跑（§39，不落库）");
    const normalize = await request("POST", `/api/products/${createdProductId}/facts/normalize`, {
      token,
      body: { use_ai: false }
    });
    check("事实归一返回 200", normalize.status === 200, normalize.status);
    check("明确返回不落库", normalize.payload?.persisted === false);
    check(
      "六分类输出结构完整",
      ["confirmed_facts", "tasting_facts", "rnd_facts", "user_opinions", "inferences", "missing"].every(
        (category) => Array.isArray(normalize.payload?.output?.[category])
      ),
      Object.keys(normalize.payload?.output ?? {})
    );
    check(
      "candidates 呈现为待人工确认候选",
      (normalize.payload?.candidates ?? []).length > 0 &&
        normalize.payload.candidates.every((item) => item.category !== "missing")
    );

    console.log("\n[6] Prompt 管理后台（§50 / §62-15）");
    const promptList = await request("GET", "/api/prompts", { token });
    check("Prompt 列表返回 200", promptList.status === 200, promptList.status);
    check("登记 11 个 Prompt Key", (promptList.payload?.items ?? []).length === 11, promptList.payload?.items?.length);
    check(
      "锁定五项管理能力",
      ["version", "active", "rollback", "edit", "test_run"].every((capability) =>
        (promptList.payload?.capabilities ?? []).includes(capability)
      ),
      promptList.payload?.capabilities
    );

    const detail = await request("GET", "/api/prompts/FACT_NORMALIZER", { token });
    check("读取单个 Prompt 版本历史返回 200", detail.status === 200, detail.status);
    const versions = detail.payload?.versions ?? [];
    const v1 = versions.find((item) => item.version === 1);
    const activeVersion = versions.find((item) => item.is_active === true);
    check(
      "历史中保留种子 v1 且内容与 prompts/fact-normalizer.md 一致（§62-15）",
      v1?.content?.trim() === SEED_PROMPT_TEXT,
      { version: v1?.version }
    );
    check(
      "版本历史按版本号倒序返回且启用版本唯一",
      JSON.stringify(versions.map((item) => item.version)) ===
        JSON.stringify([...versions.map((item) => item.version)].sort((a, b) => b - a)) &&
        versions.filter((item) => item.is_active === true).length === 1,
      versions.map((item) => ({ version: item.version, active: item.is_active }))
    );
    const expectedNextVersion = Math.max(...versions.map((item) => item.version)) + 1;

    const newVersion = await request("POST", "/api/prompts/FACT_NORMALIZER/versions", {
      token,
      body: {
        content: `${activeVersion?.content ?? ""}\n\n<!-- 冒烟新增约束 -->`,
        notes: "冒烟派生版本",
        activate: true
      }
    });
    check("派生新版本返回 201", newVersion.status === 201, newVersion.status);
    check(
      `新版本号 = 当前最大版本 + 1（${expectedNextVersion}）且已启用`,
      newVersion.payload?.version === expectedNextVersion && newVersion.payload?.is_active === true,
      newVersion.payload?.version
    );
    check(
      "新版本记录 based_on_version 指向派生来源",
      newVersion.payload?.based_on_version === activeVersion?.version,
      { based_on_version: newVersion.payload?.based_on_version, expected: activeVersion?.version }
    );

    const rollback = await request("POST", "/api/prompts/FACT_NORMALIZER/activate", {
      token,
      body: { version: 1 }
    });
    check("回滚到 v1 返回 200", rollback.status === 200, rollback.status);
    check("启用指针指回 v1", rollback.payload?.version === 1 && rollback.payload?.is_active === true);
    const afterRollback = await request("GET", "/api/prompts/FACT_NORMALIZER", { token });
    const afterVersions = afterRollback.payload?.versions ?? [];
    check(
      "历史版本全部保留：回滚后新派生版本与 v1 均在列表中（§62-15）",
      afterVersions.length === versions.length + 1 &&
        afterVersions.some((item) => item.version === expectedNextVersion) &&
        afterVersions.some((item) => item.version === 1),
      afterVersions.map((item) => item.version)
    );
    check(
      "回滚不改变版本内容（仅切换启用指针）",
      afterVersions.find((item) => item.version === 1)?.content?.trim() === SEED_PROMPT_TEXT &&
        afterVersions.filter((item) => item.is_active === true).length === 1,
      afterVersions.map((item) => ({ version: item.version, active: item.is_active }))
    );

    const testRun = await request("POST", "/api/prompts/FACT_NORMALIZER/test-run", {
      token,
      body: { input: "产品：龙德记六星孔雀；产区：布朗山。", variables: {}, temperature: 0.2 }
    });
    check("试跑返回 200", testRun.status === 200, testRun.status);
    check("试跑标注不落库", testRun.payload?.persisted === false && testRun.payload?.test_run === true);
    check("试跑返回 provider 与输出", typeof testRun.payload?.provider === "string" && typeof testRun.payload?.output === "string");
    check("试跑返回 schema 校验结果字段", "schema_valid" in (testRun.payload ?? {}));

    console.log("\n[7] 权限边界");
    const anonymous = await request("GET", "/api/prompts");
    check("未登录读取 Prompt 列表返回 401", anonymous.status === 401, anonymous.status);

    const meta = await request("GET", "/api/meta/core-features", { token });
    check("核心功能接口暴露 6 项锁定能力", (meta.payload?.core_features ?? []).length === 6);
    check("核心功能接口暴露 11 个 DNA 维度", (meta.payload?.value_dna?.dimensions ?? []).length === 11);
    check("核心功能接口暴露 ai_provider", typeof meta.payload?.ai_provider === "string");
  } finally {
    if (createdProductId) {
      const removed = await request("DELETE", `/api/products/${createdProductId}`, { token });
      console.log(
        `\n[清理] 删除冒烟产品 → ${removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`}`
      );
    }
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
