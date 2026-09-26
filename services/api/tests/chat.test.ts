import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MockAiProvider,
  generateValidatedJson,
  type AiGenerateOptions,
  type AiJsonOptions,
  type AiProvider,
  type AiTextResult
} from "@ldj/ai";
import { CHAT_LIMITS, CHAT_PRESETS, type ChatBenchmark } from "@ldj/schemas";
import type { SearchProvider, SearchRequest, SearchResult } from "@ldj/search";
import { benchmarkTokens, filterBenchmarks } from "../src/modules/chat/chat.service.js";
import {
  SIX_STAR_PEACOCK_FIXTURE,
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

/**
 * AI 对话工作台（规格 §0 总执行说明 / §21–§27 / §31 / §33 / §62 / §64）。
 *
 * 本文件锁定六件事：
 * - **工作台只有一条入口**：用户说需求 → 服务端组 Prompt → 模型出 JSON → schema 校验 → 落库（§62-13）；
 * - **只喂已录事实**：绑定产品的 Prompt 里出现的硬事实必须来自 `products` / `product_facts`，
 *   没绑产品时只给追问与占位符模板（§62-1 / §62-5 / §62-8）；
 * - **AI 失败不落半成品**：校验失败返回 502 `AI_UNAVAILABLE`，用户消息保留、AI 消息不写库；
 * - **会话只属于创建者**：越权读写一律 404，不泄露会话是否存在；
 * - **草稿 ≠ 成稿**：工作台不写 `copy_outputs`，正式发布仍然只能走事实审核（§62-14 / §62-15）；
 * - **权限边界**：读需登录，写需 ADMIN / RESEARCHER / COPYWRITER（主播要能用，只读角色不能写）。
 */

/** 一份合法的 Agent 回答：用于把链路跑到「落库成功」为止。 */
const VALID_REPLY = JSON.stringify({
  reply: "我按「身份 → 价值 → 收口」给你整理了一版，还缺两个硬事实需要你补。",
  headline: "布朗山大树春茶里的压舱石",
  copy_blocks: [
    { label: "60 秒直播稿", level: 4, text: "第一句：它贵，不是因为名字，是因为料。" },
    { label: "成交收口", level: 4, text: "想要的今天带走，过了这个村没有这个价。" }
  ],
  quotes: ["好茶不解释，一泡就知道。"],
  objections: [{ question: "太贵了", answer: "贵在原料和工艺，不在包装。" }],
  missing_facts: ["树龄", "配方比例"],
  follow_up_questions: ["这批料是哪一年的？"],
  used_facts: ["原料：布朗山大树春茶"],
  value_focus: ["identity", "material"],
  intensity: 4,
  next_actions: ["去正式流程生成一版强成交话术", "补齐树龄后重跑一次"]
});

/** 记录每一次真实送进模型的 Prompt，用于验证「只喂已录事实」（§62-1 / §62-8）。 */
class RecordingAiProvider implements AiProvider {
  readonly name = "recording";
  readonly prompts: string[] = [];

  constructor(private readonly text: string) {}

  async generateText(options: AiGenerateOptions): Promise<AiTextResult> {
    this.prompts.push(options.messages.map((message) => message.content).join("\n---\n"));
    return { text: this.text, model: "recording-model", provider: this.name };
  }

  async generateJson<T>(options: AiJsonOptions<T>): Promise<{ data: T; raw: AiTextResult }> {
    return generateValidatedJson((messages) => this.generateText({ ...options, messages }), options);
  }
}

/**
 * 记录每一次检索的产品名对标通道（§12 Adapter）。
 *
 * `outcome` 是 `Error` 时模拟「检索挂了」：出稿必须照常，只是没有对标（§62-10 降级）。
 */
class RecordingSearchProvider implements SearchProvider {
  readonly name = "recording-search";
  readonly queries: string[] = [];

  constructor(private readonly outcome: SearchResult[] | Error) {}

  async search(input: SearchRequest): Promise<SearchResult[]> {
    this.queries.push(input.query);
    if (this.outcome instanceof Error) {
      throw this.outcome;
    }
    return this.outcome;
  }
}

const BENCHMARK_FIXTURE: SearchResult[] = [
  {
    title: "大益 7572 熟饼 行情价",
    url: "https://example.com/market/7572#price",
    snippet: "整件挂牌价与单饼价口径不同，本文只讨论单饼零售价。",
    sourceDomain: "example.com",
    publishedAt: "2026-08-01"
  }
];

/** 模型自己编的 `benchmarks`：服务端必须整体覆盖，不能让用户点到死链（§62-1）。 */
const REPLY_WITH_FAKE_BENCHMARKS = JSON.stringify({
  ...(JSON.parse(VALID_REPLY) as Record<string, unknown>),
  benchmarks: [
    {
      title: "模型编的对标",
      url: "https://made-up.example/benchmark",
      source_domain: "made-up.example",
      snippet: "",
      queried_at: "2020-01-01T00:00:00.000Z"
    }
  ]
});

interface SessionShape {
  id: string;
  title: string;
  product_id: string | null;
  product_name: string | null;
  intensity: number;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageShape {
  id: string;
  session_id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  payload: {
    reply: string;
    headline: string | null;
    copy_blocks: { label: string; level: number; text: string }[];
    quotes: string[];
    objections: { question: string; answer: string }[];
    missing_facts: string[];
    follow_up_questions: string[];
    used_facts: string[];
    value_focus: string[];
    intensity: number;
    value_height: string | null;
    benchmarks: {
      title: string;
      url: string;
      source_domain: string;
      snippet: string;
      queried_at: string;
    }[];
    next_actions: string[];
  } | null;
  provider: string | null;
  model: string | null;
  product_id: string | null;
  product_name: string | null;
  schema_valid: boolean;
  created_at: string;
}

interface ListShape<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

let context: TestContext;
let admin: BootstrapResult;

beforeAll(async () => {
  context = await createTestContext({ aiProvider: new MockAiProvider([{ match: /[\s\S]*/, text: VALID_REPLY }]) });
});

beforeEach(async () => {
  await context.reset();
  admin = await bootstrapAdmin(context.app, {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  });
});

afterAll(async () => {
  await context.close();
});

function headers(token: string = admin.accessToken): Record<string, string> {
  return authHeader(token);
}

async function createSession(payload: Record<string, unknown> = {}): Promise<SessionShape> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/chat/sessions",
    headers: headers(),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as SessionShape;
}

async function sendMessage(
  sessionId: string,
  payload: Record<string, unknown>
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/chat/sessions/${sessionId}/messages`,
    headers: headers(),
    payload
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

async function readMessages(sessionId: string, query = ""): Promise<{ statusCode: number; body: ListShape<MessageShape> }> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/chat/sessions/${sessionId}/messages${query}`,
    headers: headers()
  });
  return { statusCode: response.statusCode, body: response.json() as ListShape<MessageShape> };
}

async function createFullProduct(name = "龙德记六星孔雀"): Promise<string> {
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: headers(),
    payload: {
      ...SIX_STAR_PEACOCK_FIXTURE,
      product_name: name,
      tree_type: "大树",
      grade: "特级",
      blend_description: "三年料拼配，以布朗山主料打底",
      brand_id: null
    }
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { id: string }).id;
}

async function createUserToken(role: "VIEWER" | "COPYWRITER" | "RESEARCHER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: headers(),
    payload: {
      email: `${role.toLowerCase()}-chat@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

/**
 * 另开一个注入了别的 AI Provider 的 App 时，用户表是共用的：
 * 此时只有已登录的管理员能建号，所以这里由外层管理员代办注册（首用户自动成为管理员只发生一次）。
 */
async function registerAdminIn(
  app: import("fastify").FastifyInstance,
  email: string
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: headers(),
    payload: { email, password: "AdminPass1234", name: "测试管理员", role: "ADMIN" }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

describe("chat 合同与标签（§62 / §64）", () => {
  it("合同自检返回 15 条铁律、六条预设与全部上限", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/chat/contract",
      headers: headers()
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      contract: { output: { schema: string }; rules: string[]; guarantees: Record<string, boolean> };
      presets: { key: string }[];
      limits: { maxMessageChars: number };
      iron_rules: string[];
    };
    expect(body.contract.output.schema).toBe("chatReplySchema");
    expect(body.contract.rules.length).toBeGreaterThan(0);
    expect(body.iron_rules).toHaveLength(15);
    expect(body.presets).toHaveLength(CHAT_PRESETS.length);
    expect(body.limits.maxMessageChars).toBe(CHAT_LIMITS.maxMessageChars);
    expect(Object.values(body.contract.guarantees).every((value) => value === true)).toBe(true);
  });

  it("标签接口把五档强度、八项价值重点与当前 Provider 一并交给前端", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/chat/labels",
      headers: headers()
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      role_labels: Record<string, string>;
      presets: unknown[];
      onboarding_questions: string[];
      intensity_meta: { level: number }[];
      value_focus_labels: Record<string, string>;
      forbidden_facts: string[];
      default_intensity: number;
      ai_provider: string;
    };
    expect(body.role_labels.ASSISTANT).toBe("AI 卖点");
    expect(body.presets).toHaveLength(CHAT_PRESETS.length);
    expect(body.intensity_meta).toHaveLength(5);
    expect(Object.keys(body.value_focus_labels)).toHaveLength(8);
    expect(body.onboarding_questions.length).toBeGreaterThan(0);
    expect(body.forbidden_facts.length).toBeGreaterThan(0);
    expect(body.default_intensity).toBe(4);
    expect(body.ai_provider).toBe("mock");
  });

  it("未登录读不到任何工作台数据", async () => {
    for (const url of ["/api/chat/contract", "/api/chat/labels", "/api/chat/sessions"]) {
      const response = await context.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(401);
    }
  });
});

describe("chat 会话管理", () => {
  it("新建会话：未说明标题与产品时用占位标题与默认强度", async () => {
    const session = await createSession();
    expect(session.title).toBe("新对话");
    expect(session.product_id).toBeNull();
    expect(session.product_name).toBeNull();
    expect(session.message_count).toBe(0);
    expect(session.last_message_at).toBeNull();
    expect(session.intensity).toBe(4);
  });

  it("绑定产品的会话自动带上产品名做标题，产品不存在直接 404", async () => {
    const productId = await createFullProduct();
    const bound = await createSession({ product_id: productId });
    expect(bound.product_name).toBe("龙德记六星孔雀");
    expect(bound.title).toBe("龙德记六星孔雀 的卖点");

    const missing = await context.app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      headers: headers(),
      payload: { product_id: "00000000-0000-4000-8000-000000000000" }
    });
    expect(missing.statusCode).toBe(404);
  });

  it("strict 请求体：多余字段与非 UUID 产品都被拒", async () => {
    const extra = await context.app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      headers: headers(),
      payload: { unknown: true }
    });
    expect(extra.statusCode).toBe(400);

    const badProduct = await context.app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      headers: headers(),
      payload: { product_id: "not-a-uuid" }
    });
    expect(badProduct.statusCode).toBe(400);

    const badPageSize = await context.app.inject({
      method: "GET",
      url: `/api/chat/sessions?pageSize=${CHAT_LIMITS.maxPageSize + 1}`,
      headers: headers()
    });
    expect(badPageSize.statusCode).toBe(400);
  });

  it("改标题 / 换产品 / 改强度都会落到会话上", async () => {
    const productId = await createFullProduct();
    const session = await createSession({ title: "双十一专场" });

    const patched = await context.app.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${session.id}`,
      headers: headers(),
      payload: { product_id: productId, intensity: 5 }
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as SessionShape;
    expect(body.product_id).toBe(productId);
    expect(body.product_name).toBe("龙德记六星孔雀");
    expect(body.intensity).toBe(5);
    expect(body.title).toBe("双十一专场");

    const cleared = await context.app.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${session.id}`,
      headers: headers(),
      payload: { product_id: null }
    });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.json() as SessionShape).product_id).toBeNull();
  });

  it("列表按当前用户过滤，并支持关键字与是否绑产品", async () => {
    await createSession({ title: "双十一专场" });
    const productId = await createFullProduct();
    await createSession({ product_id: productId });

    const all = await context.app.inject({
      method: "GET",
      url: "/api/chat/sessions",
      headers: headers()
    });
    expect((all.json() as ListShape<SessionShape>).total).toBe(2);

    const keyword = await context.app.inject({
      method: "GET",
      url: "/api/chat/sessions?q=双十一",
      headers: headers()
    });
    const keywordBody = keyword.json() as ListShape<SessionShape>;
    expect(keywordBody.total).toBe(1);
    expect(keywordBody.items[0]?.title).toBe("双十一专场");

    const bound = await context.app.inject({
      method: "GET",
      url: "/api/chat/sessions?bound=true",
      headers: headers()
    });
    expect((bound.json() as ListShape<SessionShape>).total).toBe(1);

    const unbound = await context.app.inject({
      method: "GET",
      url: "/api/chat/sessions?bound=false",
      headers: headers()
    });
    expect((unbound.json() as ListShape<SessionShape>).total).toBe(1);
  });

  it("删除会话时消息级联删除，删完再读 404", async () => {
    const session = await createSession();
    await sendMessage(session.id, { content: "整理一版 60 秒直播稿" });

    const removed = await context.app.inject({
      method: "DELETE",
      url: `/api/chat/sessions/${session.id}`,
      headers: headers()
    });
    expect(removed.statusCode).toBe(204);
    expect((await readMessages(session.id)).statusCode).toBe(404);
  });

  it("会话只属于创建者：别人的会话一律 404", async () => {
    const session = await createSession();
    const otherToken = await createUserToken("COPYWRITER");

    for (const [method, url] of [
      ["GET", `/api/chat/sessions/${session.id}/messages`],
      ["PATCH", `/api/chat/sessions/${session.id}`],
      ["DELETE", `/api/chat/sessions/${session.id}`]
    ] as const) {
      const response = await context.app.inject({
        method,
        url,
        headers: authHeader(otherToken),
        ...(method === "GET" ? {} : { payload: { title: "劫持" } })
      });
      expect(response.statusCode).toBe(404);
    }

    const otherList = await context.app.inject({
      method: "GET",
      url: "/api/chat/sessions",
      headers: authHeader(otherToken)
    });
    expect((otherList.json() as ListShape<SessionShape>).total).toBe(0);
  });

  it("只读角色不能写，但主播 / 文案角色可以出草稿", async () => {
    const viewerToken = await createUserToken("VIEWER");
    const blocked = await context.app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      headers: authHeader(viewerToken),
      payload: {}
    });
    expect(blocked.statusCode).toBe(403);

    const viewerRead = await context.app.inject({
      method: "GET",
      url: "/api/chat/sessions",
      headers: authHeader(viewerToken)
    });
    expect(viewerRead.statusCode).toBe(200);

    const copywriterToken = await createUserToken("COPYWRITER");
    const allowed = await context.app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      headers: authHeader(copywriterToken),
      payload: {}
    });
    expect(allowed.statusCode).toBe(201);
  });

  it(`单个用户最多保留 ${CHAT_LIMITS.maxSessionsPerUser} 个会话`, async () => {
    const token = await createUserToken("COPYWRITER");
    for (let index = 0; index < CHAT_LIMITS.maxSessionsPerUser; index += 1) {
      const response = await context.app.inject({
        method: "POST",
        url: "/api/chat/sessions",
        headers: authHeader(token),
        payload: { title: `会话 ${index}` }
      });
      expect(response.statusCode).toBe(201);
    }
    const overflow = await context.app.inject({
      method: "POST",
      url: "/api/chat/sessions",
      headers: authHeader(token),
      payload: {}
    });
    expect(overflow.statusCode).toBe(409);
    const error = overflow.json() as { error: { code: string; details: { max_sessions: number } } };
    expect(error.error.code).toBe("CONFLICT");
    expect(error.error.details.max_sessions).toBe(CHAT_LIMITS.maxSessionsPerUser);
  }, 60000);
});

describe("chat 发消息出稿（§62-13）", () => {
  it("一条需求得到一版通过校验的话术，会话与消息都同步更新", async () => {
    const session = await createSession();
    const result = await sendMessage(session.id, { content: "把这款茶整理成 60 秒直播稿" });
    expect(result.statusCode).toBe(201);

    const userMessage = result.body.user_message as MessageShape;
    const assistantMessage = result.body.assistant_message as MessageShape;
    const updatedSession = result.body.session as SessionShape;

    expect(userMessage.role).toBe("USER");
    expect(userMessage.content).toBe("把这款茶整理成 60 秒直播稿");
    expect(userMessage.payload).toBeNull();
    expect(assistantMessage.role).toBe("ASSISTANT");
    expect(assistantMessage.provider).toBe("mock");
    expect(assistantMessage.schema_valid).toBe(true);
    expect(assistantMessage.payload?.copy_blocks[0]?.label).toBe("60 秒直播稿");
    expect(assistantMessage.payload?.value_focus).toEqual(["identity", "material"]);
    expect(assistantMessage.payload?.missing_facts).toEqual(["树龄", "配方比例"]);

    // 首条需求自动给会话命名，用户不必先想标题（§64）。
    expect(updatedSession.title).toBe("把这款茶整理成 60 秒直播稿");
    expect(updatedSession.message_count).toBe(2);
    expect(updatedSession.last_message_at).not.toBeNull();

    const listed = await readMessages(session.id);
    expect(listed.statusCode).toBe(200);
    expect(listed.body.total).toBe(2);
    expect(listed.body.items.map((item) => item.role)).toEqual(["USER", "ASSISTANT"]);
  });

  it("第二条需求不改会话标题，消息数继续累加", async () => {
    const session = await createSession();
    await sendMessage(session.id, { content: "第一版 60 秒直播稿" });
    const second = await sendMessage(session.id, { content: "再狠一点，别新增事实" });
    expect(second.statusCode).toBe(201);
    const updated = second.body.session as SessionShape;
    expect(updated.title).toBe("第一版 60 秒直播稿");
    expect(updated.message_count).toBe(4);
    expect((await readMessages(session.id)).body.total).toBe(4);
  });

  it("发消息时临时换产品，会话绑定与消息标注同时更新", async () => {
    const productId = await createFullProduct();
    const session = await createSession();
    const result = await sendMessage(session.id, { content: "用已录事实写一版", product_id: productId });
    expect(result.statusCode).toBe(201);
    const updated = result.body.session as SessionShape;
    expect(updated.product_id).toBe(productId);
    expect(updated.product_name).toBe("龙德记六星孔雀");
    const assistantMessage = result.body.assistant_message as MessageShape;
    expect(assistantMessage.product_name).toBe("龙德记六星孔雀");
  });

  it("空需求、超长需求、未知会话都被拦下", async () => {
    const session = await createSession();
    expect((await sendMessage(session.id, { content: "   " })).statusCode).toBe(400);
    expect((await sendMessage(session.id, { content: "x".repeat(CHAT_LIMITS.maxMessageChars + 1) })).statusCode).toBe(400);
    expect((await sendMessage("00000000-0000-4000-8000-000000000000", { content: "写一版" })).statusCode).toBe(404);
    expect((await readMessages(session.id)).body.total).toBe(0);
  });
});

describe("chat Prompt 纪律（§62-1 / §62-5 / §62-8）", () => {
  it("未绑定产品：Prompt 明说不要编造，且不出现任何具体产品事实", async () => {
    const provider = new RecordingAiProvider(VALID_REPLY);
    const local = await createTestContext({ aiProvider: provider });
    try {
      const localToken = await registerAdminIn(local.app, "recording-chat@longdeji.local");
      const created = await local.app.inject({
        method: "POST",
        url: "/api/chat/sessions",
        headers: authHeader(localToken),
        payload: {}
      });
      const sessionId = (created.json() as SessionShape).id;
      const sent = await local.app.inject({
        method: "POST",
        url: `/api/chat/sessions/${sessionId}/messages`,
        headers: authHeader(localToken),
        payload: { content: "帮我写一版开场" }
      });
      expect(sent.statusCode).toBe(201);

      const prompt = provider.prompts[0] ?? "";
      expect(prompt).toContain("不要编造任何具体产品事实");
      expect(prompt).toContain("【待补充：");
      expect(prompt).not.toContain("已录事实（下面每一条都有出处");
      expect(prompt).not.toContain("布朗山");
    } finally {
      await local.close();
    }
  });

  it("绑定产品：Prompt 只带已录事实与出处，缺口写进 missing_facts 要求", async () => {
    const provider = new RecordingAiProvider(VALID_REPLY);
    const local = await createTestContext({ aiProvider: provider });
    try {
      const localToken = await registerAdminIn(local.app, "recording-bound-chat@longdeji.local");
      const created = await local.app.inject({
        method: "POST",
        url: "/api/products",
        headers: authHeader(localToken),
        payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
      });
      expect(created.statusCode).toBe(201);
      const productId = (created.json() as { id: string }).id;

      const session = await local.app.inject({
        method: "POST",
        url: "/api/chat/sessions",
        headers: authHeader(localToken),
        payload: { product_id: productId, intensity: 5 }
      });
      const sessionId = (session.json() as SessionShape).id;

      const sent = await local.app.inject({
        method: "POST",
        url: `/api/chat/sessions/${sessionId}/messages`,
        headers: authHeader(localToken),
        payload: { content: "按 Level 5 写一版王者话术" }
      });
      expect(sent.statusCode).toBe(201);

      const prompt = provider.prompts[0] ?? "";
      expect(prompt).toContain("已录事实（下面每一条都有出处");
      expect(prompt).toContain("来源：产品录入");
      expect(prompt).toContain("原料：大树春茶");
      expect(prompt).toContain("山头：布朗山");
      // 没录入的硬事实只能进 missing_facts：树龄 / 配方比例在本例都没有录入。
      expect(prompt).toContain("树龄");
      expect(prompt).toContain("配方比例");
      expect(prompt).toContain("必须写进 missing_facts");
      expect(prompt).toContain("本次采用：Level 5");
      expect(prompt).toContain("强反问");
      // 未录入的产品事实不会凭空出现（本例没有录入村庄与获奖）。
      expect(prompt).not.toContain("老班章");
    } finally {
      await local.close();
    }
  });
});

describe("chat 全网对标（§12 / §62-1 / §62-5）", () => {
  it("绑定产品：按产品名并发检索，对标进 Prompt，且服务端覆盖模型自己编的链接", async () => {
    const ai = new RecordingAiProvider(REPLY_WITH_FAKE_BENCHMARKS);
    const search = new RecordingSearchProvider(BENCHMARK_FIXTURE);
    const local = await createTestContext({ aiProvider: ai, searchProvider: search });
    try {
      const token = await registerAdminIn(local.app, "benchmark-chat@longdeji.local");
      const created = await local.app.inject({
        method: "POST",
        url: "/api/products",
        headers: authHeader(token),
        payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
      });
      expect(created.statusCode).toBe(201);
      const productId = (created.json() as { id: string }).id;

      const session = await local.app.inject({
        method: "POST",
        url: "/api/chat/sessions",
        headers: authHeader(token),
        payload: { product_id: productId }
      });
      const sessionId = (session.json() as SessionShape).id;

      const sent = await local.app.inject({
        method: "POST",
        url: `/api/chat/sessions/${sessionId}/messages`,
        headers: authHeader(token),
        payload: { content: "写一份产品卖点介绍" }
      });
      expect(sent.statusCode).toBe(201);

      // 三条查询覆盖「直接价格 / 单饼价格 / 同门对比」，并发一次发完。
      expect(search.queries).toHaveLength(CHAT_LIMITS.benchmarkQueries);
      expect(search.queries[0]).toContain("六星孔雀");

      const prompt = ai.prompts[0] ?? "";
      expect(prompt).toContain("## 九、全网对标素材");
      expect(prompt).toContain("大益 7572 熟饼 行情价");
      expect(prompt).toContain("example.com");
      expect(prompt).toContain("不许**把这些来源里的原料、树龄、山头、年份、配方、工艺写成龙德记自己的事实");

      const payload = (sent.json() as { assistant_message: MessageShape }).assistant_message.payload;
      expect(payload?.benchmarks).toHaveLength(1);
      expect(payload?.benchmarks[0]?.source_domain).toBe("example.com");
      // hash 被规范化掉，模型编的那条整体作废。
      expect(payload?.benchmarks[0]?.url).toBe("https://example.com/market/7572");
      expect(JSON.stringify(payload?.benchmarks)).not.toContain("made-up.example");
      expect(payload?.benchmarks[0]?.queried_at.length).toBeGreaterThan(0);
    } finally {
      await local.close();
    }
  });

  it("检索失败不阻塞出稿：降级为「没有对标」，自动进 Category Creator Mode", async () => {
    const ai = new RecordingAiProvider(VALID_REPLY);
    const search = new RecordingSearchProvider(new Error("search offline"));
    const local = await createTestContext({ aiProvider: ai, searchProvider: search });
    try {
      const token = await registerAdminIn(local.app, "benchmark-degrade-chat@longdeji.local");
      const created = await local.app.inject({
        method: "POST",
        url: "/api/products",
        headers: authHeader(token),
        payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
      });
      const productId = (created.json() as { id: string }).id;
      const session = await local.app.inject({
        method: "POST",
        url: "/api/chat/sessions",
        headers: authHeader(token),
        payload: { product_id: productId }
      });
      const sessionId = (session.json() as SessionShape).id;

      const sent = await local.app.inject({
        method: "POST",
        url: `/api/chat/sessions/${sessionId}/messages`,
        headers: authHeader(token),
        payload: { content: "写一份产品卖点介绍" }
      });
      expect(sent.statusCode).toBe(201);
      const prompt = ai.prompts[0] ?? "";
      expect(prompt).toContain("没有检索到任何对标来源");
      expect(prompt).toContain("Category Creator Mode");
      expect((sent.json() as { assistant_message: MessageShape }).assistant_message.payload?.benchmarks).toEqual(
        []
      );
    } finally {
      await local.close();
    }
  });

  it("未绑定产品但用户直接写了产品名：按它检索，且明说「只能当检索词」", async () => {
    const ai = new RecordingAiProvider(VALID_REPLY);
    const search = new RecordingSearchProvider(BENCHMARK_FIXTURE);
    const local = await createTestContext({ aiProvider: ai, searchProvider: search });
    try {
      const token = await registerAdminIn(local.app, "benchmark-hint-chat@longdeji.local");
      const session = await local.app.inject({
        method: "POST",
        url: "/api/chat/sessions",
        headers: authHeader(token),
        payload: {}
      });
      const sessionId = (session.json() as SessionShape).id;

      const sent = await local.app.inject({
        method: "POST",
        url: `/api/chat/sessions/${sessionId}/messages`,
        headers: authHeader(token),
        payload: { content: "把这款茶的卖点整理出来", product_name: "龙德记貂蝉冰岛生茶" }
      });
      expect(sent.statusCode).toBe(201);
      expect(search.queries[0]).toContain("龙德记貂蝉冰岛生茶");

      const prompt = ai.prompts[0] ?? "";
      expect(prompt).toContain("不要编造任何具体产品事实");
      expect(prompt).toContain("用户在这条需求里给出的产品名是「龙德记貂蝉冰岛生茶」");
      expect(prompt).toContain("大益 7572 熟饼 行情价");
      // 产品名只是检索词：事实层仍然一个字都不给。
      expect(prompt).not.toContain("已录事实（下面每一条都有出处");

      const payload = (sent.json() as { assistant_message: MessageShape }).assistant_message.payload;
      expect(payload?.benchmarks).toHaveLength(1);
    } finally {
      await local.close();
    }
  });

  it("产品名是可选的纯检索词：空串被拒，超长被拒", async () => {
    const session = await createSession();
    expect(
      (await sendMessage(session.id, { content: "写一版", product_name: "   " })).statusCode
    ).toBe(400);
    expect(
      (
        await sendMessage(session.id, {
          content: "写一版",
          product_name: "茶".repeat(CHAT_LIMITS.maxProductNameChars + 1)
        })
      ).statusCode
    ).toBe(400);
    expect((await readMessages(session.id)).body.total).toBe(0);
  });
});

describe("chat 对标相关性过滤（§62-1 / §62-5）", () => {
  const at = "2026-09-26T00:00:00.000Z";

  const source = (index: number, title: string, snippet: string): ChatBenchmark => ({
    title,
    url: `https://example.com/${index}`,
    source_domain: "example.com",
    snippet,
    queried_at: at
  });

  it("产品名令牌取整段与 2 字窗口，纯数字年份不算令牌", () => {
    const tokens = benchmarkTokens("龙德记 六星孔雀 2023");
    expect(tokens).toContain("六星孔雀");
    expect(tokens).toContain("孔雀");
    expect(tokens).toContain("六星");
    expect(tokens).not.toContain("2023");
  });

  it("同名的非茶行业来源被丢掉，命中产品名的茶叶来源留下", () => {
    const kept = filterBenchmarks("龙德记 六星孔雀", [
      source(1, "德龙国六6x2三轴车价格2024新款_卡车之家", "德龙国六三轴车多少钱"),
      source(2, "2003年福今六星孔雀班章：价格暴涨至3500万/件", "六星孔雀是茶圈顶级价格符号"),
      source(3, "2026 延超圆满收官龙井、延吉、珲春跻身三甲", "延边足球联赛收官")
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toBe("https://example.com/2");
  });

  it("一条都没命中产品名时退回「茶叶价格语境」，不会把对标清空", () => {
    const kept = filterBenchmarks("龙德记貂蝉", [
      source(1, "大益 7572 熟饼 行情价", "整件挂牌价与单饼价口径不同"),
      source(2, "德龙国六6x2三轴车价格2024新款", "德龙国六三轴车多少钱")
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.url).toBe("https://example.com/1");
  });
});

describe("chat AI 失败路径（§62-13）", () => {
  it("模型输出不合格时返回 502，用户消息保留、AI 消息不落库", async () => {
    const local = await createTestContext({
      aiProvider: new MockAiProvider([{ match: /[\s\S]*/, text: "抱歉，我这次没法给出 JSON。" }])
    });
    try {
      const localToken = await registerAdminIn(local.app, "broken-ai-chat@longdeji.local");
      const created = await local.app.inject({
        method: "POST",
        url: "/api/chat/sessions",
        headers: authHeader(localToken),
        payload: {}
      });
      const sessionId = (created.json() as SessionShape).id;

      const failed = await local.app.inject({
        method: "POST",
        url: `/api/chat/sessions/${sessionId}/messages`,
        headers: authHeader(localToken),
        payload: { content: "整理一版收口话术" }
      });
      expect(failed.statusCode).toBe(502);
      const error = failed.json() as {
        error: { code: string; message: string; details: { session_id: string; user_message_id: string; ai_provider: string } };
      };
      expect(error.error.code).toBe("AI_UNAVAILABLE");
      expect(error.error.details.session_id).toBe(sessionId);
      expect(error.error.details.user_message_id.length).toBeGreaterThan(0);
      expect(error.error.details.ai_provider).toBe("mock");
      expect(error.error.message).toContain("需求已保存");

      // 用户输入不能丢；AI 半成品一个字段都不许写库。
      const listed = await local.app.inject({
        method: "GET",
        url: `/api/chat/sessions/${sessionId}/messages`,
        headers: authHeader(localToken)
      });
      const body = listed.json() as ListShape<MessageShape>;
      expect(body.total).toBe(1);
      expect(body.items[0]?.role).toBe("USER");

      const sessions = await local.app.inject({
        method: "GET",
        url: "/api/chat/sessions",
        headers: authHeader(localToken)
      });
      expect((sessions.json() as ListShape<SessionShape>).items[0]?.message_count).toBe(0);
    } finally {
      await local.close();
    }
  });
});
