/**
 * 产品卖点工作台端到端冒烟（客户 2026-09-26 追加需求 / 规格 §0 总执行说明 / §12 Adapter /
 * §20–§27 / §31 / §33 / §62 / §64）。
 *
 * 用法：
 *   1) 先启动 API：pnpm dev:api（默认 127.0.0.1:4400），且 `AI_PROVIDER=deepseek` 时才走真模型
 *   2) node scripts/smoke/sellpoints.mjs
 *
 * 注意：第 [5] 段会**真实调用一次模型**（实测单次 60–150 秒），脚本内的 fetch 没有超时，
 *       请给足等待时间，不要在期间中断进程。
 *
 * 约束：脚本只使用冒烟数据；结束时删除自己创建的会话（消息级联删除）与临时账号，
 *       并校验 chat_sessions / chat_messages 清零、copy_outputs 未被写入（工作台产出的是草稿，§53）。
 *
 * 本脚本压的是五条硬约束：
 *   1) §64 / §62-11：默认交付形态是**产品卖点介绍**，七段骨架固定，前端不另写一套文案；
 *   2) §12 / §62-1：对标来源必须是**服务端真实检索**结果，链接由服务端回写，模型产出的同名
 *      字段一律作废（否则用户点开就是死链）；
 *   3) §62-5 / §62-10：对标只用来讲价格高度，查不到时不硬凑——降级路径由
 *      `services/api/tests/chat.test.ts` 的「对标相关性过滤」用例覆盖，这里只验「有结果时必须是
 *      茶叶语境来源」「0 条时照样 201，不许 502」；
 *   4) §62-13：模型输出必须过 schema，校验失败 502 且不写半成品；
 *   5) 会话只属于创建者，越权一律 404；工作台**不写 copy_outputs**（草稿与正式交付互不污染）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const BASE_URL = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4400";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@longdeji.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? "ChangeMe_123456";

const VIEWER_EMAIL = "smoke-sellpoints-viewer@longdeji.local";
const ROLE_PASSWORD = "SmokePass1234";

/** 合同口径（与 `CHAT_SPEC_REF` / `CHAT_SELLPOINT_FORM.spec_ref` 同源）。 */
const SPEC_REF = "§0 / §12 / §17 / §20 / §21 / §22 / §26 / §31 / §33 / §49 / §62 / §64";
const SELLPOINT_SPEC_REF = "§20 / §22 / §26 / §33 / §64";
/** 固定七段骨架：少一段或换一段都算违约（§20 / §22 / §33）。 */
const SELLPOINT_OUTLINE_KEYS = [
  "一句话定位",
  "核心卖点",
  "价值高度",
  "口感与产品结构",
  "配方哲学",
  "异议接住",
  "收口"
];
/** §62 的 15 条铁律。 */
const IRON_RULE_COUNT = 15;
/** 未绑定产品时直接写在对话框里的产品名上限（`CHAT_LIMITS.maxProductNameChars`）。 */
const MAX_PRODUCT_NAME_CHARS = 80;
/** 单次回给前端的对标来源上限（`CHAT_LIMITS.maxBenchmarks`）。 */
const MAX_BENCHMARKS = 8;
/** 单次对同一次出稿发起的产品名检索条数（`CHAT_LIMITS.benchmarkQueries`）。 */
const BENCHMARK_QUERIES = 3;
/**
 * 对标必须落在「茶叶价格语境」里：360 免 Key 检索会混进同名其它行业的结果
 * （实测「六星孔雀」会带回「德龙国六卡车」「延超龙井新闻」），所以服务端加了相关性过滤。
 */
const TEA_KEYWORDS = [
  "茶",
  "普洱",
  "生普",
  "熟普",
  "生茶",
  "熟茶",
  "饼",
  "沱",
  "砖",
  "毛料",
  "古树",
  "大树",
  "乔木",
  "山头",
  "易武",
  "布朗",
  "勐海",
  "仓储"
];
/**
 * §62-11：默认交付形态是产品卖点介绍，不能退化成直播稿。
 * 这里只压「直播场景词」，而不搜「直播」两个字——因为 §21 的 Level 4 官方短标签就叫
 * 「Level 4｜直播爆款」，那是一个强度档名字，不是场景词。
 */
const LIVE_SCENE_WORDS = ["上链接", "扣一", "扣1", "直播间", "宝宝们", "老铁们", "点关注", "直播间见"];
/** 本轮的用途是详情页 / 招商资料，模型不该往直播场景走。 */
const SELLPOINT_DEMAND =
  "帮我把这款茶整理成一版产品卖点介绍，用于详情页和经销商招商资料：讲清它是谁、值在哪、什么口感，价格高度要能对上同类高价值产品，不要写成参数说明书。";
/** 未绑定产品时，用户直接在需求里写的产品名——只当检索词用（§62-8）。 */
const PRODUCT_NAME_HINT = "龙德记 六星孔雀 2023 普洱生茶";

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

/** AI 消息里所有会被用户读到的文本（用来验证「没有直播场景词」这条）。 */
function assistantTexts(payload) {
  const texts = [];
  if (typeof payload?.reply === "string") {
    texts.push(payload.reply);
  }
  if (typeof payload?.headline === "string") {
    texts.push(payload.headline);
  }
  if (typeof payload?.value_height === "string") {
    texts.push(payload.value_height);
  }
  for (const block of payload?.copy_blocks ?? []) {
    if (typeof block?.text === "string") {
      texts.push(block.text);
    }
  }
  for (const quote of payload?.quotes ?? []) {
    texts.push(String(quote));
  }
  for (const objection of payload?.objections ?? []) {
    texts.push(String(objection?.question ?? ""), String(objection?.answer ?? ""));
  }
  return texts;
}

/** 一条对标是否落在茶叶语境里（标题 + 摘要里至少命中一个茶类关键词）。 */
function isTeaBenchmark(benchmark) {
  const haystack = `${benchmark?.title ?? ""}${benchmark?.snippet ?? ""}`;
  return TEA_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();

  let token;
  const createdSessionIds = [];
  const createdUserEmails = [];
  const missingId = "00000000-0000-4000-8000-000000000000";
  const notAUuid = "not-a-uuid";

  const createSession = (body = {}, authToken = token) =>
    request("POST", "/api/chat/sessions", { token: authToken, body });
  const patchSession = (id, body = {}, authToken = token) =>
    request("PATCH", `/api/chat/sessions/${id}`, { token: authToken, body });
  const listMessages = (id, authToken = token) =>
    request("GET", `/api/chat/sessions/${id}/messages`, { token: authToken });
  const sendMessage = (id, body = {}, authToken = token) =>
    request("POST", `/api/chat/sessions/${id}/messages`, { token: authToken, body });

  try {
    console.log(`\n[1] 健康检查与登录（${BASE_URL}）`);
    const health = await request("GET", "/api/health");
    check("GET /api/health 返回 200", health.status === 200, health.status);
    check(
      "未登录不能读工作台合同 / 标签 / 会话列表（401）",
      (await request("GET", "/api/chat/contract")).status === 401 &&
        (await request("GET", "/api/chat/labels")).status === 401 &&
        (await request("GET", "/api/chat/sessions")).status === 401
    );
    check(
      "未登录不能建会话 / 读消息 / 发需求（401）",
      (await createSession({})).status === 401 &&
        (await listMessages(missingId)).status === 401 &&
        (await sendMessage(missingId, { content: "在吗" })).status === 401
    );
    check(
      "伪造 token 一律 401（工作台不因为「只读」就放开鉴权）",
      (await request("GET", "/api/chat/contract", { token: "not-a-real-token" })).status === 401
    );

    const login = await request("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    check("管理员登录返回 200", login.status === 200, login.status);
    token = login.payload?.tokens?.access_token;
    check("登录响应带回 access_token", typeof token === "string" && token.length > 0);

    console.log("\n[2] §64 / §20–§33 / §62 合同自检（卖点形态 / 对标策略 / 15 条铁律）");
    const contractResponse = await request("GET", "/api/chat/contract", { token });
    check("GET /api/chat/contract 返回 200", contractResponse.status === 200, contractResponse.status);
    const contract = contractResponse.payload?.contract;
    const limits = contractResponse.payload?.limits;

    check(
      "默认交付形态 = 产品卖点介绍（§62-11：工作台不再默认出直播稿）",
      contract?.sellpoint_form?.name === "产品卖点介绍" &&
        contract?.sellpoint_form?.spec_ref === SELLPOINT_SPEC_REF,
      contract?.sellpoint_form?.name
    );
    const outline = contract?.sellpoint_form?.outline ?? [];
    check(
      "七段骨架一段不少、顺序固定（一句话定位 / 核心卖点 / 价值高度 / 口感与产品结构 / 配方哲学 / 异议接住 / 收口）",
      outline.length === 7 &&
        outline.every((item, index) => String(item).startsWith(SELLPOINT_OUTLINE_KEYS[index])),
      outline
    );
    const sellpointRules = contract?.sellpoint_form?.rules ?? [];
    check(
      "卖点形态三条硬要求：不写成参数说明书 / 不出现直播场景词 / 没有对标就走 Category Creator Mode",
      sellpointRules.length === 3 &&
        sellpointRules[0].includes("§62-11") &&
        sellpointRules[1].includes("直播") &&
        sellpointRules[2].includes("§62-10"),
      sellpointRules
    );

    const policy = contract?.benchmark_policy;
    check(
      "对标策略：开启 / 单轮 3 条查询 / 回给前端最多 8 条 / 只要真实来源（§12 / §62-1）",
      policy?.enabled === true &&
        policy?.queries_per_run === BENCHMARK_QUERIES &&
        policy?.result_cap === MAX_BENCHMARKS &&
        policy?.only_real_sources === true,
      policy
    );
    check(
      "对标只允许讲价格高度与市场认知，禁止搬运竞品原料 / 树龄 / 山头 / 年份 / 配方（§62-5）",
      String(policy?.allowed_use ?? "").includes("价格高度") &&
        String(policy?.forbidden_use ?? "").includes("§62-5") &&
        String(policy?.forbidden_use ?? "").includes("配方"),
      policy?.forbidden_use
    );
    check(
      "检索失败 / 超时 / 0 条时降级为空对标并进入 Category Creator Mode，绝不阻塞出稿（§62-10）",
      String(policy?.degrade ?? "").includes("Category Creator Mode") &&
        String(policy?.degrade ?? "").includes("降级"),
      policy?.degrade
    );
    check(
      "benchmarks 由服务端回写，模型输出的同名字段一律作废（防止编链接）",
      String(policy?.server_written ?? "").includes("覆盖") &&
        String(policy?.server_written ?? "").includes("服务端")
    );

    check(
      "输出字段含 value_height（价值高度）与 benchmarks（对标来源）",
      (contract?.output?.fields ?? []).some((field) => String(field).includes("value_height")) &&
        (contract?.output?.fields ?? []).some((field) => String(field).includes("benchmarks"))
    );
    const ironRules = contractResponse.payload?.iron_rules ?? [];
    check(
      `§62 的 ${IRON_RULE_COUNT} 条铁律逐条可读（含 §62-9 允许极强修辞 / §62-10 Category Creator / §62-11 前台不许变说明书）`,
      ironRules.length === IRON_RULE_COUNT &&
        ironRules.some((rule) => rule.startsWith("§62-9")) &&
        ironRules.some((rule) => rule.startsWith("§62-10")) &&
        ironRules.some((rule) => rule.startsWith("§62-11")),
      ironRules.length
    );
    check(
      "上限口径与后端校验同源（product_name ≤ 80 / message ≤ 4000 / 对标 ≤ 8）",
      limits?.maxProductNameChars === MAX_PRODUCT_NAME_CHARS &&
        limits?.maxBenchmarks === MAX_BENCHMARKS &&
        limits?.benchmarkQueries === BENCHMARK_QUERIES &&
        typeof limits?.maxMessageChars === "number",
      limits
    );
    const presets = contractResponse.payload?.presets;
    check(
      "预设需求第一张就是「产品卖点介绍」，且保留「对标谁、高在哪」这一张",
      Array.isArray(presets) &&
        presets.length === 6 &&
        String(presets[0]?.label ?? "").includes("产品卖点介绍") &&
        presets.some((preset) => String(preset?.label ?? "").includes("对标")),
      presets
    );
    check(
      "合同自检 spec_ref 与 schema 层同源",
      contract?.spec_ref === SPEC_REF,
      contract?.spec_ref
    );
    check(
      "保证项：只讲已录事实 / 不移植竞品事实 / 对标是真实来源 / 输出过 schema / 产出是草稿 / 发布仍要事实审核",
      contract?.guarantees?.only_recorded_facts === true &&
        contract?.guarantees?.no_competitor_fact_transplant === true &&
        contract?.guarantees?.benchmarks_are_real_sources === true &&
        contract?.guarantees?.schema_validated_output === true &&
        contract?.guarantees?.ai_output_is_draft === true &&
        contract?.guarantees?.publish_requires_fact_review === true
    );

    console.log("\n[3] 标签口径（角色 / 禁用事实 / Provider）");
    const labelsResponse = await request("GET", "/api/chat/labels", { token });
    check("GET /api/chat/labels 返回 200", labelsResponse.status === 200, labelsResponse.status);
    const labels = labelsResponse.payload;
    check(
      "AI 消息的角色标签是「AI 卖点」（不是「主播话术」）",
      labels?.role_labels?.ASSISTANT === "AI 卖点" &&
        labels?.role_labels?.USER === "我的需求",
      labels?.role_labels
    );
    check(
      "禁用事实清单 14 条（树龄 / 山头 / 年份 / 获奖 / 大师 / 配方比例 / 成交价等）",
      Array.isArray(labels?.forbidden_facts) && labels.forbidden_facts.length === 14,
      labels?.forbidden_facts?.length
    );
    check(
      "Provider 口径可读（前端据此判断真模型还是 mock）",
      typeof labels?.ai_provider === "string" && labels.ai_provider.length > 0,
      labels?.ai_provider
    );
    console.log(`  · 当前 Provider：${labels?.ai_provider}`);

    console.log("\n[4] 会话读写与越权边界");
    const created = await createSession({});
    check("新建会话返回 201", created.status === 201, created.status);
    const sessionId = created.payload?.id;
    if (sessionId) {
      createdSessionIds.push(sessionId);
    }
    check(
      "新会话标题是占位「新对话」、默认强度 Level 4、消息数 0",
      created.payload?.title === "新对话" &&
        created.payload?.intensity === 4 &&
        created.payload?.message_count === 0,
      created.payload
    );
    const patched = await patchSession(sessionId, { intensity: 5 });
    check(
      "PATCH 改强度返回 200 且生效（Level 5 王者话术仍在专业模式里可选，§21）",
      patched.status === 200 && patched.payload?.intensity === 5,
      patched.payload?.intensity
    );
    const emptyMessages = await listMessages(sessionId);
    check(
      "新会话消息列表为空（第 1 页升序返回）",
      emptyMessages.status === 200 && (emptyMessages.payload?.items ?? []).length === 0,
      emptyMessages.payload
    );

    check(
      "非法查询串 400：page=0 / 未知参数 / 强度越界 / 需求超长 / 产品名超 80 字",
      (await request("GET", "/api/chat/sessions?page=0", { token })).status === 400 &&
        (await request("GET", "/api/chat/sessions?nope=1", { token })).status === 400 &&
        (await patchSession(sessionId, { intensity: 6 })).status === 400 &&
        (await sendMessage(sessionId, { content: "x".repeat(4001) })).status === 400 &&
        (await sendMessage(sessionId, { content: "在吗", product_name: "茶".repeat(81) })).status === 400
    );
    check(
      "不存在的会话 / 非 UUID 会话 id：一律 404（不是 500，也不泄露会话是否存在）",
      (await listMessages(missingId)).status === 404 &&
        (await patchSession(missingId, { intensity: 5 })).status === 404 &&
        (await listMessages(notAUuid)).status === 404 &&
        (await sendMessage(notAUuid, { content: "在吗" })).status === 404
    );
    check(
      "绑定不存在的产品：404；非法格式 product_id：400（都不许静默成功）",
      (await createSession({ product_id: missingId })).status === 404 &&
        (await createSession({ product_id: notAUuid })).status === 400
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
      "会话只属于创建者：别人的会话读消息 404、改会话 / 发需求一律拒绝（越权不泄露存在性）",
      (await listMessages(sessionId, viewerToken)).status === 404 &&
        (await patchSession(sessionId, { intensity: 3 }, viewerToken)).status === 403 &&
        (await sendMessage(sessionId, { content: "在吗" }, viewerToken)).status === 403,
      {
        list: (await listMessages(sessionId, viewerToken)).status,
        patch: (await patchSession(sessionId, { intensity: 3 }, viewerToken)).status
      }
    );
    check(
      "只读账号可以读合同 / 标签（草稿工作台不能因为权限变成黑盒）",
      (await request("GET", "/api/chat/contract", { token: viewerToken })).status === 200 &&
        (await request("GET", "/api/chat/labels", { token: viewerToken })).status === 200
    );

    console.log("\n[5] 真实出稿：未绑定产品 + 只给产品名（会真实调用一次模型，60–150 秒）");
    const started = Date.now();
    const sent = await sendMessage(sessionId, {
      content: SELLPOINT_DEMAND,
      product_name: PRODUCT_NAME_HINT,
      intensity: 5
    });
    const elapsed = Math.round((Date.now() - started) / 1000);
    check(
      `发一条需求返回 201（不是 502），实际耗时 ${elapsed} 秒`,
      sent.status === 201,
      { status: sent.status, payload: sent.payload?.error }
    );
    const assistant = sent.payload?.assistant_message;
    const payload = assistant?.payload;
    check(
      "AI 消息落库：role = ASSISTANT / schema_valid = true / provider 与 model 有值",
      assistant?.role === "ASSISTANT" &&
        assistant?.schema_valid === true &&
        typeof assistant?.provider === "string" &&
        typeof assistant?.model === "string",
      {
        role: assistant?.role,
        schema_valid: assistant?.schema_valid,
        provider: assistant?.provider
      }
    );
    check(
      "会话标题由首条需求自动生成（不再是占位「新对话」）",
      sent.payload?.session?.title !== "新对话" &&
        String(sent.payload?.session?.title ?? "").length > 0,
      sent.payload?.session?.title
    );
    check(
      "产出是完整卖点：reply / copy_blocks / quotes / objections / missing_facts / next_actions 都在（headline 可为 null）",
      typeof payload?.reply === "string" &&
        payload.reply.length > 0 &&
        "headline" in (payload ?? {}) &&
        Array.isArray(payload?.copy_blocks) &&
        payload.copy_blocks.length > 0 &&
        Array.isArray(payload?.quotes) &&
        Array.isArray(payload?.objections) &&
        Array.isArray(payload?.missing_facts) &&
        Array.isArray(payload?.next_actions),
      {
        reply_chars: payload?.reply?.length,
        copy_blocks: payload?.copy_blocks?.length,
        quotes: payload?.quotes?.length
      }
    );
    check(
      "话术块结构合法：label ≤ 40 字 / level 1–5 / text 非空，条数 ≤ 12",
      payload.copy_blocks.length <= 12 &&
        payload.copy_blocks.every(
          (block) =>
            typeof block?.label === "string" &&
            block.label.length > 0 &&
            block.label.length <= 40 &&
            Number.isInteger(block?.level) &&
            block.level >= 1 &&
            block.level <= 5 &&
            typeof block?.text === "string" &&
            block.text.length > 0
        ),
      payload.copy_blocks?.map((block) => [block.label, block.level])
    );
    check(
      "工作台不出直播场景词（§62-11：默认形态是卖点介绍，不是主播台词）",
      !assistantTexts(payload).some((text) => LIVE_SCENE_WORDS.some((word) => text.includes(word))),
      assistantTexts(payload).filter((text) => LIVE_SCENE_WORDS.some((word) => text.includes(word)))
    );
    check(
      "强度口径就是本次选的 Level 5（§21 / §62-9 允许极强修辞）",
      payload?.intensity === 5,
      payload?.intensity
    );

    const benchmarks = payload?.benchmarks ?? [];
    const valueHeight = payload?.value_height ?? null;
    check(
      `对标字段是数组且 ≤ ${MAX_BENCHMARKS} 条（0 条也合法：走 Category Creator Mode，§62-10）`,
      Array.isArray(payload?.benchmarks) && benchmarks.length <= MAX_BENCHMARKS,
      benchmarks.length
    );
    check(
      "每条对标都是真实来源：http(s) 链接 + 来源域名 + 检索时刻 + 标题（服务端回写，§62-1）",
      benchmarks.every(
        (benchmark) =>
          typeof benchmark?.url === "string" &&
          /^https?:\/\//.test(benchmark.url) &&
          typeof benchmark?.source_domain === "string" &&
          benchmark.source_domain.length > 0 &&
          typeof benchmark?.queried_at === "string" &&
          benchmark.queried_at.length > 0 &&
          typeof benchmark?.title === "string" &&
          benchmark.title.length > 0
      ),
      benchmarks.map((benchmark) => benchmark.source_domain)
    );
    check(
      "对标相关性：每条都落在茶叶/普洱茶语境里（同名其它行业的结果必须被过滤掉）",
      benchmarks.every((benchmark) => isTeaBenchmark(benchmark)),
      benchmarks.map((benchmark) => benchmark.title)
    );
    console.log(
      `  · 本次检索到 ${benchmarks.length} 条对标，价值高度：${valueHeight === null ? "（无对标，按 §62-10 讲自建标准）" : `「${String(valueHeight).slice(0, 40)}…」`}`
    );

    const reloaded = await listMessages(sessionId);
    const reloadedAssistant = (reloaded.payload?.items ?? []).find(
      (message) => message.id === assistant?.id
    );
    check(
      "重新读会话：AI 消息 payload 与本次返回逐字一致（工作台不落半成品、不改写历史）",
      reloaded.status === 200 &&
        JSON.stringify(reloadedAssistant?.payload) === JSON.stringify(payload),
      reloaded.status
    );
    check(
      "对标由服务端回写：落库 payload.benchmarks 就是检索结果（模型自己写的同名字段已被覆盖）",
      JSON.stringify(reloadedAssistant?.payload?.benchmarks ?? []) === JSON.stringify(benchmarks)
    );
    check(
      "需求原话逐字落库（用户说了什么都可追溯），并带上本次产品名",
      reloadedAssistant !== undefined &&
        (reloaded.payload?.items ?? []).some(
          (message) => message.role === "USER" && message.content === SELLPOINT_DEMAND
        )
    );

    const drafts = await client.query(
      "select count(*)::int as count from copy_outputs where product_id is not null"
    );
    check(
      "工作台产出的是草稿：不写 copy_outputs、不落任何正式交付表（§53 / §62-15）",
      drafts.rows[0]?.count === 0,
      drafts.rows[0]
    );

    console.log("\n[6] 清理冒烟数据并校验业务表清零");
  } finally {
    for (const sessionId of createdSessionIds) {
      const removed = await request("DELETE", `/api/chat/sessions/${sessionId}`, { token });
      console.log(
        `[清理] 删除冒烟会话 ${sessionId}（消息级联删除）→ ${
          removed.status === 204 || removed.status === 200 ? "已删除" : `状态 ${removed.status}`
        }`
      );
    }
    if (createdSessionIds.length > 0) {
      const gone = await request("GET", `/api/chat/sessions/${createdSessionIds[0]}/messages`, { token });
      check("删掉的会话再读一律 404（会话与消息都不留残影）", gone.status === 404, gone.status);
    }
    if (createdUserEmails.length > 0) {
      await client.query("delete from users where email = any($1::text[])", [createdUserEmails]);
      console.log(`[清理] 删除冒烟账号：${createdUserEmails.join("、")}`);
    }

    const totals = await client.query(
      "select (select count(*)::int from chat_sessions) as sessions, (select count(*)::int from chat_messages) as messages, (select count(*)::int from products) as products, (select count(*)::int from copy_outputs) as copy_outputs, (select count(*)::int from value_codes) as value_codes"
    );
    const row = totals.rows[0];
    console.log(
      `[清理] 开发库当前：chat_sessions=${row?.sessions} · chat_messages=${row?.messages} · products=${row?.products} · copy_outputs=${row?.copy_outputs} · value_codes=${row?.value_codes}`
    );
    check(
      "冒烟结束后 chat_sessions / chat_messages 清零（只保留 seed 与 16 行 Value Code 字典）",
      row?.sessions === 0 &&
        row?.messages === 0 &&
        row?.products === 0 &&
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
