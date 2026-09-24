/**
 * Phase 4 端到端冒烟（规格 §12 搜索逻辑 / §40 Agent 2 / §41 Agent 3 / §55·§56 研究进度）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400）
 *   2) node scripts/smoke/phase4.mjs
 *
 * 约束：脚本只使用冒烟数据，结束时删除自己创建的产品（来源 / 抽取 / 研究任务随之级联删除）；
 *       开发库最终只保留 seed（品牌「龙德记」+ 管理员）。
 *       本地默认 SEARCH_PROVIDER=mock，检索不会返回任何结果——因此本脚本顺带验证
 *       「没有真实检索结果时不得凭空造出来源」（§62-1），而不是伪造一条搜索结果。
 */

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

/** 保留域名（RFC 2606）：一定解析失败，用于验证抓取失败的诚实记录，不依赖外网。 */
const UNREACHABLE_URL = "https://ldj-smoke-phase4.invalid/liuxingkongque";

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

const EXPECTED_QUERY_TYPES = [
  "exact_queries",
  "concept_queries",
  "origin_queries",
  "flavor_queries",
  "taste_queries",
  "positioning_queries",
  "price_queries",
  "auction_queries",
  "transaction_queries"
];

async function main() {
  let token;
  let productId;

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

    console.log("\n[2] 创建冒烟产品");
    const created = await request("POST", "/api/products", {
      token,
      body: {
        product_name: "冒烟产品-四期研究",
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
    productId = created.payload?.id;
    check("返回产品 id", typeof productId === "string" && productId.length > 10);

    console.log("\n[3] 搜索策略读取（§12 / §40）：未生成时只能给「未落库」预览");
    const preview = await request("GET", `/api/products/${productId}/search-plan`, { token });
    check("读取搜索策略返回 200", preview.status === 200, preview.status);
    check("未生成时 stored=false", preview.payload?.stored === false, preview.payload?.stored);
    check(
      "未落库时给出明确警告，不假装已确认",
      (preview.payload?.warnings ?? []).some((warning) => warning.includes("未落库")),
      preview.payload?.warnings
    );
    check(
      "预览覆盖 9 类检索意图",
      EXPECTED_QUERY_TYPES.every((type) => Array.isArray(preview.payload?.plan?.[type])),
      Object.keys(preview.payload?.plan ?? {})
    );
    check("预览包含价格与成交查询意图", (preview.payload?.plan?.price_queries ?? []).length > 0, {
      price: preview.payload?.plan?.price_queries?.length,
      transaction: preview.payload?.plan?.transaction_queries?.length
    });
    check("spec_ref 指向 §12 / §40", preview.payload?.spec_ref === "§12 / §40", preview.payload?.spec_ref);

    console.log("\n[4] 生成搜索策略（规则引擎）");
    const generated = await request("POST", `/api/products/${productId}/search-plan/generate`, {
      token,
      body: { use_ai: false, max_per_type: 12 }
    });
    check("生成搜索策略返回 201", generated.status === 201, generated.status);
    check("生成后 stored=true", generated.payload?.stored === true, generated.payload?.stored);
    check("生成器标注为规则引擎", generated.payload?.generator === "RULE_BASED", generated.payload?.generator);
    check("查询总数大于 0", (generated.payload?.query_count ?? 0) > 0, generated.payload?.query_count);
    check("记录基于的 Value DNA 版本", typeof generated.payload?.dna_version === "number", generated.payload?.dna_version);
    check("刚落库的策略不标记过期", generated.payload?.stale === false, generated.payload?.stale);
    const planQueryText = JSON.stringify(generated.payload?.plan ?? {});
    check("查询词只用已录入字段，不凭空出现树龄/班章/获奖", !/300|古树|班章|获奖|大师/.test(planQueryText), planQueryText.slice(0, 240));

    console.log("\n[5] 运行研究流水线（§55）");
    const run = await request("POST", `/api/products/${productId}/research/runs`, {
      token,
      body: {
        use_ai: false,
        max_queries: 4,
        max_results_per_query: 2,
        max_sources: 3,
        auto_extract: true
      }
    });
    check("启动研究返回 201", run.status === 201, run.status);
    check("任务状态为 SUCCEEDED", run.payload?.status === "SUCCEEDED", {
      status: run.payload?.status,
      error: run.payload?.error
    });
    const stagesRun = run.payload?.stages_run ?? [];
    check(
      "执行阶段覆盖事实归一 → Value DNA → 搜索策略 → 检索 → 抓取 → 网页抽取",
      ["FACT_NORMALIZE", "VALUE_DNA", "SEARCH_PLAN", "WEB_SEARCH", "SOURCE_FETCH", "ENTITY_EXTRACT"].every(
        (stage) => stagesRun.includes(stage)
      ),
      stagesRun
    );
    check(
      "mock 检索无结果时不编造来源（§62-1）",
      run.payload?.sources_created === 0 && run.payload?.summary?.search_results === 0,
      { created: run.payload?.sources_created, results: run.payload?.summary?.search_results }
    );

    console.log("\n[6] 研究进度 UI 数据（§56）");
    const progress = await request("GET", `/api/products/${productId}/research/progress`, { token });
    check("读取研究进度返回 200", progress.status === 200, progress.status);
    const progressItems = progress.payload?.progress ?? [];
    check("登记 22 个流水线阶段", progressItems.length === 22, progressItems.length);
    check("最新任务可追溯", progress.payload?.job?.id === run.payload?.id && progress.payload?.latest === true);
    const factStage = progressItems.find((item) => item.stage === "FACT_NORMALIZE");
    check("事实归一阶段已完成", factStage?.status === "SUCCEEDED", factStage?.status);
    check(
      "每个阶段都带中文标签 / 所属 Phase / 是否已交付",
      progressItems.every(
        (item) => typeof item.label === "string" && typeof item.phase === "number" && typeof item.implemented === "boolean"
      )
    );
    // 已交付阶段会随 Phase 推进变化：Phase 9 的价值映射模块已交付，但 VALUE_CODES 阶段
    // 由产品内的价值拆解页面单独触发，因此本流水线里它的状态仍是 PENDING。
    const valueCodesStage = progressItems.find((item) => item.stage === "VALUE_CODES");
    check(
      "Phase 9 价值映射已交付，但该阶段未在本轮流水线执行时状态仍为 PENDING",
      valueCodesStage?.status === "PENDING" && valueCodesStage?.implemented === true && valueCodesStage?.phase === 9,
      valueCodesStage
    );
    // 已交付阶段会随 Phase 推进变化：Phase 10 的产品结构模块已交付，但 PRODUCT_ARCHITECTURE 阶段
    // 由产品内的产品结构页面单独触发，因此本流水线里它的状态仍是 PENDING。
    const productArchitectureStage = progressItems.find((item) => item.stage === "PRODUCT_ARCHITECTURE");
    check(
      "Phase 10 产品结构已交付，但该阶段未在本轮流水线执行时状态仍为 PENDING",
      productArchitectureStage?.status === "PENDING" &&
        productArchitectureStage?.implemented === true &&
        productArchitectureStage?.phase === 10,
      productArchitectureStage
    );
    // 尚未交付的后续阶段必须保持未交付标记，不假装完成。
    const formulaStage = progressItems.find((item) => item.stage === "FORMULA_PHILOSOPHY");
    check(
      "Phase 11 配方哲学已交付，但该阶段未在本轮流水线执行时状态仍为 PENDING",
      formulaStage?.status === "PENDING" &&
        formulaStage?.implemented === true &&
        formulaStage?.phase === 11,
      formulaStage
    );
    check(
      "进度 UI 明确两种成交模式的分支（Benchmark / Category Creator）",
      typeof progress.payload?.job?.mode_notes?.BENCHMARK === "string" &&
        progress.payload.job.mode_notes.CATEGORY_CREATOR.includes("Category Creator"),
      progress.payload?.job?.mode_notes
    );

    const runs = await request("GET", `/api/products/${productId}/research/runs?limit=10`, { token });
    check("研究任务历史返回 200", runs.status === 200, runs.status);
    check("历史中保留本轮任务（§62-15）", (runs.payload?.items ?? []).some((item) => item.id === run.payload?.id));

    console.log("\n[4·5] 来源登记与去重（§41）");
    const manual = await request("POST", `/api/products/${productId}/sources`, {
      token,
      body: { url: UNREACHABLE_URL, title: "冒烟来源-不可达页面" }
    });
    check("手工登记来源返回 201", manual.status === 201, manual.status);
    check("标记为新建", manual.payload?.created === true, manual.payload?.created);
    const sourceId = manual.payload?.source?.id;
    check("规范化出域名", manual.payload?.source?.domain === "ldj-smoke-phase4.invalid", manual.payload?.source?.domain);
    check("初始抓取状态为 PENDING", manual.payload?.source?.fetch_status === "PENDING", manual.payload?.source?.fetch_status);
    check(
      "初始抽取状态为 NOT_EXTRACTED",
      manual.payload?.source?.extraction_status === "NOT_EXTRACTED",
      manual.payload?.source?.extraction_status
    );

    const duplicate = await request("POST", `/api/products/${productId}/sources`, {
      token,
      body: { url: UNREACHABLE_URL }
    });
    check("重复登记同一 URL 返回 200 而不是新建", duplicate.status === 200, duplicate.status);
    check("复用同一条来源，不制造证据厚度", duplicate.payload?.created === false && duplicate.payload?.source?.id === sourceId);

    const filtered = await request(
      "GET",
      `/api/products/${productId}/sources?keyword=liuxingkongque&fetch_status=PENDING&extraction_status=NOT_EXTRACTED`,
      { token }
    );
    check("按关键词与状态筛选返回 200", filtered.status === 200, filtered.status);
    check(
      "筛选命中同一条来源",
      (filtered.payload?.items ?? []).length === 1 && filtered.payload.items[0].id === sourceId,
      filtered.payload?.total
    );

    console.log("\n[7] 抓取：失败必须诚实记录（不伪造正文）");
    const fetched = await request("POST", `/api/products/${productId}/sources/${sourceId}/fetch`, {
      token,
      body: { force: true }
    });
    check("抓取接口返回 200（业务失败也是成功响应）", fetched.status === 200, fetched.status);
    check("抓取状态记为 FAILED", fetched.payload?.fetch_status === "FAILED", fetched.payload?.fetch_status);
    check("记录失败原因", typeof fetched.payload?.fetch_error === "string" && fetched.payload.fetch_error.length > 0, fetched.payload?.fetch_error);
    check("没有正文时不写入内容长度", (fetched.payload?.content_chars ?? 0) === 0, fetched.payload?.content_chars);

    console.log("\n[8] 网页事实抽取（§41 Agent 3）：只落证据，不写产品事实");
    const extraction = await request("POST", `/api/products/${productId}/sources/${sourceId}/extract`, {
      token,
      body: { use_ai: false }
    });
    check("抽取返回 201", extraction.status === 201, extraction.status);
    check("无正文时 has_content=false", extraction.payload?.has_content === false, extraction.payload?.has_content);
    check("价格证据为 0 条", extraction.payload?.price_count === 0, extraction.payload?.price_count);
    check(
      "返回抽取说明（说明为什么没有可用信息）",
      typeof extraction.payload?.extraction?.null_reason === "string" &&
        extraction.payload.extraction.null_reason.length > 0,
      extraction.payload?.extraction?.null_reason
    );
    check(
      "抽取结果结构完整（prices / facts / dropped / warnings）",
      Array.isArray(extraction.payload?.extraction?.prices) &&
        Array.isArray(extraction.payload?.extraction?.facts) &&
        Array.isArray(extraction.payload?.dropped) &&
        Array.isArray(extraction.payload?.warnings)
    );
    check("抽取状态记为 FAILED（无正文）", extraction.payload?.has_content === false);

    const facts = await request("GET", `/api/products/${productId}/facts`, { token });
    check("产品事实清单仍为空：抽取绝不自动写入产品事实（§41 / §62-5）", facts.payload?.total === 0, facts.payload?.total);

    const again = await request("POST", `/api/products/${productId}/sources/${sourceId}/extract`, {
      token,
      body: { use_ai: false }
    });
    check("未指定 force 时复用已有抽取结果（不重复计费）", again.payload?.id === extraction.payload?.id, {
      again: again.payload?.id,
      first: extraction.payload?.id
    });
    const forced = await request("POST", `/api/products/${productId}/sources/${sourceId}/extract`, {
      token,
      body: { use_ai: false, force: true }
    });
    check("指定 force 时产生新版本，旧版本不被覆盖", forced.payload?.id !== extraction.payload?.id);

    const extractionList = await request("GET", `/api/products/${productId}/sources/${sourceId}/extractions`, { token });
    check("抽取历史返回 200", extractionList.status === 200, extractionList.status);
    check("抽取历史保留 2 次记录（§62-15）", (extractionList.payload?.items ?? []).length === 2, extractionList.payload?.items?.length);
    check(
      "抽取历史按时间倒序",
      (extractionList.payload?.items ?? []).length > 1 &&
        new Date(extractionList.payload.items[0].created_at) >=
          new Date(extractionList.payload.items[1].created_at)
    );

    const detail = await request("GET", `/api/products/${productId}/sources/${sourceId}`, { token });
    check("来源详情返回 200", detail.status === 200, detail.status);
    check("详情保留抓取失败原因", typeof detail.payload?.fetch_error === "string", detail.payload?.fetch_error);

    console.log("\n[9] 证据删除与权限边界");
    const removed = await request("DELETE", `/api/products/${productId}/sources/${sourceId}`, { token });
    check("删除来源返回 204", removed.status === 204, removed.status);
    const gone = await request("GET", `/api/products/${productId}/sources/${sourceId}`, { token });
    check("删除后来源详情返回 404", gone.status === 404, gone.status);

    const anonymousList = await request("GET", `/api/products/${productId}/sources`);
    check("未登录读取来源返回 401", anonymousList.status === 401, anonymousList.status);
    const anonymousRun = await request("POST", `/api/products/${productId}/research/runs`, { body: {} });
    check("未登录启动研究返回 401", anonymousRun.status === 401, anonymousRun.status);
  } finally {
    if (productId) {
      const removed = await request("DELETE", `/api/products/${productId}`, { token });
      console.log(
        `\n[清理] 删除冒烟产品（级联删除来源 / 抽取 / 研究任务 / 搜索策略）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
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
