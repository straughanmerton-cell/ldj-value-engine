import { z } from "zod";
import {
  researchJobStatusSchema,
  researchStages,
  researchStageSchema,
  type ResearchStage
} from "./enums.js";

/**
 * 研究流水线与进度（规格 §55 Research Pipeline / §56 研究进度 UI）。
 *
 * §56 要求进度 UI 逐阶段展示完成状态，并显式提示：
 * 有锚点 → 进入高价值对标模式；没有锚点 → 切换自建高端标准模式。
 * 因此阶段清单必须与 §55 的流水线一一对应，缺一不可（否则等于裁掉核心功能）。
 */

export const researchStageStates = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] as const;
export const researchStageStateSchema = z.enum(researchStageStates);
export type ResearchStageState = z.infer<typeof researchStageStateSchema>;

export const researchStageProgressSchema = z
  .object({
    stage: researchStageSchema,
    status: researchStageStateSchema,
    started_at: z.string().nullable().optional(),
    finished_at: z.string().nullable().optional(),
    message: z.string().max(4000).nullable().optional(),
    /** 该阶段的产出摘要（数量、来源、命中规则等），只存摘要不存业务事实 */
    detail: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .strict();
export type ResearchStageProgress = z.infer<typeof researchStageProgressSchema>;

export const researchProgressSchema = z.array(researchStageProgressSchema);
export type ResearchProgress = z.infer<typeof researchProgressSchema>;

/** 每个阶段属于哪个 Phase，用于「未交付阶段」的显式占位，避免进度 UI 说谎。 */
export const RESEARCH_STAGE_PHASE: Record<ResearchStage, number> = {
  FACT_NORMALIZE: 3,
  VALUE_DNA: 3,
  PRODUCT_ARCHITECTURE_SEED: 10,
  SEARCH_PLAN: 4,
  WEB_SEARCH: 4,
  SOURCE_FETCH: 4,
  ENTITY_EXTRACT: 4,
  CANDIDATE_POOL: 5,
  SIMILARITY_SCORE: 5,
  PRICE_SEARCH: 6,
  PRICE_EVIDENCE: 6,
  OUTLIER_DETECTION: 6,
  ANCHOR_BUILD: 7,
  VALUE_CODES: 9,
  VALUE_MAPPING: 9,
  PRODUCT_ARCHITECTURE: 10,
  FORMULA_PHILOSOPHY: 11,
  SALES_COPY: 12,
  IMPACT_SCORE: 12,
  INTENSIFY: 13,
  FACT_REVIEW: 14,
  HUMAN_APPROVAL: 14
};

/** §56 进度 UI 的中文阶段名（顺序与 §55 流水线一致）。 */
export const RESEARCH_STAGE_LABELS: Record<ResearchStage, string> = {
  FACT_NORMALIZE: "产品事实整理",
  VALUE_DNA: "价值DNA生成",
  PRODUCT_ARCHITECTURE_SEED: "产品结构种子分析",
  SEARCH_PLAN: "搜索策略生成",
  WEB_SEARCH: "全网候选搜索",
  SOURCE_FETCH: "来源抓取",
  ENTITY_EXTRACT: "网页事实抽取",
  CANDIDATE_POOL: "候选池去重",
  SIMILARITY_SCORE: "可比性评分",
  PRICE_SEARCH: "市场价格搜索",
  PRICE_EVIDENCE: "价格证据验证",
  OUTLIER_DETECTION: "价格异常值检测",
  ANCHOR_BUILD: "高价值锚点构建",
  VALUE_CODES: "Value Codes 分析",
  VALUE_MAPPING: "龙德记价值映射",
  PRODUCT_ARCHITECTURE: "产品结构叙事",
  FORMULA_PHILOSOPHY: "配方哲学",
  SALES_COPY: "强成交话术生成",
  IMPACT_SCORE: "成交冲击力评分",
  INTENSIFY: "牛逼化强化",
  FACT_REVIEW: "事实审核",
  HUMAN_APPROVAL: "人工审批"
};

/** 两种成交模式在进度 UI 中的说明（§56 的两个分支）。 */
export const RESEARCH_MODE_STAGE_NOTES = {
  BENCHMARK: "有可靠锚点：进入高价值对标模式（Benchmark Mode）",
  CATEGORY_CREATOR: "没有可靠锚点：强制切换自建高端标准模式（Category Creator Mode）"
} as const;

export function emptyResearchProgress(): ResearchProgress {
  return researchStages.map((stage) =>
    researchStageProgressSchema.parse({
      stage,
      status: "PENDING",
      started_at: null,
      finished_at: null,
      message: null,
      detail: null
    })
  );
}

export interface ResearchProgressView extends ResearchStageProgress {
  label: string;
  phase: number;
  /** 该阶段是否已交付（未交付阶段必须显式标注 Phase，不得显示为已完成） */
  implemented: boolean;
}

export function researchProgressView(
  progress: ResearchProgress,
  implementedPhases: readonly number[]
): ResearchProgressView[] {
  return progress.map((item) => ({
    ...item,
    label: RESEARCH_STAGE_LABELS[item.stage],
    phase: RESEARCH_STAGE_PHASE[item.stage],
    implemented: implementedPhases.includes(RESEARCH_STAGE_PHASE[item.stage])
  }));
}

export function researchProgressSummary(progress: ResearchProgress): {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  pending: number;
  current_stage: ResearchStage | null;
  percent: number;
} {
  const succeeded = progress.filter((item) => item.status === "SUCCEEDED").length;
  const failed = progress.filter((item) => item.status === "FAILED").length;
  const running = progress.filter((item) => item.status === "RUNNING").length;
  const pending = progress.filter((item) => item.status === "PENDING").length;
  const current = progress.find((item) => item.status === "RUNNING") ?? null;
  return {
    total: progress.length,
    succeeded,
    failed,
    running,
    pending,
    current_stage: current?.stage ?? null,
    percent: progress.length === 0 ? 0 : Math.round((succeeded / progress.length) * 100)
  };
}

export const researchRunRequestSchema = z
  .object({
    use_ai: z.boolean().optional(),
    /** 本轮最多执行多少条搜索查询（默认 18，避免一次跑爆） */
    max_queries: z.number().int().min(1).max(60).optional(),
    /** 每条查询最多取多少条结果（默认 6） */
    max_results_per_query: z.number().int().min(1).max(20).optional(),
    /** 单次运行最多抓取多少条来源（默认 8） */
    max_sources: z.number().int().min(0).max(50).optional(),
    /** 抓取后是否立即调用 Agent 3 抽取 */
    auto_extract: z.boolean().optional(),
    /** 是否重新生成搜索策略（默认复用当前版本） */
    regenerate_plan: z.boolean().optional()
  })
  .strict();
export type ResearchRunRequest = z.infer<typeof researchRunRequestSchema>;

export const researchJobSchema = z
  .object({
    id: z.string(),
    product_id: z.string(),
    status: researchJobStatusSchema,
    current_stage: researchStageSchema.nullable(),
    started_at: z.string(),
    finished_at: z.string().nullable(),
    error: z.string().nullable(),
    progress: researchProgressSchema
  })
  .strict();
export type ResearchJobView = z.infer<typeof researchJobSchema>;

/** 供 API 自检：确认 §55 流水线的 22 个阶段全部登记。 */
export const RESEARCH_PIPELINE_CONTRACT = {
  spec_ref: "§55 / §56",
  stages: researchStages,
  labels: RESEARCH_STAGE_LABELS,
  mode_notes: RESEARCH_MODE_STAGE_NOTES
} as const;
