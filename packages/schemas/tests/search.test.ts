import { describe, expect, it } from "vitest";
import {
  buildSearchPlanFromValueDna,
  countSearchPlanQueries,
  emptyWebExtraction,
  emptyResearchProgress,
  inferPriceTypeFromQuote,
  mergeSearchPlans,
  researchProgressSummary,
  ruleBasedWebExtraction,
  sanitizeSearchPlan,
  sanitizeWebExtraction,
  searchPlanQueries,
  searchPlanSchema,
  SOURCE_CONTRACT,
  WEB_EXTRACTOR_CONTRACT,
  classifySourceKind,
  canonicalizeUrl,
  detectUnitScope
} from "../src/index.js";

const fixtureDna = {
  identity: ["六星", "孔雀"],
  category: ["普洱生茶"],
  origin: ["布朗山"],
  material: ["大树春茶"],
  process: ["传统晒青"],
  flavor: ["烟香"],
  taste: ["浓强", "回甘快"],
  positioning: [],
  collection: [],
  naming_concepts: ["星级", "图腾命名"],
  architecture_signals: ["强骨架"]
};

const fixtureProduct = {
  product_name: "龙德记六星孔雀",
  series_name: null,
  tea_type: "普洱生茶",
  tea_subtype: "生茶",
  mountain: "布朗山"
};

describe("搜索策略（规格 §12 / §40 Agent 2）", () => {
  it("按 §12.1–§12.5 生成 9 类查询，且只用已录入信息", () => {
    const plan = buildSearchPlanFromValueDna({ dna: fixtureDna, product: fixtureProduct });

    expect(plan.exact_queries).toContain("龙德记六星孔雀 生茶");
    expect(plan.concept_queries).toContain("六星孔雀");
    expect(plan.concept_queries).toContain("五星孔雀");
    expect(plan.concept_queries).toContain("布朗山孔雀");
    expect(plan.origin_queries.some((query) => query.startsWith("布朗山 高端"))).toBe(true);
    expect(plan.flavor_queries).toContain("烟香 普洱");
    expect(plan.taste_queries).toContain("浓强 生普");
    expect(plan.price_queries).toContain("龙德记六星孔雀 成交价");
    expect(plan.auction_queries).toContain("龙德记六星孔雀 拍卖");
    expect(plan.transaction_queries).toContain("龙德记六星孔雀 成交记录");
    expect(countSearchPlanQueries(plan)).toBe(searchPlanQueries(plan).length);
  });

  it("输入里没有的硬事实（班章 / 古树 / 年份）不会出现在搜索词里（§58-2）", () => {
    const bareProduct = { product_name: "冒烟产品-空白饼", tea_type: "普洱生茶", tea_subtype: "生茶" };
    const bareDna = {
      ...fixtureDna,
      identity: [],
      origin: [],
      material: [],
      flavor: [],
      taste: [],
      naming_concepts: []
    };
    const plan = buildSearchPlanFromValueDna({ dna: bareDna, product: bareProduct });
    const all = searchPlanQueries(plan)
      .map((item) => item.query)
      .join(" ");

    expect(all).not.toContain("班章");
    expect(all).not.toContain("古树");
    expect(all).not.toContain("孔雀");
    expect(all).not.toContain("六星");
  });

  it("AI 搜索策略中凭空出现的硬事实会被丢弃，规则引擎查询保留", () => {
    const candidate = searchPlanSchema.parse({
      exact_queries: ["龙德记六星孔雀 普洱", "班章孔雀 拍卖"],
      concept_queries: [],
      origin_queries: [],
      flavor_queries: [],
      taste_queries: [],
      positioning_queries: [],
      price_queries: [],
      auction_queries: [],
      transaction_queries: []
    });
    const corpus = "龙德记六星孔雀 普洱生茶 布朗山 大树春茶 烟香 浓强";
    const sanitized = sanitizeSearchPlan(candidate, corpus);

    expect(sanitized.plan.exact_queries).toEqual(["龙德记六星孔雀 普洱"]);
    expect(sanitized.dropped).toHaveLength(1);
    expect(sanitized.dropped[0]?.reason).toBe("FORBIDDEN_FABRICATION");
    expect(sanitized.dropped[0]?.details.join()).toContain("山头");
  });

  it("合并策略去重且不丢规则引擎查询", () => {
    const base = buildSearchPlanFromValueDna({ dna: fixtureDna, product: fixtureProduct });
    const extra = searchPlanSchema.parse({ ...base, exact_queries: [...base.exact_queries, "新查询词"] });
    const merged = mergeSearchPlans(base, extra);

    expect(merged.exact_queries).toContain("新查询词");
    expect(new Set(merged.exact_queries).size).toBe(merged.exact_queries.length);
  });
});

describe("来源与价格类型（规格 §41 / §62-2·3·4）", () => {
  it("URL 规范化去除跟踪参数与末尾斜杠", () => {
    expect(canonicalizeUrl("https://www.example.com/a/b/?utm_source=x&fbclid=y#top")).toBe(
      "https://www.example.com/a/b"
    );
  });

  it("来源类型区分拍卖页、交易平台、社区与文章", () => {
    expect(classifySourceKind("https://auction.artron.net/item/1")).toBe("AUCTION_PAGE");
    expect(classifySourceKind("https://item.taobao.com/123")).toBe("MARKETPLACE");
    expect(classifySourceKind("https://tieba.baidu.com/p/1")).toBe("SOCIAL");
    expect(classifySourceKind("https://www.example.com/tea.html", "普洱行情分析")).toBe("ARTICLE");
  });

  it("挂牌价不会被当成成交价，口述成交说法降级为未知", () => {
    const listing = inferPriceTypeFromQuote("本店挂牌价 12000 元/饼，可议价", "MARKETPLACE");
    expect(listing.price_type).toBe("LISTING");

    const oral = inferPriceTypeFromQuote("据说成交价 8000 元一饼", "SOCIAL");
    expect(oral.price_type).toBe("UNKNOWN");
    expect(oral.reason).toContain("口述");

    const auction = inferPriceTypeFromQuote("2021 年拍卖落槌价 15 万元", "AUCTION_PAGE");
    expect(auction.price_type).toBe("AUCTION_HAMMER");

    const historical = inferPriceTypeFromQuote("2020 年行情参考价 6000 元", "ARTICLE");
    expect(historical.price_type).toBe("HISTORICAL_REFERENCE");
  });

  it("整件价与单饼价分别识别，不会互相换算", () => {
    expect(detectUnitScope("整件 42 万元")).toBe("CASE");
    expect(detectUnitScope("单饼 1 万元")).toBe("PIECE");
    expect(detectUnitScope("每公斤 8000 元")).toBe("KG");
  });

  it("锁定 §62-2/3/4 三条价格红线", () => {
    expect(SOURCE_CONTRACT.rules).toContain("挂牌价 ≠ 成交价");
    expect(SOURCE_CONTRACT.rules).toContain("整件价 ≠ 单饼价");
    expect(SOURCE_CONTRACT.rules).toContain("历史/口述价格 ≠ 当前价格");
  });
});

describe("网页事实抽取净化（规格 §41 / §58-3）", () => {
  const pageText = [
    "龙德记六星孔雀 2026 年生茶，布朗山原料，357g 饼。",
    "某平台挂牌价 12000 元/饼，整件价 480000 元。",
    "网友称成交价 9000 元（口述，未提供凭证）。"
  ].join("\n");

  it("只保留网页写明的字段，其余置 null", () => {
    const result = sanitizeWebExtraction(
      {
        product_name: "龙德记六星孔雀",
        brand_name: "龙德记",
        year: 2026,
        tea_type: "普洱生茶",
        origin_region: null,
        mountain: "班章",
        village: null,
        weight_g: 357,
        spec_notes: null,
        storage: null,
        prices: [],
        facts: [],
        null_reason: null
      },
      pageText,
      "ARTICLE"
    );

    expect(result.output.product_name).toBe("龙德记六星孔雀");
    expect(result.output.weight_g).toBe(357);
    // 网页里没有「班章」→ 必须为 null 并记录丢弃原因
    expect(result.output.mountain).toBeNull();
    expect(result.dropped.some((item) => item.reason === "FORBIDDEN_FABRICATION")).toBe(true);
  });

  it("价格类型按原文纠正，整件价被标成单饼价时整条拒绝", () => {
    const result = sanitizeWebExtraction(
      {
        product_name: null,
        brand_name: null,
        year: null,
        tea_type: null,
        origin_region: null,
        mountain: null,
        village: null,
        weight_g: null,
        spec_notes: null,
        storage: null,
        prices: [
          {
            value: 12000,
            currency: "CNY",
            quote: "某平台挂牌价 12000 元/饼",
            price_type: "VERIFIED_TRANSACTION",
            unit_scope: "PIECE"
          },
          {
            value: 480000,
            currency: "CNY",
            quote: "整件价 480000 元",
            price_type: "LISTING",
            unit_scope: "PIECE"
          }
        ],
        facts: [],
        null_reason: null
      },
      pageText,
      "MARKETPLACE"
    );

    expect(result.output.prices).toHaveLength(1);
    expect(result.output.prices[0]?.price_type).toBe("LISTING");
    expect(result.output.prices[0]?.unit_scope).toBe("PIECE");
    expect(result.dropped.some((item) => item.reason === "PRICE_TYPE_CORRECTED")).toBe(true);
    expect(result.dropped.some((item) => item.reason === "UNIT_MISMATCH")).toBe(true);
  });

  it("引文回溯不到的价格与事实全部丢弃", () => {
    const result = sanitizeWebExtraction(
      {
        product_name: null,
        brand_name: null,
        year: null,
        tea_type: null,
        origin_region: null,
        mountain: null,
        village: null,
        weight_g: null,
        spec_notes: null,
        storage: null,
        prices: [
          {
            value: 99999,
            currency: "CNY",
            quote: "拍卖成交 99999 元",
            price_type: "AUCTION_HAMMER"
          }
        ],
        facts: [{ field: "tree_age", value: "树龄 300 年", quote: "古树 300 年" }],
        null_reason: null
      },
      pageText,
      "ARTICLE"
    );

    expect(result.output.prices).toHaveLength(0);
    expect(result.output.facts).toHaveLength(0);
    expect(result.has_content).toBe(false);
    expect(result.warnings.join()).toContain("没有明确写出可用信息");
  });

  it("空抽取结果显式说明原因，不生成候选", () => {
    const empty = emptyWebExtraction("页面为登录墙，正文为空");
    const result = sanitizeWebExtraction(empty, "", "OTHER");
    expect(result.has_content).toBe(false);
    expect(result.output.null_reason).toBe("页面为登录墙，正文为空");
    expect(WEB_EXTRACTOR_CONTRACT.null_rule).toBe("没有写 = null");
  });

  it("无 AI Provider 时的规则抽取只登记原文写明的内容（年份 / 重量 / 价格）", () => {
    const text = [
      "龙德记六星孔雀 2026 年生茶，规格 357g。",
      "某平台挂牌价 12000 元/饼，另有整件价 48 万元。",
      "页面没有提到的信息一律不出现。"
    ].join("\n");
    const extracted = ruleBasedWebExtraction(text, "MARKETPLACE");
    expect(extracted.year).toBe(2026);
    expect(extracted.weight_g).toBe(357);
    expect(extracted.prices).toHaveLength(2);
    expect(extracted.prices.map((price) => price.price_type)).toEqual(["LISTING", "LISTING"]);
    expect(extracted.prices.map((price) => price.unit_scope)).toEqual(["PIECE", "CASE"]);
    expect(extracted.prices[1]?.value).toBe(480_000);
    // 规则抽取产出的结果同样必须通过净化（引文可回溯）
    const sanitized = sanitizeWebExtraction(extracted, text, "MARKETPLACE");
    expect(sanitized.output.prices).toHaveLength(2);
    expect(sanitized.output.year).toBe(2026);
  });

  it("整件价在前、单饼价在后时，两条价格仍各自判定单位（§62-3）", () => {
    const text = "整件价 48 万元（共 40 饼，折合单饼 12000 元）；该批次暂未成交。";
    const extracted = ruleBasedWebExtraction(text, "MARKETPLACE");
    const byValue = new Map(extracted.prices.map((price) => [price.value, price.unit_scope]));
    expect(byValue.get(480_000)).toBe("CASE");
    expect(byValue.get(12_000)).toBe("PIECE");
  });
});

describe("研究流程进度（规格 §55 / §56）", () => {
  it("22 个阶段全部登记且初始为 PENDING", () => {
    const progress = emptyResearchProgress();
    expect(progress).toHaveLength(22);
    expect(progress.every((item) => item.status === "PENDING")).toBe(true);
    const summary = researchProgressSummary(progress);
    expect(summary.succeeded).toBe(0);
    expect(summary.percent).toBe(0);
  });

  it("完成状态驱动百分比与当前阶段", () => {
    const progress = emptyResearchProgress().map((item) =>
      item.stage === "VALUE_DNA"
        ? { ...item, status: "SUCCEEDED" as const }
        : item.stage === "SEARCH_PLAN"
          ? { ...item, status: "RUNNING" as const }
          : item
    );
    const summary = researchProgressSummary(progress);
    expect(summary.succeeded).toBe(1);
    expect(summary.running).toBe(1);
    expect(summary.current_stage).toBe("SEARCH_PLAN");
    expect(summary.percent).toBe(Math.round((1 / 22) * 100));
  });
});
