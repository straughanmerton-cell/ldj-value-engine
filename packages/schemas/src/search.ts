import { z } from "zod";
import { searchQueryTypes, type SearchQueryType } from "./enums.js";
import {
  findForbiddenFabrications,
  normalizeTraceabilityText,
  FORBIDDEN_AUTO_FILL_LABELS
} from "./fact-normalizer.js";
import type { ValueDna } from "./value-dna.js";

/**
 * 搜索策略（规格 §12 搜索逻辑 / §40 Agent 2 搜索策略专家）。
 *
 * 两条硬约束：
 * 1. 目标不是「直接回答谁最贵」，而是构建可比产品池 + 价格证据池；
 * 2. 搜索词本身也不得凭空造出产品没有的硬事实（§58-2）：
 *    例如输入里没有「班章」，AI 就不能生成「班章孔雀」这类搜索词。
 */

const queryList = z.array(z.string().trim().min(2).max(120)).default([]);

export const searchPlanSchema = z
  .object({
    exact_queries: queryList,
    concept_queries: queryList,
    origin_queries: queryList,
    flavor_queries: queryList,
    taste_queries: queryList,
    positioning_queries: queryList,
    price_queries: queryList,
    auction_queries: queryList,
    transaction_queries: queryList
  })
  .strict();
export type SearchPlan = z.infer<typeof searchPlanSchema>;

/** Agent 2（§40）的原始输出：字段缺失按空数组处理，其余仍走 schema 校验（§62-13）。 */
export const searchPlanAiOutputSchema = searchPlanSchema;

export type SearchPlanGenerator = "RULE_BASED" | "AI_ASSISTED";

export interface SearchPlanQuery {
  query_type: SearchQueryType;
  query: string;
}

export interface SearchPlanBuildInput {
  dna: ValueDna;
  /** snake_case 产品快照（product.product_name / tea_type / mountain ...） */
  product?: Record<string, unknown> | undefined;
  /** 每个查询类型保留的最大条数，默认 12 */
  maxPerType?: number;
}

export interface SearchPlanSanitizeResult {
  plan: SearchPlan;
  dropped: { query_type: SearchQueryType; query: string; reason: string; details: string[] }[];
}

const PRICE_SUFFIXES = ["价格", "成交价", "行情", "挂牌", "整件", "单饼"] as const;
const AUCTION_SUFFIXES = ["拍卖", "拍卖 成交价", "老茶 拍卖"] as const;
const TRANSACTION_SUFFIXES = ["成交价", "成交记录", "交易"] as const;

/** 六星孔雀 → 五星孔雀：同系列相邻星级的搜索词（仅用于找可比产品，不作为产品事实）。 */
const STAR_NEIGHBORS: Record<string, string> = {
  十星: "九星",
  九星: "八星",
  八星: "七星",
  七星: "六星",
  六星: "五星",
  五星: "四星",
  四星: "三星",
  三星: "二星",
  二星: "一星"
};

function uniqueStrings(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = raw.replace(/\s+/g, " ").trim();
    if (value.length < 2 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** 产品茶类词（普洱 / 生茶 / 熟茶），只从已录入的茶类字段里取，不额外推断。 */
function teaWords(product: Record<string, unknown>): string[] {
  const teaType = text(product["tea_type"]);
  const subtype = text(product["tea_subtype"]);
  const words: string[] = [];
  if (teaType) {
    words.push(teaType);
    if (teaType.includes("普洱")) {
      words.push("普洱");
    }
  }
  if (subtype) {
    words.push(subtype);
  }
  words.push("茶");
  return uniqueStrings(words, 5);
}

/** 品味/风格类查询用的短茶类词：浓强 生普 / 茶气强 普洱（§12.4）。 */
function shortTeaWord(product: Record<string, unknown>): string {
  const teaType = text(product["tea_type"]) ?? "";
  const subtype = text(product["tea_subtype"]) ?? "";
  if (teaType.includes("生") || subtype.includes("生")) {
    return "生普";
  }
  if (teaType.includes("熟") || subtype.includes("熟")) {
    return "熟普";
  }
  return "普洱";
}

/** 身份词里最像「系列图腾」的那个（孔雀 / 凤凰 / 麒麟…），用于 班章孔雀 这类组合词。 */
function totemToken(dna: ValueDna): string | null {
  return (
    dna.identity.find((token) => token.length >= 2 && token.length <= 4 && !/星$/.test(token)) ?? null
  );
}

function starToken(dna: ValueDna): string | null {
  return dna.identity.find((token) => /星$/.test(token)) ?? null;
}

/**
 * 规则引擎版本的搜索策略（规格 §12.1–§12.5）。
 * 只用已录入字段与 Value DNA 组装，因此「输入里没有的词」永远不会出现在搜索词里。
 */
export function buildSearchPlanFromValueDna(input: SearchPlanBuildInput): SearchPlan {
  const dna = input.dna;
  const product = input.product ?? {};
  const limit = input.maxPerType ?? 12;
  const name = text(product["product_name"]) ?? text(product["series_name"]) ?? null;
  const series = text(product["series_name"]);
  const words = teaWords(product);
  const shortWord = shortTeaWord(product);
  const primaryTeaWord = words.find((word) => word !== "茶") ?? "茶";
  const totem = totemToken(dna);
  const star = starToken(dna);

  const exact: string[] = [];
  if (name) {
    for (const word of words) {
      exact.push(`${name} ${word}`);
    }
    for (const suffix of ["年份", "批次", "真假"]) {
      exact.push(`${name} ${suffix}`);
    }
  }

  const concept: string[] = [];
  for (const token of [...dna.identity, ...(series && name && series !== name ? [series] : [])]) {
    concept.push(`${token} 普洱`);
    concept.push(`${token}系列 普洱`);
  }
  if (star && totem) {
    concept.push(`${star}${totem}`);
    const neighbor = STAR_NEIGHBORS[star];
    if (neighbor) {
      concept.push(`${neighbor}${totem}`);
    }
  }
  for (const region of dna.origin) {
    if (totem) {
      concept.push(`${region}${totem}`);
    }
    concept.push(`${region} ${primaryTeaWord}`);
  }

  const origin: string[] = [];
  for (const region of dna.origin) {
    origin.push(`${region} 高端 ${shortWord === "熟普" ? "熟茶" : "生茶"}`);
    origin.push(`${region} 高端 普洱`);
    // 只在原料里真的写了该说法时，才把「大树 / 古树 / 乔木」这类原料词与山头组合；
    // 绝不因为产品在某个山头就替它加上树龄相关硬事实（§58-2 / §62-5）。
    for (const material of dna.material) {
      origin.push(`${region} ${material}`);
    }
  }

  const flavor: string[] = [];
  for (const value of dna.flavor) {
    flavor.push(`${value} 普洱`);
    for (const region of dna.origin.slice(0, 3)) {
      flavor.push(`${value} ${region}`);
    }
  }

  const taste: string[] = [];
  for (const value of dna.taste) {
    taste.push(`${value} ${shortWord}`);
    taste.push(`${value} 普洱`);
  }

  const positioning: string[] = [];
  if (name) {
    positioning.push(`${name} 高端`);
    positioning.push(`${name} 收藏`);
    positioning.push(`${name} 定位`);
  }
  for (const value of dna.positioning) {
    positioning.push(`${value} 普洱`);
  }
  for (const value of dna.collection) {
    positioning.push(`${value} 普洱`);
  }

  const price: string[] = [];
  const auction: string[] = [];
  const transaction: string[] = [];
  const priceTargets = uniqueStrings(
    [name ?? "", series ?? "", name ? `${name} 普洱` : ""].filter((value) => value.length >= 2),
    3
  );
  for (const target of priceTargets) {
    for (const suffix of PRICE_SUFFIXES) {
      price.push(`${target} ${suffix}`);
    }
    for (const suffix of AUCTION_SUFFIXES) {
      auction.push(`${target} ${suffix}`);
    }
    for (const suffix of TRANSACTION_SUFFIXES) {
      transaction.push(`${target} ${suffix}`);
    }
  }

  return searchPlanSchema.parse({
    exact_queries: uniqueStrings(exact, limit),
    concept_queries: uniqueStrings(concept, limit),
    origin_queries: uniqueStrings(origin, limit),
    flavor_queries: uniqueStrings(flavor, limit),
    taste_queries: uniqueStrings(taste, limit),
    positioning_queries: uniqueStrings(positioning, limit),
    price_queries: uniqueStrings(price, limit),
    auction_queries: uniqueStrings(auction, limit),
    transaction_queries: uniqueStrings(transaction, limit)
  });
}

/** 把 9 类查询拉平为执行队列（按 §12.1 → §12.5 的优先级）。 */
export function searchPlanQueries(plan: SearchPlan): SearchPlanQuery[] {
  return searchQueryTypes.flatMap((type) =>
    plan[type].map((query) => ({ query_type: type, query }))
  );
}

/**
 * AI 生成的搜索策略净化（§40 + §58-2 + §62-1）：
 * - 命中禁止自动生成的硬事实（班章 / 树龄 / 获奖 / 比例…）且语料里没有 → 丢弃该查询；
 * - 与规则引擎结果重复的查询保留在 AI 结果中但不重复计数（由 mergeSearchPlans 处理）。
 */
export function sanitizeSearchPlan(
  candidate: SearchPlan,
  corpusText: string
): SearchPlanSanitizeResult {
  const corpus = normalizeTraceabilityText(corpusText);
  const dropped: SearchPlanSanitizeResult["dropped"] = [];
  const cleaned = {} as Record<SearchQueryType, string[]>;

  for (const type of searchQueryTypes) {
    const kept: string[] = [];
    for (const query of candidate[type]) {
      const normalized = normalizeTraceabilityText(query);
      if (normalized.length === 0) {
        continue;
      }
      const forbidden = findForbiddenFabrications(query, corpusText);
      if (forbidden.length > 0) {
        dropped.push({
          query_type: type,
          query,
          reason: "FORBIDDEN_FABRICATION",
          details: forbidden.map((key) => FORBIDDEN_AUTO_FILL_LABELS[key])
        });
        continue;
      }
      // 明显与语料无关的长查询（例如凭空出现的第三个产品名）直接丢弃。
      if (!corpus.includes(normalized) && normalized.length >= 12 && !/[价格成交拍卖行情挂牌]/.test(normalized)) {
        dropped.push({
          query_type: type,
          query,
          reason: "NOT_GROUNDED",
          details: ["查询词在输入语料中找不到来源，属于凭空构造的产品名或概念"]
        });
        continue;
      }
      kept.push(query);
    }
    cleaned[type] = kept;
  }

  return { plan: searchPlanSchema.parse(cleaned), dropped };
}

/** 规则引擎结果为主、AI 结果只做增量补充（去重后合并）。 */
export function mergeSearchPlans(base: SearchPlan, extra: SearchPlan): SearchPlan {
  const merged = {} as Record<SearchQueryType, string[]>;
  for (const type of searchQueryTypes) {
    merged[type] = uniqueStrings([...base[type], ...extra[type]], 24);
  }
  return searchPlanSchema.parse(merged);
}

export function countSearchPlanQueries(plan: SearchPlan): number {
  return searchQueryTypes.reduce((total, type) => total + plan[type].length, 0);
}

/** 供 API 自检：确认 §12 的 9 类查询与 §40 的 Agent 2 输出字段一一对应。 */
export const SEARCH_PLAN_CONTRACT = {
  spec_ref: "§12 / §40",
  query_types: searchQueryTypes,
  agent: "Agent 2｜搜索策略专家",
  goal: "构建可比产品池 + 价格证据池，而不是直接回答谁最贵"
} as const;

export const searchPlanGenerateRequestSchema = z
  .object({
    use_ai: z.boolean().optional(),
    max_per_type: z.number().int().min(1).max(30).optional()
  })
  .strict();
export type SearchPlanGenerateRequest = z.infer<typeof searchPlanGenerateRequestSchema>;
