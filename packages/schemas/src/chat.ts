import { z } from "zod";
import { copyIntensitySchema, type CopyIntensity } from "./enums.js";
import { FORBIDDEN_AUTO_FILL_LABELS } from "./fact-normalizer.js";
import { FORBIDDEN_PROMISES, RND_RESTRICTED_PHRASES } from "./forbidden-claims.js";
import {
  COPY_INTENSITY_META,
  LEVEL5_REQUIREMENT_META,
  SALES_COPY_OUTPUT_META,
  VALUE_FOCUS_LABELS,
  valueFocusKeys,
  type ValueFocusKey
} from "./sales-copy.js";

/**
 * AI 对话工作台（规格 §0 总执行说明 / §21–§27 成交文案 / §31 页面信息架构 / §33 强成交页面 /
 * §38–§49 Agent / §57 验收 / §64 项目最终目标）。
 *
 * 这一层的产品目标只有一个（§64）：**老板不用学系统，把需求说清楚就能拿到话术**。
 * 但「好上手」绝不等于「放松事实纪律」，所以四条约束写在代码里：
 *
 * 1. **只喂已录事实**（§62-1 / §62-5 / §62-8）：绑定产品时，进入 Prompt 的硬事实只有
 *    `products` 已录入字段与 `product_facts` 行——「未录入的树龄、山头、年份、获奖、大师、
 *    配方比例、研发关系、成交价格」一律不出现，缺什么就让模型写进 `missing_facts` 交给产品方补；
 * 2. **AI 输出必须经过 schema 校验**（§62-13）：模型只能回 `chatReplySchema` 的 JSON，
 *    解析或校验失败由调用方按既有 `generateValidatedJson` 流程重试，绝不把自由文本直接落库；
 * 3. **允许极强修辞，禁止虚构事实**（§62-9 / §24）：Prompt 里写明「气势、比喻、排比、身份塑造
 *    可以拉满」，但禁止承诺收益、禁止无据的「第一 / 最贵 / 唯一」、禁止把对标产品的事实当自己的；
 * 4. **没有对标就走 Category Creator Mode**（§62-10）：Prompt 明确要求「没有可靠锚点时，
 *    按自建高端标准讲，而不是硬凑一个对标」。
 *
 * 这里只放**纯函数与常量**：Prompt 组装（`buildChatSystemPrompt`）与请求 / 响应契约，
 * 落库与模型调用在 `services/api/src/modules/chat`。
 *
 * 客户 2026-09-26 追加需求（**基线外追加，已登记 `agent_memory`**）：
 * 「不需要直播话术，我要的是产品卖点介绍；卖点一定要根据我提供的产品名，尽可能去全网搜索
 * 高价值的对标产品，把卖点吹大」。四处的落地方式：
 * - 交付形态改成**产品卖点介绍**（`CHAT_SELLPOINT_FORM`），直播稿退成 §26 里的一档可选块；
 * - 服务端按产品名检索全网对标，结果作为 `benchmarks` 只读素材注入 Prompt **并**回给前端；
 * - 「吹大」= 修辞与价值高度放开（Level 4/5 + §22 七项 + §33 八项），但事实层仍逐字来自已录记录；
 * - 对标只能贡献「价格高度 / 市场认知」这一层，**绝不把竞品的原料、树龄、山头、年份、
 *   配方、价格搬成龙德记自己的事实**（§62-5 从未放宽）。
 */

export const CHAT_SPEC_REF = "§0 / §12 / §17 / §20 / §21 / §22 / §26 / §31 / §33 / §49 / §62 / §64";

/** 对话工作台的数量上限：写在一处，前端提示与后端校验读同一份。 */
export const CHAT_LIMITS = {
  defaultPageSize: 20,
  maxPageSize: 50,
  /** 单条需求 / 追问字数上限（够写一大段需求，又不至于把 Prompt 撑爆） */
  maxMessageChars: 4000,
  maxTitleChars: 60,
  /** 每个用户的会话上限：超过就先删旧会话，避免无限增长 */
  maxSessionsPerUser: 200,
  /** 送入模型的历史消息条数（最近 N 条，含本轮用户消息） */
  historyMessages: 12,
  /** 单次组装进 Prompt 的已录事实行上限（超出时保留最早录入的，并在缺口里说明） */
  maxProductFactsInPrompt: 60,
  maxCopyBlocks: 12,
  maxQuotes: 8,
  maxObjections: 6,
  maxMissingFacts: 12,
  maxFollowUps: 5,
  maxUsedFacts: 24,
  maxNextActions: 5,
  /** 单次注入 Prompt / 回给前端的全网对标来源上限 */
  maxBenchmarks: 8,
  /** 单条对标来源摘要的字数上限 */
  maxBenchmarkSnippetChars: 300,
  /** 单次对同一次出稿发起的产品名检索条数（并发跑，任一条失败都只是少几条素材） */
  benchmarkQueries: 3,
  /** 未绑定产品时，用户直接写在对话框里的产品名上限 */
  maxProductNameChars: 80
} as const;

/** §62 的 15 条铁律：逐条照抄基线，Prompt 与合同自检读同一份。 */
export const CHAT_IRON_RULES: readonly string[] = [
  "§62-1 不把搜索功能改成模型凭记忆回答",
  "§62-2 不把挂牌价当成交价",
  "§62-3 不把整件价当单饼价",
  "§62-4 不让价格参与相似度",
  "§62-5 不让竞品事实自动移植到龙德记",
  "§62-6 不虚构研发关系",
  "§62-7 不虚构配方比例",
  "§62-8 不虚构树龄、山头、年份、获奖、大师等硬事实",
  "§62-9 允许极强修辞和强成交表达",
  "§62-10 没有对标时，必须自动进入 Category Creator Mode",
  "§62-11 前台文案不能因为研究层谨慎而变成说明书",
  "§62-12 Prompt 必须可版本管理",
  "§62-13 AI 输出必须经过 schema validation",
  "§62-14 RED claim 禁止发布",
  "§62-15 所有版本必须保留"
];

/** 对话角色：工作台只保存「用户需求」与「AI 成稿」两类消息（系统提示不落库，随时可重建）。 */
export const chatRoles = ["USER", "ASSISTANT"] as const;
export const chatRoleSchema = z.enum(chatRoles);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const CHAT_ROLE_LABELS: Record<ChatRole, string> = {
  USER: "我的需求",
  ASSISTANT: "AI 卖点"
};

/** 新建会话的占位标题：首条需求进来后由服务端自动改名（前端与服务端读同一份）。 */
export const CHAT_DEFAULT_TITLE = "新对话";

/**
 * 交付形态：**产品卖点介绍**（客户 2026-09-26 追加需求）。
 *
 * 基线里 §26 的 15 秒 / 30 秒 / 60 秒 / 3 分钟 / 直播稿是**专业模式下的可选输出**，一个都没删；
 * 但对话工作台的默认产出不再是「主播台词」，而是能直接拿去当详情页 / 招商页 / 手卡的产品卖点介绍。
 * 这一段中文口径只写在这里，Prompt 与前端同源。
 */
export const CHAT_SELLPOINT_FORM = {
  spec_ref: "§20 / §22 / §26 / §33 / §64",
  name: "产品卖点介绍",
  /** 固定七段骨架：无话可说的段落宁可空着写【待补充：xxx】，也不许灌水或编事实 */
  outline: [
    "一句话定位：这款茶是谁、给谁喝、一句话说清它凭什么站得住",
    "核心卖点：3–5 条，每条先给结论再给依据（依据必须来自已录事实）",
    "价值高度：把价格高度标准与全网对标讲清，只讲「别人卖到多少、你处在什么高度」",
    "口感与产品结构：汤感、香气、回甘、茶气，以及饼型 / 克重 / 拼配结构（没录入的不写）",
    "配方哲学：为什么这么拼、这么压、这么做，落到「我们坚持什么」",
    "异议接住：凭什么这么贵 / 别家更便宜 / 喝不出区别",
    "收口：一句能记住的话 + 下一步动作"
  ],
  rules: [
    "不写成参数说明书：先给画面与结论，再给依据（§62-11）",
    "不出现「直播」「开场」「上链接」「扣一」这类直播场景词，除非用户明确要直播稿",
    "没有对标素材时走 Category Creator Mode：讲自建标准，不硬凑对标（§62-10）"
  ]
} as const;

/* ------------------------------------------------------- AI 输出契约 */

/** 一块可直接拿去用的话术：`label` 是它的作用（如「60 秒直播稿」），`level` 是 §21 强度档。 */
export const chatCopyBlockSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    level: copyIntensitySchema,
    text: z.string().trim().min(1).max(CHAT_LIMITS.maxMessageChars)
  })
  .strict();
export type ChatCopyBlock = z.infer<typeof chatCopyBlockSchema>;

/**
 * 一条全网对标来源（客户 2026-09-26 追加需求）。
 *
 * **只由服务端写入**：来自真实检索通道（§12 Adapter）返回的 title / url / domain / snippet，
 * 模型的输出里就算带了 `benchmarks` 也会被服务端结果整体覆盖——因为「人人可点开自查的链接」
 * 是这个功能唯一的可信度来源，绝不能让模型凭记忆编一条链接出来（§62-1）。
 */
export const chatBenchmarkSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    url: z.string().trim().min(1).max(1000),
    source_domain: z.string().trim().min(1).max(200),
    snippet: z.string().trim().max(CHAT_LIMITS.maxBenchmarkSnippetChars).default(""),
    /** 检索时刻（ISO 字符串）：对标行情会变，页面上要能显示「这是什么时候查的」 */
    queried_at: z.string().trim().min(1).max(40)
  })
  .strict();
export type ChatBenchmark = z.infer<typeof chatBenchmarkSchema>;

export const chatObjectionSchema = z
  .object({
    question: z.string().trim().min(1).max(200),
    answer: z.string().trim().min(1).max(CHAT_LIMITS.maxMessageChars)
  })
  .strict();
export type ChatObjection = z.infer<typeof chatObjectionSchema>;

/**
 * Agent 回答（§62-13：模型的输出结构就是这一份 schema，校验不过就重试）。
 *
 * 字段设计对着四类真实使用场景：
 * - `reply`：对话正文——先说人话，告诉用户「我按什么思路给你整理的」；
 * - `copy_blocks` / `quotes` / `objections`：可直接念的成稿（对标 §26 九种输出与 §51 十项）；
 * - `missing_facts`：**这次没敢写、需要产品方补的硬事实**（不给模型编造的机会，§62-8）；
 * - `used_facts` / `follow_up_questions`：可追溯性——这段话用了哪些已录事实、还差什么信息。
 */
export const chatReplySchema = z
  .object({
    reply: z.string().trim().min(1).max(CHAT_LIMITS.maxMessageChars),
    headline: z.string().trim().min(1).max(120).nullable().default(null),
    copy_blocks: z.array(chatCopyBlockSchema).max(CHAT_LIMITS.maxCopyBlocks).default([]),
    quotes: z
      .array(z.string().trim().min(1).max(300))
      .max(CHAT_LIMITS.maxQuotes)
      .default([]),
    objections: z.array(chatObjectionSchema).max(CHAT_LIMITS.maxObjections).default([]),
    missing_facts: z
      .array(z.string().trim().min(1).max(200))
      .max(CHAT_LIMITS.maxMissingFacts)
      .default([]),
    follow_up_questions: z
      .array(z.string().trim().min(1).max(200))
      .max(CHAT_LIMITS.maxFollowUps)
      .default([]),
    used_facts: z
      .array(z.string().trim().min(1).max(200))
      .max(CHAT_LIMITS.maxUsedFacts)
      .default([]),
    value_focus: z.array(z.enum(valueFocusKeys)).default([]),
    intensity: copyIntensitySchema.default(4),
    /** 本次价值高度的一句话总纲（「同料同山头的别人卖到多少、你站在什么高度」）；没有对标时为 null */
    value_height: z.string().trim().min(1).max(400).nullable().default(null),
    /** 本次真实检索到的对标来源；**服务端回写，模型不产出**（见 chatBenchmarkSchema 注释） */
    benchmarks: z.array(chatBenchmarkSchema).max(CHAT_LIMITS.maxBenchmarks).default([]),
    next_actions: z
      .array(z.string().trim().min(1).max(120))
      .max(CHAT_LIMITS.maxNextActions)
      .default([])
  })
  .strict();
export type ChatReply = z.infer<typeof chatReplySchema>;

/* ----------------------------------------------------------- 请求契约 */

export const createChatSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(CHAT_LIMITS.maxTitleChars).optional(),
    product_id: z.uuid().nullable().optional(),
    intensity: copyIntensitySchema.optional()
  })
  .strict();
export type CreateChatSessionInput = z.infer<typeof createChatSessionSchema>;

export const updateChatSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(CHAT_LIMITS.maxTitleChars).optional(),
    product_id: z.uuid().nullable().optional(),
    intensity: copyIntensitySchema.optional()
  })
  .strict();
export type UpdateChatSessionInput = z.infer<typeof updateChatSessionSchema>;

/** 发一条需求：`content` 是用户原话；`product_id` 可临时绑定 / 切换产品；`intensity` 覆盖本档强度。 */
export const sendChatMessageSchema = z
  .object({
    content: z.string().trim().min(1, "请先写下你的需求").max(CHAT_LIMITS.maxMessageChars),
    product_id: z.uuid().nullable().optional(),
    /**
     * 没有绑定产品时，用户可以在对话框里**直接写产品名**：
     * 服务端按它去全网找高价值对标（客户 2026-09-26 追加需求）。
     * 注意它**只是检索词**，不是事实来源——产品的年份 / 山头 / 原料一律仍视为未录入。
     */
    product_name: z.string().trim().min(1).max(CHAT_LIMITS.maxProductNameChars).nullable().optional(),
    intensity: copyIntensitySchema.optional()
  })
  .strict();
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const chatSessionListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(CHAT_LIMITS.maxPageSize).optional(),
    q: z.string().trim().max(60).optional(),
    /** 三态：不传 = 全部，`true` = 只看绑定了产品的会话（`false` 反之） */
    bound: z.stringbool().optional(),
    archived: z.stringbool().optional()
  })
  .strict();
export type ChatSessionListQuery = z.infer<typeof chatSessionListQuerySchema>;

export const chatMessageListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(CHAT_LIMITS.maxPageSize).optional()
  })
  .strict();
export type ChatMessageListQuery = z.infer<typeof chatMessageListQuerySchema>;

/* ----------------------------------------------------------- 视图契约 */

export const chatSessionViewSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    product_id: z.uuid().nullable(),
    product_name: z.string().nullable(),
    intensity: copyIntensitySchema,
    message_count: z.number().int().nonnegative(),
    last_message_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string()
  })
  .strict();
export type ChatSessionView = z.infer<typeof chatSessionViewSchema>;

export const chatMessageViewSchema = z
  .object({
    id: z.uuid(),
    session_id: z.uuid(),
    role: chatRoleSchema,
    content: z.string(),
    /** 仅 ASSISTANT：结构化话术；模型只回了自由文本时为 null */
    payload: chatReplySchema.nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    product_id: z.uuid().nullable(),
    product_name: z.string().nullable(),
    schema_valid: z.boolean(),
    created_at: z.string()
  })
  .strict();
export type ChatMessageView = z.infer<typeof chatMessageViewSchema>;

/* --------------------------------------------------------------- 预设需求 */

/**
 * 首页「一句话就能开工」的预设（§64：主播不需要自己琢磨）。
 *
 * 每一条都对着 §21 的一档强度与 §26 的一种输出，用户点一下就等于把需求说清楚了；
 * 文案在 `@ldj/schemas` 固化，前端不另写一套。
 */
export interface ChatPreset {
  key: string;
  label: string;
  hint: string;
  prompt: string;
  intensity: CopyIntensity;
  spec_ref: string;
}

export const CHAT_PRESETS: readonly ChatPreset[] = [
  {
    key: "SELLPOINT_CARD",
    label: "产品卖点介绍",
    hint: "默认形态：一句话定位 + 3–5 条核心卖点 + 价值高度 + 收口",
    prompt:
      "把这款茶写成一份产品卖点介绍：一句话定位，3–5 条核心卖点（每条先给结论再给依据），价值高度，口感与产品结构，配方哲学，异议接住，最后一句收口。",
    intensity: 4,
    spec_ref: "§20 / §26 / §33 / §64"
  },
  {
    key: "KING_LEVEL5",
    label: "王者级卖点（Level 5）",
    hint: "§22 七项强制全部落地",
    prompt:
      "按 Level 5 王者档写一版卖点介绍：强反问开场、身份定义、价值拆解、画面感、记忆点、短视频金句、成交收口，一项都不能少。",
    intensity: 5,
    spec_ref: "§21 / §22"
  },
  {
    key: "WHY_EXPENSIVE",
    label: "为什么值这个价",
    hint: "只讲已录事实与价格高度标准，不移植竞品事实",
    prompt: "讲清楚这款茶为什么值这个价：先说身份与产品结构，再说价格高度标准，不要凭空说成交价。",
    intensity: 4,
    spec_ref: "§16 / §20"
  },
  {
    key: "BENCHMARK",
    label: "对标谁、高在哪",
    hint: "用全网检索到的真实对标，把价值高度抬起来",
    prompt:
      "用这次全网检索到的对标来源，说清楚同类里谁卖到什么价、这款茶站在什么高度；只引用对标的价格高度与市场认知，不要搬运对标的原料、树龄、山头、年份、配方。",
    intensity: 4,
    spec_ref: "§17 / §20 / §62-5 / §62-10"
  },
  {
    key: "OBJECTIONS",
    label: "异议回答",
    hint: "「太贵了」「和别家差不多」的标准回答",
    prompt: "把客户最常见的异议整理成问答：太贵了、别家更便宜、喝不出区别，各给一段可以直接说的回答。",
    intensity: 4,
    spec_ref: "§26"
  },
  {
    key: "INTENSIFY",
    label: "再狠一点",
    hint: "不新增事实，只提高气势与记忆点",
    prompt: "把上一版再狠一点：不新增任何事实，只提高气势、身份、画面、价值、记忆点与金句密度。",
    intensity: 5,
    spec_ref: "§34 / §48"
  }
];

/** 没绑定产品时先问清楚的几个硬事实（§10 产品录入里最影响话术的几项）。 */
export const CHAT_ONBOARDING_QUESTIONS: readonly string[] = [
  "这款茶的产品名、年份与茶类是什么？",
  "原料与产区：什么料、哪个山头的毛料、什么季节？（没录入的不要猜）",
  "工艺与感官：杀青 / 揉捻 / 干燥 / 压制方式，以及汤感、回甘、茶气表现",
  "原料 / 工艺 / 品饮里最想让人记住的一点是什么？",
  "这次用途是直播、经销商培训，还是招商资料？"
];

/** 对话工作台合同自检（§62：核心口径必须可被运维与前端读到）。 */
export const CHAT_CONTRACT = {
  spec_ref: CHAT_SPEC_REF,
  purpose:
    "用户用自然语言说需求，系统按产品名去全网检索高价值对标，整理成一份可直接拿去用的产品卖点介绍（§20–§27 / §33 / §64）",
  /** 默认交付形态：产品卖点介绍（客户 2026-09-26 追加需求；§26 的直播稿等仍保留在专业模式） */
  sellpoint_form: CHAT_SELLPOINT_FORM,
  /** 全网对标检索口径：服务端按产品名检索，只回真实来源（§12 Adapter / §62-1） */
  benchmark_policy: {
    enabled: true,
    trigger:
      "会话绑定了产品时按产品名（+ 品牌 / 年份 / 茶类 / 山头）自动检索；没有绑定产品时，用用户在需求里直接给出的产品名检索",
    result_cap: CHAT_LIMITS.maxBenchmarks,
    queries_per_run: CHAT_LIMITS.benchmarkQueries,
    only_real_sources: true,
    server_written: "benchmarks 字段由服务端回写，模型输出里的同名字段一律被覆盖",
    allowed_use: "只允许引用价格高度与市场认知",
    forbidden_use: "不许把对标的原料 / 树龄 / 山头 / 年份 / 配方 / 工艺写成龙德记自己的事实（§62-5）",
    degrade: "检索失败、超时或 0 条结果时降级为「没有对标」，自动进入 Category Creator Mode（§62-10），绝不阻塞出稿"
  },
  input: {
    free_text: "用户原话（≤ 4000 字）",
    product_binding: "可选：绑定一款产品，服务端只把该产品**已录入**的事实拼进 Prompt",
    product_name_hint:
      "可选：未绑定产品时直接写产品名（≤ 80 字），服务端按它去全网找对标；它只当检索词，不作为事实来源",
    intensity: "可选：§21 五档成交强度，默认 Level 4"
  },
  output: {
    schema: "chatReplySchema",
    fields: [
      "reply：对话正文",
      "headline：一句话定位",
      "copy_blocks：可直接念的话术块（label / level / text）",
      "quotes：可独立传播的金句",
      "objections：异议问答",
      "missing_facts：本次不敢写、需要产品方补的硬事实",
      "follow_up_questions：继续追问",
      "used_facts：本次用到的已录事实（可追溯）",
      "value_focus：§33 八项价值重点",
      "intensity：本次强度档",
      "value_height：本次价值高度总纲（没有对标支撑时为 null）",
      "benchmarks：本次真实检索到的全网对标来源（服务端回写）",
      "next_actions：建议下一步"
    ]
  },
  rules: [
    "§62-1 AI 不凭记忆代替检索：未录入的硬事实只能写进 missing_facts，不能写进话术",
    "§62-1 对标来源必须是真实检索结果：链接由服务端回写，模型产出的同名字段一律作废",
    "§62-5 不移植竞品事实：对标只引用价格高度标准，不引用竞品的原料 / 树龄 / 山头 / 配方",
    "§62-11 默认交付形态是产品卖点介绍，不写成直播稿、也不写成参数说明书",
    "§62-8 不虚构树龄、山头、年份、获奖、大师、配方比例、研发关系、成交价格",
    "§62-9 允许极强修辞：比喻、排比、反问、身份塑造可以拉满",
    "§62-10 没有可靠锚点时按 Category Creator Mode 讲自建标准，不硬凑对标",
    "§62-11 前台表达不能退化成说明书：不允许通篇参数罗列",
    "§62-13 模型输出必须通过 chatReplySchema 校验，校验失败按既有重试流程处理",
    "§62-14 涉及 RED claim（禁止承诺、无据第一 / 最贵 / 唯一）的话术不出现在工作台成稿里"
  ],
  guarantees: {
    only_recorded_facts: true,
    no_competitor_fact_transplant: true,
    benchmarks_are_real_sources: true,
    schema_validated_output: true,
    conversation_history_kept: true,
    ai_output_is_draft: true,
    publish_requires_fact_review: true
  },
  limits: CHAT_LIMITS,
  iron_rules: CHAT_IRON_RULES
} as const;

/* --------------------------------------------------------- Prompt 组装 */

/** 一条「已录事实」：值 + 出处，用于让模型只讲有出处的话（§62-1 / §62-8）。 */
export interface ChatProductFactLine {
  label: string;
  value: string;
  /** 出处：产品字段 / 事实状态 / 品饮档案 / 研发参考 */
  source: string;
}

/**
 * 绑定产品的上下文：**只由服务端从库里现有数据拼**，不含任何推断。
 *
 * `missing_hard_facts` 是「这类茶最容易被编造、但这瓶产品还没录入」的硬事实清单，
 * 模型必须把它们写进 `missing_facts`，而不是自己补一个（§62-6 / §62-7 / §62-8）。
 */
export interface ChatProductContext {
  product_id: string;
  product_name: string;
  facts: readonly ChatProductFactLine[];
  /** 该产品当前的模式判定（无可靠锚点必须是 CATEGORY_CREATOR，§62-10） */
  mode: "AUTO" | "BENCHMARK" | "CATEGORY_CREATOR";
  mode_reason: string;
  /** 最新一版强成交话术版本号；还没有成稿时为 null */
  copy_version: number | null;
  missing_hard_facts: readonly string[];
  /** 事实超过 Prompt 上限时被裁掉的行数（不静默丢弃） */
  truncated_facts: number;
  /** 本次按产品名全网检索到的对标来源（真实链接，只作素材，绝不落成龙德记自己的事实） */
  benchmarks: readonly ChatBenchmark[];
}

export interface ChatPromptInput {
  product: ChatProductContext | null;
  intensity: CopyIntensity;
  valueFocus?: readonly ValueFocusKey[];
  /** 未绑定产品时用户直接给出的产品名：只作检索词，不当作已录事实 */
  productNameHint?: string | null;
  /** 未绑定产品时也要能把本轮检索到的对标素材喂给模型（§12 / §62-1） */
  benchmarks?: readonly ChatBenchmark[];
}

/** §21 一行强度说明：Prompt 的「这次要写多狠」一节直接用它。 */
export function chatIntensityPromptLine(level: CopyIntensity): string {
  const meta = COPY_INTENSITY_META.find((item) => item.level === level);
  if (!meta) {
    return `Level ${level}`;
  }
  return `${meta.label}：${meta.definition}（硬要求：${meta.requirement}）`;
}

/** 没录入的硬事实清单：Prompt 与前端提示共用同一份中文口径。 */
export function chatForbiddenFabricationLabels(): readonly string[] {
  return Object.values(FORBIDDEN_AUTO_FILL_LABELS);
}

/**
 * 对话工作台的 System Prompt（§62-12：Prompt 必须可版本管理，因此这里是纯函数、可单独测试）。
 *
 * 组装顺序刻意固定为「强度 → 输出 → 铁律 → 禁止项 → 产品事实 → JSON 契约」：
 * 先把「写多狠」定死，再给可用素材，最后锁输出格式——避免模型先看到素材就开始自由发挥。
 */
export function buildChatSystemPrompt(input: ChatPromptInput): string {
  const missing = input.product ? [...input.product.missing_hard_facts] : [];
  const focus = input.valueFocus && input.valueFocus.length > 0 ? input.valueFocus : null;
  const benchmarks = input.product ? [...input.product.benchmarks] : [...(input.benchmarks ?? [])];
  const hint = input.productNameHint?.trim() ? input.productNameHint.trim() : null;

  const lines: string[] = [
    "你是「龙德记 AI 高价值锚点与强成交话术系统」的对话工作台主笔。",
    "用户会用自己的话提需求；你的任务是把需求整理成一份**可以直接拿去用**的产品卖点介绍，",
    "并顺手告诉用户「这一段用了哪些已录事实」「还缺哪些事实」。",
    "记住这条总原则：后台研究要像分析师一样严谨，前台表达要像顶级操盘手一样有压迫感；事实不造假，价值表达做到极致。",
    "",
    "## 一、这次要写多狠（§21 五档成交强度）"
  ];
  for (const meta of COPY_INTENSITY_META) {
    lines.push(`- ${chatIntensityPromptLine(meta.level)}`);
  }
  lines.push(`本次采用：${chatIntensityPromptLine(input.intensity)}`);
  if (input.intensity === 5) {
    lines.push("", "## 二、Level 5 王者话术的七项强制（§22，一项都不能少）");
    for (const item of LEVEL5_REQUIREMENT_META) {
      lines.push(`- ${item.label}：${item.requirement}`);
    }
  } else {
    lines.push(
      "",
      "## 二、Level 5 的七项强制（§22）",
      "本次不是 Level 5，但用户明确要求王者档时要补齐：强反问 / 身份定义 / 价值拆解 / 画面感 / 记忆点 / 金句密度 / 成交收口。"
    );
  }

  lines.push(
    "",
    `## 三、这次的交付形态：${CHAT_SELLPOINT_FORM.name}（不是直播稿）`,
    "默认产出是产品卖点介绍，按下面这个骨架组织（名字可以按用户要求调整，骨架不要丢）："
  );
  for (const item of CHAT_SELLPOINT_FORM.outline) {
    lines.push(`- ${item}`);
  }
  for (const rule of CHAT_SELLPOINT_FORM.rules) {
    lines.push(`- 硬要求：${rule}`);
  }

  lines.push("", "## 四、可选的话术块（§26 / §33 / §51）", "用户点名要哪几种就补哪几种，没点名不要全上：");
  for (const item of SALES_COPY_OUTPUT_META) {
    lines.push(`- ${item.label}：${item.requirement}`);
  }

  lines.push(
    "",
    "## 五、八项价值重点（§33）",
    valueFocusKeys.map((key) => VALUE_FOCUS_LABELS[key]).join(" / "),
    focus
      ? `本次重点：${focus.map((key) => VALUE_FOCUS_LABELS[key]).join(" / ")}（勾中的必须多讲，没勾的不要硬塞）`
      : "本次没有指定重点：按产品事实里最硬的一两项作为主心骨，不要八项平铺。",
    "",
    "## 六、十五条铁律（§62，任何一条都不许破）"
  );
  CHAT_IRON_RULES.forEach((rule, index) => {
    lines.push(`${index + 1}. ${rule}`);
  });

  lines.push(
    "",
    "## 七、绝对不许编（命中任意一条，这一稿就是废稿）",
    `- 没有录入就不许写的硬事实：${chatForbiddenFabricationLabels().join(" / ")}`,
    `- 禁止承诺收益：${FORBIDDEN_PROMISES.join(" / ")}`,
    `- 没有 RND_CONFIRMED 证据时禁止的表述：${RND_RESTRICTED_PHRASES.join(" / ")}`,
    "- 没有可靠价格锚点时：不许编成交价、不许说「市场第一 / 最贵 / 唯一 / 会涨价」",
    "- 对标产品的事实（原料、树龄、山头、年份、配方、价格）只能引用「价格高度标准」这一层，",
    "  不许写成龙德记自己的事实（§62-5）",
    "- 允许极限修辞：比喻、排比、反问、身份塑造、画面感可以拉满；但修辞不能让人以为存在一个并不存在的",
    "  可核验事实（§24）。修辞不是事实造假，事实造假一定判 RED。",
    ""
  );

  lines.push("## 八、产品事实（唯一可用的硬事实来源）");
  if (input.product) {
    const product = input.product;
    lines.push(
      `产品：${product.product_name}（product_id: ${product.product_id}）`,
      `模式判定：${product.mode}——${product.mode_reason}`,
      product.copy_version === null
        ? "已有成稿：还没有生成过强成交话术版本"
        : `已有成稿：最新为第 ${product.copy_version} 版（用户要求「再狠一点」时以它为基准，不许新增事实）`,
      "已录事实（下面每一条都有出处；**未列出的硬事实一律不许写进话术**）："
    );
    if (product.facts.length === 0) {
      lines.push("- （这款产品还没有录入任何可用事实：只输出追问 + 带【待补充：xxx】占位符的模板话术）");
    } else {
      for (const fact of product.facts) {
        lines.push(`- ${fact.label}：${fact.value}（来源：${fact.source}）`);
      }
    }
    if (product.truncated_facts > 0) {
      lines.push(`- （还有 ${product.truncated_facts} 条已录事实未放入本次上下文，不要凭记忆补写）`);
    }
    lines.push(
      product.missing_hard_facts.length > 0
        ? `本次**没有录入、必须写进 missing_facts** 的硬事实：${product.missing_hard_facts.join(" / ")}`
        : "本次没有发现明显的硬事实缺口：仍然不许新增任何未列出的硬事实。"
    );
  } else {
    lines.push(
      "本次没有绑定产品：**不要编造任何具体产品事实**（没有产品名、年份、山头、原料就一个字都不要写）。",
      "请你先做两件事：",
      `1. 按下面这些问题追问用户（最多 ${CHAT_LIMITS.maxFollowUps} 条，挑这次最关键的）：`,
      ...CHAT_ONBOARDING_QUESTIONS.map((question) => `   - ${question}`),
      "2. 同时给出一版「模板话术」：结构完整、可以直接套，但每个具体事实位置都写成【待补充：xxx】。"
    );
    if (hint) {
      lines.push(
        "",
        `用户在这条需求里给出的产品名是「${hint}」。它**只用来做检索与价值高度**：`,
        "- 可以按这个产品名讲「同类里别人卖到什么价位、这款茶站在什么高度」；",
        "- 它的年份、山头、原料、树龄、配方、获奖一律**视为未录入**，不许写成它的事实；",
        "- 需要这些硬事实时，写进 `missing_facts` 让产品方补，或者写【待补充：xxx】。"
      );
    }
  }

  lines.push("", "## 九、全网对标素材（本次真实检索到的来源）");
  if (benchmarks.length === 0) {
    lines.push(
      "本次**没有检索到任何对标来源**（这一轮检索失败、没有结果，或者还没有绑定产品）。",
      "处理方式（§62-10）：**自动进入 Category Creator Mode**——按「这个价位段本来就该有什么标准」自建高端标准来讲，",
      "不要硬凑一个品牌名，不要凭记忆说「某某茶现在卖多少」。`value_height` 只写你能从已录事实撑住的高度，",
      "撑不住就填 null。"
    );
  } else {
    lines.push(
      "下面是本次全网检索到的真实来源。**它们只能贡献「价格高度 / 市场认知」这一层**：",
      "- 可以用来讲：同类里别人站到什么价位、市场怎么给这类茶定价、你处在什么高度；",
      "- **不许**把这些来源里的原料、树龄、山头、年份、配方、工艺写成龙德记自己的事实（§62-5）；",
      "- 引用时要带出处口径（如「某电商平台在售」「行业报道」），不要伪造原文里没有的数字；",
      "- 来源之间价格口径可能不一致（挂牌价 / 批发价 / 整件价），口径不明就不要写成具体数字（§62-2 / §62-3）；",
      "- 这些链接由系统原样附在最终回复里，**你不需要也不要在 JSON 里重复它们**。"
    );
    benchmarks.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.title}｜${item.source_domain}｜${item.queried_at}`,
        `   摘要：${item.snippet || "（该来源没有可读摘要，只作链接参考）"}`
      );
    });
    lines.push(`本次检索到 ${benchmarks.length} 条来源，最多引用其中 3 条最有信息量的。`);
  }

  lines.push(
    "",
    "## 十、输出格式（必须通过 schema 校验，§62-13）",
    "只输出一个 JSON 对象，不要任何解释性前后缀：",
    "{",
    '  "reply": "对话正文：先说清你按什么思路整理，再指出缺什么（1–3 段）",',
    '  "headline": "一句话定位，没有把握就 null",',
    '  "copy_blocks": [{ "label": "核心卖点", "level": 4, "text": "可以直接拿去用的完整段落" }],',
    '  "quotes": ["可独立传播的金句"],',
    '  "objections": [{ "question": "太贵了", "answer": "可以直接说的回答" }],',
    '  "missing_facts": ["需要产品方补充的硬事实"],',
    '  "follow_up_questions": ["继续追问"],',
    '  "used_facts": ["本次用到的已录事实（逐条抄上面已录事实，不许新造）"],',
    `  "value_focus": ["identity"]（只能取这 8 个英文键：${valueFocusKeys.join(" / ")}）,`,
    "  \"intensity\": 4,",
    '  "value_height": "一句话讲清这款茶站在什么价值高度；没有对标支撑就填 null",',
    '  "next_actions": ["建议下一步：去事实审核 / 去生成正式版强成交话术"]',
    "}",
    "字段要求：",
    "- `benchmarks` 由系统回写，**不要自己输出这个字段**；",
    `- \`value_focus\` **只能**填这 8 个英文键：${valueFocusKeys.join(" / ")}；不确定就填 \`[]\`，`,
    "  不要写中文标签、不要自造键名（写错整份输出会被判废稿）；",
    "- `intensity` 只能填 1–5 的整数；",
    "- `copy_blocks` 的 `level` 只能是 1–5；用户没指定就按本次采用的档位；",
    "- `used_facts` 只能逐条抄「已录事实」里的内容，没绑定产品时留空数组；",
    "- 没有事实支撑的位置，宁可写进 `missing_facts` 或留占位符，也不许编；",
    "- `reply` 用中文口语，不要出现算法名、字段名、内部术语；",
    "- 不要用「直播」「开场」「上链接」「扣一」这类直播场景词，除非用户明确要直播稿；",
    "- 不要输出 markdown 表格；话术正文不要写成一堆参数的罗列（§62-11）。"
  );

  return lines.join("\n");
}
