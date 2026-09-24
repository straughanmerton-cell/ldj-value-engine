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
 * Phase 10 产品结构叙事（规格 §5 Product Architecture / §45 Agent 7 / §57 验收）。
 *
 * 与锚点、自建标准、价值映射同理：**口径全部来自后端**。
 * 前端只负责把「这款茶的九个部分各自在干什么」摊开，并显式标出哪些部分还没事实可讲。
 *
 * 三条必须在界面上说清的规则：
 * 1. §45 明文：不允许增加任何原料或配方事实（界面上写「只能用已录入字段」）；
 * 2. 事实不足的角色留空并写缺口，绝不写弱化版（§11 / §62-7）；
 * 3. `value_role` 不足 3 个写实角色就不成立——结构还没形成，不能硬写「不像普通茶」（§11）。
 */

export type ProductArchitectureRoleKey =
  | "backbone"
  | "identity"
  | "aroma_role"
  | "body_role"
  | "front_stage_role"
  | "middle_stage_role"
  | "finish_role"
  | "memory_point"
  | "value_role";
export type ProductArchitectureRoleStatus = "WRITTEN" | "GAP";
export type ProductArchitectureSort =
  | "-updated_at"
  | "updated_at"
  | "product_name"
  | "-product_name"
  | "-written_roles"
  | "-gap_roles";

export {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  formatDateTime
};
export type { ResolvedMode, AnchorResolveSource };

/** §5 固定的九个角色与顺序，前端不得重排。 */
export const PRODUCT_ARCHITECTURE_ROLE_ORDER: ProductArchitectureRoleKey[] = [
  "backbone",
  "identity",
  "aroma_role",
  "body_role",
  "front_stage_role",
  "middle_stage_role",
  "finish_role",
  "memory_point",
  "value_role"
];

/** §57 验收必须回答的五项（谁负责骨架／香气／汤感／回甘／记忆点）。 */
export const PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS: ProductArchitectureRoleKey[] = [
  "backbone",
  "aroma_role",
  "middle_stage_role",
  "finish_role",
  "memory_point"
];

/** 兜底文案：与后端 `PRODUCT_ARCHITECTURE_ROLE_META` 同口径，展示时优先使用 `/labels` 返回值。 */
export const PRODUCT_ARCHITECTURE_ROLE_FALLBACK_LABELS: Record<
  ProductArchitectureRoleKey,
  string
> = {
  backbone: "骨架 Backbone",
  identity: "身份 Identity",
  aroma_role: "香气角色 Aroma Role",
  body_role: "底气 Body Role",
  front_stage_role: "第一口冲击 Front Stage",
  middle_stage_role: "中段厚度 Middle Stage",
  finish_role: "后半程 Finish Role",
  memory_point: "记忆点 Memory Point",
  value_role: "价值位 Value Role"
};

export const PRODUCT_ARCHITECTURE_ROLE_FALLBACK_SHORT_LABELS: Record<
  ProductArchitectureRoleKey,
  string
> = {
  backbone: "骨架",
  identity: "身份",
  aroma_role: "香气",
  body_role: "底气",
  front_stage_role: "第一口",
  middle_stage_role: "中段",
  finish_role: "后半程",
  memory_point: "记忆点",
  value_role: "价值位"
};

export const PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS: Record<
  ProductArchitectureRoleStatus,
  string
> = {
  WRITTEN: "已写实",
  GAP: "事实不足（留空）"
};

export const PRODUCT_ARCHITECTURE_ROLE_STATUS_TONES: Record<
  ProductArchitectureRoleStatus,
  "ok" | "danger"
> = {
  WRITTEN: "ok",
  GAP: "danger"
};

export const PRODUCT_ARCHITECTURE_SORT_LABELS: Record<ProductArchitectureSort, string> = {
  "-updated_at": "最近生成优先",
  updated_at: "最久未生成优先",
  product_name: "产品名 A→Z",
  "-product_name": "产品名 Z→A",
  "-written_roles": "已写实角色最多优先",
  "-gap_roles": "缺口最多优先"
};

/* ------------------------------------------------------------ 后端对象 */

export interface ProductArchitectureRoleView {
  key: ProductArchitectureRoleKey;
  label: string;
  short_label: string;
  question: string;
  definition: string;
  requirement: string;
  /** 角色文案；事实不足时为 ""（留空，不写弱化版） */
  text: string;
  status: ProductArchitectureRoleStatus;
  layer: "INTERPRETATION" | "RHETORIC";
  evidence_refs: string[];
  /** 引用的已录入事实原文（ref=value），可逐条对照 */
  citations: string[];
  gap: string | null;
  acceptance_required: boolean;
  spec_ref: string;
}

export interface ProductArchitectureRoleCounts {
  written: number;
  gap: number;
}

export interface ProductArchitectureAcceptance {
  spec_ref: "§57";
  question: string;
  required_keys: ProductArchitectureRoleKey[];
  written_keys: ProductArchitectureRoleKey[];
  missing_keys: ProductArchitectureRoleKey[];
  passed: boolean;
}

export interface ProductArchitectureDownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  /** 恒为 PENDING：本阶段只登记交接，不得显示为已完成（§60） */
  status: "PENDING";
}

export interface ProductArchitectureRecordView {
  id: string;
  product_id: string;
  product_name?: string | null;
  version: number;
  preference: "AUTO" | ResolvedMode;
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  roles: ProductArchitectureRoleView[];
  /** §35.3 存储形状：九个字段的扁平快照，事实不足的字段是 "" */
  architecture: Record<ProductArchitectureRoleKey, string>;
  /** §5 的结构叙事段落（= value_role 成稿；不足 3 个写实角色时为 ""） */
  narrative: string;
  role_counts: ProductArchitectureRoleCounts;
  acceptance: ProductArchitectureAcceptance;
  evidence_gaps: string[];
  evidence_refs: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  downstream: ProductArchitectureDownstreamItem[];
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  spec_ref: string;
}

export interface ProductArchitectureVersionSummary {
  id: string;
  version: number;
  written_roles: number;
  acceptance_passed: boolean;
  missing_acceptance_keys: ProductArchitectureRoleKey[];
  is_confirmed: boolean;
  created_at: string;
}

export interface ProductArchitectureOverview {
  product_id: string;
  product_name?: string | null;
  preference: "AUTO" | ResolvedMode;
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  can_generate: boolean;
  block_reason: string | null;
  record: ProductArchitectureRecordView | null;
  versions: ProductArchitectureVersionSummary[];
  missing_acceptance_keys: ProductArchitectureRoleKey[];
  spec_ref: string;
}

export interface ProductArchitectureMatrixRow {
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
  written_roles: number;
  gap_roles: number;
  missing_acceptance_keys: ProductArchitectureRoleKey[];
  acceptance_passed: boolean;
  /** 结构叙事正文（未生成时为 null） */
  narrative: string | null;
  generated_at: string | null;
  spec_ref: string;
}

export interface ProductArchitectureLibraryResponse {
  items: ProductArchitectureMatrixRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProductArchitectureRoleMeta {
  key: ProductArchitectureRoleKey;
  label: string;
  short_label: string;
  question: string;
  definition: string;
  requirement: string;
  evidence_refs: string[];
  acceptance_required: boolean;
  spec_ref: string;
}

export interface ProductArchitectureAgent7Question {
  order: number;
  question: string;
  role: ProductArchitectureRoleKey;
  spec_ref: string;
  note?: string;
}

export interface ProductArchitectureContract {
  spec_ref: string;
  role_count: number;
  roles: ProductArchitectureRoleMeta[];
  agent7_questions: ProductArchitectureAgent7Question[];
  acceptance: {
    spec_ref: string;
    question: string;
    required_keys: ProductArchitectureRoleKey[];
  };
  limits: {
    maxVersionsPerProduct: number;
    minWrittenRolesForValueRole: number;
    maxDnaRefsPerRole: number;
    defaultPageSize: number;
    maxPageSize: number;
  };
  no_new_facts: boolean;
  no_fabricated_relation: boolean;
  gap_stays_empty: boolean;
  evidence_only_from_own_product: boolean;
  rhetoric_allowed_for_structure_only: boolean;
  structure_not_parameter_list: boolean;
  downstream_phases: ProductArchitectureDownstreamItem[];
  rules: string[];
}

export interface ProductArchitectureEngineInfo {
  spec_ref: string;
  role_count: number;
  limits: ProductArchitectureContract["limits"];
  acceptance_required_keys: ProductArchitectureRoleKey[];
  acceptance_question: string;
  no_new_facts: boolean;
  no_fabricated_relation: boolean;
  gap_stays_empty: boolean;
  evidence_only_from_own_product: boolean;
  structure_not_parameter_list: boolean;
  note: string;
}

export interface ProductArchitectureLabels {
  roles: ProductArchitectureRoleMeta[];
  agent7_questions: ProductArchitectureAgent7Question[];
  acceptance: ProductArchitectureContract["acceptance"];
  limits: ProductArchitectureContract["limits"];
  rules: string[];
  role_status_labels: Record<ProductArchitectureRoleStatus, string>;
  role_status_tones: Record<ProductArchitectureRoleStatus, "ok" | "danger">;
  acceptance_question: string;
}

export interface ProductArchitectureContractResponse {
  contract: ProductArchitectureContract;
  engine: ProductArchitectureEngineInfo;
  downstream: ProductArchitectureDownstreamItem[];
}

/* ------------------------------------------------------------ 展示辅助 */

export function roleMeta(
  key: ProductArchitectureRoleKey,
  labels: ProductArchitectureLabels | null
): ProductArchitectureRoleMeta | null {
  return labels?.roles.find((item) => item.key === key) ?? null;
}

export function roleLabel(
  key: ProductArchitectureRoleKey,
  labels: ProductArchitectureLabels | null
): string {
  return roleMeta(key, labels)?.label ?? PRODUCT_ARCHITECTURE_ROLE_FALLBACK_LABELS[key];
}

export function roleShortLabel(
  key: ProductArchitectureRoleKey,
  labels: ProductArchitectureLabels | null
): string {
  return roleMeta(key, labels)?.short_label ?? PRODUCT_ARCHITECTURE_ROLE_FALLBACK_SHORT_LABELS[key];
}

export function roleStatusLabel(
  status: ProductArchitectureRoleStatus,
  labels: ProductArchitectureLabels | null
): string {
  return labels?.role_status_labels[status] ?? PRODUCT_ARCHITECTURE_ROLE_STATUS_LABELS[status];
}

export function roleStatusTone(
  status: ProductArchitectureRoleStatus,
  labels: ProductArchitectureLabels | null
): "ok" | "danger" {
  return labels?.role_status_tones[status] ?? PRODUCT_ARCHITECTURE_ROLE_STATUS_TONES[status];
}

/** 未生成的记录（矩阵行没有 record_id）在界面上统一按「未生成」而不是「零角色」呈现。 */
export function isGenerated(row: ProductArchitectureMatrixRow): boolean {
  return row.record_id !== null;
}

/* ------------------------------------------------------------ 数据钩子 */

/** 合同自检：九个角色、§45 八问、§57 验收与红线全部按后端口径渲染。 */
export function useProductArchitectureContract(token: string | null): {
  contract: ProductArchitectureContract | null;
  engine: ProductArchitectureEngineInfo | null;
  downstream: ProductArchitectureDownstreamItem[];
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<ProductArchitectureContract | null>(null);
  const [engine, setEngine] = useState<ProductArchitectureEngineInfo | null>(null);
  const [downstream, setDownstream] = useState<ProductArchitectureDownstreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<ProductArchitectureContractResponse>(
        "/api/product-architecture/contract",
        { token }
      );
      setContract(result.contract);
      setEngine(result.engine);
      setDownstream(result.downstream ?? result.contract.downstream_phases ?? []);
      setError(null);
    } catch {
      setError("读取 §5 产品结构合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, downstream, loading, error };
}

export function useProductArchitectureLabels(token: string | null): {
  labels: ProductArchitectureLabels | null;
  loading: boolean;
  error: string | null;
} {
  const [labels, setLabels] = useState<ProductArchitectureLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<ProductArchitectureLabels>("/api/product-architecture/labels", {
        token
      });
      setLabels(result);
      setError(null);
    } catch {
      setError("读取产品结构文案失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { labels, loading, error };
}
