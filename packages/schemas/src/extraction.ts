import { z } from "zod";
import { priceTypeSchema, type PriceType } from "./enums.js";
import { findForbiddenFabrications, normalizeTraceabilityText } from "./fact-normalizer.js";
import {
  detectUnitScope,
  inferPriceTypeFromQuote,
  priceUnitScopeSchema,
  priceLocalScopeText,
  quoteIsTraceable,
  resolvePriceUnitScope,
  type PriceUnitScope,
  type SourceKind
} from "./source.js";

/**
 * Agent 3｜网页事实抽取器（规格 §41）。
 *
 * 只抽取网页明确出现的信息：**没有写 = null**。
 * 四条禁止的自动换算（§41 / §62-2·3·4）在 sanitizeWebExtraction 中强制：
 * - 整件价 → 单饼价
 * - 挂牌 → 成交
 * - 历史 → 当前
 * - 口述价格 → 已验证成交
 *
 * 抽取结果只作为「来源证据」落库（source_extractions），
 * 绝不自动写入产品事实（product_facts 必须由人工确认为六态之一，见 Phase 14 审核）。
 */

const optionalText = z.string().trim().max(4000).nullable().optional();

export const extractedPriceSchema = z
  .object({
    /** 价格数值（不得为 0 或负数） */
    value: z.number().positive().max(100_000_000),
    currency: z.string().trim().min(1).max(10).nullable().optional(),
    /** 网页原文片段：必须能在来源正文中逐字回溯 */
    quote: z.string().trim().min(1).max(600),
    price_type: priceTypeSchema,
    unit_scope: priceUnitScopeSchema.nullable().optional(),
    /** 原文同时写明的规格重量（如 357g、1kg），没有写就是 null */
    weight_g: z.number().positive().max(100_000).nullable().optional(),
    observed_at: z.string().trim().max(60).nullable().optional(),
    note: optionalText
  })
  .strict();
export type ExtractedPrice = z.infer<typeof extractedPriceSchema>;

export const extractedFactSchema = z
  .object({
    field: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(2000),
    quote: z.string().trim().min(1).max(1000)
  })
  .strict();
export type ExtractedFact = z.infer<typeof extractedFactSchema>;

export const webExtractionAiOutputSchema = z
  .object({
    product_name: optionalText,
    brand_name: optionalText,
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    tea_type: optionalText,
    origin_region: optionalText,
    mountain: optionalText,
    village: optionalText,
    weight_g: z.number().positive().max(100_000).nullable().optional(),
    spec_notes: optionalText,
    storage: optionalText,
    prices: z.array(extractedPriceSchema).default([]),
    facts: z.array(extractedFactSchema).default([]),
    /** 页面没有可用信息时由模型说明原因；不得用推断内容填空 */
    null_reason: optionalText
  })
  .strict();
export type WebExtractionAiOutput = z.infer<typeof webExtractionAiOutputSchema>;

export type WebExtractionDropReason =
  | "NOT_ON_PAGE"
  | "FORBIDDEN_FABRICATION"
  | "PRICE_TYPE_CORRECTED"
  | "UNIT_MISMATCH"
  | "ORAL_PRICE_DOWNGRADED";

export interface WebExtractionDrop {
  field: string;
  value: string;
  reason: WebExtractionDropReason;
  details: string[];
}

export interface WebExtractionResult {
  output: WebExtractionAiOutput;
  dropped: WebExtractionDrop[];
  warnings: string[];
  /** 抽取到的价格条数（纠正类型后仍保留的） */
  price_count: number;
  /** 是否至少抽到一条可用信息 */
  has_content: boolean;
}

const SCALAR_FIELDS = [
  "product_name",
  "brand_name",
  "tea_type",
  "origin_region",
  "mountain",
  "village",
  "spec_notes",
  "storage"
] as const;

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * 抽取结果净化：逐字段检查「网页里到底有没有」。
 * 任何不能回溯的内容一律置为 null 并记入 dropped，绝不留在结果里。
 */
export function sanitizeWebExtraction(
  candidate: WebExtractionAiOutput,
  sourceText: string,
  sourceKind: SourceKind
): WebExtractionResult {
  const dropped: WebExtractionDrop[] = [];
  const warnings: string[] = [];
  const corpus = normalizeTraceabilityText(sourceText);

  const output: WebExtractionAiOutput = {
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
    prices: [],
    facts: [],
    null_reason: candidate.null_reason ?? null
  };

  for (const field of SCALAR_FIELDS) {
    const value = asText(candidate[field]);
    if (!value) {
      continue;
    }
    const forbidden = findForbiddenFabrications(value, sourceText);
    if (forbidden.length > 0) {
      dropped.push({
        field,
        value,
        reason: "FORBIDDEN_FABRICATION",
        details: ["该表述在网页中没有出现，禁止自动补出硬事实（§58-2 / §62-5）"]
      });
      continue;
    }
    if (!corpus.includes(normalizeTraceabilityText(value))) {
      dropped.push({
        field,
        value,
        reason: "NOT_ON_PAGE",
        details: ["网页正文中找不到该表述（没有写 = null）"]
      });
      continue;
    }
    output[field] = value;
  }

  const year = candidate.year ?? null;
  if (year !== null) {
    if (corpus.includes(String(year))) {
      output.year = year;
    } else {
      dropped.push({
        field: "year",
        value: String(year),
        reason: "NOT_ON_PAGE",
        details: ["网页正文中没有出现该年份"]
      });
    }
  }

  const weight = candidate.weight_g ?? null;
  if (weight !== null) {
    if (corpus.includes(String(weight))) {
      output.weight_g = weight;
    } else {
      dropped.push({
        field: "weight_g",
        value: String(weight),
        reason: "NOT_ON_PAGE",
        details: ["网页正文中没有出现该重量"]
      });
    }
  }

  for (const price of candidate.prices) {
    if (!quoteIsTraceable(price.quote, sourceText)) {
      dropped.push({
        field: "price",
        value: String(price.value),
        reason: "NOT_ON_PAGE",
        details: ["价格引文无法在网页正文中回溯，整条丢弃（§41）"]
      });
      continue;
    }
    const inference = inferPriceTypeFromQuote(price.quote, sourceKind, price.price_type);
    // 单位只看这条价格自己的分句：同句里的整件价不能把单饼价带成整件价（§62-3）。
    const unitScope: PriceUnitScope = resolvePriceUnitScope(
      price.quote,
      price.value,
      inference.unit_scope
    );
    const claimedUnit = price.unit_scope ?? null;
    if (
      unitScope === "CASE" &&
      (claimedUnit === "PIECE" || price.price_type === "OFFICIAL_RETAIL")
    ) {
      dropped.push({
        field: "price",
        value: String(price.value),
        reason: "UNIT_MISMATCH",
        details: ["原文是整件价，禁止换算成单饼价（§62-3）"]
      });
      continue;
    }
    if (inference.corrected_from !== null) {
      dropped.push({
        field: "price",
        value: String(price.value),
        reason: "PRICE_TYPE_CORRECTED",
        details: [
          `原标注 ${inference.corrected_from}，按原文重新判定为 ${inference.price_type}：${inference.reason}`
        ]
      });
    }
    if (price.price_type === "VERIFIED_TRANSACTION" && inference.price_type === "UNKNOWN") {
      dropped.push({
        field: "price",
        value: String(price.value),
        reason: "ORAL_PRICE_DOWNGRADED",
        details: [inference.reason]
      });
    }
    output.prices.push({
      ...price,
      price_type: inference.price_type as PriceType,
      unit_scope: unitScope,
      note: price.note ?? inference.reason
    });
  }

  for (const fact of candidate.facts) {
    if (!quoteIsTraceable(fact.quote, sourceText)) {
      dropped.push({
        field: fact.field,
        value: fact.value,
        reason: "NOT_ON_PAGE",
        details: ["该条目的引文无法在网页正文中回溯"]
      });
      continue;
    }
    const forbidden = findForbiddenFabrications(fact.value, sourceText);
    if (forbidden.length > 0) {
      dropped.push({
        field: fact.field,
        value: fact.value,
        reason: "FORBIDDEN_FABRICATION",
        details: ["该表述在网页中没有出现，禁止自动补出硬事实"]
      });
      continue;
    }
    output.facts.push(fact);
  }

  const hasContent =
    SCALAR_FIELDS.some((field) => output[field] !== null) ||
    output.year !== null ||
    output.weight_g !== null ||
    output.prices.length > 0 ||
    output.facts.length > 0;

  if (!hasContent) {
    warnings.push("该来源没有明确写出可用信息：按 §41「没有写 = null」，不生成任何候选事实");
  }
  if (dropped.some((item) => item.reason === "FORBIDDEN_FABRICATION")) {
    warnings.push("抽取结果中出现网页没有的硬事实，已整条丢弃");
  }
  if (dropped.some((item) => item.reason === "UNIT_MISMATCH")) {
    warnings.push("检测到整件价被当作单饼价的写法，已拒绝该价格条目（§62-3）");
  }

  return {
    output: webExtractionAiOutputSchema.parse(output),
    dropped,
    warnings,
    price_count: output.prices.length,
    has_content: hasContent
  };
}

/** 无模型时的规则抽取兜底：只做「原文里能找到的整块文本」的登记，不做任何推断。 */
export function emptyWebExtraction(nullReason: string): WebExtractionAiOutput {
  return webExtractionAiOutputSchema.parse({
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
    prices: [],
    facts: [],
    null_reason: nullReason
  });
}

const SENTENCE_SPLIT = /[。！？；;\n]+/;
/** 价格必须带货币符号或「万 / 元 / 块」等单位才算写明，避免把年份当成价格。 */
const PRICE_WITH_SYMBOL = /(?:¥|￥)\s*(\d{1,3}(?:[,，]\d{3})+|\d+(?:\.\d+)?)/;
const PRICE_WITH_UNIT = /(\d{1,3}(?:[,，]\d{3})+|\d+(?:\.\d+)?)\s*(万元|万|元|块|rmb)/i;
const YEAR_PATTERN = /((?:19|20)\d{2})\s*年/;
const WEIGHT_PATTERN = /(\d{2,5}(?:\.\d+)?)\s*(g|G|克|公斤|kg|KG)/;

/** 「挂牌价 12000 元/饼」这类句子里的价格数字解析：12.5万 → 125000。 */
function parsePriceValue(digits: string, unit: string | undefined): number | null {
  const base = Number(digits.replace(/[,，]/g, ""));
  if (!Number.isFinite(base) || base <= 0) {
    return null;
  }
  const multiplier = unit === "万" || unit === "万元" ? 10_000 : 1;
  const value = base * multiplier;
  return value > 0 && value <= 100_000_000 ? value : null;
}

/**
 * 规则版网页抽取（无 AI Provider 时的兜底，规格 §41）。
 *
 * 与 AI 抽取遵守完全相同的红线：只登记页面原文里真的写了的内容，
 * 每条价格都带原文句子作为 quote，类型与单位一律按原文判定（不换算、不推断）。
 */

interface PriceMatch {
  index: number;
  digits: string;
  unit: string | undefined;
}

/** 同一句里可能同时有挂牌价与整件价：逐条命中，避免只取第一个数字。 */
function pricesInSentence(sentence: string): PriceMatch[] {
  const matches: PriceMatch[] = [];
  for (const match of sentence.matchAll(new RegExp(PRICE_WITH_UNIT.source, "gi"))) {
    matches.push({ index: match.index ?? 0, digits: match[1] ?? "", unit: match[2] });
  }
  for (const match of sentence.matchAll(new RegExp(PRICE_WITH_SYMBOL.source, "g"))) {
    const index = match.index ?? 0;
    const digits = match[1] ?? "";
    const duplicated = matches.some(
      (existing) => existing.digits === digits && Math.abs(existing.index - index) <= 3
    );
    if (!duplicated) {
      matches.push({ index, digits, unit: undefined });
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

export function ruleBasedWebExtraction(
  sourceText: string,
  sourceKind: SourceKind
): WebExtractionAiOutput {
  const sentences = sourceText
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 4);

  const prices: ExtractedPrice[] = [];
  for (const sentence of sentences) {
    if (!/(价|元|万|¥|￥|成交|挂牌|拍卖|报价)/.test(sentence)) {
      continue;
    }
    for (const match of pricesInSentence(sentence)) {
      const value = parsePriceValue(match.digits, match.unit);
      if (value === null) {
        continue;
      }
      const inference = inferPriceTypeFromQuote(sentence, sourceKind);
      // 单位只认这条价格自己周围的文字：同一句里既有挂牌单价又有整件价时，
      // 不能把「整件」按到单饼价头上，也不能反过来（§62-3）。
      const localText = priceLocalScopeText(sentence, value);
      prices.push(
        extractedPriceSchema.parse({
          value,
          currency: "CNY",
          quote: sentence.slice(0, 600),
          price_type: inference.price_type,
          unit_scope: detectUnitScope(localText),
          weight_g: null,
          observed_at: null,
          note: `规则抽取：${inference.reason}`
        })
      );
      if (prices.length >= 12) {
        break;
      }
    }
    if (prices.length >= 12) {
      break;
    }
  }

  const yearMatch = YEAR_PATTERN.exec(sourceText);
  const weightMatch = WEIGHT_PATTERN.exec(sourceText);
  const weightRaw = weightMatch ? Number(weightMatch[1]) : null;
  const weightUnit = weightMatch?.[2]?.toLowerCase() ?? null;
  const weightG =
    weightRaw !== null && Number.isFinite(weightRaw)
      ? weightUnit === "公斤" || weightUnit === "kg"
        ? Math.round(weightRaw * 1000)
        : Math.round(weightRaw)
      : null;

  return webExtractionAiOutputSchema.parse({
    product_name: null,
    brand_name: null,
    year: yearMatch ? Number(yearMatch[1]) : null,
    tea_type: null,
    origin_region: null,
    mountain: null,
    village: null,
    weight_g: weightG,
    spec_notes: null,
    storage: null,
    prices,
    facts: [],
    null_reason: null
  });
}

/** 供 API 自检：确认 §41 的四条禁止换算与抽取字段表均已锁定。 */
export const WEB_EXTRACTOR_CONTRACT = {
  spec_ref: "§41 / §62-2·3·4",
  agent: "Agent 3｜网页事实抽取器",
  prompt_key: "WEB_EXTRACTOR",
  forbidden_conversions: ["整件价 → 单饼价", "挂牌 → 成交", "历史 → 当前", "口述价格 → 已验证成交"],
  null_rule: "没有写 = null"
} as const;
