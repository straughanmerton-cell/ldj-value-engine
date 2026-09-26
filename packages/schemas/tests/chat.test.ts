import { describe, expect, it } from "vitest";
import {
  CHAT_CONTRACT,
  CHAT_DEFAULT_TITLE,
  CHAT_IRON_RULES,
  CHAT_LIMITS,
  CHAT_ONBOARDING_QUESTIONS,
  CHAT_PRESETS,
  CHAT_ROLE_LABELS,
  CHAT_SELLPOINT_FORM,
  COPY_INTENSITY_META,
  DEFAULT_COPY_INTENSITY,
  LEVEL5_REQUIREMENT_META,
  VALUE_FOCUS_LABELS,
  buildChatSystemPrompt,
  chatForbiddenFabricationLabels,
  chatMessageViewSchema,
  chatReplySchema,
  chatSessionListQuerySchema,
  chatSessionViewSchema,
  createChatSessionSchema,
  sendChatMessageSchema,
  updateChatSessionSchema,
  valueFocusKeys,
  type ChatProductContext
} from "../src/index.js";

/**
 * AI 对话工作台（规格 §0 总执行说明 / §21 / §22 / §24 / §26 / §31 / §33 / §62 / §64）。
 *
 * 本文件锁定四件事：
 * - **Prompt 是唯一防线**：没有绑定产品时必须明说「不要编造任何具体产品事实」并按 §10 追问；
 *   绑定产品时必须只把已录事实连同出处交给模型，并把缺口写进 `missing_facts`（§62-1 / §62-8）；
 * - **15 条铁律逐条进 Prompt**（§62），且强度档决定 Level 5 七项是否强制（§21 / §22）；
 * - **输出契约不许松**：`chatReplySchema` strict，`value_focus` 只认 8 个英文键，
 *   模型写中文标签或越界档位一律判废稿（§62-13）；
 * - **前端文案只有一份来源**：预设需求、五档强度、八项价值重点、两类角色名都从这一层读（§64）。
 */

const PRODUCT_CONTEXT: ChatProductContext = {
  product_id: "11111111-1111-4111-8111-111111111111",
  product_name: "龙德记六星孔雀",
  facts: [
    { label: "产品名称", value: "龙德记六星孔雀", source: "产品录入" },
    { label: "原料", value: "布朗山大树春茶", source: "产品录入" },
    { label: "汤感", value: "厚", source: "事实清单·品饮确认" }
  ],
  mode: "CATEGORY_CREATOR",
  mode_reason: "没有可靠价格锚点，自动进入 Category Creator Mode",
  copy_version: 3,
  missing_hard_facts: ["树龄", "配方比例"],
  truncated_facts: 2,
  benchmarks: []
};

/** 有对标素材时的上下文：对标只贡献价格高度，不许移植竞品事实（§62-5）。 */
const PRODUCT_CONTEXT_WITH_BENCHMARKS: ChatProductContext = {
  ...PRODUCT_CONTEXT,
  benchmarks: [
    {
      title: "冰岛老树熟茶价格表最新行情-茶",
      url: "https://tea.example.com/iceland-price",
      source_domain: "tea.example.com",
      snippet: "冰岛老树熟茶市场价 8000 元/饼起。",
      queried_at: "2026-09-26T06:00:00.000Z"
    }
  ]
};

describe("chat 铁律与合同（§62 / §64）", () => {
  it("15 条铁律逐条编号，顺序与 §62 一致", () => {
    expect(CHAT_IRON_RULES).toHaveLength(15);
    CHAT_IRON_RULES.forEach((rule, index) => {
      expect(rule.startsWith(`§62-${index + 1} `)).toBe(true);
    });
  });

  it("合同自检把输入 / 输出 / 规则 / 保证 / 上限都摊开", () => {
    expect(CHAT_CONTRACT.output.schema).toBe("chatReplySchema");
    expect(CHAT_CONTRACT.rules.some((rule) => rule.includes("§62-13"))).toBe(true);
    expect(CHAT_CONTRACT.rules.some((rule) => rule.includes("§62-10"))).toBe(true);
    expect(Object.values(CHAT_CONTRACT.guarantees).every((value) => value === true)).toBe(true);
    expect(CHAT_CONTRACT.limits.maxMessageChars).toBe(CHAT_LIMITS.maxMessageChars);
    expect(CHAT_CONTRACT.iron_rules).toHaveLength(CHAT_IRON_RULES.length);
    expect(CHAT_CONTRACT.guarantees.ai_output_is_draft).toBe(true);
    expect(CHAT_CONTRACT.guarantees.publish_requires_fact_review).toBe(true);
  });

  it("上限自洽，历史与事实行数都有明确天花板", () => {
    expect(CHAT_LIMITS.defaultPageSize).toBeGreaterThan(0);
    expect(CHAT_LIMITS.maxPageSize).toBeGreaterThanOrEqual(CHAT_LIMITS.defaultPageSize);
    expect(CHAT_LIMITS.maxPageSize).toBeLessThanOrEqual(100);
    expect(CHAT_LIMITS.historyMessages).toBeGreaterThan(0);
    expect(CHAT_LIMITS.maxProductFactsInPrompt).toBeGreaterThan(0);
    expect(CHAT_LIMITS.maxSessionsPerUser).toBeGreaterThan(0);
    expect(CHAT_LIMITS.maxFollowUps).toBeGreaterThan(0);
    expect(CHAT_LIMITS.maxFollowUps).toBeLessThanOrEqual(10);
    expect(CHAT_LIMITS.maxMessageChars).toBeGreaterThanOrEqual(1000);
    expect(CHAT_LIMITS.maxTitleChars).toBeGreaterThan(0);
    expect(CHAT_LIMITS.maxTitleChars).toBeLessThanOrEqual(120);
  });

  it("两类角色名与前端文案同源", () => {
    expect(CHAT_ROLE_LABELS.USER).toBe("我的需求");
    expect(CHAT_ROLE_LABELS.ASSISTANT).toBe("AI 卖点");
    expect(CHAT_DEFAULT_TITLE).toBe("新对话");
  });
});

describe("chat 预设需求（§21 / §26 / §33）", () => {
  it("六条预设都能一句话开工，且键唯一、档位合法", () => {
    expect(CHAT_PRESETS).toHaveLength(6);
    const keys = new Set(CHAT_PRESETS.map((preset) => preset.key));
    expect(keys.size).toBe(CHAT_PRESETS.length);
    for (const preset of CHAT_PRESETS) {
      expect(preset.prompt.length).toBeGreaterThan(0);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.hint.length).toBeGreaterThan(0);
      expect(preset.spec_ref.length).toBeGreaterThan(0);
      expect([1, 2, 3, 4, 5]).toContain(preset.intensity);
    }
  });

  it("Level 5 王者档与「再狠一点」都在预设里，核心功能不被裁剪", () => {
    expect(CHAT_PRESETS.some((preset) => preset.intensity === 5)).toBe(true);
    expect(CHAT_PRESETS.some((preset) => preset.prompt.includes("Level 5"))).toBe(true);
    expect(CHAT_PRESETS.some((preset) => preset.key === "INTENSIFY")).toBe(true);
  });

  it("默认形态是产品卖点介绍，六张卡里不再有直播稿（客户 2026-09-26 追加需求）", () => {
    expect(CHAT_SELLPOINT_FORM.name).toBe("产品卖点介绍");
    expect(CHAT_SELLPOINT_FORM.outline.length).toBeGreaterThanOrEqual(6);
    expect(CHAT_SELLPOINT_FORM.rules.length).toBeGreaterThan(0);
    expect(CHAT_PRESETS[0]?.key).toBe("SELLPOINT_CARD");
    expect(CHAT_PRESETS.some((preset) => preset.key === "BENCHMARK")).toBe(true);
    for (const preset of CHAT_PRESETS) {
      expect(`${preset.label}${preset.hint}${preset.prompt}`).not.toContain("直播稿");
    }
  });

  it("未绑定产品时的追问清单非空且不重复", () => {
    expect(CHAT_ONBOARDING_QUESTIONS.length).toBeGreaterThan(0);
    expect(new Set(CHAT_ONBOARDING_QUESTIONS).size).toBe(CHAT_ONBOARDING_QUESTIONS.length);
  });
});

describe("chat System Prompt 组装（§62-1 / §62-8 / §62-12）", () => {
  it("未绑定产品：明说不要编造，且给出占位符模板与追问", () => {
    const prompt = buildChatSystemPrompt({ product: null, intensity: 4 });
    expect(prompt).toContain("不要编造任何具体产品事实");
    expect(prompt).toContain("【待补充：");
    expect(prompt).toContain("missing_facts");
    for (const question of CHAT_ONBOARDING_QUESTIONS) {
      expect(prompt).toContain(question);
    }
    expect(prompt).toContain("本次没有绑定产品");
  });

  it("绑定产品：每一条已录事实都带出处，缺口交给产品方补", () => {
    const prompt = buildChatSystemPrompt({ product: PRODUCT_CONTEXT, intensity: 4 });
    expect(prompt).toContain(PRODUCT_CONTEXT.product_name);
    expect(prompt).toContain(PRODUCT_CONTEXT.product_id);
    expect(prompt).toContain("已录事实");
    expect(prompt).toContain("布朗山大树春茶");
    expect(prompt).toContain("来源：产品录入");
    expect(prompt).toContain("事实清单·品饮确认");
    expect(prompt).toContain("CATEGORY_CREATOR");
    expect(prompt).toContain(PRODUCT_CONTEXT.mode_reason);
    expect(prompt).toContain("第 3 版");
    expect(prompt).toContain("还有 2 条已录事实未放入本次上下文");
    expect(prompt).toContain("树龄");
    expect(prompt).toContain("配方比例");
  });

  it("没有缺口时也不允许新增未列出的硬事实", () => {
    const prompt = buildChatSystemPrompt({
      product: { ...PRODUCT_CONTEXT, missing_hard_facts: [], truncated_facts: 0 },
      intensity: 4
    });
    expect(prompt).toContain("仍然不许新增任何未列出的硬事实");
    expect(prompt).not.toContain("还有 0 条已录事实未放入本次上下文");
  });

  it("事实为空的产品只给模板与追问，不给具体事实", () => {
    const prompt = buildChatSystemPrompt({
      product: { ...PRODUCT_CONTEXT, facts: [], missing_hard_facts: ["树龄"] },
      intensity: 2
    });
    expect(prompt).toContain("还没有录入任何可用事实");
    expect(prompt).toContain("占位符");
  });

  it("15 条铁律与禁止编造清单都进 Prompt", () => {
    const prompt = buildChatSystemPrompt({ product: null, intensity: 4 });
    for (const rule of CHAT_IRON_RULES) {
      expect(prompt).toContain(rule);
    }
    for (const label of chatForbiddenFabricationLabels()) {
      expect(prompt).toContain(label);
    }
    expect(chatForbiddenFabricationLabels().length).toBeGreaterThan(0);
  });

  it("§33 八项价值重点：没指定就不许八项平铺，指定了就必须多讲", () => {
    const none = buildChatSystemPrompt({ product: null, intensity: 4 });
    expect(none).toContain("本次没有指定重点");
    for (const key of valueFocusKeys) {
      expect(none).toContain(VALUE_FOCUS_LABELS[key]);
    }

    const focused = buildChatSystemPrompt({
      product: PRODUCT_CONTEXT,
      intensity: 4,
      valueFocus: ["mountain", "formula_philosophy"]
    });
    expect(focused).toContain(`本次重点：${VALUE_FOCUS_LABELS.mountain} / ${VALUE_FOCUS_LABELS.formula_philosophy}`);
  });

  it("§21 五档强度全部写入 Prompt，本次档位单独点明", () => {
    const prompt = buildChatSystemPrompt({ product: null, intensity: 3 });
    expect(COPY_INTENSITY_META).toHaveLength(5);
    for (const meta of COPY_INTENSITY_META) {
      expect(prompt).toContain(meta.label);
      expect(prompt).toContain(meta.requirement);
    }
    expect(prompt).toContain("本次采用：Level 3");
    expect(prompt).toContain("本次不是 Level 5");
  });

  it("§22 Level 5 王者档：七项强制逐条进 Prompt", () => {
    const prompt = buildChatSystemPrompt({ product: PRODUCT_CONTEXT, intensity: 5 });
    expect(LEVEL5_REQUIREMENT_META).toHaveLength(7);
    for (const item of LEVEL5_REQUIREMENT_META) {
      expect(prompt).toContain(item.label);
      expect(prompt).toContain(item.requirement);
    }
    expect(prompt).toContain("本次采用：Level 5");
    expect(prompt).not.toContain("本次不是 Level 5");
  });

  it("输出格式段给出 value_focus 英文键白名单与 intensity 取值", () => {
    const prompt = buildChatSystemPrompt({ product: null, intensity: 4 });
    for (const key of valueFocusKeys) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain("不要写中文标签、不要自造键名");
    expect(prompt).toContain("`intensity` 只能填 1–5 的整数");
  });

  it("有对标素材：逐条进 Prompt，并写死「只能引用价格高度」（§62-5）", () => {
    const prompt = buildChatSystemPrompt({ product: PRODUCT_CONTEXT_WITH_BENCHMARKS, intensity: 4 });
    expect(prompt).toContain("全网对标素材");
    expect(prompt).toContain("冰岛老树熟茶价格表最新行情-茶");
    expect(prompt).toContain("tea.example.com");
    expect(prompt).toContain("8000 元/饼起");
    expect(prompt).toContain("原料、树龄、山头、年份、配方、工艺写成龙德记自己的事实");
    expect(prompt).not.toContain("没有检索到任何对标来源");
  });

  it("没有对标素材：自动进 Category Creator Mode，不许硬凑对标（§62-10）", () => {
    const prompt = buildChatSystemPrompt({ product: PRODUCT_CONTEXT, intensity: 4 });
    expect(prompt).toContain("没有检索到任何对标来源");
    expect(prompt).toContain("自动进入 Category Creator Mode");
    expect(prompt).toContain("不要硬凑一个品牌名");
  });

  it("交付形态段写明「不是直播稿」，并禁止直播场景词", () => {
    const prompt = buildChatSystemPrompt({ product: PRODUCT_CONTEXT, intensity: 4 });
    expect(prompt).toContain("产品卖点介绍（不是直播稿）");
    expect(prompt).toContain("直播场景词");
    expect(prompt).toContain("核心卖点");
  });
});

describe("chatReplySchema（§62-13）", () => {
  it("只给 reply 时其余字段走默认值", () => {
    const parsed = chatReplySchema.parse({ reply: "先说思路，再指出缺口。" });
    expect(parsed.headline).toBeNull();
    expect(parsed.copy_blocks).toEqual([]);
    expect(parsed.quotes).toEqual([]);
    expect(parsed.objections).toEqual([]);
    expect(parsed.missing_facts).toEqual([]);
    expect(parsed.follow_up_questions).toEqual([]);
    expect(parsed.used_facts).toEqual([]);
    expect(parsed.value_focus).toEqual([]);
    expect(parsed.intensity).toBe(DEFAULT_COPY_INTENSITY);
    expect(parsed.value_height).toBeNull();
    expect(parsed.benchmarks).toEqual([]);
    expect(parsed.next_actions).toEqual([]);
  });

  it("benchmarks 只收服务端回写的真实来源，结构不合规一律拒绝", () => {
    const parsed = chatReplySchema.parse({ reply: "x" });
    expect(parsed.benchmarks).toEqual([]);
    expect(
      chatReplySchema.safeParse({
        reply: "x",
        benchmarks: [
          {
            title: "冰岛老树熟茶价格表",
            url: "https://tea.example.com/p",
            source_domain: "tea.example.com",
            snippet: "8000 元/饼起",
            queried_at: "2026-09-26T06:00:00.000Z"
          }
        ]
      }).success
    ).toBe(true);
    // 缺 url / 带多余字段都不接受
    expect(
      chatReplySchema.safeParse({ reply: "x", benchmarks: [{ title: "缺链接", source_domain: "a.com", queried_at: "t" }] })
        .success
    ).toBe(false);
    expect(
      chatReplySchema.safeParse({
        reply: "x",
        benchmarks: [
          { title: "t", url: "https://a.com", source_domain: "a.com", queried_at: "t", fake: 1 }
        ]
      }).success
    ).toBe(false);
  });

  it("strict：多余字段直接判废稿", () => {
    expect(chatReplySchema.safeParse({ reply: "x", extra: 1 }).success).toBe(false);
  });

  it("value_focus 只认 8 个英文键，中文标签一律拒绝", () => {
    expect(chatReplySchema.safeParse({ reply: "x", value_focus: ["identity"] }).success).toBe(true);
    expect(chatReplySchema.safeParse({ reply: "x", value_focus: ["山头"] }).success).toBe(false);
    expect(chatReplySchema.safeParse({ reply: "x", value_focus: ["mountain_name"] }).success).toBe(false);
  });

  it("intensity 与 copy_blocks.level 都被限制在 1–5", () => {
    expect(chatReplySchema.safeParse({ reply: "x", intensity: 5 }).success).toBe(true);
    expect(chatReplySchema.safeParse({ reply: "x", intensity: 6 }).success).toBe(false);
    expect(chatReplySchema.safeParse({ reply: "x", intensity: 0 }).success).toBe(false);
    expect(chatReplySchema.safeParse({ reply: "x", intensity: "4" }).success).toBe(false);

    const block = { label: "60 秒直播稿", level: 6, text: "可以直接念的一段" };
    expect(chatReplySchema.safeParse({ reply: "x", copy_blocks: [block] }).success).toBe(false);
    expect(
      chatReplySchema.safeParse({ reply: "x", copy_blocks: [{ ...block, level: 5 }] }).success
    ).toBe(true);
  });

  it("空 reply、空话术块、超上限数组都被拦下", () => {
    expect(chatReplySchema.safeParse({ reply: "   " }).success).toBe(false);
    expect(
      chatReplySchema.safeParse({
        reply: "x",
        copy_blocks: [{ label: "  ", level: 4, text: "内容" }]
      }).success
    ).toBe(false);
    expect(
      chatReplySchema.safeParse({
        reply: "x",
        copy_blocks: Array.from({ length: CHAT_LIMITS.maxCopyBlocks + 1 }, (_, index) => ({
          label: `块 ${index}`,
          level: 4,
          text: "内容"
        }))
      }).success
    ).toBe(false);
    expect(
      chatReplySchema.safeParse({
        reply: "x",
        follow_up_questions: Array.from({ length: CHAT_LIMITS.maxFollowUps + 1 }, () => "还差什么？")
      }).success
    ).toBe(false);
  });

  it("异议问答与金句都要有正文", () => {
    expect(
      chatReplySchema.safeParse({ reply: "x", objections: [{ question: "太贵了", answer: "  " }] }).success
    ).toBe(false);
    expect(chatReplySchema.safeParse({ reply: "x", quotes: ["  "] }).success).toBe(false);
    expect(
      chatReplySchema.safeParse({
        reply: "x",
        objections: [{ question: "太贵了", answer: "贵在原料与工艺，不在包装。" }]
      }).success
    ).toBe(true);
  });
});

describe("chat 请求契约", () => {
  const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

  it("新建 / 修改会话：产品可空、标题限长、strict 无后门", () => {
    expect(createChatSessionSchema.safeParse({}).success).toBe(true);
    expect(createChatSessionSchema.safeParse({ product_id: null }).success).toBe(true);
    expect(createChatSessionSchema.safeParse({ product_id: PRODUCT_ID }).success).toBe(true);
    expect(createChatSessionSchema.safeParse({ product_id: "not-a-uuid" }).success).toBe(false);
    expect(createChatSessionSchema.safeParse({ title: "x".repeat(CHAT_LIMITS.maxTitleChars + 1) }).success).toBe(false);
    expect(createChatSessionSchema.safeParse({ unknown: true }).success).toBe(false);

    expect(updateChatSessionSchema.safeParse({}).success).toBe(true);
    expect(updateChatSessionSchema.safeParse({ intensity: 5 }).success).toBe(true);
    expect(updateChatSessionSchema.safeParse({ intensity: 0 }).success).toBe(false);
  });

  it("发消息：必填原话、自动去空白、超长拒绝", () => {
    const parsed = sendChatMessageSchema.parse({ content: "  把这款茶整理成 60 秒直播稿  " });
    expect(parsed.content).toBe("把这款茶整理成 60 秒直播稿");
    expect(sendChatMessageSchema.safeParse({ content: "   " }).success).toBe(false);
    expect(
      sendChatMessageSchema.safeParse({ content: "x".repeat(CHAT_LIMITS.maxMessageChars + 1) }).success
    ).toBe(false);
    expect(sendChatMessageSchema.safeParse({ content: "x", product_id: null, intensity: 5 }).success).toBe(true);
  });

  it("列表查询：布尔用 stringbool，页长有上限", () => {
    const parsed = chatSessionListQuerySchema.parse({ bound: "true", archived: "false", pageSize: "50" });
    expect(parsed.bound).toBe(true);
    expect(parsed.archived).toBe(false);
    expect(parsed.pageSize).toBe(50);
    expect(chatSessionListQuerySchema.safeParse({ bound: "maybe" }).success).toBe(false);
    expect(chatSessionListQuerySchema.safeParse({ bound: 1 }).success).toBe(false);
    expect(chatSessionListQuerySchema.safeParse({ pageSize: CHAT_LIMITS.maxPageSize + 1 }).success).toBe(false);
    expect(chatSessionListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe("chat 视图契约", () => {
  it("会话视图 strict，缺字段或多字段都不通过", () => {
    const view = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "六星孔雀的话术",
      product_id: null,
      product_name: null,
      intensity: 4,
      message_count: 2,
      last_message_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    };
    expect(chatSessionViewSchema.safeParse(view).success).toBe(true);
    expect(chatSessionViewSchema.safeParse({ ...view, extra: 1 }).success).toBe(false);
    expect(chatSessionViewSchema.safeParse({ ...view, intensity: 9 }).success).toBe(false);
  });

  it("消息视图允许 payload 为空（模型只回自由文本时的兜底）", () => {
    const message = {
      id: "22222222-2222-4222-8222-222222222222",
      session_id: "11111111-1111-4111-8111-111111111111",
      role: "ASSISTANT",
      content: "先说思路。",
      payload: null,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      product_id: null,
      product_name: null,
      schema_valid: false,
      created_at: "2026-01-01T00:00:00.000Z"
    };
    const parsed = chatMessageViewSchema.safeParse(message);
    expect(parsed.success).toBe(true);
    expect(chatMessageViewSchema.safeParse({ ...message, role: "SYSTEM" }).success).toBe(false);
  });
});
