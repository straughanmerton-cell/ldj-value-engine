import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { ChatMessageRow, ChatSessionRow, Database, Product } from "@ldj/database";
import { brands, chatMessages, chatSessions, copyOutputs, productFacts, products } from "@ldj/database";
import type { AiProvider } from "@ldj/ai";
import type { SearchProvider } from "@ldj/search";
import {
  CHAT_CONTRACT,
  CHAT_DEFAULT_TITLE,
  CHAT_IRON_RULES,
  CHAT_LIMITS,
  CHAT_ONBOARDING_QUESTIONS,
  CHAT_PRESETS,
  CHAT_ROLE_LABELS,
  COPY_INTENSITY_META,
  DEFAULT_COPY_INTENSITY,
  FACT_KEY_CATALOG,
  FORBIDDEN_AUTO_FILL_LABELS,
  SALES_COPY_OUTPUT_META,
  VALUE_FOCUS_LABELS,
  buildChatSystemPrompt,
  chatBenchmarkSchema,
  chatForbiddenFabricationLabels,
  chatMessageViewSchema,
  chatReplySchema,
  chatSessionViewSchema,
  copyIntensitySchema,
  type ChatBenchmark,
  type ChatMessageListQuery,
  type ChatMessageView,
  type ChatProductContext,
  type ChatProductFactLine,
  type ChatSessionListQuery,
  type ChatSessionView,
  type CopyIntensity,
  type CreateChatSessionInput,
  type SendChatMessageInput,
  type UpdateChatSessionInput
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import type { AnchorsService } from "../anchors/anchors.service.js";

/**
 * AI 对话工作台（规格 §0 总执行说明 / §21–§27 成交文案 / §31 / §33 / §62 / §64）。
 *
 * 这一层只做三件事，别的都不做：
 *
 * 1. **把用户原话变成一次有纪律的模型调用**：产品事实只从库里**已录入**的字段读
 *    （`products` 列 + `product_facts` 行），System Prompt 由 `@ldj/schemas` 的纯函数组装；
 * 2. **强制 schema 校验后落库**（§62-13）：模型只能回 `chatReplySchema` 的 JSON，
 *    解析 / 校验失败**不写任何半成品**，直接 502 `AI_UNAVAILABLE`（用户消息保留，AI 消息不落库）；
 * 3. **会话只属于创建者**：所有读写都带 `user_id = 当前用户`，越权一律 404（不泄露会话是否存在）。
 *
 * 与既有链路的关系（§62-15 所有版本必须保留）：
 * 工作台产出的是**草稿**，不写 `copy_outputs`、不改任何既有表；正式发布仍然只能走
 * 强成交话术 + 逐句事实审核 + 人工审批（§53 / §57 / §62-14）。
 */

/** §11 事实状态中文口径（与 `ProductFactsPanel` 一致，服务端只用于标注出处）。 */
const FACT_STATUS_LABELS: Record<string, string> = {
  OFFICIAL_CONFIRMED: "官方确认",
  INTERNAL_CONFIRMED: "内部确认",
  TASTING_CONFIRMED: "品饮确认",
  RND_CONFIRMED: "研发确认",
  SUPPLIER_PROVIDED: "供应商提供",
  UNCONFIRMED: "未确认"
};

/** `products` 列 → `FACT_KEY_CATALOG` 事实键：只映射「可以直接讲」的字段，内部开关不进 Prompt。 */
const PRODUCT_COLUMN_VALUES: Record<string, (row: Product) => string | number | null | undefined> = {
  series_name: (row) => row.seriesName,
  year: (row) => row.year,
  tea_type: (row) => row.teaType,
  tea_subtype: (row) => row.teaSubtype,
  origin_province: (row) => row.originProvince,
  origin_city: (row) => row.originCity,
  origin_region: (row) => row.originRegion,
  mountain: (row) => row.mountain,
  village: (row) => row.village,
  weight_g: (row) => row.weightG,
  pieces_per_box: (row) => row.piecesPerBox,
  boxes_per_case: (row) => row.boxesPerCase,
  suggested_retail_price: (row) => row.suggestedRetailPrice,
  raw_material: (row) => row.rawMaterial,
  tree_type: (row) => row.treeType,
  tree_age: (row) => row.treeAge,
  season: (row) => row.season,
  harvest_standard: (row) => row.harvestStandard,
  grade: (row) => row.grade,
  blend_description: (row) => row.blendDescription,
  material_notes: (row) => row.materialNotes,
  kill_green_method: (row) => row.killGreenMethod,
  rolling_method: (row) => row.rollingMethod,
  drying_method: (row) => row.dryingMethod,
  pressing_method: (row) => row.pressingMethod,
  fermentation_degree: (row) => row.fermentationDegree,
  fermentation_method: (row) => row.fermentationMethod,
  storage: (row) => row.storage,
  processing_notes: (row) => row.processingNotes,
  dry_leaf_aroma: (row) => row.dryLeafAroma,
  hot_cup_aroma: (row) => row.hotCupAroma,
  liquor_aroma: (row) => row.liquorAroma,
  cold_cup_aroma: (row) => row.coldCupAroma,
  entry_taste: (row) => row.entryTaste,
  bitterness: (row) => row.bitterness,
  astringency: (row) => row.astringency,
  sweetness: (row) => row.sweetness,
  huigan: (row) => row.huigan,
  salivation: (row) => row.salivation,
  cha_qi: (row) => row.chaQi,
  thickness: (row) => row.thickness,
  viscosity: (row) => row.viscosity,
  water_texture: (row) => row.waterTexture,
  early_stage: (row) => row.earlyStage,
  middle_stage: (row) => row.middleStage,
  late_stage: (row) => row.lateStage,
  finish: (row) => row.finish,
  endurance: (row) => row.endurance,
  leaf_bottom: (row) => row.leafBottom
};

/**
 * 「最容易被人凭空写出来」的硬事实 → 该产品是否已经有据可查（§62-8）。
 *
 * 规则：`products` 有对应列就以列值为准；没有对应列的（获奖 / 大师 / 名人 / 秘方 /
 * 稀缺数量 / 产量 / 品牌历史 / 成交价格）只有事实清单里真录了才算有。
 */
const HARD_FACT_COLUMN: Record<string, (row: Product) => string | number | null | undefined> = {
  year: (row) => row.year,
  tree_age: (row) => row.treeAge,
  mountain: (row) => row.mountain,
  raw_material: (row) => row.rawMaterial,
  formula_ratio: (row) => row.blendDescription,
  rnd_relationship: (row) => (row.rndEvidenceAvailable ? "已有内部研发证据" : null)
};

function isBlank(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  return typeof value === "string" && value.trim().length === 0;
}

function textOf(value: string | number | null | undefined): string | null {
  if (isBlank(value)) {
    return null;
  }
  return typeof value === "number" ? String(value) : (value as string).trim();
}

/** 产品录入字段 → 已录事实行（带出处「产品录入」）。 */
function productFieldFacts(row: Product, brandName: string | null): ChatProductFactLine[] {
  const lines: ChatProductFactLine[] = [{ label: "产品名称", value: row.productName, source: "产品录入" }];
  if (brandName) {
    lines.push({ label: "品牌", value: brandName, source: "产品录入" });
  }
  for (const definition of FACT_KEY_CATALOG) {
    const pick = PRODUCT_COLUMN_VALUES[definition.key];
    if (!pick) {
      continue;
    }
    const value = textOf(pick(row));
    if (!value) {
      continue;
    }
    lines.push({ label: definition.label, value, source: "产品录入" });
  }
  return lines;
}

/** 事实清单行 → 已录事实行（出处带 §11 事实状态：未确认的只能当线索）。 */
function factRowLines(rows: readonly (typeof productFacts.$inferSelect)[]): ChatProductFactLine[] {
  return rows.map((row) => {
    const label =
      row.factLabel?.trim() ||
      FACT_KEY_CATALOG.find((definition) => definition.key === row.factKey)?.label ||
      row.factKey;
    const status = FACT_STATUS_LABELS[row.factStatus] ?? row.factStatus;
    return {
      label,
      value: row.factValue,
      source: `事实清单·${status}`
    };
  });
}

/** 没录入的硬事实：Prompt 要求写进 `missing_facts`，而不是被模型补出来（§62-6/7/8）。 */
function missingHardFactsOf(row: Product, factRows: readonly (typeof productFacts.$inferSelect)[]): string[] {
  const recordedLabels = factRows.flatMap((fact) =>
    [fact.factKey, fact.factLabel ?? ""].filter((item) => item.length > 0).map((item) => item.toLowerCase())
  );
  const missing: string[] = [];
  for (const [category, label] of Object.entries(FORBIDDEN_AUTO_FILL_LABELS)) {
    const pick = HARD_FACT_COLUMN[category];
    const fromColumn = pick ? !isBlank(pick(row)) : false;
    const fromFacts = recordedLabels.some((item) => item.includes(label.toLowerCase()) || item === category);
    if (!fromColumn && !fromFacts) {
      missing.push(label);
    }
  }
  return missing;
}

/** 历史消息喂给模型的形式：assistant 侧把结构化成稿压成可继续加工的文本，并封顶长度。 */
const HISTORY_ITEM_CHARS = 2500;

function historyContentOf(message: ChatMessageRow): string {
  const payload = message.payload;
  if (!payload) {
    return message.content.slice(0, HISTORY_ITEM_CHARS);
  }
  const parts: string[] = [payload.reply];
  if (payload.headline) {
    parts.push(`定位：${payload.headline}`);
  }
  for (const block of payload.copy_blocks) {
    parts.push(`【${block.label}】${block.text}`);
  }
  if (payload.quotes.length > 0) {
    parts.push(`金句：${payload.quotes.join(" / ")}`);
  }
  const joined = parts.join("\n");
  return joined.length > HISTORY_ITEM_CHARS ? `${joined.slice(0, HISTORY_ITEM_CHARS)}…（后略）` : joined;
}

/** 首条需求自动命名会话：用户不必先想标题（§64 好上手）。 */
function titleFromDemand(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const limit = CHAT_LIMITS.maxTitleChars;
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** 每条检索查询取几条：一次出稿最多 3 条查询，去重后按 `CHAT_LIMITS.maxBenchmarks` 封顶。 */
const BENCHMARK_RESULTS_PER_QUERY = 5;

/**
 * 对标检索词（客户 2026-09-26 追加需求：「根据我提供的产品名，尽可能去全网搜索高价值的对标产品」）。
 *
 * 三条查询覆盖三种「别人卖多少」的问法：直接价格、单饼价格、以及带上品牌 / 年份 / 茶类 / 山头的
 * 同门对比。查不到就是查不到——降级成 Category Creator Mode，绝不用模型记忆编一个价格出来。
 */
function benchmarkQueries(productName: string, hints: readonly (string | null | undefined)[]): string[] {
  const context = hints
    .map((item) => (item ?? "").trim())
    .filter((item) => item.length > 0)
    .join(" ");
  /** 两条必发查询都带上「茶」：抓取式检索里不加限定词会混进同名行业（实测查茶会带回卡车行情）。 */
  const queries = [`${productName} 茶 价格`, `${productName} 茶 多少钱 一饼`];
  queries.push(context.length > 0 ? `${context} 茶叶 价格` : `${productName} 高端 茶 对标`);
  return queries.slice(0, CHAT_LIMITS.benchmarkQueries);
}

/** 同一个页面只留一条：去掉 hash 与结尾斜杠，避免同一来源占满对标位。 */
function normalizeBenchmarkUrl(value: string): string {
  const raw = value.trim();
  if (raw.length === 0) {
    return "";
  }
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/**
 * 「这条来源是不是在讲茶叶价格」的关键词。抓取式检索（360）会混进同名的其它行业页面，
 * 实测查「龙德记 六星孔雀」会带回「德龙国六卡车」与无关新闻——这些不是对标，必须丢掉。
 */
const BENCHMARK_TEA_KEYWORDS: readonly string[] = [
  "茶",
  "普洱",
  "班章",
  "冰岛",
  "易武",
  "古树",
  "山头",
  "饼",
  "件",
  "生茶",
  "熟茶"
];

/** 产品名的检索令牌：整段 + 每个 2 字窗口（纯数字年份不作令牌，太泛）。 */
export function benchmarkTokens(productName: string): string[] {
  const tokens = new Set<string>();
  for (const segment of productName.split(/[\s\u3000,，、/|()（）[\]【】"'“”「」]+/)) {
    const text = segment.trim();
    if (text.length < 2 || /^\d+$/.test(text)) {
      continue;
    }
    tokens.add(text);
    for (let index = 0; index + 2 <= text.length; index += 1) {
      tokens.add(text.slice(index, index + 2));
    }
  }
  return [...tokens];
}

/**
 * 对标过滤（客户 2026-09-26 追加需求「尽可能去全网搜索高价值的对标产品」）。
 *
 * 两级口径，先精确后兜底：
 * 1. 先只留「茶叶价格语境」且**标题 / 摘要里出现产品名令牌**的来源；
 * 2. 一条都没命中时退回只要求「茶叶价格语境」——宁可少几条，也不能把卡车行情的页面
 *    当成对标喂给模型（那会让卖点直接吹错方向）。
 *
 * 过滤只影响「给模型看的素材」，任何情况下都不会因为过滤而成空之外再做别的降级动作；
 * 全空即走 Category Creator Mode（§62-10）。
 */
export function filterBenchmarks(productName: string, candidates: readonly ChatBenchmark[]): ChatBenchmark[] {
  const inTeaContext = (item: ChatBenchmark): boolean => {
    const haystack = `${item.title} ${item.snippet}`;
    return BENCHMARK_TEA_KEYWORDS.some((keyword) => haystack.includes(keyword));
  };
  const tokens = benchmarkTokens(productName);
  const named = candidates.filter((item) => {
    if (tokens.length === 0) {
      return false;
    }
    const haystack = `${item.title} ${item.snippet}`;
    return inTeaContext(item) && tokens.some((token) => haystack.includes(token));
  });
  if (named.length > 0) {
    return named;
  }
  return candidates.filter(inTeaContext);
}

export interface ChatSendResult {
  session: ChatSessionView;
  user_message: ChatMessageView;
  assistant_message: ChatMessageView;
}

export class ChatService {
  constructor(
    private readonly db: Database,
    private readonly anchors: AnchorsService,
    private readonly ai: AiProvider,
    /** §12 Adapter：只用来按产品名找对标素材，任何失败都不能影响出稿 */
    private readonly search: SearchProvider
  ) {}

  /* --------------------------------------------------------- 合同与标签 */

  /** 合同自检：输入 / 输出 / 规则 / 保证 / 上限 / 15 条铁律（§62 / §64）。 */
  contractBody(): {
    contract: typeof CHAT_CONTRACT;
    presets: typeof CHAT_PRESETS;
    limits: typeof CHAT_LIMITS;
    iron_rules: readonly string[];
  } {
    return {
      contract: CHAT_CONTRACT,
      presets: CHAT_PRESETS,
      limits: CHAT_LIMITS,
      iron_rules: CHAT_IRON_RULES
    };
  }

  /** 前端标签文案一律从 schema 层读，前端不另写一套（§21 / §26 / §33）。 */
  labelsBody(): {
    role_labels: typeof CHAT_ROLE_LABELS;
    presets: typeof CHAT_PRESETS;
    onboarding_questions: readonly string[];
    intensity_meta: typeof COPY_INTENSITY_META;
    value_focus_labels: typeof VALUE_FOCUS_LABELS;
    output_meta: typeof SALES_COPY_OUTPUT_META;
    forbidden_facts: readonly string[];
    limits: typeof CHAT_LIMITS;
    default_intensity: CopyIntensity;
    ai_provider: string;
  } {
    return {
      role_labels: CHAT_ROLE_LABELS,
      presets: CHAT_PRESETS,
      onboarding_questions: CHAT_ONBOARDING_QUESTIONS,
      intensity_meta: COPY_INTENSITY_META,
      value_focus_labels: VALUE_FOCUS_LABELS,
      output_meta: SALES_COPY_OUTPUT_META,
      forbidden_facts: chatForbiddenFabricationLabels(),
      limits: CHAT_LIMITS,
      default_intensity: DEFAULT_COPY_INTENSITY,
      ai_provider: this.ai.name
    };
  }

  /* --------------------------------------------------------------- 会话 */

  async listSessions(userId: string, query: ChatSessionListQuery): Promise<Paginated<ChatSessionView>> {
    const pagination = normalizePagination({
      page: query.page,
      pageSize: query.pageSize ?? CHAT_LIMITS.defaultPageSize
    });
    const filters: SQL[] = [eq(chatSessions.userId, userId)];
    if (query.archived !== undefined) {
      filters.push(eq(chatSessions.isArchived, query.archived));
    }
    if (query.bound !== undefined) {
      filters.push(
        query.bound ? sql`${chatSessions.productId} is not null` : sql`${chatSessions.productId} is null`
      );
    }
    const keyword = query.q?.trim();
    if (keyword) {
      const pattern = `%${keyword}%`;
      const condition = or(ilike(chatSessions.title, pattern), ilike(products.productName, pattern));
      if (condition) {
        filters.push(condition);
      }
    }
    const where = and(...filters);

    const totalRows = await this.db
      .select({ value: count() })
      .from(chatSessions)
      .leftJoin(products, eq(products.id, chatSessions.productId))
      .where(where);
    const total = Number(totalRows[0]?.value ?? 0);

    const rows = await this.db
      .select({ session: chatSessions, productName: products.productName })
      .from(chatSessions)
      .leftJoin(products, eq(products.id, chatSessions.productId))
      .where(where)
      .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.id))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    return buildPage(
      rows.map((row) => this.sessionView(row.session, row.productName)),
      total,
      pagination
    );
  }

  async createSession(userId: string, input: CreateChatSessionInput): Promise<ChatSessionView> {
    const name = input.product_id ? await this.productName(input.product_id) : null;
    const used = await this.db
      .select({ value: count() })
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId));
    if (Number(used[0]?.value ?? 0) >= CHAT_LIMITS.maxSessionsPerUser) {
      throw new AppError(
        "CONFLICT",
        `最多保留 ${CHAT_LIMITS.maxSessionsPerUser} 个对话，请先删除不再需要的会话`,
        409,
        { max_sessions: CHAT_LIMITS.maxSessionsPerUser }
      );
    }

    const inserted = await this.db
      .insert(chatSessions)
      .values({
        userId,
        title: input.title?.trim() || (name ? `${name} 的卖点` : CHAT_DEFAULT_TITLE),
        productId: input.product_id ?? null,
        intensity: input.intensity ?? DEFAULT_COPY_INTENSITY
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "会话创建失败");
    }
    return this.sessionView(row, name);
  }

  async updateSession(userId: string, sessionId: string, input: UpdateChatSessionInput): Promise<ChatSessionView> {
    const current = await this.findSession(userId, sessionId);
    if (input.product_id !== undefined && input.product_id !== null) {
      await this.productName(input.product_id);
    }
    const updated = await this.db
      .update(chatSessions)
      .set({
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.product_id !== undefined ? { productId: input.product_id } : {}),
        ...(input.intensity !== undefined ? { intensity: input.intensity } : {}),
        updatedAt: new Date()
      })
      .where(eq(chatSessions.id, current.id))
      .returning();

    const row = updated[0];
    if (!row) {
      throw AppError.notFound("会话不存在");
    }
    const name = row.productId ? await this.productName(row.productId) : null;
    return this.sessionView(row, name);
  }

  /** 删除会话：消息随外键级联删除（会话本身是「草稿容器」，不是需要保留的成稿版本）。 */
  async deleteSession(userId: string, sessionId: string): Promise<void> {
    const current = await this.findSession(userId, sessionId);
    await this.db.delete(chatSessions).where(eq(chatSessions.id, current.id));
  }

  async listMessages(
    userId: string,
    sessionId: string,
    query: ChatMessageListQuery
  ): Promise<Paginated<ChatMessageView>> {
    const session = await this.findSession(userId, sessionId);
    const pagination = normalizePagination({
      page: query.page,
      pageSize: query.pageSize ?? CHAT_LIMITS.defaultPageSize
    });
    const totalRows = await this.db
      .select({ value: count() })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, session.id));
    const total = Number(totalRows[0]?.value ?? 0);

    /** 第 1 页 = 最新一段对话；返回顺序统一升序，前端直接从头往后渲染。 */
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, session.id))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const items = rows.reverse().map((row) => this.messageView(row));
    return buildPage(items, total, pagination);
  }

  /* ------------------------------------------------------------- 发消息 */

  /**
   * 核心链路：写用户需求 → 组 System Prompt（只含已录事实）→ 模型输出 → schema 校验 → 落库。
   *
   * 失败时的取舍（写在这里，避免以后有人「顺手」改成落半成品）：用户消息**照常保留**
   * （那是用户输入，不能丢），AI 消息**不落库**，返回 502 `AI_UNAVAILABLE`。
   */
  async sendMessage(userId: string, sessionId: string, input: SendChatMessageInput): Promise<ChatSendResult> {
    const session = await this.findSession(userId, sessionId);
    const productId = input.product_id !== undefined ? input.product_id : session.productId;
    const intensity = input.intensity ?? copyIntensitySchema.parse(session.intensity);
    const productName = productId ? await this.productName(productId) : null;

    /** 换产品 / 改强度 = 会话属性变化：与消息一起写，避免「绑定 A 却出 B 的稿」。 */
    const sessionPatch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.product_id !== undefined) {
      sessionPatch.productId = input.product_id;
    }
    if (input.intensity !== undefined) {
      sessionPatch.intensity = input.intensity;
    }
    if (session.messageCount === 0 && session.title === CHAT_DEFAULT_TITLE) {
      sessionPatch.title = titleFromDemand(input.content);
    }

    const productContext = productId ? await this.loadProductContext(productId, intensity) : null;
    /**
     * 没绑定产品时，用户直接在需求里写产品名也能对标（客户 2026-09-26 追加需求）：
     * 检索词来自用户输入，产品事实仍然一条都不给模型（`product: null`），
     * 所以这条路径只可能抬高「价值高度」，不可能伪造龙德记自己的硬事实。
     */
    const productNameHint = input.product_name?.trim() ? input.product_name.trim() : null;
    const benchmarks = productContext
      ? productContext.benchmarks
      : await this.searchBenchmarks(productNameHint, []);

    const userRows = await this.db
      .insert(chatMessages)
      .values({
        sessionId: session.id,
        role: "USER",
        content: input.content,
        productId,
        productName
      })
      .returning();
    const userRow = userRows[0];
    if (!userRow) {
      throw new AppError("INTERNAL_ERROR", "需求写入失败");
    }

    const history = await this.loadHistory(session.id);
    const messages = [
      {
        role: "system" as const,
        content: buildChatSystemPrompt({
          product: productContext,
          intensity,
          productNameHint,
          benchmarks
        })
      },
      ...history.map((row) => ({
        role: row.role === "ASSISTANT" ? ("assistant" as const) : ("user" as const),
        content: historyContentOf(row)
      }))
    ];

    let reply: { reply: string; payload: unknown; provider: string; model: string };
    try {
      const generated = await this.ai.generateJson({
        schema: chatReplySchema,
        messages,
        temperature: 0.8,
        /**
         * 一次成稿要装下正文 + 话术块 + 金句 + 异议 + 已用事实 + 待补事实 + 追问，
         * 3200 会在 JSON 中途被截断（实测出现过「载荷不完整」，还白烧一次模型调用）。
         * 这里给够写完整份 JSON 的额度，宁可多留余量。
         */
        maxTokens: 8000
      });
      reply = {
        reply: generated.data.reply,
        /**
         * 对标来源**一律用服务端检索结果覆盖**（§62-1）：
         * 模型输出里的 `benchmarks` 是它自己编的，不能给用户一个点开是死链的「对标」。
         */
        payload: { ...generated.data, benchmarks },
        provider: generated.raw.provider,
        model: generated.raw.model
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AppError(
        "AI_UNAVAILABLE",
        `AI 卖点生成失败：${reason.slice(0, 200)}。你的需求已保存，可以直接重发一次。`,
        502,
        { session_id: session.id, user_message_id: userRow.id, ai_provider: this.ai.name }
      );
    }

    const assistantRows = await this.db
      .insert(chatMessages)
      .values({
        sessionId: session.id,
        role: "ASSISTANT",
        content: reply.reply,
        payload: chatReplySchema.parse(reply.payload),
        provider: reply.provider,
        model: reply.model,
        productId,
        productName,
        schemaValid: true
      })
      .returning();
    const assistantRow = assistantRows[0];
    if (!assistantRow) {
      throw new AppError("INTERNAL_ERROR", "AI 卖点写入失败");
    }

    const updated = await this.db
      .update(chatSessions)
      .set({
        ...sessionPatch,
        messageCount: session.messageCount + 2,
        lastMessageAt: assistantRow.createdAt
      })
      .where(eq(chatSessions.id, session.id))
      .returning();
    const updatedRow = updated[0];
    if (!updatedRow) {
      throw AppError.notFound("会话不存在");
    }

    return {
      session: this.sessionView(updatedRow, productName),
      user_message: this.messageView(userRow),
      assistant_message: this.messageView(assistantRow)
    };
  }

  /* ------------------------------------------------------------ 内部工具 */

  private async findSession(userId: string, sessionId: string): Promise<ChatSessionRow> {
    const rows = await this.db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("会话不存在");
    }
    return row;
  }

  private async productName(productId: string): Promise<string> {
    const rows = await this.db
      .select({ name: products.productName })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品不存在");
    }
    return row.name;
  }

  /** 最近 N 条消息（含刚写入的这条需求），升序返回。 */
  private async loadHistory(sessionId: string): Promise<ChatMessageRow[]> {
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(CHAT_LIMITS.historyMessages);
    return rows.reverse();
  }

  /**
   * 绑定产品的上下文：**只由库里现有数据拼**，不含任何推断。
   * 模式判定直接复用锚点引擎（§17），没有可靠锚点必然是 CATEGORY_CREATOR（§62-10）。
   */
  private async loadProductContext(productId: string, intensity: CopyIntensity): Promise<ChatProductContext> {
    const rows = await this.db
      .select({ product: products, brandName: brands.name })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(eq(products.id, productId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品不存在");
    }

    const mode = await this.anchors.benchmarkMode(productId);
    const copies = await this.db
      .select({ version: copyOutputs.version, modeReason: copyOutputs.modeReason })
      .from(copyOutputs)
      .where(eq(copyOutputs.productId, productId))
      .orderBy(desc(copyOutputs.version))
      .limit(1);
    const latestCopy = copies[0] ?? null;

    const facts = await this.db
      .select()
      .from(productFacts)
      .where(eq(productFacts.productId, productId))
      .orderBy(asc(productFacts.createdAt), asc(productFacts.id));

    const allLines = [...productFieldFacts(row.product, row.brandName), ...factRowLines(facts)];
    const kept = allLines.slice(0, CHAT_LIMITS.maxProductFactsInPrompt);

    const benchmarks = await this.searchBenchmarks(row.product.productName, [
      row.brandName,
      textOf(row.product.year),
      textOf(row.product.teaType),
      textOf(row.product.teaSubtype),
      textOf(row.product.mountain)
    ]);

    return {
      product_id: row.product.id,
      product_name: row.product.productName,
      facts: kept,
      mode: mode.mode,
      mode_reason: latestCopy
        ? `${mode.reason}；最近一版强成交话术（第 ${latestCopy.version} 版）的判定说明：${latestCopy.modeReason}`
        : `${mode.reason}；这款产品还没有正式强成交话术版本，本次只出草稿，正式发布必须走事实审核`,
      copy_version: latestCopy?.version ?? null,
      missing_hard_facts: missingHardFactsOf(row.product, facts),
      truncated_facts: Math.max(0, allLines.length - kept.length),
      benchmarks
    };
  }

  /**
   * 按产品名去全网找高价值对标（客户 2026-09-26 追加需求：「卖点一定要根据我提供的产品名，
   * 尽可能去全网搜索高价值的对标产品，把卖点吹大」）。
   *
   * 纪律（§12 Adapter / §62-1）：
   * - 只用真实检索通道（Provider 由环境变量决定），绝不凭模型记忆说「某某茶现在卖多少」；
   * - 任何一条查询失败 / 超时 / 0 条结果，都只是少几条素材——**绝不阻塞出稿**（降级为 `[]`）；
   * - 查不到就查不到：Prompt 会自动进入 Category Creator Mode（§62-10），不硬凑一个品牌名。
   */
  private async searchBenchmarks(
    productName: string | null,
    hints: readonly (string | null | undefined)[]
  ): Promise<ChatBenchmark[]> {
    const name = productName?.trim();
    if (!name) {
      return [];
    }
    const settled = await Promise.allSettled(
      benchmarkQueries(name, hints).map((query) =>
        this.search.search({ query, maxResults: BENCHMARK_RESULTS_PER_QUERY })
      )
    );
    const queriedAt = new Date().toISOString();
    const seen = new Set<string>();
    const candidates: ChatBenchmark[] = [];
    for (const item of settled) {
      if (item.status !== "fulfilled") {
        continue;
      }
      for (const result of item.value) {
        const url = normalizeBenchmarkUrl(result.url ?? "");
        const domain = (result.sourceDomain ?? "").trim();
        if (url.length === 0 || domain.length === 0 || domain === "unknown" || seen.has(url)) {
          continue;
        }
        seen.add(url);
        try {
          candidates.push(
            chatBenchmarkSchema.parse({
              title: (result.title ?? "").trim().slice(0, 200),
              url,
              source_domain: domain.slice(0, 200),
              snippet: (result.snippet ?? "").trim().slice(0, CHAT_LIMITS.maxBenchmarkSnippetChars),
              queried_at: queriedAt
            })
          );
        } catch {
          /** 单条不合格就丢这一条：对标少一条不影响出稿，编一条才会出事。 */
          continue;
        }
      }
    }
    /** 先按产品名做相关性过滤（丢无关行业的同名噪音），再按上限截断。 */
    return filterBenchmarks(name, candidates).slice(0, CHAT_LIMITS.maxBenchmarks);
  }

  private sessionView(row: ChatSessionRow, productName: string | null): ChatSessionView {
    return chatSessionViewSchema.parse({
      id: row.id,
      title: row.title,
      product_id: row.productId,
      product_name: productName,
      intensity: copyIntensitySchema.parse(row.intensity),
      message_count: row.messageCount,
      last_message_at: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    });
  }

  private messageView(row: ChatMessageRow): ChatMessageView {
    return chatMessageViewSchema.parse({
      id: row.id,
      session_id: row.sessionId,
      role: row.role,
      content: row.content,
      payload: row.payload ?? null,
      provider: row.provider,
      model: row.model,
      product_id: row.productId,
      product_name: row.productName,
      schema_valid: row.schemaValid,
      created_at: row.createdAt.toISOString()
    });
  }
}
