import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api.js";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  type AnchorResolveSource,
  type ResolvedMode
} from "./anchors.js";
import { formatDateTime } from "./category-creator.js";

/**
 * Phase 11 配方哲学（规格 §6 Formula Philosophy / §46 Agent 8 / §57 验收 / §6.1 比例红线）。
 *
 * 与产品结构同理：**口径全部来自后端**，前端只负责把「这款茶为什么这么设计」摊开。
 * 三条必须在界面上说清的规则：
 * 1. §6.1：没有确切比例时绝对不编比例——正文里连比例字样都不许出现；
 * 2. §46：没有某个原料时绝对不新增原料——分量正文只能引用本产品已录入字段与 Value DNA；
 * 3. §6.2 / §57：就算没有比例，也必须写得清「先定骨架、再定香气、再定回甘」的设计逻辑。
 */

export type FormulaComponentKey = "backbone" | "aroma" | "sweetness" | "body" | "finish";
export type FormulaComponentStatus = "WRITTEN" | "GAP";
export type FormulaPhilosophySort =
  | "-updated_at"
  | "updated_at"
  | "product_name"
  | "-product_name"
  | "-written_components"
  | "-gap_components";

export {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  formatDateTime
};
export type { ResolvedMode, AnchorResolveSource };

/** §6.3 固定的五个分量与顺序，前端不得重排。 */
export const FORMULA_COMPONENT_ORDER: FormulaComponentKey[] = [
  "backbone",
  "aroma",
  "sweetness",
  "body",
  "finish"
];

/** §46 Agent 8 必须输出的五项，展示时优先使用 `/labels` 返回值。 */
export const FORMULA_AGENT8_OUTPUT_KEYS = [
  "formula_strategy",
  "ingredient_roles",
  "taste_roles",
  "design_goal",
  "sales_explanation"
];

/** 兜底文案：与后端 `FORMULA_COMPONENT_META` 同口径，优先使用 `/labels` 返回值。 */
export const FORMULA_COMPONENT_FALLBACK_LABELS: Record<FormulaComponentKey, string> = {
  backbone: "骨架分量 Backbone Component",
  aroma: "香气分量 Aroma Component",
  sweetness: "回甘分量 Sweetness Component",
  body: "汤感分量 Body Component",
  finish: "收口分量 Finish Component"
};

export const FORMULA_COMPONENT_FALLBACK_SHORT_LABELS: Record<FormulaComponentKey, string> = {
  backbone: "骨架",
  aroma: "香气",
  sweetness: "回甘",
  body: "汤感",
  finish: "收口"
};

export const FORMULA_COMPONENT_STATUS_LABELS: Record<FormulaComponentStatus, string> = {
  WRITTEN: "已写实",
  GAP: "事实不足（留空）"
};

export const FORMULA_COMPONENT_STATUS_TONES: Record<FormulaComponentStatus, "ok" | "danger"> = {
  WRITTEN: "ok",
  GAP: "danger"
};

export const FORMULA_PHILOSOPHY_SORT_LABELS: Record<FormulaPhilosophySort, string> = {
  "-updated_at": "最近生成优先",
  updated_at: "最久未生成优先",
  product_name: "产品名 A→Z",
  "-product_name": "产品名 Z→A",
  "-written_components": "写实分量最多优先",
  "-gap_components": "缺口最多优先"
};

/** §6.1：比例来源只有两种合法出处，界面必须写明，不能只说「有配比」。 */
export const FORMULA_RATIO_SOURCE_LABELS: Record<string, string> = {
  REQUEST: "产品负责人登记",
  BLEND_DESCRIPTION: "已录入的拼配描述"
};

/* ------------------------------------------------------------ 后端对象 */

export interface FormulaComponentView {
  key: FormulaComponentKey;
  label: string;
  short_label: string;
  storage_field: string;
  definition: string;
  requirement: string;
  /** 这个分量主要喂给 §46 的哪一项输出 */
  agent8_output: string;
  /** §6.3 的 JSONB 数组：一条正文对应一条已录入事实；GAP 分量为空数组 */
  texts: string[];
  status: FormulaComponentStatus;
  layer: "INTERPRETATION";
  evidence_refs: string[];
  /** 引用的已录入事实原文（ref=value），可逐条对照 */
  citations: string[];
  gap: string | null;
  spec_ref: string;
}

export interface FormulaComponentCounts {
  written: number;
  gap: number;
}

export interface FormulaIngredientRole {
  ingredient: string;
  role: string;
  component: FormulaComponentKey;
  evidence_ref: string;
  spec_ref: "§46";
}

export interface FormulaTasteRole {
  taste: string;
  role: string;
  component: FormulaComponentKey;
  evidence_ref: string;
  spec_ref: "§46";
}

export interface FormulaRatio {
  known_ratio: boolean;
  ratio_data: Record<string, string> | null;
  ratio_evidence: string[];
  ratio_source: string | null;
  spec_ref: "§6.1";
}

export interface FormulaPhilosophyAcceptance {
  spec_ref: "§57";
  question: string;
  design_logic_ready: boolean;
  /** 没有确认比例时，正文里是否一个比例字样都没有 */
  no_fabricated_ratio: boolean;
  written_components: number;
  required_min_components: number;
  /** 五个分量是否全部写实（覆盖度，不参与 §57 通过判定） */
  coverage_passed: boolean;
  passed: boolean;
}

export interface FormulaPhilosophyRecordView {
  id: string;
  product_id: string;
  product_name?: string | null;
  version: number;
  preference: "AUTO" | ResolvedMode;
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  components: FormulaComponentView[];
  /** §35.4 存储形状：五个数组 + formula_strategy + design_goal + known_ratio */
  formula: {
    formula_strategy: string;
    backbone_component: string[];
    aroma_component: string[];
    sweetness_component: string[];
    body_component: string[];
    finish_component: string[];
    design_goal: string;
    known_ratio: boolean;
    ratio_data: Record<string, string | number> | null;
  };
  /** §46 formula_strategy（设计逻辑正文）；不足 2 个写实分量时为 "" */
  formula_strategy: string;
  ingredient_roles: FormulaIngredientRole[];
  taste_roles: FormulaTasteRole[];
  design_goal: string;
  sales_explanation: string;
  ratio: FormulaRatio;
  component_counts: FormulaComponentCounts;
  acceptance: FormulaPhilosophyAcceptance;
  design_logic_ready: boolean;
  architecture_version: number | null;
  architecture_acceptance_passed: boolean | null;
  evidence_gaps: string[];
  evidence_refs: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  downstream: FormulaPhilosophyDownstreamItem[];
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  spec_ref: "§6 / §46";
}

export interface FormulaPhilosophyVersionSummary {
  id: string;
  version: number;
  written_components: number;
  texts_total: number;
  known_ratio: boolean;
  design_logic_ready: boolean;
  acceptance_passed: boolean;
  is_confirmed: boolean;
  created_at: string;
}

export interface FormulaPhilosophyArchitectureRef {
  version: number;
  written_roles: number;
  acceptance_passed: boolean;
}

export interface FormulaPhilosophyOverview {
  product_id: string;
  product_name?: string | null;
  preference: "AUTO" | ResolvedMode;
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  can_generate: boolean;
  block_reason: string | null;
  record: FormulaPhilosophyRecordView | null;
  versions: FormulaPhilosophyVersionSummary[];
  /** 还没写实的分量（用于排产） */
  missing_components: FormulaComponentKey[];
  /** Phase 10 产品结构：配方哲学的输入，未生成时提示先跑产品结构 */
  architecture: FormulaPhilosophyArchitectureRef | null;
  spec_ref: "§6 / §46";
}

export interface FormulaPhilosophyMatrixRow {
  product_id: string;
  product_name: string;
  year: number;
  tea_type: string;
  mountain: string | null;
  mode: ResolvedMode;
  preference: "AUTO" | ResolvedMode;
  record_id: string | null;
  version: number | null;
  is_confirmed: boolean;
  written_components: number;
  gap_components: number;
  texts_total: number;
  known_ratio: boolean;
  design_logic_ready: boolean;
  acceptance_passed: boolean;
  /** 设计逻辑正文（未生成时为 null） */
  formula_strategy: string | null;
  generated_at: string | null;
  spec_ref: "§6 / §46";
}

export interface FormulaPhilosophyLibraryResponse {
  items: FormulaPhilosophyMatrixRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface FormulaComponentMeta {
  key: FormulaComponentKey;
  label: string;
  short_label: string;
  storage_field: string;
  definition: string;
  requirement: string;
  agent8_output: string;
  evidence_refs: string[];
  spec_ref: string;
}

export interface FormulaAgent8Output {
  key: string;
  layer: "INTERPRETATION" | "RHETORIC";
  meaning: string;
  storage: string;
  spec_ref: string;
}

export interface FormulaPhilosophyDownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  /** 恒为 PENDING：本阶段只登记交接，不得显示为已完成（§60） */
  status: "PENDING";
}

export interface FormulaPhilosophyContract {
  spec_ref: string;
  component_count: number;
  components: FormulaComponentMeta[];
  agent8_outputs: FormulaAgent8Output[];
  acceptance: {
    spec_ref: string;
    question: string;
    min_written_components: number;
  };
  limits: {
    maxVersionsPerProduct: number;
    minWrittenComponentsForStrategy: number;
    maxDnaRefsPerComponent: number;
    maxRatioEntries: number;
    defaultPageSize: number;
    maxPageSize: number;
  };
  no_fabricated_ratio: boolean;
  no_new_ingredient: boolean;
  design_logic_without_ratio: boolean;
  gap_stays_empty: boolean;
  evidence_only_from_own_product: boolean;
  rhetoric_allowed_for_roles_only: boolean;
  sales_tone_allowed: boolean;
  downstream_phases: FormulaPhilosophyDownstreamItem[];
  rules: string[];
}

export interface FormulaPhilosophyEngineInfo {
  spec_ref: string;
  component_count: number;
  limits: FormulaPhilosophyContract["limits"];
  acceptance_question: string;
  agent8_outputs: FormulaAgent8Output[];
  no_fabricated_ratio: boolean;
  no_new_ingredient: boolean;
  design_logic_without_ratio: boolean;
  gap_stays_empty: boolean;
  evidence_only_from_own_product: boolean;
  rhetoric_allowed_for_roles_only: boolean;
  note: string;
}

export interface FormulaPhilosophyLabels {
  components: FormulaComponentMeta[];
  agent8_outputs: FormulaAgent8Output[];
  acceptance: FormulaPhilosophyContract["acceptance"];
  limits: FormulaPhilosophyContract["limits"];
  rules: string[];
  component_status_labels: Record<FormulaComponentStatus, string>;
  component_status_tones: Record<FormulaComponentStatus, "ok" | "danger">;
}

export interface FormulaPhilosophyContractResponse {
  contract: FormulaPhilosophyContract;
  engine: FormulaPhilosophyEngineInfo;
  downstream: FormulaPhilosophyDownstreamItem[];
}

/* ------------------------------------------------------------ 展示辅助 */

export function componentMeta(
  key: FormulaComponentKey,
  labels: FormulaPhilosophyLabels | null
): FormulaComponentMeta | null {
  return labels?.components.find((item) => item.key === key) ?? null;
}

export function componentLabel(
  key: FormulaComponentKey,
  labels: FormulaPhilosophyLabels | null
): string {
  return componentMeta(key, labels)?.label ?? FORMULA_COMPONENT_FALLBACK_LABELS[key];
}

export function componentShortLabel(
  key: FormulaComponentKey,
  labels: FormulaPhilosophyLabels | null
): string {
  return (
    componentMeta(key, labels)?.short_label ?? FORMULA_COMPONENT_FALLBACK_SHORT_LABELS[key]
  );
}

export function componentStatusLabel(
  status: FormulaComponentStatus,
  labels: FormulaPhilosophyLabels | null
): string {
  return labels?.component_status_labels[status] ?? FORMULA_COMPONENT_STATUS_LABELS[status];
}

export function componentStatusTone(
  status: FormulaComponentStatus,
  labels: FormulaPhilosophyLabels | null
): "ok" | "danger" {
  return labels?.component_status_tones[status] ?? FORMULA_COMPONENT_STATUS_TONES[status];
}

export function ratioSourceLabel(source: string | null): string {
  if (!source) {
    return "未确认比例";
  }
  return FORMULA_RATIO_SOURCE_LABELS[source] ?? source;
}

/** 未生成的记录（矩阵行没有 record_id）在界面上统一按「未生成」而不是「零分量」呈现。 */
export function isGenerated(row: FormulaPhilosophyMatrixRow): boolean {
  return row.record_id !== null;
}

/* ------------------------------------------------------------ 数据钩子 */

/** 合同自检：五个分量、§46 五项输出与 §6.1 红线全部按后端口径渲染。 */
export function useFormulaPhilosophyContract(token: string | null): {
  contract: FormulaPhilosophyContract | null;
  engine: FormulaPhilosophyEngineInfo | null;
  downstream: FormulaPhilosophyDownstreamItem[];
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<FormulaPhilosophyContract | null>(null);
  const [engine, setEngine] = useState<FormulaPhilosophyEngineInfo | null>(null);
  const [downstream, setDownstream] = useState<FormulaPhilosophyDownstreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<FormulaPhilosophyContractResponse>(
        "/api/formula-philosophy/contract",
        { token }
      );
      setContract(result.contract);
      setEngine(result.engine);
      setDownstream(result.downstream ?? result.contract.downstream_phases ?? []);
      setError(null);
    } catch {
      setError("读取 §6 配方哲学合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, downstream, loading, error };
}

export function useFormulaPhilosophyLabels(token: string | null): {
  labels: FormulaPhilosophyLabels | null;
  loading: boolean;
  error: string | null;
} {
  const [labels, setLabels] = useState<FormulaPhilosophyLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<FormulaPhilosophyLabels>("/api/formula-philosophy/labels", {
        token
      });
      setLabels(result);
      setError(null);
    } catch {
      setError("读取配方哲学文案失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { labels, loading, error };
}
