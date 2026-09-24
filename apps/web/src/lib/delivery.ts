import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest } from "./api.js";
import { formatDateTime } from "./category-creator.js";
import { FACT_REVIEW_STATUS_FALLBACK_LABELS, type FactReviewStatus, type FactReviewVersionSummary } from "./fact-review.js";
import type { CopyIntensity, ImpactScoreBand, SalesCopyVersionSummary } from "./sales-copy.js";

/**
 * Phase 15 交付层（规格 §31 一级导航 / §32 产品详情 Tabs / §51 主播中心 / §52 经销商中心 /
 * §53 逐句风险 / §57 版本冻结 / §60 导出）。
 *
 * 前端在这一层只做两件事：**把后端算好的发布闸门摊开给人看**，以及**把十项原文交到主播 / 经销商手里**。
 * 六条不许越界的口径：
 *
 * 1. **发布闸门只有一条口径**（§53 / §57 / §62-14）：`ready` 由后端给出，前端不重算、不「差不多就行」，
 *    连「为什么不能交」与「下一步去哪里」都读同一份 `reason` / `next_action`；
 * 2. **闸门未通过时十项全为空**：后端已经保证不含正文，页面如实显示缺口并指向「事实审核」Tab，
 *    绝不用上游数据临时拼一个「先看着用」的版本（§62-15 / §64）；
 * 3. **导出是派生视图**（§62-15）：正文逐字来自两个中心，导出永远标注成稿版本与第几次审核；
 * 4. **闸门不通过时导出返回 409**：前端把 `gate_label` / `blocking_sentences` / `next_action`
 *    原样摆出来，不吞掉后端给出的拒绝理由（§53）；
 * 5. **不移植竞品事实**（§62-5）：同赛道市场认知 / 主要锚点由后端从锚点与成稿派生，前端不再组织第二套说法；
 * 6. **主播不用自己琢磨**（§64）：每一格都给可直接念的原文，并提供一键复制与 60 秒 / 3 分钟 / 金句快捷复制。
 */

export { formatDateTime };

/** 交付层统一色调：与后端 `DeliveryTone` 和 `<Pill tone>` 的取值一一对应。 */
export type DeliveryTone = "brand" | "ok" | "warn" | "danger" | "info" | "neutral" | "outline";

/* ------------------------------------------------------- §51 / §52 十项 */

/** §51 主播中心十项固定顺序（不得增删或重排）。 */
export const HOST_CENTER_SLOT_ORDER = [
  "product_identity",
  "one_liner",
  "must_say_three",
  "value_track",
  "product_structure",
  "formula_philosophy",
  "core_quotes",
  "sec60",
  "min3",
  "objections"
] as const;
export type HostCenterSlotKey = (typeof HOST_CENTER_SLOT_ORDER)[number];

/** §52 经销商中心十项固定顺序。 */
export const DEALER_CENTER_SLOT_ORDER = [
  "positioning",
  "selling_points",
  "why_this_price",
  "market_cognition",
  "primary_anchor",
  "product_structure",
  "formula_philosophy",
  "consumer",
  "how_to_introduce",
  "faq"
] as const;
export type DealerCenterSlotKey = (typeof DEALER_CENTER_SLOT_ORDER)[number];

/** 兜底：§51 十项中文名（逐字照抄基线），优先使用 `/api/delivery/labels` 返回值。 */
export const HOST_CENTER_SLOT_FALLBACK_LABELS: Record<HostCenterSlotKey, string> = {
  product_identity: "产品身份",
  one_liner: "一句话定位",
  must_say_three: "今天必讲 3 点",
  value_track: "价值赛道 / 产品标准",
  product_structure: "产品结构",
  formula_philosophy: "配方哲学",
  core_quotes: "5 句金句",
  sec60: "60 秒稿",
  min3: "3 分钟稿",
  objections: "异议回答"
};

/** 兜底：§52 十项中文名（逐字照抄基线）。 */
export const DEALER_CENTER_SLOT_FALLBACK_LABELS: Record<DealerCenterSlotKey, string> = {
  positioning: "产品定位",
  selling_points: "核心卖点",
  why_this_price: "为什么值这个价",
  market_cognition: "同赛道市场认知",
  primary_anchor: "主要锚点",
  product_structure: "产品结构",
  formula_philosophy: "配方哲学",
  consumer: "消费人群",
  how_to_introduce: "如何介绍",
  faq: "常见问题"
};

/* --------------------------------------------------------- §53 发布闸门 */

/**
 * 六种闸门状态（与后端 `gate_states` 的**顺序**一一对应）。
 *
 * 后端 `gate` 里没有 `label` / `tone`（那是标签接口的职责），所以前端按同一套判定把闸门归到六态之一，
 * 再取对应文案；`reason` / `next_action` 一律优先用 `gate` 自己带的那一份（它带版本号，比字典更准）。
 */
export type DeliveryGateStateKey =
  | "NO_COPY"
  | "NEEDS_REVIEW"
  | "RED_BLOCKED"
  | "REJECTED"
  | "NEEDS_APPROVAL"
  | "READY";

export const DELIVERY_GATE_STATE_ORDER: DeliveryGateStateKey[] = [
  "NO_COPY",
  "NEEDS_REVIEW",
  "RED_BLOCKED",
  "REJECTED",
  "NEEDS_APPROVAL",
  "READY"
];

/** 兜底六态文案：与后端 `/api/delivery/labels` 的 `gate_states` 同口径、同顺序。 */
export const DELIVERY_GATE_STATE_FALLBACK: Record<
  DeliveryGateStateKey,
  { label: string; tone: DeliveryTone; reason: string | null; next_action: string | null }
> = {
  NO_COPY: {
    label: "还没有成稿",
    tone: "outline",
    reason: "这款产品还没有强成交话术成稿：先生成一版主播稿（§21 / §26），再逐句做事实审核并人工审批（§53）。",
    next_action: "去生成强成交话术"
  },
  NEEDS_REVIEW: {
    label: "待事实审核",
    tone: "info",
    reason: "最新一版成稿还没有做过逐句事实审核：对外讲之前必须审完并人工审批通过（§53 / §57）。",
    next_action: "去事实审核"
  },
  RED_BLOCKED: {
    label: "被 RED 阻断",
    tone: "danger",
    reason: "最新一版成稿的审核存在 RED 阻断句，禁止发布：必须改写或删除后重新送审（§53 / §57 / §62-14）。",
    next_action: "去事实审核改稿"
  },
  REJECTED: {
    label: "已被否决",
    tone: "danger",
    reason: "最新一版成稿的审核已被人工否决：按备注修正后重新送审（§53）。",
    next_action: "去事实审核"
  },
  NEEDS_APPROVAL: {
    label: "待人工审批",
    tone: "warn",
    reason: "最新一版成稿的审核还没有人工审批通过：审核通过后才能出最终资料（§53 / §57）。",
    next_action: "去事实审核"
  },
  READY: {
    label: "可交付",
    tone: "ok",
    reason: null,
    next_action: null
  }
};

/* ------------------------------------------------------------ 后端对象 */

export type DeliveryExportFormat = "MARKDOWN" | "TEXT";
export type DeliveryExportScope = "HOST" | "DEALER" | "ALL";

/** §51 / §52 一格里的一个条目：必讲序号 / 金句 / 3 分钟时间轴 / 异议。 */
export interface DeliverySlotItem {
  index: number;
  label: string | null;
  text: string;
  /** 补充说明：3 分钟稿每段的要求、异议的标准回答等 */
  detail: string | null;
}

/** 十项格子共用的字段形状；两侧各自把 `key` 收窄成自己的枚举。 */
export interface DeliverySlotView {
  label: string;
  requirement: string;
  source: string;
  spec_ref: string;
  tone: DeliveryTone;
  /** 可直接念的单段正文；没有内容时为 null */
  text: string | null;
  /** 可直接念的条目文本（与 items 同源，供复制与导出） */
  lines: string[];
  items: DeliverySlotItem[];
  chars: number;
  /** 闸门未通过时全部为 false（后端不给半成品正文） */
  present: boolean;
}

export interface HostCenterSlotView extends DeliverySlotView {
  key: HostCenterSlotKey;
}

export interface DealerCenterSlotView extends DeliverySlotView {
  key: DealerCenterSlotKey;
}

/** §53 / §57 发布闸门：后端唯一实现给出，前端只读不重算。 */
export interface DeliveryGate {
  product_id: string;
  product_name: string | null;
  copy_record_id: string | null;
  copy_version: number | null;
  review_version: number | null;
  approval_status: FactReviewStatus;
  approved: boolean;
  publishable: boolean;
  ready: boolean;
  red_count: number;
  blocking_sentences: string[];
  reason: string | null;
  next_action: string | null;
  spec_ref: string;
}

/** `/api/delivery/labels` 里的一条闸门状态：只有这一处带 label / tone。 */
export interface DeliveryGateStateMeta {
  label: string;
  tone: DeliveryTone;
  ready: boolean;
  reason: string | null;
  next_action: string | null;
}

export interface DeliverySlotMeta {
  key: string;
  label: string;
  requirement: string;
  source: string;
  spec_ref: string;
}

export interface DeliveryExportFormatMeta {
  key: DeliveryExportFormat;
  label: string;
  extension: string;
  content_type: string;
  hint: string;
}

export interface DeliveryExportScopeMeta {
  key: DeliveryExportScope;
  label: string;
  hint: string;
}

export interface DeliveryLimits {
  defaultPageSize: number;
  maxPageSize: number;
  maxExportChars: number;
  maxQueryLength: number;
}

export interface DeliveryPublishGate {
  spec_ref: string;
  requires_approved: boolean;
  requires_latest_copy: boolean;
  red_blocks_publish: boolean;
  no_copy_no_material: boolean;
  blocking_states: string[];
}

export interface DeliveryContract {
  spec_ref: string;
  host_center: { spec_ref: string; slot_count: number; slots: DeliverySlotMeta[] };
  dealer_center: { spec_ref: string; slot_count: number; slots: DeliverySlotMeta[] };
  export: {
    spec_ref: string;
    formats: DeliveryExportFormatMeta[];
    scopes: DeliveryExportScopeMeta[];
  };
  publish_gate: DeliveryPublishGate;
  /** 派生视图：不新增表、不改写正文（§62-15） */
  derived_view: boolean;
  /** 所有版本必须保留：导出永远标注成稿版本与第几次审核 */
  keep_all_versions: boolean;
  limits: DeliveryLimits;
  rules: string[];
}

export interface DeliveryDownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  status: "PENDING";
}

export interface DeliveryContractResponse {
  contract: DeliveryContract;
  downstream: DeliveryDownstreamItem[];
  limits: DeliveryLimits;
}

export interface DeliveryLabels {
  host_center_slots: DeliverySlotMeta[];
  dealer_center_slots: DeliverySlotMeta[];
  export_formats: DeliveryExportFormatMeta[];
  export_scopes: DeliveryExportScopeMeta[];
  gate_states: DeliveryGateStateMeta[];
  limits: DeliveryLimits;
  rules: string[];
}

/** 顶部状态条要用的成稿摘要：只读落库冻结值（§57 / §62-15）。 */
export interface DeliverySummary {
  copy_record_id: string | null;
  copy_version: number | null;
  copy_created_at: string | null;
  intensity: CopyIntensity | null;
  impact_score: number | null;
  impact_band: ImpactScoreBand | null;
  impact_band_label: string | null;
  level5_passed: boolean;
  compliance_risk: "GREEN" | "YELLOW" | "RED" | null;
  gate: DeliveryGate;
  /** 只有闸门通过时才为 true；前端据此决定是否展示正文（§53 / §57） */
  ready: boolean;
}

/** §51 主播中心：一版已审批成稿重排成「主播拿起来就能念」的十项。 */
export interface HostCenterView extends DeliverySummary {
  product_id: string;
  product_name: string;
  slots: HostCenterSlotView[];
  spec_ref: string;
}

/** §52 经销商中心：同一版成稿重排成「讲给终端听」的十项。 */
export interface DealerCenterView extends DeliverySummary {
  product_id: string;
  product_name: string;
  slots: DealerCenterSlotView[];
  spec_ref: string;
}

/** §60 导出：正文逐字来自两个中心，`chars === content.length`。 */
export interface DeliveryExportView {
  product_id: string;
  product_name: string;
  format: DeliveryExportFormat;
  scope: DeliveryExportScope;
  filename: string;
  content_type: string;
  content: string;
  chars: number;
  copy_record_id: string | null;
  copy_version: number | null;
  review_version: number | null;
  gate: DeliveryGate;
  generated_at: string;
  spec_ref: string;
}

/** §31 跨产品排产列表的一行：`ready` / `gate_reason` 与详情页同源（§62-14）。 */
export interface HostCenterRow {
  product_id: string;
  product_name: string;
  year: number;
  tea_type: string;
  mountain: string | null;
  copy_record_id: string | null;
  copy_version: number | null;
  one_liner: string | null;
  intensity: CopyIntensity | null;
  impact_score: number | null;
  impact_band: ImpactScoreBand | null;
  level5_passed: boolean;
  compliance_passed: boolean;
  generated_at: string | null;
  review_version: number | null;
  approval_status: FactReviewStatus;
  publishable: boolean | null;
  red_count: number;
  ready: boolean;
  gate_reason: string | null;
  spec_ref: string;
}

export interface HostCenterListResponse {
  items: HostCenterRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 跨产品列表的查询条件：`ready` 是三态（`null` = 不筛）。 */
export interface HostCenterQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  ready?: boolean | null;
}

/* ------------------------------------------------------------ 展示辅助 */

/** 六态判定：与后端 `deliveryGateLabel()` / `deliveryGateTone()` 同一顺序、同一条件。 */
export function gateStateOf(gate: DeliveryGate): DeliveryGateStateKey {
  if (gate.ready) {
    return "READY";
  }
  if (gate.copy_record_id === null) {
    return "NO_COPY";
  }
  if (gate.review_version === null) {
    return "NEEDS_REVIEW";
  }
  if (gate.red_count > 0 || !gate.publishable) {
    return "RED_BLOCKED";
  }
  return gate.approval_status === "REJECTED" ? "REJECTED" : "NEEDS_APPROVAL";
}

export function gateStateIndex(key: DeliveryGateStateKey): number {
  return DELIVERY_GATE_STATE_ORDER.indexOf(key);
}

/**
 * 闸门的展示口径：`label` / `tone` 优先取字典（与后端 `gate_states` 同序），
 * `reason` / `next_action` 优先取 `gate` 自己带的那一份——它带版本号，比字典更准（§53 / §64）。
 */
export function gateStateMetaOf(
  gate: DeliveryGate,
  labels: DeliveryLabels | null
): { key: DeliveryGateStateKey; label: string; tone: DeliveryTone; reason: string | null; next_action: string | null } {
  const key = gateStateOf(gate);
  const fallback = DELIVERY_GATE_STATE_FALLBACK[key];
  const meta = labels?.gate_states[gateStateIndex(key)];
  return {
    key,
    label: meta?.label ?? fallback.label,
    tone: meta?.tone ?? fallback.tone,
    reason: gate.reason ?? meta?.reason ?? fallback.reason,
    next_action: gate.next_action ?? meta?.next_action ?? fallback.next_action
  };
}

/** 只要 label / tone 的场合（表格、Pill）。 */
export function gateLabelTone(
  gate: DeliveryGate,
  labels: DeliveryLabels | null
): { label: string; tone: DeliveryTone } {
  const meta = gateStateMetaOf(gate, labels);
  return { label: meta.label, tone: meta.tone };
}

/**
 * 列表行 → 闸门对象。
 *
 * 跨产品列表为了少传字段，只回了 `ready / gate_reason / approval_status / publishable / red_count`，
 * 这里按后端同一套条件把它还原成 `DeliveryGate`，让列表与详情页共用同一个六态判定
 * （§62-14：同一口径只有一份实现，页面与页面之间不许出现两种说法）。
 */
export function gateOfRow(row: HostCenterRow): DeliveryGate {
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    copy_record_id: row.copy_record_id,
    copy_version: row.copy_version,
    review_version: row.review_version,
    approval_status: row.approval_status,
    approved: row.approval_status === "APPROVED",
    publishable: row.publishable === true,
    ready: row.ready,
    red_count: row.red_count,
    blocking_sentences: [],
    reason: row.gate_reason,
    next_action: null,
    spec_ref: row.spec_ref
  };
}

/** 十项格子的中文名：优先用 `/api/delivery/labels`，拿不到时用基线原文兜底。 */
export function slotLabel(
  key: string,
  side: "host" | "dealer",
  labels: DeliveryLabels | null
): string {
  const metas = side === "host" ? labels?.host_center_slots : labels?.dealer_center_slots;
  const found = metas?.find((meta) => meta.key === key);
  if (found) {
    return found.label;
  }
  const fallback: Record<string, string> =
    side === "host" ? HOST_CENTER_SLOT_FALLBACK_LABELS : DEALER_CENTER_SLOT_FALLBACK_LABELS;
  return fallback[key] ?? key;
}

export function exportFormatLabel(
  format: DeliveryExportFormat,
  labels: DeliveryLabels | null
): string {
  const found = labels?.export_formats.find((meta) => meta.key === format);
  if (found) {
    return found.label;
  }
  return format === "MARKDOWN" ? "Markdown" : "纯文本";
}

export function exportScopeLabel(scope: DeliveryExportScope, labels: DeliveryLabels | null): string {
  const found = labels?.export_scopes.find((meta) => meta.key === scope);
  if (found) {
    return found.label;
  }
  if (scope === "HOST") {
    return "只要主播中心";
  }
  return scope === "DEALER" ? "只要经销商中心" : "主播 + 经销商完整资料";
}

/** 审批状态文案只读事实审核那一份兜底表，交付层不另写「已批准」这类同义说法。 */
export function approvalStatusLabel(status: FactReviewStatus): string {
  return FACT_REVIEW_STATUS_FALLBACK_LABELS[status];
}

export function approvalStatusTone(status: FactReviewStatus): DeliveryTone {
  if (status === "APPROVED") {
    return "ok";
  }
  return status === "REJECTED" ? "danger" : "warn";
}

/**
 * 导出被拒时的可读信息（§53 / §57）。
 *
 * 后端两种拒绝：闸门不通过 → 409 + `details.gate_label / blocking_sentences / next_action`；
 * 正文超上限 → 400 + `details.chars / max_export_chars`。两种都原样摆出来，不吞理由。
 */
export interface DeliveryExportBlocked {
  status: number;
  message: string;
  gateLabel: string | null;
  blockingSentences: string[];
  nextAction: string | null;
  overLimit: { chars: number; maxChars: number } | null;
}

export function deliveryExportBlockedOf(error: unknown): DeliveryExportBlocked | null {
  if (!(error instanceof ApiError) || (error.status !== 409 && error.status !== 400)) {
    return null;
  }
  const details = (error.details ?? {}) as Record<string, unknown>;
  const blocking = details.blocking_sentences;
  const gateLabel = typeof details.gate_label === "string" ? details.gate_label : null;
  const nextAction = typeof details.next_action === "string" ? details.next_action : null;
  const chars = typeof details.chars === "number" ? details.chars : null;
  const maxChars = typeof details.max_export_chars === "number" ? details.max_export_chars : null;
  return {
    status: error.status,
    message: error.message,
    gateLabel,
    blockingSentences: Array.isArray(blocking)
      ? blocking.filter((item): item is string => typeof item === "string")
      : [],
    nextAction,
    overLimit: chars !== null && maxChars !== null ? { chars, maxChars } : null
  };
}

/** 一格能不能复制：只有真的拿到正文才算（闸门未通过时 `text` 为 null、`lines` 为空）。 */
export function slotCopyText(slot: DeliverySlotView): string | null {
  if (slot.lines.length > 0) {
    return slot.lines.join("\n");
  }
  return slot.text;
}

/** 降级复制：`navigator.clipboard` 在非安全上下文里不可用时，用隐藏 textarea 兜底。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走兜底路径：剪贴板权限被拒时不该让按钮直接失败。
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 导出落盘：`Blob` + 临时链接触发下载，文件名用后端给的那一份（含成稿版本）。 */
export function downloadExportFile(view: DeliveryExportView): void {
  const blob = new Blob([view.content], { type: view.content_type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = view.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 导出请求：闸门不通过时抛 409，正文超上限抛 400，两种都由调用方转成可读提示。 */
export async function requestDeliveryExport(
  token: string | null,
  productId: string,
  format: DeliveryExportFormat,
  scope: DeliveryExportScope
): Promise<DeliveryExportView> {
  const query = new URLSearchParams();
  query.set("format", format === "MARKDOWN" ? "markdown" : "text");
  query.set("scope", scope === "HOST" ? "host" : scope === "DEALER" ? "dealer" : "all");
  return apiRequest<DeliveryExportView>(
    `/api/products/${productId}/delivery/export?${query.toString()}`,
    { token }
  );
}

/* ------------------------------------------------------------ 数据钩子 */

/** 合同自检：十项 × 2 / 导出格式与范围 / 发布闸门 / 七条铁律都按后端口径渲染。 */
export function useDeliveryContract(token: string | null): {
  contract: DeliveryContract | null;
  downstream: DeliveryDownstreamItem[];
  limits: DeliveryLimits | null;
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<DeliveryContract | null>(null);
  const [downstream, setDownstream] = useState<DeliveryDownstreamItem[]>([]);
  const [limits, setLimits] = useState<DeliveryLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<DeliveryContractResponse>("/api/delivery/contract", { token });
      setContract(result.contract);
      setDownstream(result.downstream ?? []);
      setLimits(result.limits ?? null);
      setError(null);
    } catch {
      setError("读取 §51 / §52 / §53 交付合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, downstream, limits, loading, error };
}

export function useDeliveryLabels(token: string | null): {
  labels: DeliveryLabels | null;
  loading: boolean;
  error: string | null;
} {
  const [labels, setLabels] = useState<DeliveryLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<DeliveryLabels>("/api/delivery/labels", { token });
      setLabels(result);
      setError(null);
    } catch {
      setError("读取交付层文案失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { labels, loading, error };
}

/** 跨产品排产列表：筛选条件进 URL 后原样映射成 query（`ready` 三态必须显式分支）。 */
export function useHostCenterList(
  token: string | null,
  query: HostCenterQuery
): {
  data: HostCenterListResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const { page, pageSize, q, ready } = query;
  const [data, setData] = useState<HostCenterListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (page) {
      params.set("page", String(page));
    }
    if (pageSize) {
      params.set("pageSize", String(pageSize));
    }
    if (q && q.trim()) {
      params.set("q", q.trim());
    }
    if (ready === true) {
      params.set("ready", "true");
    } else if (ready === false) {
      params.set("ready", "false");
    }
    const suffix = params.toString();
    apiRequest<HostCenterListResponse>(`/api/host-center${suffix ? `?${suffix}` : ""}`, { token })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setData(null);
          setError(caught instanceof ApiError ? caught.message : "读取主播中心排产列表失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, pageSize, q, ready, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, loading, error, reload };
}

/** §51 主播中心十项。 */
export function useHostCenter(
  token: string | null,
  productId: string | null
): { view: HostCenterView | null; loading: boolean; error: string | null; reload: () => void } {
  const [view, setView] = useState<HostCenterView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<HostCenterView>(`/api/products/${productId}/host-center`, { token })
      .then((result) => {
        if (!cancelled) {
          setView(result);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setView(null);
          setError(caught instanceof ApiError ? caught.message : "读取主播中心失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, productId, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { view, loading, error, reload };
}

/** §52 经销商中心十项。 */
export function useDealerCenter(
  token: string | null,
  productId: string | null
): { view: DealerCenterView | null; loading: boolean; error: string | null; reload: () => void } {
  const [view, setView] = useState<DealerCenterView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<DealerCenterView>(`/api/products/${productId}/dealer-center`, { token })
      .then((result) => {
        if (!cancelled) {
          setView(result);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setView(null);
          setError(caught instanceof ApiError ? caught.message : "读取经销商中心失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, productId, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { view, loading, error, reload };
}

/** 历史版本（§62-15）：成稿版本 + 审核版本一次取齐，两个接口的返回都是 `{ items }`。 */
export function useProductVersions(
  token: string | null,
  productId: string | null
): {
  copyVersions: SalesCopyVersionSummary[];
  reviewVersions: FactReviewVersionSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [copyVersions, setCopyVersions] = useState<SalesCopyVersionSummary[]>([]);
  const [reviewVersions, setReviewVersions] = useState<FactReviewVersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiRequest<{ items: SalesCopyVersionSummary[] }>(`/api/products/${productId}/copy/versions`, {
        token
      }),
      apiRequest<{ items: FactReviewVersionSummary[] }>(
        `/api/products/${productId}/fact-review/versions`,
        { token }
      )
    ])
      .then(([copy, review]) => {
        if (cancelled) {
          return;
        }
        setCopyVersions(copy.items ?? []);
        setReviewVersions(review.items ?? []);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setCopyVersions([]);
        setReviewVersions([]);
        setError(caught instanceof ApiError ? caught.message : "读取历史版本失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, productId, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { copyVersions, reviewVersions, loading, error, reload };
}
