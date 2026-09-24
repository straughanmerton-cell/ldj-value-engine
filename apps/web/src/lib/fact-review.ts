import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api.js";
import { formatDateTime } from "./category-creator.js";

/**
 * Phase 14 事实审核与人工审批（规格 §24 三层标记 / §25 研发证据 / §36 工作台 /
 * §49 十三项审核焦点 / §53 逐句标注页 / §57 版本冻结）。
 *
 * 与产品结构、配方哲学、强成交话术同理：**口径全部来自后端**
 * （`/api/fact-review/contract` 与 `/api/fact-review/labels`），前端只负责把
 * 「这一版稿子哪句话不能讲、为什么不能讲、谁批过」摊开。五条必须在界面上说清的规则：
 * 1. §24 三层标记 FACT / INTERPRETATION / RHETORIC：**修辞不是事实造假**，
 *    比喻、反问、排比、身份塑造本身不判 RED；
 * 2. §49 三档风险 GREEN / YELLOW / RED：RED = 阻断句，禁止审批、禁止发布；
 * 3. §53 每一句都必须给出 `句子 / Claim Type / Risk / Evidence / 修改建议`；
 * 4. §25 没有 RND_CONFIRMED 时不得出现研发关系暗示，「复刻 X / 同款配方」一律 RED；
 * 5. §62-15 所有版本必须保留：重新审核只新增审核版本，审批与否决都留痕。
 */

export type ClaimType = "FACT" | "INTERPRETATION" | "RHETORIC";
export type FactReviewRisk = "GREEN" | "YELLOW" | "RED";
export type FactReviewStatus = "PENDING" | "APPROVED" | "REJECTED";
export type FactReviewEngine = "RULE" | "RULE_AI";
export type FactEvidenceKind = "PRODUCT_FACT" | "VALUE_DNA" | "UPSTREAM_COPY" | "RND_REFERENCE";
export type FactReviewTone = "ok" | "warn" | "danger" | "info" | "neutral" | "outline" | "brand";

export { formatDateTime };

/** §24 固定顺序：三层标记不得增删或重排。 */
export const CLAIM_TYPE_ORDER: ClaimType[] = ["FACT", "INTERPRETATION", "RHETORIC"];

/** §49 固定顺序：三档风险从低到高（取更严的一档时按这个顺序）。 */
export const RISK_LEVEL_ORDER: FactReviewRisk[] = ["GREEN", "YELLOW", "RED"];

export const FACT_EVIDENCE_KIND_ORDER: FactEvidenceKind[] = [
  "PRODUCT_FACT",
  "VALUE_DNA",
  "UPSTREAM_COPY",
  "RND_REFERENCE"
];

/** 兜底文案：与后端 `CLAIM_TYPE_LABELS` 同口径，优先使用 `/labels` 返回值。 */
export const CLAIM_TYPE_FALLBACK_LABELS: Record<ClaimType, string> = {
  FACT: "事实",
  INTERPRETATION: "解释",
  RHETORIC: "修辞"
};

export const CLAIM_TYPE_FALLBACK_HINTS: Record<ClaimType, string> = {
  FACT: "可核验事实：必须能在本产品已录入字段或上游成稿里逐字找到出处（§24）",
  INTERPRETATION: "基于事实与品饮表现的产品解释：可以讲作用与设计逻辑，但不得新增硬事实（§24）",
  RHETORIC: "修辞表达：比喻 / 反问 / 排比 / 身份塑造，允许极限；但不得让消费者误以为存在可核验事实（§24 / §49）"
};

export const CLAIM_TYPE_TONES: Record<ClaimType, FactReviewTone> = {
  FACT: "ok",
  INTERPRETATION: "info",
  RHETORIC: "brand"
};

export const RISK_LEVEL_FALLBACK_LABELS: Record<FactReviewRisk, string> = {
  GREEN: "可发布",
  YELLOW: "需人工确认",
  RED: "禁止发布"
};

export const RISK_LEVEL_FALLBACK_HINTS: Record<FactReviewRisk, string> = {
  GREEN: "落在已录入事实、上游成稿或纯修辞上，机械层面没有发现虚构（§49）",
  YELLOW: "不是红线，但发布前需要人工确认出处；缺少出处就必须改写或删除（§49 / §57）",
  RED: "禁止审批、禁止发布：必须改写或删除后才允许进入下一步（§53 / §57 / §62-14）"
};

export const FACT_REVIEW_STATUS_FALLBACK_LABELS: Record<FactReviewStatus, string> = {
  PENDING: "待审批",
  APPROVED: "已审批通过",
  REJECTED: "已否决"
};

export const FACT_EVIDENCE_KIND_FALLBACK_LABELS: Record<FactEvidenceKind, string> = {
  PRODUCT_FACT: "产品已录入字段",
  VALUE_DNA: "Value DNA",
  UPSTREAM_COPY: "上游成稿",
  RND_REFERENCE: "研发记录"
};

/** 兜底：§53 逐句表格五列；界面表头以后端 `sentence_columns` 为唯一准。 */
export const FACT_REVIEW_SENTENCE_COLUMN_FALLBACK: string[] = [
  "句子",
  "Claim Type",
  "Risk",
  "Evidence",
  "修改建议"
];

/** 兜底：§49 十三项重点审核项（逐字照抄规格清单）。 */
export const FACT_REVIEW_FOCUS_FALLBACK: string[] = [
  "对标关系",
  "研发关系",
  "配方",
  "原料",
  "树龄",
  "山头",
  "年份",
  "历史",
  "价格",
  "市场第一",
  "最贵",
  "唯一",
  "投资回报"
];

/** 兜底：§62-15 同一版成稿最多保留多少次事实审核。 */
export const FACT_REVIEW_MAX_VERSIONS_FALLBACK = 20;

/* ------------------------------------------------------------ 后端对象 */

export interface FactReviewClaimTypeMeta {
  key: ClaimType;
  label: string;
  hint: string;
  spec_ref: string;
}

export interface FactReviewRiskLevelMeta {
  key: FactReviewRisk;
  label: string;
  hint: string;
  spec_ref: string;
}

export interface FactReviewStatusMeta {
  key: FactReviewStatus;
  label: string;
  spec_ref: string;
}

export interface FactEvidenceKindMeta {
  key: FactEvidenceKind;
  label: string;
}

export interface FactReviewEngineInfo {
  prompt_key: string;
  /** Phase 14 起 Agent 11 已接线（Mock / 失败时一律回落纯规则引擎） */
  ai_wired: boolean;
  /** 纯规则引擎始终先跑一遍，AI 不能覆盖它判出的红线 */
  rule_engine_authoritative: boolean;
  spec_ref: string;
}

export interface FactReviewDownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  /** 恒为 PENDING：本阶段只登记交接，不得显示为已完成（§60） */
  status: "PENDING";
}

export interface FactReviewLimits {
  maxVersionsPerCopy: number;
}

export interface FactReviewContract {
  spec_ref: string;
  claim_types: FactReviewClaimTypeMeta[];
  risk_levels: FactReviewRiskLevelMeta[];
  statuses: FactReviewStatusMeta[];
  evidence_kinds: FactEvidenceKindMeta[];
  focus_items: string[];
  sentence_columns: string[];
  engine: FactReviewEngineInfo;
  /** §24：修辞不是事实造假，不能因为不是字面事实就全部判 RED */
  rhetoric_not_fraud: boolean;
  /** §53 / §57：RED 禁止审批 */
  red_blocks_approval: boolean;
  /** §57：修辞可以保留 */
  rhetoric_kept: boolean;
  /** §62-15：所有版本必须保留 */
  keep_all_versions: boolean;
  /** §25：只有 RND_CONFIRMED 才允许出现真实研发关系暗示 */
  rnd_requires_confirmation: boolean;
  /** AI 只能加严：规则判出的 RED 不会被 AI 洗白 */
  ai_can_only_tighten: boolean;
  rules: string[];
}

export interface FactReviewContractResponse {
  contract: FactReviewContract;
  engine: FactReviewEngineInfo;
  downstream: FactReviewDownstreamItem[];
  limits: FactReviewLimits;
}

export interface FactReviewLabels {
  claim_type_labels: Record<ClaimType, string>;
  claim_type_hints: Record<ClaimType, string>;
  risk_level_labels: Record<FactReviewRisk, string>;
  risk_level_hints: Record<FactReviewRisk, string>;
  status_labels: Record<FactReviewStatus, string>;
  evidence_kind_labels: Record<FactEvidenceKind, string>;
  focus_items: string[];
  sentence_columns: string[];
  limits: FactReviewLimits;
  rules: string[];
}

/** §24 / §25 合规结论：与逐句判定同源（`sales-copy.ts` 里那一份的实现）。 */
export interface FactReviewCompliance {
  spec_ref: "§24 / §25 / §62";
  rnd_confirmed: boolean;
  rnd_claimed: boolean;
  forbidden_promises: string[];
  restricted_phrases: string[];
  fabricated_categories: string[];
  risk: FactReviewRisk;
  note: string;
}

/** §53 的逐句审核行：`句子 / Claim Type / Risk / Evidence / 修改建议`。 */
export interface FactReviewSentenceView {
  index: number;
  text: string;
  claim_type: ClaimType;
  risk: FactReviewRisk;
  /** `字段路径=逐字值`，机械逐字回查结果（§24 / §46 / §57） */
  evidence_refs: string[];
  issue: string | null;
  suggestion: string | null;
  /** RED = 阻断句：存在任何一条就不允许审批（§53 / §57） */
  is_blocking: boolean;
}

export interface FactReviewSummary {
  green: number;
  yellow: number;
  red: number;
}

export interface FactReviewClaimCounts {
  FACT: number;
  INTERPRETATION: number;
  RHETORIC: number;
}

/** `claim_evidence` 表的一行：一条可逐字点回的出处（§24 / §46 / §53）。 */
export interface FactEvidenceView {
  id: string;
  claim_id: string;
  source_ref: string;
  source_id: string | null;
  excerpt: string;
  evidence_kind: FactEvidenceKind;
  traceable: boolean;
  created_at: string;
}

export interface FactReviewView {
  id: string;
  product_id: string;
  product_name?: string | null;
  copy_output_id: string;
  /** 被审核的那一版强成交话术 */
  copy_version: number;
  /** 这一版成稿的第几次事实审核（从 1 递增） */
  version: number;
  engine: FactReviewEngine;
  rnd_confirmed: boolean;
  has_reliable_price_anchor: boolean;
  price_high_story_ready: boolean;
  sentences: FactReviewSentenceView[];
  claim_counts: FactReviewClaimCounts;
  summary: FactReviewSummary;
  overall_risk: FactReviewRisk;
  publishable: boolean;
  blocking_sentences: string[];
  evidence_gaps: string[];
  facts_used: number;
  compliance: FactReviewCompliance;
  warnings: string[];
  created_at: string;
  spec_ref: "§24 / §25 / §49 / §53";
}

/** 一次事实审核的完整视图：逐句结论 + 逐条证据行。 */
export interface FactReviewRecordView {
  review: FactReviewView;
  evidence: FactEvidenceView[];
}

export interface FactReviewVersionSummary {
  /** 该审核版本首句所在行的 id；打开历史审核时用它当 `reviewId` */
  id: string;
  version: number;
  copy_version: number;
  engine: FactReviewEngine;
  overall_risk: FactReviewRisk;
  publishable: boolean;
  green: number;
  yellow: number;
  red: number;
  facts_used: number;
  created_at: string;
}

export interface FactReviewApproval {
  status: FactReviewStatus;
  reviewed_version: number | null;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export interface FactReviewOverview {
  product_id: string;
  product_name?: string | null;
  copy_record_id: string | null;
  copy_version: number | null;
  can_review: boolean;
  block_reason: string | null;
  review: FactReviewView | null;
  /** 只含**当前成稿**的审核版本；跨成稿版本的全量历史走 `/fact-review/versions` */
  versions: FactReviewVersionSummary[];
  approval: FactReviewApproval;
  spec_ref: "§24 / §49 / §53";
}

export interface FactReviewVersionsResponse {
  items: FactReviewVersionSummary[];
}

/* ------------------------------------------------------------ 展示辅助 */

export function claimTypeLabel(type: ClaimType, labels: FactReviewLabels | null): string {
  return labels?.claim_type_labels[type] ?? CLAIM_TYPE_FALLBACK_LABELS[type];
}

export function claimTypeHint(type: ClaimType, labels: FactReviewLabels | null): string {
  return labels?.claim_type_hints[type] ?? CLAIM_TYPE_FALLBACK_HINTS[type];
}

export function claimTypeTone(type: ClaimType): FactReviewTone {
  return CLAIM_TYPE_TONES[type];
}

export function riskLabel(risk: FactReviewRisk, labels: FactReviewLabels | null): string {
  return labels?.risk_level_labels[risk] ?? RISK_LEVEL_FALLBACK_LABELS[risk];
}

export function riskHint(risk: FactReviewRisk, labels: FactReviewLabels | null): string {
  return labels?.risk_level_hints[risk] ?? RISK_LEVEL_FALLBACK_HINTS[risk];
}

export function riskTone(risk: FactReviewRisk): FactReviewTone {
  if (risk === "RED") {
    return "danger";
  }
  return risk === "YELLOW" ? "warn" : "ok";
}

export function statusLabel(status: FactReviewStatus, labels: FactReviewLabels | null): string {
  return labels?.status_labels[status] ?? FACT_REVIEW_STATUS_FALLBACK_LABELS[status];
}

export function statusTone(status: FactReviewStatus): FactReviewTone {
  if (status === "APPROVED") {
    return "ok";
  }
  return status === "REJECTED" ? "danger" : "warn";
}

export function evidenceKindLabel(
  kind: FactEvidenceKind,
  labels: FactReviewLabels | null
): string {
  return labels?.evidence_kind_labels[kind] ?? FACT_EVIDENCE_KIND_FALLBACK_LABELS[kind];
}

export function engineLabel(engine: FactReviewEngine): string {
  return engine === "RULE_AI" ? "规则引擎 + Agent 11（AI 只能加严）" : "纯规则引擎";
}

/**
 * 证据行按「`字段路径=逐字值`」索引。
 *
 * 后端 `Evidence` 列与 `claim_evidence` 行是同一份机械回查结果：逐句的 `evidence_refs`
 * 就是 `source_ref=excerpt`。用这个键把逐条证据（含 `evidence_kind` / `traceable`）挂回句子，
 * 不需要在响应里再传一次句子行 id。
 */
export function evidenceByRef(evidence: readonly FactEvidenceView[]): Map<string, FactEvidenceView[]> {
  const grouped = new Map<string, FactEvidenceView[]>();
  for (const item of evidence) {
    const key = `${item.source_ref}=${item.excerpt}`;
    const list = grouped.get(key);
    if (list) {
      list.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}

/**
 * 这一版还能不能点「审批通过」。
 *
 * 与后端 `decide()` 同一套口径：存在任何 RED 阻断句（或 §24 合规 RED）直接 400；
 * 前端提前禁用并给出理由，避免用户点完才吃 400（§53 / §57）。
 */
export function approveBlockReason(
  review: FactReviewView | null,
  canWrite: boolean
): string | null {
  if (!canWrite) {
    return "当前账号为只读：事实审核与人工审批限 ADMIN / RESEARCHER（§53）";
  }
  if (!review) {
    return "还没有事实审核结论：先送审一版成稿（§53）";
  }
  if (review.summary.red > 0 || review.compliance.risk === "RED" || !review.publishable) {
    return `这一版有 ${review.blocking_sentences.length} 条 RED 阻断句（合规风险 ${review.compliance.risk}），禁止审批：必须改写或删除后才允许通过（§53 / §57）`;
  }
  return null;
}

/**
 * 审批结论与「当前正在审的这一版」是否对得上（§53 / §62-15）。
 *
 * 审批记在被审批的那一版上，因此新生成一版话术不会继承上一版的结论：
 * 界面必须让人看到「上一版已通过 v2 / 当前 v3 待审批」这样的事实，而不是一个会骗人的绿灯。
 */
export function approvalMismatch(
  approval: FactReviewApproval,
  currentVersion: number | null,
  labels: FactReviewLabels | null
): string | null {
  if (approval.status === "PENDING" || approval.reviewed_version === null) {
    return null;
  }
  if (currentVersion !== null && approval.reviewed_version === currentVersion) {
    return null;
  }
  return `上一次人工结论（${statusLabel(approval.status, labels)}）落在事实审核 v${
    approval.reviewed_version
  }，当前正在看的是 v${currentVersion ?? "—"}：上一版的结论不会被继承（§53 / §62-15）`;
}

/** 阻断句的展示去重：同一句在多列里重复出现时只列一次。 */
export function uniqueSentences(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/* ------------------------------------------------------------ 数据钩子 */

/** 合同自检：三层标记、三档风险、§53 五列、§49 十三项与全部红线都按后端口径渲染。 */
export function useFactReviewContract(token: string | null): {
  contract: FactReviewContract | null;
  engine: FactReviewEngineInfo | null;
  downstream: FactReviewDownstreamItem[];
  limits: FactReviewLimits | null;
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<FactReviewContract | null>(null);
  const [engine, setEngine] = useState<FactReviewEngineInfo | null>(null);
  const [downstream, setDownstream] = useState<FactReviewDownstreamItem[]>([]);
  const [limits, setLimits] = useState<FactReviewLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<FactReviewContractResponse>("/api/fact-review/contract", {
        token
      });
      setContract(result.contract);
      setEngine(result.engine);
      setDownstream(result.downstream ?? []);
      setLimits(result.limits ?? null);
      setError(null);
    } catch {
      setError("读取 §24 / §49 / §53 事实审核合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, downstream, limits, loading, error };
}

export function useFactReviewLabels(token: string | null): {
  labels: FactReviewLabels | null;
  loading: boolean;
  error: string | null;
} {
  const [labels, setLabels] = useState<FactReviewLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<FactReviewLabels>("/api/fact-review/labels", { token });
      setLabels(result);
      setError(null);
    } catch {
      setError("读取事实审核文案失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { labels, loading, error };
}
