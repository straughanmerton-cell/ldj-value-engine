import type { AiProvider } from "@ldj/ai";
import type { Database } from "@ldj/database";
import {
  FACT_KEY_CATALOG,
  factNormalizationCandidates,
  factNormalizerAiOutputSchema,
  filterValueDnaTraceability,
  findFactKeyDefinition,
  isValueDnaStale,
  mergeValueDna,
  sanitizeFactNormalization,
  SENSORY_FIELDS,
  valueDnaAiOutputSchema,
  valueDnaToCorpus,
  type FactNormalizationCandidate,
  type FactNormalizationDrop,
  type FactNormalizerAiOutput,
  type FactNormalizeRequest,
  type ValueDna,
  type ValueDnaGenerateRequest,
  type ValueDnaMeta
} from "@ldj/schemas";
import {
  buildValueDna,
  buildValueDnaMeta,
  loadValueDnaSources,
  saveValueDna,
  type ValueDnaCounts,
  type ValueDnaSources
} from "../../lib/value-dna.js";
import type { ActivePromptSource } from "../prompts/service.js";

/**
 * Value DNA（规格 §9）+ Agent 1 事实归一（规格 §39）。
 *
 * 两条红线在这里落地：
 * 1. 规则引擎先跑：DNA 只能由「已录入字段 / 事实 / 品饮档案 / 研发参考」推导，不在库里的硬事实一律不出现；
 * 2. AI 只能补充「源文本可逐字回溯」的条目，其余直接丢弃并记入 warnings（§58-1/2/3/5、§62-5/6/7/8）。
 */

export interface ValueDnaResponse {
  product_id: string;
  /** 库中是否已有落库的 DNA（§9 要求产品创建后自动生成，因此正常为 true） */
  stored: boolean;
  value_dna: ValueDna;
  meta: ValueDnaMeta | null;
  stale: boolean;
  missing_dimensions: string[];
  warnings: string[];
  current: ValueDnaCounts;
  spec_ref: "§9";
}

export interface FactNormalizationResponse {
  product_id: string;
  ai_used: boolean;
  prompt_key: "FACT_NORMALIZER";
  prompt_version: number | null;
  provider: string | null;
  model: string | null;
  output: FactNormalizerAiOutput;
  candidates: FactNormalizationCandidate[];
  dropped: FactNormalizationDrop[];
  warnings: string[];
  /** §39 只整理事实：该接口不写库，事实必须经人工确认后单独入库。 */
  persisted: false;
  spec_ref: "§39";
}

export class ValueDnaService {
  constructor(
    private readonly db: Database,
    private readonly ai: AiProvider,
    private readonly prompts: ActivePromptSource
  ) {}

  async get(productId: string): Promise<ValueDnaResponse> {
    const sources = await loadValueDnaSources(this.db, productId);
    const stored = sources.product.valueDna;
    const meta = sources.product.valueDnaMeta;
    const freshlyBuilt = stored ? null : buildValueDna(sources);
    const dna = stored ?? freshlyBuilt!.dna;
    return {
      product_id: productId,
      stored: Boolean(stored),
      value_dna: dna,
      meta,
      stale: meta ? isValueDnaStale(meta, sources.counts) : true,
      missing_dimensions: meta?.missing_dimensions ?? freshlyBuilt?.missingDimensions ?? [],
      warnings: meta?.warnings ?? freshlyBuilt?.warnings ?? [],
      current: sources.counts,
      spec_ref: "§9"
    };
  }

  async generate(
    productId: string,
    input: ValueDnaGenerateRequest,
    _actorId: string
  ): Promise<ValueDnaResponse> {
    const sources = await loadValueDnaSources(this.db, productId);
    const rule = buildValueDna(sources);
    const warnings: string[] = [];

    let dna = rule.dna;
    let generator: ValueDnaMeta["generator"] = "RULE_BASED";
    let promptVersion: number | null = null;
    let provider: string | null = null;
    let model: string | null = null;

    // 真实 Provider 默认带 AI 辅助；Mock Provider 默认只跑规则引擎，避免把占位文本当内容。
    const wantAi = input.use_ai ?? this.ai.name !== "mock";
    if (wantAi) {
      try {
        const active = await this.prompts.getActiveContent("FACT_NORMALIZER");
        const { data, raw } = await this.ai.generateJson({
          schema: valueDnaAiOutputSchema,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: [
                active.content,
                "",
                "附加约束（规格 §9 / §58 / §62）：只输出 {\"dna\": {...}} 的 11 个维度数组；",
                "只能收录输入里已经存在的表述，不得新增树龄、山头、年份、获奖、大师、研发关系、配方比例等硬事实。"
              ].join("\n")
            },
            {
              role: "user",
              content: JSON.stringify({
                product: sources.snapshot,
                facts: rule.input.facts ?? [],
                tasting_profiles: rule.input.tastingProfiles ?? [],
                rnd_references: rule.input.rndReferences ?? []
              })
            }
          ]
        });
        const filtered = filterValueDnaTraceability(data.dna, valueDnaToCorpus(rule.input));
        dna = mergeValueDna(rule.dna, filtered.dna);
        generator = "AI_ASSISTED";
        promptVersion = active.version;
        provider = raw.provider;
        model = raw.model;
        if (filtered.rejected.length > 0) {
          warnings.push(
            `AI 补充的 ${filtered.rejected.length} 条内容无法在源文本中回溯，已丢弃：${filtered.rejected
              .map((item) => `${item.dimension}:${item.value}`)
              .join("、")}`
          );
        }
      } catch (error) {
        warnings.push(
          `AI 辅助生成未完成，已保留规则引擎结果：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const previousVersion = sources.product.valueDnaMeta?.version ?? 0;
    const meta = buildValueDnaMeta(rule, sources.counts, {
      generator,
      promptKey: generator === "AI_ASSISTED" ? "FACT_NORMALIZER" : null,
      promptVersion,
      provider,
      model,
      version: previousVersion + 1,
      extraWarnings: warnings
    });
    await saveValueDna(this.db, productId, dna, meta);

    return {
      product_id: productId,
      stored: true,
      value_dna: dna,
      meta,
      stale: false,
      missing_dimensions: meta.missing_dimensions,
      warnings: meta.warnings,
      current: sources.counts,
      spec_ref: "§9"
    };
  }

  /**
   * Agent 1 事实归一试跑（§39）：整理已录入的内容 + 可选 AI 归类，
   * 输出六类候选与丢弃记录，但绝不落库。
   */
  async normalizeFacts(productId: string, input: FactNormalizeRequest): Promise<FactNormalizationResponse> {
    const sources = await loadValueDnaSources(this.db, productId);
    const base = classifyRecordedFacts(sources);
    const warnings: string[] = [];
    const dropped: FactNormalizationDrop[] = [];

    let output = base;
    let aiUsed = false;
    let promptVersion: number | null = null;
    let provider: string | null = null;
    let model: string | null = null;

    const wantAi = input.use_ai ?? this.ai.name !== "mock";
    if (wantAi) {
      try {
        const active = await this.prompts.getActiveContent("FACT_NORMALIZER");
        const corpus = valueDnaToCorpus({
          product: sources.snapshot,
          facts: sources.facts.map((row) => ({
            id: row.id,
            fact_key: row.factKey,
            fact_value: row.factValue,
            fact_group: row.factGroup,
            fact_status: row.factStatus
          })),
          tastingProfiles: sources.tastingProfiles.map(
            (row) => ({ ...row }) as unknown as Record<string, unknown>
          ),
          rndReferences: sources.rndReferences.map((row) => ({
            id: row.id,
            reference_product_name: row.referenceProductName,
            reference_type: row.referenceType,
            description: row.description,
            verification_status: row.verificationStatus
          }))
        });
        const { data, raw } = await this.ai.generateJson({
          schema: factNormalizerAiOutputSchema,
          temperature: 0.1,
          messages: [
            { role: "system", content: active.content },
            { role: "user", content: corpus }
          ]
        });
        const sanitized = sanitizeFactNormalization(data, corpus);
        output = mergeNormalizationOutputs(base, sanitized.output);
        dropped.push(...sanitized.dropped);
        warnings.push(...sanitized.warnings);
        aiUsed = true;
        promptVersion = active.version;
        provider = raw.provider;
        model = raw.model;
      } catch (error) {
        warnings.push(
          `AI 事实归一未完成，已回退为按录入字段分类：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      product_id: productId,
      ai_used: aiUsed,
      prompt_key: "FACT_NORMALIZER",
      prompt_version: promptVersion,
      provider,
      model,
      output,
      candidates: factNormalizationCandidates(output),
      dropped,
      warnings,
      persisted: false,
      spec_ref: "§39"
    };
  }
}

const PRICE_KEYS = new Set(["suggested_retail_price", "internal_cost"]);

/** §10 中最容易被 AI 补全的硬事实键：未提供时必须列为 missing，绝不自动生成。 */
const MISSING_FACT_KEYS = [
  "tree_type",
  "tree_age",
  "mountain",
  "season",
  "harvest_standard",
  "grade",
  "raw_material",
  "blend_description",
  "kill_green_method",
  "rolling_method",
  "drying_method",
  "pressing_method",
  "storage"
] as const;

function clean(value: unknown): string | null {
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
 * 按 §39 的六个分类整理「已经录入」的内容。
 * 这一步不调用模型，因此不会产生任何输入里没有的事实。
 */
function classifyRecordedFacts(sources: ValueDnaSources): FactNormalizerAiOutput {
  const output: FactNormalizerAiOutput = {
    confirmed_facts: [],
    tasting_facts: [],
    rnd_facts: [],
    user_opinions: [],
    inferences: [],
    missing: []
  };

  for (const definition of FACT_KEY_DEFINITIONS) {
    if (PRICE_KEYS.has(definition.key) || definition.group === "RND") {
      continue;
    }
    const value = clean(sources.snapshot[definition.key]);
    if (!value) {
      continue;
    }
    output.confirmed_facts.push({
      field: definition.key,
      value,
      evidence_note: `来源：产品录入 ${definition.label}（product.${definition.key}）`,
      source_text: `product.${definition.key}`
    });
  }

  for (const field of SENSORY_FIELDS) {
    const value = clean(sources.snapshot[field.key]);
    if (!value) {
      continue;
    }
    output.tasting_facts.push({
      field: field.key,
      value,
      evidence_note: `来源：产品录入 ${field.label}（product.${field.key}）`,
      source_text: `product.${field.key}`
    });
  }

  for (const row of sources.facts) {
    const item = {
      field: row.factKey,
      value: row.factValue,
      evidence_note: row.evidenceNote ?? `事实状态：${row.factStatus}`,
      source_text: `product_fact:${row.factKey}`
    };
    switch (row.factStatus) {
      case "TASTING_CONFIRMED":
        output.tasting_facts.push(item);
        break;
      case "RND_CONFIRMED":
        output.rnd_facts.push(item);
        break;
      case "OFFICIAL_CONFIRMED":
      case "INTERNAL_CONFIRMED":
      case "SUPPLIER_PROVIDED":
        output.confirmed_facts.push(item);
        break;
      default:
        // 录入但未确认：按用户观点呈现，不得当作已确认事实。
        output.user_opinions.push(item);
    }
  }

  for (const profile of sources.tastingProfiles) {
    for (const field of SENSORY_FIELDS) {
      const value = clean((profile as unknown as Record<string, unknown>)[toCamelField(field.key)]);
      if (!value) {
        continue;
      }
      output.tasting_facts.push({
        field: field.key,
        value,
        evidence_note: `来源：品饮档案 ${profile.id}（${field.label}）`,
        source_text: `tasting_profile:${profile.id}.${field.key}`
      });
    }
  }

  for (const row of sources.rndReferences) {
    output.rnd_facts.push({
      field: "r_and_d_reference",
      value: row.referenceProductName,
      evidence_note:
        row.evidenceNote ??
        `研发参考记录（${row.referenceType}，验证状态 ${row.verificationStatus}）：${row.description}`,
      source_text: `r_and_d_reference:${row.id}`
    });
  }

  for (const key of MISSING_FACT_KEYS) {
    const definition = findFactKeyDefinition(key);
    const hasRecordedValue = Boolean(clean(sources.snapshot[key]));
    const hasFactRecord = sources.facts.some((row) => row.factKey === key);
    if (hasRecordedValue || hasFactRecord) {
      continue;
    }
    output.missing.push({
      field: key,
      reason: `${definition?.label ?? key} 未提供：产品录入与事实清单均为空，按 §62-8 禁止自动补全`
    });
  }

  return factNormalizerAiOutputSchema.parse(output);
}

function mergeNormalizationOutputs(
  base: FactNormalizerAiOutput,
  extra: FactNormalizerAiOutput
): FactNormalizerAiOutput {
  const merged: FactNormalizerAiOutput = {
    confirmed_facts: [...base.confirmed_facts],
    tasting_facts: [...base.tasting_facts],
    rnd_facts: [...base.rnd_facts],
    user_opinions: [...base.user_opinions],
    inferences: [...base.inferences],
    missing: [...base.missing]
  };
  for (const section of ["confirmed_facts", "tasting_facts", "rnd_facts", "user_opinions", "inferences"] as const) {
    const seen = new Set(merged[section].map((item) => `${item.field}|${item.value}`));
    for (const item of extra[section]) {
      const marker = `${item.field}|${item.value}`;
      if (seen.has(marker)) {
        continue;
      }
      seen.add(marker);
      merged[section].push(item);
    }
  }
  const missingFields = new Set(merged.missing.map((item) => item.field));
  for (const item of extra.missing) {
    if (!missingFields.has(item.field)) {
      missingFields.add(item.field);
      merged.missing.push(item);
    }
  }
  return factNormalizerAiOutputSchema.parse(merged);
}

function toCamelField(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** §10.1–10.5 的字段目录项（感官字段单独走 SENSORY_FIELDS）。 */
const FACT_KEY_DEFINITIONS = FACT_KEY_CATALOG.filter((definition) => definition.group !== "SENSORY");
