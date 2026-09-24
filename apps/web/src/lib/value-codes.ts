import { useCallback, useEffect, useState } from "react";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  type AnchorResolveSource,
  type ResolvedMode
} from "./anchors.js";
import { apiRequest } from "./api.js";
import { formatDateTime } from "./category-creator.js";

/**
 * Phase 9 价值映射（规格 §18 Value Codes / §19 状态判定 / §20 六类价值故事 / §30 价值拆解）。
 *
 * 与锚点、自建标准同理：**口径全部来自后端**。前端只负责把「16 个 Code 现在各自成立到什么程度、
 * 六类故事能不能讲、还差哪些事实」摊开，方便研究员审阅与补齐。
 *
 * 三条必须在界面上说清的规则：
 * 1. 未录入一律 UNKNOWN（界面写「未录入（不得书写）」），不允许补全或推测（§11 / §62-7）；
 * 2. 时间依赖型 Code（陈化 / 收藏 / 流通）只能写固定安全句式，绝不承诺未来（§19）；
 * 3. 对标只提供「高价值产品的底层条件」这一层标准，竞品事实一律不进本产品证据（§44 / §62-5）。
 */

export type ValueCodeKey = string;
export type ValueCodeStatus =
  | "ALREADY_HAVE"
  | "PARTIAL"
  | "TIME_DEPENDENT"
  | "NOT_HAVE"
  | "UNKNOWN";
export type ValueStoryKey =
  | "identity_story"
  | "price_ceiling_story"
  | "product_architecture_story"
  | "formula_philosophy_story"
  | "flavor_identity_story"
  | "time_story";
export type ValueStoryStatus = "READY" | "PARTIAL" | "GAP" | "HANDOFF";
export type ValueCodeSort =
  | "-updated_at"
  | "updated_at"
  | "product_name"
  | "-product_name"
  | "-unknown_count"
  | "-time_dependent_count";

export type ValueCodeCounts = Partial<Record<ValueCodeStatus, number>>;

export {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  formatDateTime
};
export type { ResolvedMode, AnchorResolveSource };

/** §18 的固定顺序，前端不得重排。 */
export const VALUE_CODE_STATUS_ORDER: ValueCodeStatus[] = [
  "ALREADY_HAVE",
  "PARTIAL",
  "TIME_DEPENDENT",
  "NOT_HAVE",
  "UNKNOWN"
];

/** §20 六类故事顺序，必须与后端一致。 */
export const VALUE_STORY_KEYS: ValueStoryKey[] = [
  "identity_story",
  "price_ceiling_story",
  "product_architecture_story",
  "formula_philosophy_story",
  "flavor_identity_story",
  "time_story"
];

/** 兜底标签：与后端 `VALUE_CODE_STATUS_META` 同口径，展示时优先使用 `/labels` 返回值。 */
export const VALUE_CODE_STATUS_LABELS: Record<ValueCodeStatus, string> = {
  ALREADY_HAVE: "已经具备",
  PARTIAL: "部分具备",
  TIME_DEPENDENT: "时间依赖",
  NOT_HAVE: "不具备",
  UNKNOWN: "未录入（不得书写）"
};

export const VALUE_CODE_STATUS_SHORT_LABELS: Record<ValueCodeStatus, string> = {
  ALREADY_HAVE: "已具备",
  PARTIAL: "单点事实",
  TIME_DEPENDENT: "时间依赖",
  NOT_HAVE: "不具备",
  UNKNOWN: "未录入"
};

export const VALUE_CODE_STATUS_TONES: Record<
  ValueCodeStatus,
  "ok" | "warn" | "info" | "danger"
> = {
  ALREADY_HAVE: "ok",
  PARTIAL: "warn",
  TIME_DEPENDENT: "info",
  NOT_HAVE: "danger",
  UNKNOWN: "danger"
};

export const VALUE_STORY_STATUS_LABELS: Record<ValueStoryStatus, string> = {
  READY: "可讲",
  PARTIAL: "只够单点事实",
  GAP: "事实不足（不得书写）",
  HANDOFF: "由后续 Phase 交付"
};

export const VALUE_STORY_STATUS_TONES: Record<
  ValueStoryStatus,
  "ok" | "warn" | "danger" | "info"
> = {
  READY: "ok",
  PARTIAL: "warn",
  GAP: "danger",
  HANDOFF: "info"
};

export const VALUE_STORY_LABELS: Record<ValueStoryKey, string> = {
  identity_story: "身份故事（Identity Story）",
  price_ceiling_story: "价格上限故事（Price Ceiling Story）",
  product_architecture_story: "产品结构故事（Product Architecture Story）",
  formula_philosophy_story: "配方哲学故事（Formula Philosophy Story）",
  flavor_identity_story: "风味身份故事（Flavor Identity Story）",
  time_story: "时间故事（Time Story）"
};

export const VALUE_CODE_SORT_LABELS: Record<ValueCodeSort, string> = {
  "-updated_at": "最近生成优先",
  updated_at: "最久未生成优先",
  product_name: "产品名 A→Z",
  "-product_name": "产品名 Z→A",
  "-unknown_count": "未录入最多优先",
  "-time_dependent_count": "时间依赖最多优先"
};

/* ------------------------------------------------------------ 后端对象 */

export interface ValueCodeItem {
  code: ValueCodeKey;
  label: string;
  definition: string;
  dimensions: string[];
  /** §44 底层条件：高价值产品形成之前就必须具备什么 */
  requirement: string;
  /** §18 contribution：这个 Code 对「为什么贵得起」的贡献 */
  contribution: string;
  /** 只引用本产品已录入事实（product.* / dna.*） */
  evidence: string[];
  evidence_refs: string[];
  status: ValueCodeStatus;
  status_reason: string;
  /** 前台表达；UNKNOWN 必须为 null */
  statement: string | null;
  /** TIME_DEPENDENT 时等于 §19 固定安全句式 */
  safe_expression: string | null;
  gap: string | null;
  layer: "INTERPRETATION";
}

export interface ValueStoryItem {
  label: string;
  status: ValueStoryStatus;
  /** GAP / HANDOFF 时必须为 null：宁可留空，不得编 */
  text: string | null;
  layer: "INTERPRETATION" | "RHETORIC";
  based_on: ValueCodeKey[];
  gap: string | null;
  handoff_phase: number | null;
  note: string | null;
}

export interface ValueCodeAnchorContext {
  anchor_id: string | null;
  name: string | null;
  similarity_score: number | null;
  price_evidence_score: number | null;
  usage: "STANDARD_ONLY";
}

export interface ValueCodeProfileView {
  id: string;
  product_id: string;
  product_name?: string | null;
  version: number;
  preference: "AUTO" | ResolvedMode;
  mode_at_generation: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  anchor_context: ValueCodeAnchorContext | null;
  codes: ValueCodeItem[];
  code_counts: ValueCodeCounts;
  stories: Record<ValueStoryKey, ValueStoryItem>;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  downstream: ValueCodeDownstreamItem[];
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  spec_ref: string;
}

export interface ValueCodeDownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  /** 恒为 PENDING：本阶段只登记交接，不得显示为已完成（§60） */
  status: "PENDING";
}

export interface ValueCodeVersionSummary {
  id: string;
  version: number;
  mode_at_generation: ResolvedMode;
  resolved_by: AnchorResolveSource;
  code_counts: ValueCodeCounts;
  time_dependent_count: number;
  unknown_count: number;
  is_confirmed: boolean;
  created_at: string;
}

export interface ValueCodeOverview {
  product_id: string;
  product_name?: string | null;
  preference: "AUTO" | ResolvedMode;
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  can_generate: boolean;
  block_reason: string | null;
  profile: ValueCodeProfileView | null;
  versions: ValueCodeVersionSummary[];
  spec_ref: string;
}

export interface ValueCodeMatrixRow {
  product_id: string;
  product_name: string;
  year: number;
  tea_type: string;
  mountain: string | null;
  mode: ResolvedMode;
  preference: "AUTO" | ResolvedMode;
  profile_id: string | null;
  version: number | null;
  is_confirmed: boolean;
  code_counts: ValueCodeCounts;
  time_dependent_codes: ValueCodeKey[];
  unknown_codes: ValueCodeKey[];
  already_have_codes: ValueCodeKey[];
  time_dependent_expression: string | null;
  generated_at: string | null;
  spec_ref: string;
}

export interface ValueCodeLibraryResponse {
  items: ValueCodeMatrixRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ValueCodeStatusMeta {
  status: ValueCodeStatus;
  label: string;
  short_label: string;
  tone: "ok" | "warn" | "info" | "danger";
  meaning: string;
  rule: string;
}

export interface ValueCodeLabels {
  statuses: ValueCodeStatusMeta[];
  status_labels: Record<ValueCodeStatus, string>;
  status_short_labels: Record<ValueCodeStatus, string>;
  status_tones: Record<ValueCodeStatus, "ok" | "warn" | "info" | "danger">;
  dimension_labels: Record<string, string>;
  story_labels: Record<string, string>;
  story_status_labels: Record<string, string>;
  story_handoff_phases: Record<string, number>;
  time_dependent_safe_expression: string;
  time_dependent_forbidden_expression: string;
  rules: string[];
}

export interface ValueCodeContract {
  spec_ref: string;
  codes: {
    code: ValueCodeKey;
    label: string;
    definition: string;
    dimensions: string[];
    requirement: string;
    contribution: string;
    evidence_refs: string[];
    time_dependent: boolean;
    spec_ref: string;
  }[];
  dimensions: { dimension: string; label: string }[];
  statuses: ValueCodeStatusMeta[];
  stories: { key: ValueStoryKey; label: string }[];
  time_dependent_safe_expression: string;
  time_dependent_forbidden_expression: string;
  no_competitor_fact_transplant: boolean;
  time_dependent_not_promise: boolean;
  unknown_is_written_as_unknown: boolean;
  not_have_requires_recorded_fact: boolean;
  evidence_only_from_own_product: boolean;
  downstream_phases: ValueCodeDownstreamItem[];
  rules: string[];
}

export interface ValueCodeEngineInfo {
  spec_ref: string;
  code_count: number;
  statuses: ValueCodeStatus[];
  limits: { maxProfilesPerProduct: number; defaultPageSize: number; maxPageSize: number };
  time_dependent_safe_expression: string;
  time_dependent_forbidden_expression: string;
  story_handoff_phases: Record<string, number>;
  no_competitor_fact_transplant: boolean;
  time_dependent_not_promise: boolean;
  unknown_is_written_as_unknown: boolean;
  not_have_requires_recorded_fact: boolean;
  evidence_only_from_own_product: boolean;
  note: string;
}

export interface ValueCodeContractResponse {
  contract: ValueCodeContract;
  engine: ValueCodeEngineInfo;
  downstream: ValueCodeDownstreamItem[];
}

/* ------------------------------------------------------------ 展示辅助 */

export function countOf(counts: ValueCodeCounts, status: ValueCodeStatus): number {
  return counts[status] ?? 0;
}

export function totalCount(counts: ValueCodeCounts): number {
  return VALUE_CODE_STATUS_ORDER.reduce((sum, status) => sum + countOf(counts, status), 0);
}

export function codeLabel(
  code: ValueCodeKey,
  contract: ValueCodeContract | null
): string {
  return contract?.codes.find((item) => item.code === code)?.label ?? code;
}

export function statusLabel(
  status: ValueCodeStatus,
  labels: ValueCodeLabels | null
): string {
  return labels?.status_labels[status] ?? VALUE_CODE_STATUS_LABELS[status];
}

export function statusShortLabel(
  status: ValueCodeStatus,
  labels: ValueCodeLabels | null
): string {
  return labels?.status_short_labels[status] ?? VALUE_CODE_STATUS_SHORT_LABELS[status];
}

export function statusTone(
  status: ValueCodeStatus,
  labels: ValueCodeLabels | null
): "ok" | "warn" | "info" | "danger" {
  return labels?.status_tones[status] ?? VALUE_CODE_STATUS_TONES[status];
}

export function storyStatusLabel(
  status: ValueStoryStatus,
  labels: ValueCodeLabels | null
): string {
  return labels?.story_status_labels[status] ?? VALUE_STORY_STATUS_LABELS[status];
}

/** 合同自检 / 标签文案：前端不在页面里写死 §18 口径，一律从这里取。 */
export function useValueCodesContract(token: string | null): {
  contract: ValueCodeContract | null;
  engine: ValueCodeEngineInfo | null;
  downstream: ValueCodeDownstreamItem[];
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<ValueCodeContract | null>(null);
  const [engine, setEngine] = useState<ValueCodeEngineInfo | null>(null);
  const [downstream, setDownstream] = useState<ValueCodeDownstreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<ValueCodeContractResponse>("/api/value-codes/contract", {
        token
      });
      setContract(result.contract);
      setEngine(result.engine);
      setDownstream(result.downstream ?? result.contract.downstream_phases ?? []);
      setError(null);
    } catch {
      setError("读取 §18 价值映射合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, downstream, loading, error };
}

export function useValueCodeLabels(token: string | null): {
  labels: ValueCodeLabels | null;
  loading: boolean;
  error: string | null;
} {
  const [labels, setLabels] = useState<ValueCodeLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<ValueCodeLabels>("/api/value-codes/labels", { token });
      setLabels(result);
      setError(null);
    } catch {
      setError("读取价值映射文案失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { labels, loading, error };
}
