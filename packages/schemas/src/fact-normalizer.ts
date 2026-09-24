import { z } from "zod";
import type { FactStatus } from "./enums.js";
import { FORBIDDEN_FABRICATION_CATEGORIES, type ForbiddenFabricationCategory } from "./forbidden-claims.js";
import { findRestrictedRndPhrases } from "./rnd.js";

/**
 * Agent 1｜产品事实整理器（规格 §39）。
 *
 * 该 Agent 只负责「整理事实」，必须严格区分：
 * confirmed_fact / tasting_fact / rnd_fact / user_opinion / inference / missing；
 * 不得自动补树龄、配方比例、年份、山头、获奖、大师、历史、产量、市场价格。
 *
 * 实现约束（对应规格 §58-1～5 与 §62-5/6/7/8）：
 * 1. AI 输出的每一条 value 必须能在源文本中逐字回溯，否则整条丢弃；
 * 2. 命中禁止虚构类型（树龄 / 山头 / 获奖 / 大师 / 比例 / 研发关系等）且源文本中不存在时，标记 FORBIDDEN_FABRICATION；
 * 3. rnd_fact 必须自带证据说明，否则不得成立（禁止自动编研发关系）；
 * 4. AI 永远不能把事实状态提升到 OFFICIAL_CONFIRMED。
 */

export const factNormalizationCategories = [
  "confirmed_fact",
  "tasting_fact",
  "rnd_fact",
  "user_opinion",
  "inference",
  "missing"
] as const;
export type FactNormalizationCategory = (typeof factNormalizationCategories)[number];

/** 六个分类到 §11 事实状态的映射：AI 不得把任何条目提升为 OFFICIAL_CONFIRMED。 */
export const FACT_NORMALIZATION_CATEGORY_STATUS: Record<FactNormalizationCategory, FactStatus | null> = {
  confirmed_fact: "INTERNAL_CONFIRMED",
  tasting_fact: "TASTING_CONFIRMED",
  rnd_fact: "RND_CONFIRMED",
  user_opinion: "UNCONFIRMED",
  inference: "UNCONFIRMED",
  missing: null
};

const optionalText = z.string().trim().max(2000).nullable().optional();

export const factNormalizationItemSchema = z
  .object({
    /** 事实键（如 tree_age）或字段路径（如 感官.汤香） */
    field: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(2000),
    evidence_note: optionalText,
    source_text: optionalText
  })
  .strict();
export type FactNormalizationItem = z.infer<typeof factNormalizationItemSchema>;

export const factNormalizationMissingItemSchema = z
  .object({
    field: z.string().trim().min(1).max(120),
    reason: optionalText
  })
  .strict();
export type FactNormalizationMissingItem = z.infer<typeof factNormalizationMissingItemSchema>;

export const factNormalizerAiOutputSchema = z
  .object({
    confirmed_facts: z.array(factNormalizationItemSchema).default([]),
    tasting_facts: z.array(factNormalizationItemSchema).default([]),
    rnd_facts: z.array(factNormalizationItemSchema).default([]),
    user_opinions: z.array(factNormalizationItemSchema).default([]),
    inferences: z.array(factNormalizationItemSchema).default([]),
    missing: z.array(factNormalizationMissingItemSchema).default([])
  })
  .strict();
export type FactNormalizerAiOutput = z.infer<typeof factNormalizerAiOutputSchema>;

export type FactNormalizationDropReason =
  | "NOT_TRACEABLE_VALUE"
  | "FORBIDDEN_FABRICATION"
  | "RND_REQUIRES_EVIDENCE";

export interface FactNormalizationDrop {
  category: FactNormalizationCategory;
  field: string;
  value: string;
  reason: FactNormalizationDropReason;
  details: string[];
}

export interface FactNormalizationResult {
  output: FactNormalizerAiOutput;
  dropped: FactNormalizationDrop[];
  warnings: string[];
}

/** 禁止自动补全的硬事实类型 → 中文说明（与 §3 / §62 一致）。 */
export const FORBIDDEN_AUTO_FILL_LABELS: Record<ForbiddenFabricationCategory, string> = {
  year: "年份",
  tree_age: "树龄",
  mountain: "山头",
  raw_material: "原料",
  formula_ratio: "配方比例",
  rnd_relationship: "研发关系",
  brand_history: "品牌历史",
  transaction_price: "成交价格",
  award: "获奖",
  output_volume: "产量",
  master: "大师",
  celebrity: "名人",
  secret_recipe: "秘方",
  scarcity_quantity: "稀缺数量"
};

interface ForbiddenPattern {
  readonly category: ForbiddenFabricationCategory;
  readonly pattern: RegExp;
}

/**
 * 硬事实识别模式：只在「源文本里不存在该表述」时才判定为虚构，
 * 因此「输入里有的班章 / 2026 年」不会被误杀（规格 §58-2）。
 */
const FORBIDDEN_HARD_FACT_PATTERNS: readonly ForbiddenPattern[] = [
  { category: "tree_age", pattern: /\d{2,4}\s*年\s*(古树|大树|老树|乔木)|(百年|千年)\s*(古树|老树)|树龄\s*\d{2,4}/ },
  { category: "mountain", pattern: /班章|冰岛|易武|昔归|薄荷塘|曼松|刮风寨|曼糯|那卡/ },
  { category: "award", pattern: /获奖|金奖|银奖|一等奖|特等奖|评比第一/ },
  { category: "master", pattern: /大师|非遗传承人|监制|亲制/ },
  { category: "brand_history", pattern: /(始于|创立于|源自|前身是)\s*\d{3,4}\s*年/ },
  { category: "output_volume", pattern: /(产量|发行量|限量|仅生产)\s*\d+/ },
  { category: "scarcity_quantity", pattern: /全球仅|仅存\s*\d+|存世不足\s*\d+/ },
  { category: "formula_ratio", pattern: /\d{1,3}\s*%\s*(原料|料|拼配|芽|叶)?|\d{1,2}\s*[:：]\s*\d{1,2}\s*(配比|比例)/ },
  { category: "rnd_relationship", pattern: /复刻|同款配方|原配方再现|某大师配方|经典秘方|按照.*配方做/ },
  { category: "celebrity", pattern: /明星|名人|大师签名/ }
];

/**
 * 文本可回溯比较用的归一化：忽略空白、常见中英文标点与大小写。
 * 事实归一（§39）、Value DNA 可回溯过滤（§62-8）与网页抽取（§41）必须共用同一套规则，
 * 否则同一句话在不同环节会被判定成「能回溯 / 不能回溯」两种结果。
 */
export function normalizeTraceabilityText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s,，、·・\-—_/|()（）【】[\]「」《》:：；;。.!！?？"'“”‘’]/g, "");
}

/** 找出「源文本中不存在」的禁止虚构类型。 */
export function findForbiddenFabrications(
  value: string,
  corpusText: string
): ForbiddenFabricationCategory[] {
  const corpus = normalizeTraceabilityText(corpusText);
  const hits: ForbiddenFabricationCategory[] = [];
  for (const rule of FORBIDDEN_HARD_FACT_PATTERNS) {
    const match = rule.pattern.exec(value);
    if (!match) {
      continue;
    }
    if (corpus.includes(normalizeTraceabilityText(match[0]))) {
      continue;
    }
    if (!hits.includes(rule.category)) {
      hits.push(rule.category);
    }
  }
  return hits;
}

function valueIsTraceable(value: string, corpusText: string): boolean {
  return normalizeTraceabilityText(corpusText).includes(normalizeTraceabilityText(value));
}

const VALUE_SECTIONS = [
  "confirmed_facts",
  "tasting_facts",
  "rnd_facts",
  "user_opinions",
  "inferences"
] as const;

/**
 * 事实归一结果的净化器：不通过校验的条目直接丢弃并记录原因，
 * 绝不把不可回溯或禁止虚构的内容写进事实清单。
 */
export function sanitizeFactNormalization(
  output: FactNormalizerAiOutput,
  corpusText: string
): FactNormalizationResult {
  const sanitized: FactNormalizerAiOutput = {
    confirmed_facts: [],
    tasting_facts: [],
    rnd_facts: [],
    user_opinions: [],
    inferences: [],
    missing: [...output.missing]
  };
  const dropped: FactNormalizationDrop[] = [];

  for (const section of VALUE_SECTIONS) {
    const category = section.replace(/s$/, "") as FactNormalizationCategory;
    for (const item of output[section]) {
      // 先判禁止虚构类型（原因更具体），再判可回溯性。
      const forbidden = findForbiddenFabrications(item.value, corpusText);
      if (forbidden.length > 0) {
        dropped.push({
          category,
          field: item.field,
          value: item.value,
          reason: "FORBIDDEN_FABRICATION",
          details: forbidden.map((key) => FORBIDDEN_AUTO_FILL_LABELS[key])
        });
        continue;
      }
      if (!valueIsTraceable(item.value, corpusText)) {
        dropped.push({
          category,
          field: item.field,
          value: item.value,
          reason: "NOT_TRACEABLE_VALUE",
          details: ["源文本中找不到该表述，禁止作为事实使用"]
        });
        continue;
      }
      if (section === "rnd_facts") {
        const note = item.evidence_note?.trim() ?? "";
        if (note.length === 0) {
          dropped.push({
            category,
            field: item.field,
            value: item.value,
            reason: "RND_REQUIRES_EVIDENCE",
            details: [
              "研发关系必须提供 RND_CONFIRMED 证据，禁止自动编造",
              ...findRestrictedRndPhrases(item.value)
            ]
          });
          continue;
        }
      }
      sanitized[section].push(item);
    }
  }

  const warnings = summarizeDrops(dropped);
  return { output: sanitized, dropped, warnings };
}

function summarizeDrops(dropped: readonly FactNormalizationDrop[]): string[] {
  const warnings: string[] = [];
  const forbidden = dropped.filter((drop) => drop.reason === "FORBIDDEN_FABRICATION");
  if (forbidden.length > 0) {
    warnings.push(
      `AI 试图补出输入中没有的硬事实，已丢弃 ${forbidden.length} 条：${[
        ...new Set(forbidden.flatMap((drop) => drop.details))
      ].join("、")}`
    );
  }
  const untraceable = dropped.filter((drop) => drop.reason === "NOT_TRACEABLE_VALUE");
  if (untraceable.length > 0) {
    warnings.push(`AI 输出了 ${untraceable.length} 条无法在源文本回溯的内容，已丢弃`);
  }
  const rnd = dropped.filter((drop) => drop.reason === "RND_REQUIRES_EVIDENCE");
  if (rnd.length > 0) {
    warnings.push(`AI 输出了 ${rnd.length} 条缺少研发证据的研发关系，已丢弃`);
  }
  return warnings;
}

export interface FactNormalizationCandidate {
  category: FactNormalizationCategory;
  fact_status: FactStatus | null;
  field: string;
  value: string;
  evidence_note: string | null;
}

/**
 * 把净化后的结果展开成「待人工确认的事实候选」。
 * missing 不产生候选，inference / user_opinion 一律以 UNCONFIRMED 呈现。
 */
export function factNormalizationCandidates(
  output: FactNormalizerAiOutput
): FactNormalizationCandidate[] {
  const candidates: FactNormalizationCandidate[] = [];
  for (const section of VALUE_SECTIONS) {
    const category = section.replace(/s$/, "") as FactNormalizationCategory;
    const status = FACT_NORMALIZATION_CATEGORY_STATUS[category];
    for (const item of output[section]) {
      candidates.push({
        category,
        fact_status: status,
        field: item.field,
        value: item.value,
        evidence_note: item.evidence_note ?? null
      });
    }
  }
  return candidates;
}

/** 供 API 自检：确认 §39 的六个分类与三处红线清单均已注册。 */
export const FACT_NORMALIZER_CONTRACT = {
  categories: factNormalizationCategories,
  forbidden_categories: FORBIDDEN_FABRICATION_CATEGORIES,
  needs_evidence: ["rnd_fact"] as const
} as const;
