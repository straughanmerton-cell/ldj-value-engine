import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api.js";

/**
 * Phase 8 自建高端标准模式（规格 §4.2 / §17 / §29 / §24）。
 *
 * 与锚点引擎同理：前端只负责展示与调用，**口径全部来自后端**。
 * 唯一的例外是「中文兜底文案」——后端无响应时界面不能只剩类型码，因此这里保留一份
 * 与 `packages/schemas/src/category-creator.ts` 同口径的兜底标签，展示时优先用后端返回值。
 *
 * 三条必须在界面上说清的规则：
 * 1. 没有可靠锚点时必须进入自建标准模式，不得硬凑竞品、不得下调阈值（§17 / §62-10）；
 * 2. 没有对标 ≠ 文案变弱：要输出六标准轴、风格身份证与价值逻辑（§4.2）；
 * 3. 标准只能引用已录入事实：未录入的轴显示「未录入（不得书写）」，且不输出成交表达（§11 / §24）。
 */

export type CategoryStandardAxis =
  | "FRAME"
  | "DEPTH"
  | "IDENTITY"
  | "FIRST_IMPRESSION"
  | "FINISH"
  | "CRAFT";
export type CategoryAxisStatus = "SUPPORTED" | "PARTIAL" | "UNKNOWN";
export type CategoryReadiness = "READY" | "PARTIAL" | "INSUFFICIENT";
export type CategoryCreatorTrigger = "NO_RELIABLE_ANCHOR" | "USER_OPT_OUT";
export type ValueLogicStage = "FACT" | "INTERPRETATION" | "VALUE" | "SALES_LINE";
export type CopyLayer = "FACT" | "INTERPRETATION" | "RHETORIC";
export type CategoryCreatorPreference = "AUTO" | "BENCHMARK" | "CATEGORY_CREATOR";

export const CATEGORY_STANDARD_AXIS_ORDER: CategoryStandardAxis[] = [
  "FRAME",
  "DEPTH",
  "IDENTITY",
  "FIRST_IMPRESSION",
  "FINISH",
  "CRAFT"
];

/** 兜底标签：与后端 `CATEGORY_STANDARD_AXIS_LABELS` 一致，展示优先取后端合同。 */
export const CATEGORY_STANDARD_AXIS_LABELS: Record<CategoryStandardAxis, string> = {
  FRAME: "骨架（产区 / 山头）",
  DEPTH: "底气（原料）",
  IDENTITY: "身份（辨识度）",
  FIRST_IMPRESSION: "第一口（汤感）",
  FINISH: "后半程（回甘 / 生津）",
  CRAFT: "工艺控制"
};

export const CATEGORY_AXIS_STATUS_LABELS: Record<CategoryAxisStatus, string> = {
  SUPPORTED: "有事实支撑",
  PARTIAL: "只有单点事实",
  UNKNOWN: "未录入（不得书写）"
};

export const CATEGORY_AXIS_STATUS_TONES: Record<CategoryAxisStatus, "ok" | "warn" | "danger"> = {
  SUPPORTED: "ok",
  PARTIAL: "warn",
  UNKNOWN: "danger"
};

export const CATEGORY_READINESS_LABELS: Record<CategoryReadiness, string> = {
  READY: "标准成立（可以进入成交表达）",
  PARTIAL: "标准部分成立（先补事实再放大）",
  INSUFFICIENT: "事实不足（不得输出成交表达）"
};

export const CATEGORY_READINESS_SHORT_LABELS: Record<CategoryReadiness, string> = {
  READY: "标准成立",
  PARTIAL: "部分成立",
  INSUFFICIENT: "事实不足"
};

export const CATEGORY_READINESS_TONES: Record<CategoryReadiness, "ok" | "warn" | "danger"> = {
  READY: "ok",
  PARTIAL: "warn",
  INSUFFICIENT: "danger"
};

/** 两个触发条件（§4.2）：一个是被动强制，一个是产品负责人主动选择不使用对标。 */
export const CATEGORY_CREATOR_TRIGGER_LABELS: Record<CategoryCreatorTrigger, string> = {
  NO_RELIABLE_ANCHOR: "没有可靠锚点（强制进入）",
  USER_OPT_OUT: "用户选择不使用对标"
};

export const CATEGORY_CREATOR_TRIGGER_TONES: Record<CategoryCreatorTrigger, "warn" | "info"> = {
  NO_RELIABLE_ANCHOR: "warn",
  USER_OPT_OUT: "info"
};

export const VALUE_LOGIC_STAGE_LABELS: Record<ValueLogicStage, string> = {
  FACT: "事实（FACT）",
  INTERPRETATION: "解释（INTERPRETATION）",
  VALUE: "价值（VALUE）",
  SALES_LINE: "成交表达（RHETORIC）"
};

export const COPY_LAYER_LABELS: Record<CopyLayer, string> = {
  FACT: "FACT｜事实",
  INTERPRETATION: "INTERPRETATION｜解释",
  RHETORIC: "RHETORIC｜修辞"
};

export const COPY_LAYER_TONES: Record<CopyLayer, "ok" | "info" | "warn"> = {
  FACT: "ok",
  INTERPRETATION: "info",
  RHETORIC: "warn"
};

/* ------------------------------------------------------------ 后端对象 */

export interface CategoryStandardItem {
  axis: CategoryStandardAxis;
  label: string;
  requirement: string;
  why_it_matters: string;
  status: CategoryAxisStatus;
  evidence_refs: string[];
  evidence_summary: string;
  /** 未录入的轴必须为 null：宁可少讲，不得编（§11 / §62-7） */
  statement: string | null;
  gap: string | null;
  layer: "INTERPRETATION";
}

export interface CategoryStandard {
  items: CategoryStandardItem[];
  supported_count: number;
  partial_count: number;
  unknown_count: number;
  summary: string;
}

export interface CategoryStyleIdentity {
  identity_name: string;
  category_positioning: string;
  first_impression: string | null;
  mid_palate: string | null;
  finish: string | null;
  signature_trait: string | null;
  differentiators: string[];
  /** §19 TIME_DEPENDENT 表达位：Phase 9 交付后填充，当前恒为 null */
  time_story: string | null;
  not_claiming: string[];
}

export interface ValueLogicItem {
  stage: ValueLogicStage;
  label: string;
  layer: CopyLayer;
  text: string;
  source_refs: string[];
}

export interface ValueLogic {
  items: ValueLogicItem[];
  mode_switch_note: string;
  /** 事实不足时不输出 SALES_LINE，且此标记为 false */
  sales_line_ready: boolean;
}

export interface CategoryDownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  /** 恒为 PENDING：本阶段只登记交接，不得显示为已完成（§60） */
  status: "PENDING";
}

export interface CategoryCreatorProfileView {
  id: string;
  product_id: string;
  product_name?: string | null;
  version: number;
  trigger: CategoryCreatorTrigger;
  mode_at_generation: "BENCHMARK" | "CATEGORY_CREATOR";
  readiness: CategoryReadiness;
  supported_axes: number;
  total_axes: number;
  standard: CategoryStandard;
  style_identity: CategoryStyleIdentity;
  value_logic: ValueLogic;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  downstream: CategoryDownstreamItem[];
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  spec_ref: string;
}

export interface CategoryCreatorVersionSummary {
  id: string;
  version: number;
  trigger: CategoryCreatorTrigger;
  readiness: CategoryReadiness;
  supported_axes: number;
  total_axes: number;
  is_confirmed: boolean;
  created_at: string;
}

export interface CategoryCreatorOverview {
  product_id: string;
  product_name?: string | null;
  preference: CategoryCreatorPreference;
  mode: "BENCHMARK" | "CATEGORY_CREATOR";
  resolved_by: "AUTO_ANCHOR" | "MANUAL_PREFERENCE" | "NO_RELIABLE_ANCHOR";
  mode_reason: string;
  can_generate: boolean;
  block_reason: string | null;
  suggested_trigger: CategoryCreatorTrigger;
  profile: CategoryCreatorProfileView | null;
  versions: CategoryCreatorVersionSummary[];
  spec_ref: string;
}

export interface CategoryCreatorContract {
  spec_ref: string;
  triggers: { trigger: CategoryCreatorTrigger; label: string; condition: string; spec_ref: string }[];
  axes: { axis: CategoryStandardAxis; label: string }[];
  min_supported_axes: number;
  layers: CopyLayer[];
  /** 必须为 true：没有对标不代表文案变弱（§4.2） */
  not_weak_copy: boolean;
  /** 必须为 true：没有达标候选不硬凑竞品（§17） */
  no_fake_benchmark: boolean;
  /** 必须为 true：未录入的轴写「未录入」，不补全（§62-7） */
  unknown_is_written_as_unknown: boolean;
  downstream_phases: CategoryDownstreamItem[];
  rules: string[];
}

export interface CategoryCreatorEngineInfo {
  spec_ref: string;
  mode: string;
  triggers: CategoryCreatorTrigger[];
  axes: { axis: CategoryStandardAxis; label: string }[];
  min_supported_axes: number;
  not_weak_copy: boolean;
  no_fake_benchmark: boolean;
  unknown_is_written_as_unknown: boolean;
  note: string;
}

export interface CategoryCreatorContractResponse {
  contract: CategoryCreatorContract;
  engine: CategoryCreatorEngineInfo;
  downstream: CategoryDownstreamItem[];
}

/* ------------------------------------------------------------ 展示辅助 */

export function axisLabel(
  axis: CategoryStandardAxis,
  axisLabels?: Partial<Record<CategoryStandardAxis, string>> | null
): string {
  return axisLabels?.[axis] ?? CATEGORY_STANDARD_AXIS_LABELS[axis];
}

/** 轴名的窄列版：表格里排得下，又不丢「这一轴负责什么」。 */
export function shortAxisName(label: string): string {
  return label.split("（")[0] ?? label;
}

export function triggerLabel(
  trigger: CategoryCreatorTrigger,
  contractLabels?: { trigger: CategoryCreatorTrigger; label: string }[] | null
): string {
  const fromContract = (contractLabels ?? []).find((item) => item.trigger === trigger)?.label;
  return fromContract ?? CATEGORY_CREATOR_TRIGGER_LABELS[trigger];
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN");
}

/** §4.2 / §17 合同自检：前端据此展示两触发条件、六标准轴与红线，不在页面写死口径。 */
export function useCategoryCreatorContract(token: string | null): {
  contract: CategoryCreatorContract | null;
  engine: CategoryCreatorEngineInfo | null;
  downstream: CategoryDownstreamItem[];
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<CategoryCreatorContract | null>(null);
  const [engine, setEngine] = useState<CategoryCreatorEngineInfo | null>(null);
  const [downstream, setDownstream] = useState<CategoryDownstreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<CategoryCreatorContractResponse>(
        "/api/category-creator/contract",
        { token }
      );
      setContract(result.contract);
      setEngine(result.engine);
      setDownstream(result.downstream ?? result.contract.downstream_phases ?? []);
      setError(null);
    } catch {
      setError("读取 §4.2 自建标准合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, downstream, loading, error };
}
