import { desc, eq } from "drizzle-orm";
import type { AiProvider } from "@ldj/ai";
import type { Database, SearchPlanRow } from "@ldj/database";
import { searchPlans } from "@ldj/database";
import {
  buildSearchPlanFromValueDna,
  countSearchPlanQueries,
  mergeSearchPlans,
  sanitizeSearchPlan,
  searchPlanAiOutputSchema,
  SEARCH_PLAN_CONTRACT,
  valueDnaToCorpus,
  type SearchPlan,
  type SearchPlanGenerateRequest,
  type SearchPlanQuery,
  type SearchQueryType
} from "@ldj/schemas";
import { buildValueDna, loadValueDnaSources, saveValueDna, buildValueDnaMeta } from "../../lib/value-dna.js";
import type { ActivePromptSource } from "../prompts/service.js";

/**
 * Agent 2｜搜索策略专家（规格 §12 / §40）。
 *
 * 目标不是「直接回答谁最贵」，而是构建可比产品池 + 价格证据池。
 * 规则引擎负责打底（只用已录入字段与 Value DNA），AI 只做增量补充，
 * 且任何「输入里没有的硬事实」查询词都会被 sanitizeSearchPlan 丢弃（§58-2）。
 */

export interface SearchPlanResponse {
  product_id: string;
  stored: boolean;
  plan: SearchPlan;
  generator: string;
  dna_version: number | null;
  prompt_version: number | null;
  provider: string | null;
  model: string | null;
  dropped: { query_type: SearchQueryType; query: string; reason: string; details: string[] }[];
  warnings: string[];
  query_count: number;
  queries: SearchPlanQuery[];
  counts_by_type: Record<SearchQueryType, number>;
  stale: boolean;
  generated_at: string | null;
  spec_ref: "§12 / §40";
}

export class SearchPlanService {
  constructor(
    private readonly db: Database,
    private readonly ai: AiProvider,
    private readonly prompts: ActivePromptSource
  ) {}

  async getLatestRow(productId: string): Promise<SearchPlanRow | null> {
    const rows = await this.db
      .select()
      .from(searchPlans)
      .where(eq(searchPlans.productId, productId))
      .orderBy(desc(searchPlans.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async get(productId: string): Promise<SearchPlanResponse> {
    const sources = await loadValueDnaSources(this.db, productId);
    const row = await this.getLatestRow(productId);
    const dnaVersion = sources.product.valueDnaMeta?.version ?? null;
    if (!row) {
      const plan = this.rulePlan(sources);
      return this.toResponse(productId, plan, null, {
        stored: false,
        dnaVersion,
        warnings: ["尚未生成搜索策略：以下为按当前 Value DNA 即时推导的预览，未落库"],
        stale: true
      });
    }
    return this.toResponse(productId, row.plan, row, {
      stored: true,
      dnaVersion,
      warnings: row.warnings,
      stale: row.dnaVersion !== null && dnaVersion !== null && row.dnaVersion !== dnaVersion
    });
  }

  async generate(
    productId: string,
    input: SearchPlanGenerateRequest,
    actorId: string
  ): Promise<SearchPlanResponse> {
    const sources = await loadValueDnaSources(this.db, productId);
    const rule = buildValueDna(sources);
    // DNA 不存在时先落一次，保证搜索策略永远基于一份可追溯的 DNA（§9）。
    if (!sources.product.valueDna) {
      const meta = buildValueDnaMeta(rule, sources.counts, { generator: "RULE_BASED", version: 1 });
      await saveValueDna(this.db, productId, rule.dna, meta);
      sources.product.valueDna = rule.dna;
      sources.product.valueDnaMeta = meta;
    }

    const base = buildSearchPlanFromValueDna({
      dna: sources.product.valueDna,
      product: sources.snapshot,
      maxPerType: 12
    });
    const warnings: string[] = [];
    let plan = base;
    let generator = "RULE_BASED";
    let dropped: SearchPlanResponse["dropped"] = [];
    let promptVersion: number | null = null;
    let provider: string | null = null;
    let model: string | null = null;

    // 真实 Provider 默认带 AI 辅助；Mock Provider 默认只跑规则引擎（§63-7 不阻塞开发）。
    const wantAi = input.use_ai ?? this.ai.name !== "mock";
    if (wantAi) {
      try {
        const active = await this.prompts.getActiveContent("SEARCH_PLANNER");
        const { data, raw } = await this.ai.generateJson({
          schema: searchPlanAiOutputSchema,
          temperature: 0.3,
          messages: [
            {
              role: "system",
              content: [
                active.content,
                "",
                "附加约束（规格 §12 / §58-2 / §62-8）：只输出 9 个查询数组；",
                "查询词里不得出现输入中没有的班章、古树、树龄、获奖、大师、配方比例等硬事实。"
              ].join("\n")
            },
            {
              role: "user",
              content: JSON.stringify({
                value_dna: sources.product.valueDna,
                product: sources.snapshot,
                rule_based_plan: base
              })
            }
          ]
        });
        const sanitized = sanitizeSearchPlan(data, valueDnaToCorpus(rule.input));
        plan = mergeSearchPlans(base, sanitized.plan);
        dropped = sanitized.dropped;
        generator = "AI_ASSISTED";
        promptVersion = active.version;
        provider = raw.provider;
        model = raw.model;
        if (sanitized.dropped.length > 0) {
          warnings.push(
            `AI 搜索策略中 ${sanitized.dropped.length} 条查询凭空出现输入里没有的硬事实，已丢弃`
          );
        }
      } catch (error) {
        warnings.push(
          `AI 搜索策略未完成，已保留规则引擎结果：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    const inserted = await this.db
      .insert(searchPlans)
      .values({
        productId,
        dnaVersion: sources.product.valueDnaMeta?.version ?? null,
        plan,
        queryCount: countSearchPlanQueries(plan),
        generator,
        dropped: dropped as unknown as Record<string, unknown>[],
        warnings,
        promptVersion,
        provider,
        model,
        createdBy: actorId
      })
      .returning();

    return this.toResponse(productId, plan, inserted[0] ?? null, {
      stored: true,
      dnaVersion: sources.product.valueDnaMeta?.version ?? null,
      warnings,
      stale: false
    });
  }

  private rulePlan(sources: Awaited<ReturnType<typeof loadValueDnaSources>>): SearchPlan {
    const built = buildValueDna(sources);
    return buildSearchPlanFromValueDna({
      dna: built.dna,
      product: sources.snapshot,
      maxPerType: 12
    });
  }

  private toResponse(
    productId: string,
    plan: SearchPlan,
    row: SearchPlanRow | null,
    extra: { stored: boolean; dnaVersion: number | null; warnings: string[]; stale: boolean }
  ): SearchPlanResponse {
    const queries = SEARCH_PLAN_CONTRACT.query_types.flatMap((type) =>
      plan[type].map((query) => ({ query_type: type, query }))
    );
    return {
      product_id: productId,
      stored: extra.stored,
      plan,
      generator: row?.generator ?? "RULE_BASED",
      dna_version: row?.dnaVersion ?? extra.dnaVersion,
      prompt_version: row?.promptVersion ?? null,
      provider: row?.provider ?? null,
      model: row?.model ?? null,
      dropped: (row?.dropped ?? []) as SearchPlanResponse["dropped"],
      warnings: extra.warnings,
      query_count: countSearchPlanQueries(plan),
      queries,
      counts_by_type: SEARCH_PLAN_CONTRACT.query_types.reduce(
        (accumulator, type) => ({ ...accumulator, [type]: plan[type].length }),
        {} as Record<SearchQueryType, number>
      ),
      stale: extra.stale,
      generated_at: row?.createdAt ? row.createdAt.toISOString() : null,
      spec_ref: "§12 / §40"
    };
  }
}
