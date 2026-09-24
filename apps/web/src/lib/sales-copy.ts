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
 * Phase 12 强成交话术 + Phase 13「再狠一点」（规格 §21 五档强度 / §22 Level 5 七项 / §23 成交冲击力评分 /
 * §26 九种主播输出 / §27 3 分钟八段 / §33 价值重点八项 / §34 再狠一点 / §47 十五项清单 / §48 Agent 10 八项自检）。
 *
 * 与产品结构、配方哲学同理：**口径全部来自后端**（`/api/sales-copy/contract` 与 `/labels`），
 * 前端只负责把「这一版稿子够不够狠、有没有编」摊开。四条必须在界面上说清的规则：
 * 1. §21 五档强度固定（研究 / 专业 / 强销售 / 直播爆款 / 王者），默认 Level 4，不得增删或重排；
 * 2. §23 八项评分合计 100：Level 4 ≥ 85、Level 5 ≥ 90，< 70 自动重写、不得发布；
 * 3. §22 没有可靠价格锚点时，价格高度叙事必须逐字改用标准句，且不得写任何具体价格故事；
 * 4. §34 / §48「再狠一点」只升档、不新增事实、最多自动增强 3 轮，每次强化都在版本列表里留一条新版本。
 */

export type CopyIntensity = 1 | 2 | 3 | 4 | 5;
export type IntensifyLevel = "NORMAL" | "STRONG" | "VIRAL" | "KING";
export type IntensifySelfCheckKey =
  | "opening_hook"
  | "identity"
  | "value_height"
  | "product_structure"
  | "quotes"
  | "memory_point"
  | "closing_push"
  | "no_manual_tone";
export type ImpactScoreItemKey =
  | "hook"
  | "product_identity"
  | "high_value_sense"
  | "price_or_standard_anchor"
  | "differentiation"
  | "imagery"
  | "memory_point"
  | "closing";
export type ImpactScoreBand = "REWRITE" | "USABLE" | "EXCELLENT" | "CORE";
export type Level5RequirementKey =
  | "rhetorical_question"
  | "identity_definition"
  | "price_height_story"
  | "product_architecture_story"
  | "style_identity"
  | "quotable_lines"
  | "closing";
export type SalesCopyOutputKey =
  | "core_quotes"
  | "backup_quotes"
  | "sec15"
  | "sec30"
  | "sec60"
  | "min3"
  | "level5_release"
  | "dealer_copy"
  | "objections";
export type Min3SegmentKey =
  | "hook"
  | "identity"
  | "value_track"
  | "value_logic"
  | "structure_or_formula"
  | "palate"
  | "who_for"
  | "closing";
export type ValueFocusKey =
  | "identity"
  | "market_price"
  | "material"
  | "mountain"
  | "formula_philosophy"
  | "style"
  | "time"
  | "collection";
export type SalesCopyOutputStatus = "DONE" | "MISSING";
export type SalesCopyComplianceRisk = "GREEN" | "YELLOW" | "RED";
export type SalesCopySort =
  | "-updated_at"
  | "updated_at"
  | "product_name"
  | "-product_name"
  | "-impact_score"
  | "-version";

export {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  formatDateTime
};
export type { ResolvedMode, AnchorResolveSource };

/** §21 固定顺序：五档强度不得增删或重排。 */
export const COPY_INTENSITY_ORDER: CopyIntensity[] = [1, 2, 3, 4, 5];

/** §23 固定顺序：八项评分（权重合计 100）。 */
export const IMPACT_SCORE_ITEM_ORDER: ImpactScoreItemKey[] = [
  "hook",
  "product_identity",
  "high_value_sense",
  "price_or_standard_anchor",
  "differentiation",
  "imagery",
  "memory_point",
  "closing"
];

/** §22 固定顺序：Level 5 七项强制。 */
export const LEVEL5_REQUIREMENT_ORDER: Level5RequirementKey[] = [
  "rhetorical_question",
  "identity_definition",
  "price_height_story",
  "product_architecture_story",
  "style_identity",
  "quotable_lines",
  "closing"
];

/** §26 固定顺序：九种主播输出。 */
export const SALES_COPY_OUTPUT_ORDER: SalesCopyOutputKey[] = [
  "core_quotes",
  "backup_quotes",
  "sec15",
  "sec30",
  "sec60",
  "min3",
  "level5_release",
  "dealer_copy",
  "objections"
];

/** §27 固定顺序：3 分钟八段时序。 */
export const MIN3_SEGMENT_ORDER: Min3SegmentKey[] = [
  "hook",
  "identity",
  "value_track",
  "value_logic",
  "structure_or_formula",
  "palate",
  "who_for",
  "closing"
];

/** §33 固定顺序：价值重点八项（默认全选）。 */
export const VALUE_FOCUS_ORDER: ValueFocusKey[] = [
  "identity",
  "market_price",
  "material",
  "mountain",
  "formula_philosophy",
  "style",
  "time",
  "collection"
];

/** 兜底文案：与后端 `COPY_INTENSITY_META` 同口径，优先使用 `/labels` 返回值。 */
export const COPY_INTENSITY_FALLBACK_LABELS: Record<CopyIntensity, string> = {
  1: "Level 1｜研究",
  2: "Level 2｜专业",
  3: "Level 3｜强销售",
  4: "Level 4｜直播爆款",
  5: "Level 5｜王者"
};

export const COPY_INTENSITY_FALLBACK_SHORT_LABELS: Record<CopyIntensity, string> = {
  1: "研究",
  2: "专业",
  3: "强势",
  4: "爆款",
  5: "王者"
};

export const COPY_INTENSITY_FALLBACK_TONES: Record<
  CopyIntensity,
  "neutral" | "info" | "warn" | "brand" | "ok"
> = { 1: "neutral", 2: "info", 3: "warn", 4: "brand", 5: "ok" };

export const IMPACT_SCORE_ITEM_FALLBACK_LABELS: Record<ImpactScoreItemKey, string> = {
  hook: "开场抓人",
  product_identity: "产品身份",
  high_value_sense: "高价值感",
  price_or_standard_anchor: "价格 / 标准锚定",
  differentiation: "产品差异",
  imagery: "画面感",
  memory_point: "记忆点",
  closing: "成交推进"
};

export const IMPACT_SCORE_BAND_FALLBACK_META: Record<
  ImpactScoreBand,
  Pick<ImpactScoreBandMeta, "label" | "min" | "tone" | "note">
> = {
  REWRITE: { label: "自动重写", min: 0, tone: "danger", note: "< 70 分：不得发布，必须重写" },
  USABLE: { label: "可用", min: 70, tone: "warn", note: "70–79 分：可用，但还没到爆款" },
  EXCELLENT: { label: "优秀", min: 80, tone: "ok", note: "80–89 分：优秀" },
  CORE: { label: "核心主播稿", min: 90, tone: "brand", note: "90+ 分：核心主播稿" }
};

export const VALUE_FOCUS_FALLBACK_LABELS: Record<ValueFocusKey, string> = {
  identity: "身份",
  market_price: "市场高价",
  material: "原料",
  mountain: "山头",
  formula_philosophy: "配方哲学",
  style: "风格",
  time: "时间",
  collection: "收藏"
};

export const SALES_COPY_OUTPUT_FALLBACK_LABELS: Record<SalesCopyOutputKey, string> = {
  core_quotes: "5 句核心金句",
  backup_quotes: "20 句备用金句",
  sec15: "15 秒",
  sec30: "30 秒",
  sec60: "60 秒",
  min3: "3 分钟",
  level5_release: "Level 5 新品发布",
  dealer_copy: "经销商版",
  objections: "异议处理"
};

/** §7 固定顺序：牛逼化按钮四档（普通 → 强势 → 爆款 → 王者），只升不降。 */
export const INTENSIFY_LEVEL_ORDER: IntensifyLevel[] = ["NORMAL", "STRONG", "VIRAL", "KING"];

/** 兜底文案：与后端 `INTENSIFY_BUTTON_LABELS` 同口径，优先使用 `/labels` 返回值。 */
export const INTENSIFY_LEVEL_FALLBACK_LABELS: Record<IntensifyLevel, string> = {
  NORMAL: "普通",
  STRONG: "强势",
  VIRAL: "爆款",
  KING: "王者"
};

/** §48 固定顺序：Agent 10 八项自检（最后一项是负向检查）。 */
export const INTENSIFY_SELF_CHECK_ORDER: IntensifySelfCheckKey[] = [
  "opening_hook",
  "identity",
  "value_height",
  "product_structure",
  "quotes",
  "memory_point",
  "closing_push",
  "no_manual_tone"
];

export const INTENSIFY_SELF_CHECK_FALLBACK_LABELS: Record<IntensifySelfCheckKey, string> = {
  opening_hook: "开头 3 秒抓人",
  identity: "身份拉满",
  value_height: "价值高度拉满",
  product_structure: "产品结构讲清楚",
  quotes: "短视频金句密度",
  memory_point: "记忆点立得住",
  closing_push: "成交推进收口",
  no_manual_tone: "说明书味太重"
};

/**
 * 被改写的位置名（§48 抽查用）。
 *
 * 后端返回的是形如 `headline.opening_hook` / `quotes.core_quotes` 的机械路径；
 * 这里只把它们翻成人话，未知路径原样显示（宁可露出路径，也不静默吞掉改写点）。
 */
export const INTENSIFY_CHANGED_ELEMENT_LABELS: Record<string, string> = {
  "headline.one_liner": "一句话定位",
  "headline.opening_hook": "开场 3 秒钩子",
  "headline.identity_definition": "身份定义",
  "headline.price_or_standard_story": "价格 / 标准叙事",
  "headline.value_story": "价值故事",
  "headline.product_architecture_story": "产品结构叙事",
  "headline.formula_philosophy_story": "配方哲学叙事",
  "headline.style_identity": "风格身份证",
  "headline.differentiation": "差异化对比",
  "headline.imagery": "画面感",
  "headline.memory_point": "记忆点",
  "headline.who_for": "适合谁",
  "headline.closing": "成交收口",
  "quotes.core_quotes": "5 句核心金句",
  "quotes.backup_quotes": "20 句备用金句",
  "selling_points": "§47 七大卖点",
  "scripts.sec15": "15 秒稿",
  "scripts.sec30": "30 秒稿",
  "scripts.sec60": "60 秒稿",
  "scripts.min3.text": "3 分钟稿",
  "scripts.min3.segments": "3 分钟八段",
  level5_release: "Level 5 新品发布稿",
  dealer_copy: "经销商版",
  "objections.objection": "异议问题",
  "objections.response": "异议应答"
};

export const SALES_COPY_SORT_LABELS: Record<SalesCopySort, string> = {
  "-updated_at": "最近生成优先",
  updated_at: "最久未生成优先",
  product_name: "产品名 A→Z",
  "-product_name": "产品名 Z→A",
  "-impact_score": "成交冲击力最高优先",
  "-version": "版本最高优先"
};

/** 兜底：§22 原文标准句；界面上逐字对照时以后端合同返回值为唯一准。 */
export const NO_ANCHOR_STANDARD_SENTENCE_FALLBACK =
  "这款茶不是用别人现成的价格给自己撑腰，而是先把自己的产品标准立起来。";

/* ------------------------------------------------------------ 后端对象 */

export interface CopyIntensityMeta {
  level: CopyIntensity;
  label: string;
  short_label: string;
  tone: "neutral" | "info" | "warn" | "brand" | "ok";
  definition: string;
  requirement: string;
  is_king: boolean;
  spec_ref: string;
}

export interface IntensifyButtonMeta {
  level: IntensifyLevel;
  label: string;
  copy_intensity: CopyIntensity;
  note: string;
  spec_ref: string;
}

export interface ImpactScoreCriterion {
  key: string;
  check: string;
  points: number;
}

export interface ImpactScoreItemMeta {
  key: ImpactScoreItemKey;
  label: string;
  weight: number;
  criterion: string;
  source: string;
  criteria: ImpactScoreCriterion[];
  spec_ref: string;
}

export interface ImpactScoreCriterionResult {
  key: string;
  check: string;
  points: number;
  passed: boolean;
}

export interface ImpactScoreItemView {
  key: ImpactScoreItemKey;
  label: string;
  weight: number;
  criterion: string;
  points: number;
  criteria: ImpactScoreCriterionResult[];
  spec_ref: string;
}

export interface ImpactScoreBandMeta {
  band: ImpactScoreBand;
  label: string;
  min: number;
  tone: "danger" | "warn" | "ok" | "brand";
  note: string;
}

export interface ImpactScoreView {
  spec_ref: "§23";
  total: number;
  max: number;
  band: ImpactScoreBand;
  band_label: string;
  required: number | null;
  passed: boolean;
  facts_used: number;
  note: string;
  items: ImpactScoreItemView[];
}

export interface Level5RequirementMeta {
  key: Level5RequirementKey;
  label: string;
  requirement: string;
  check: string;
  source: string;
  spec_ref: string;
}

export interface Level5RequirementStatus {
  key: Level5RequirementKey;
  label: string;
  requirement: string;
  check: string;
  status: "DONE" | "MISSING";
  evidence: string | null;
  spec_ref: string;
}

export interface SalesCopyLevel5Check {
  spec_ref: "§22";
  required: boolean;
  satisfied: boolean;
  missing: Level5RequirementKey[];
  requirements: Level5RequirementStatus[];
  no_anchor_standard_sentence: string;
}

export interface SalesCopyOutputMeta {
  key: SalesCopyOutputKey;
  label: string;
  requirement: string;
  source: string;
  spec_ref: string;
}

export interface SalesCopyOutputStatusView {
  key: SalesCopyOutputKey;
  label: string;
  requirement: string;
  status: SalesCopyOutputStatus;
  count: number;
  chars: number;
  spec_ref: string;
}

export interface SalesCopyAgent9OutputMeta {
  key: string;
  label: string;
  source: string;
  spec_ref: string;
}

export interface Min3SegmentMeta {
  key: Min3SegmentKey;
  time_range: string;
  label: string;
  requirement: string;
  source: string;
  spec_ref: string;
}

export interface Min3SegmentView {
  key: Min3SegmentKey;
  time_range: string;
  label: string;
  requirement: string;
  text: string;
}

export interface ValueFocusMeta {
  key: ValueFocusKey;
  label: string;
  requirement: string;
  evidence_refs: string[];
  spec_ref: string;
}

export interface SalesCopyQuote {
  core_quotes: string[];
  backup_quotes: string[];
}

export interface SalesCopyHeadline {
  one_liner: string;
  opening_hook: string;
  identity_definition: string;
  price_or_standard_story: string;
  value_story: string;
  product_architecture_story: string;
  formula_philosophy_story: string;
  style_identity: string;
  differentiation: string;
  imagery: string;
  memory_point: string;
  who_for: string;
  closing: string;
}

export interface SalesCopyScripts {
  sec15: string;
  sec30: string;
  sec60: string;
  min3: { segments: Min3SegmentView[]; text: string };
}

export interface SalesCopyObjection {
  objection: string;
  response: string;
  layer: "INTERPRETATION" | "RHETORIC";
  spec_ref: string;
}

export interface SalesCopyAnchorRef {
  has_reliable_price_anchor: boolean;
  primary_anchor_id: string | null;
  primary_anchor_name: string | null;
  anchor_count: number;
  usage: "STANDARD_ONLY";
}

export interface SalesCopyUpstreamStatus {
  architecture_version: number | null;
  architecture_acceptance_passed: boolean;
  philosophy_version: number | null;
  philosophy_acceptance_passed: boolean;
  category_creator_ready: boolean;
  value_codes_ready: boolean;
}

export interface SalesCopyCompliance {
  spec_ref: "§24 / §25 / §62";
  rnd_confirmed: boolean;
  rnd_claimed: boolean;
  forbidden_promises: string[];
  restricted_phrases: string[];
  fabricated_categories: string[];
  risk: SalesCopyComplianceRisk;
  note: string;
}

export interface SalesCopyAcceptance {
  spec_ref: "§57";
  question: string;
  intensity: CopyIntensity;
  required_score: number | null;
  impact_score: number;
  score_passed: boolean;
  quotes_total: number;
  min_quotes: number;
  core_quotes: number;
  backup_quotes: number;
  outputs_complete: boolean;
  missing_outputs: SalesCopyOutputKey[];
  level5_passed: boolean;
  compliance_passed: boolean;
  passed: boolean;
  missing: string[];
}

export interface SalesCopyLimits {
  maxVersionsPerProduct: number;
  coreQuoteCount: number;
  backupQuoteCount: number;
  sellingPointCount: number;
  maxObjections: number;
  minLevel5QuotableLines: number;
  minRecordedFacts: number;
  minQuoteLength: number;
  maxQuoteLength: number;
  maxTextLength: number;
  defaultPageSize: number;
  maxPageSize: number;
}

export interface SalesCopyRecordView {
  id: string;
  product_id: string;
  product_name?: string | null;
  version: number;
  preference: "AUTO" | ResolvedMode;
  mode_at_generation: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  intensity: CopyIntensity;
  intensify_rounds: number;
  value_focus: ValueFocusKey[];
  anchor: SalesCopyAnchorRef;
  upstream: SalesCopyUpstreamStatus;
  headline: SalesCopyHeadline;
  quotes: SalesCopyQuote;
  selling_points: string[];
  scripts: SalesCopyScripts;
  level5_release: string;
  dealer_copy: string;
  objections: SalesCopyObjection[];
  output_statuses: SalesCopyOutputStatusView[];
  impact_score: ImpactScoreView;
  level5: SalesCopyLevel5Check;
  compliance: SalesCopyCompliance;
  acceptance: SalesCopyAcceptance;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  upstream_refs: string[];
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  spec_ref: "§21 / §22 / §23 / §26 / §27 / §33 / §47";
}

export interface SalesCopyVersionSummary {
  id: string;
  version: number;
  intensity: CopyIntensity;
  /** §34 / §48：这一版已经自动增强过几轮（0–3） */
  intensify_rounds: number;
  impact_score: number;
  band: ImpactScoreBand;
  score_passed: boolean;
  outputs_complete: boolean;
  level5_passed: boolean;
  compliance_passed: boolean;
  acceptance_passed: boolean;
  is_confirmed: boolean;
  created_at: string;
}

export interface SalesCopyOverview {
  product_id: string;
  product_name?: string | null;
  preference: "AUTO" | ResolvedMode;
  mode: ResolvedMode;
  resolved_by: AnchorResolveSource;
  mode_reason: string;
  default_intensity: CopyIntensity;
  can_generate: boolean;
  block_reason: string | null;
  record: SalesCopyRecordView | null;
  versions: SalesCopyVersionSummary[];
  missing_outputs: SalesCopyOutputKey[];
  anchor: SalesCopyAnchorRef;
  upstream: SalesCopyUpstreamStatus;
  spec_ref: "§21 / §26 / §27 / §47";
}

export interface SalesCopyMatrixRow {
  product_id: string;
  product_name: string;
  year: number;
  tea_type: string;
  mountain: string | null;
  mode: ResolvedMode;
  preference: "AUTO" | ResolvedMode;
  has_reliable_price_anchor: boolean;
  record_id: string | null;
  version: number | null;
  intensity: CopyIntensity | null;
  impact_score: number | null;
  band: ImpactScoreBand | null;
  is_confirmed: boolean;
  outputs_complete: boolean;
  level5_passed: boolean;
  compliance_passed: boolean;
  acceptance_passed: boolean;
  missing_outputs: SalesCopyOutputKey[];
  one_liner: string | null;
  generated_at: string | null;
  spec_ref: "§21 / §26 / §47";
}

export interface SalesCopyLibraryResponse {
  items: SalesCopyMatrixRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/* ------------------------------------------------------- 合同与标签口径 */

/**
 * §48 Agent 10 八项自检里的一项。
 *
 * `passed` 与 §23 的 criteria 同源（`no_manual_tone` 是负向检查：没有说明书味才算过），
 * `evidence` 是判定依据的原文，界面上直接摊开给人工抽查用。
 */
export interface SalesCopyIntensifySelfCheckItem {
  key: IntensifySelfCheckKey;
  label: string;
  check: string;
  passed: boolean;
  evidence: string | null;
  spec_ref: string;
}

export interface SalesCopyIntensifySelfCheck {
  spec_ref: "§48";
  level: IntensifyLevel;
  intensity: CopyIntensity;
  score: number;
  required_score: number | null;
  score_passed: boolean;
  items: SalesCopyIntensifySelfCheckItem[];
  missing: IntensifySelfCheckKey[];
  passed: boolean;
  max_auto_rounds: number;
  note: string;
}

export interface SalesCopyIntensifyPrevious {
  version: number;
  intensity: CopyIntensity;
  impact_score: number;
  band: ImpactScoreBand;
  passed: boolean;
}

/**
 * §7 / §34 / §48「再狠一点」的响应体。
 *
 * 三件事必须如实呈现：新版本是**新增的一版**（源版本原封不动）、
 * `added_facts` 必须为空（强化器在机械层面就不允许增加任何新事实）、
 * `self_check` 达不到阈值时如实标未通过（最多自动 3 轮，之后必须人工处理）。
 */
export interface SalesCopyIntensifyResult {
  level: IntensifyLevel;
  intensity: CopyIntensity;
  source_intensity: CopyIntensity;
  round: number;
  max_auto_rounds: number;
  previous: SalesCopyIntensifyPrevious;
  changed_elements: string[];
  added_facts: string[];
  self_check: SalesCopyIntensifySelfCheck;
  record: SalesCopyRecordView;
  spec_ref: "§7 / §34 / §48";
}

export interface SalesCopyIntensifyButton {
  levels: IntensifyButtonMeta[];
  /** §7 内部映射：NORMAL→2 / STRONG→3 / VIRAL→4 / KING→5 */
  mapping: Record<IntensifyLevel, CopyIntensity>;
  max_auto_rounds: number;
  /** §48 Agent 10 八项自检的判定口径（最后一项是负向检查） */
  self_check?: IntensifySelfCheckMeta[];
  /** §34 机械闸门：新版本的引用清单必须是源版本的子集，多出任何一条已录入事实就拒绝落库 */
  fact_rule?: string;
  note: string;
}

export interface IntensifySelfCheckMeta {
  key: IntensifySelfCheckKey;
  label: string;
  check: string;
  /** 负向检查：满足条件反而算不通过（目前只有「说明书味太重」一项） */
  negative: boolean;
  /** 这一项复用 §23 的哪几条 criteria */
  criteria: string[];
  spec_ref: string;
}

export interface SalesCopyImpactScoreContract {
  spec_ref: string;
  max: number;
  items: ImpactScoreItemMeta[];
  bands: ImpactScoreBandMeta[];
  /** 只有 Level 4 / Level 5 有硬性下限（85 / 90），其余档位不设门槛 */
  min_score_by_intensity: Record<number, number>;
}

export interface SalesCopyContract {
  spec_ref: string;
  levels: CopyIntensityMeta[];
  default_level: CopyIntensity;
  intensify_button: SalesCopyIntensifyButton;
  impact_score: SalesCopyImpactScoreContract;
  level5_requirements: Level5RequirementMeta[];
  level5_requirement_count: number;
  outputs: SalesCopyOutputMeta[];
  agent9_outputs: SalesCopyAgent9OutputMeta[];
  min3_timeline: Min3SegmentMeta[];
  value_focus: ValueFocusMeta[];
  default_value_focus: ValueFocusKey[];
  modes: Array<"AUTO" | ResolvedMode>;
  limits: SalesCopyLimits;
  no_anchor_standard_sentence: string;
  /** §58-9：没有可靠价格锚点时必须切自建标准，不得降级成平庸版本 */
  no_anchor_not_weak: boolean;
  /** §34 / §48：任何强化都不得增加新事实 */
  no_new_fact: boolean;
  /** §25：只有 RND_CONFIRMED 才允许研发关系暗示 */
  rnd_requires_confirmation: boolean;
  /** §22：只有存在可靠价格锚点时才允许写价格高度叙事 */
  price_story_only_with_anchor: boolean;
  /** §24：允许极强修辞，只要不编事实、不承诺收益 */
  rhetoric_allowed: boolean;
  /** §57 / §62-14：RED claim 禁止发布 */
  red_blocks_publish: boolean;
  /** §62-11：正文不得变成说明书 */
  no_manual_style: boolean;
  /** §62-15：所有版本必须保留 */
  keep_all_versions: boolean;
  rules: string[];
}

export interface SalesCopyEngineInfo {
  name: string;
  /** Phase 13 仍为 RULE_BASED：纯规则引擎，「再狠一点」也只换说法、不换事实，不调用 AI */
  strategy: string;
  ai_wired: boolean;
  prompt_keys: string[];
  spec_ref: string;
  note: string;
}

export interface SalesCopyDownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  /** 恒为 PENDING：本阶段只登记交接，不得显示为已完成（§60） */
  status: "PENDING";
}

export interface SalesCopyLabels {
  levels: CopyIntensityMeta[];
  level_labels: Record<CopyIntensity, string>;
  level_tones: Record<CopyIntensity, CopyIntensityMeta["tone"]>;
  intensity_short_labels: Record<CopyIntensity, string>;
  intensify_button: IntensifyButtonMeta[];
  intensify_button_labels: Record<IntensifyLevel, string>;
  impact_score_items: ImpactScoreItemMeta[];
  impact_score_bands: Record<ImpactScoreBand, ImpactScoreBandMeta>;
  impact_score_band_meta: ImpactScoreBandMeta[];
  level5_requirements: Level5RequirementMeta[];
  level5_requirement_meta: Record<Level5RequirementKey, Level5RequirementMeta>;
  outputs: SalesCopyOutputMeta[];
  agent9_outputs: SalesCopyAgent9OutputMeta[];
  min3_timeline: Min3SegmentMeta[];
  value_focus: ValueFocusMeta[];
  limits: SalesCopyLimits;
  no_anchor_standard_sentence: string;
  rules: string[];
}

export interface SalesCopyContractResponse {
  contract: SalesCopyContract;
  engine: SalesCopyEngineInfo;
  downstream: SalesCopyDownstreamItem[];
}

/* ------------------------------------------------------------ 展示辅助 */

export function intensityMeta(
  level: CopyIntensity,
  labels: SalesCopyLabels | null
): CopyIntensityMeta | null {
  return labels?.levels.find((item) => item.level === level) ?? null;
}

export function intensityLabel(level: CopyIntensity, labels: SalesCopyLabels | null): string {
  return labels?.level_labels[level] ?? COPY_INTENSITY_FALLBACK_LABELS[level];
}

export function intensityShortLabel(
  level: CopyIntensity,
  labels: SalesCopyLabels | null
): string {
  return labels?.intensity_short_labels[level] ?? COPY_INTENSITY_FALLBACK_SHORT_LABELS[level];
}

export function intensityTone(
  level: CopyIntensity,
  labels: SalesCopyLabels | null
): CopyIntensityMeta["tone"] {
  return labels?.level_tones[level] ?? COPY_INTENSITY_FALLBACK_TONES[level];
}

export function impactItemLabel(
  key: ImpactScoreItemKey,
  labels: SalesCopyLabels | null
): string {
  return (
    labels?.impact_score_items.find((item) => item.key === key)?.label ??
    IMPACT_SCORE_ITEM_FALLBACK_LABELS[key]
  );
}

export function impactBandMeta(
  band: ImpactScoreBand,
  labels: SalesCopyLabels | null
): Omit<ImpactScoreBandMeta, "band" | "spec_ref"> {
  return labels?.impact_score_bands[band] ?? IMPACT_SCORE_BAND_FALLBACK_META[band];
}

export function valueFocusLabel(key: ValueFocusKey, labels: SalesCopyLabels | null): string {
  return (
    labels?.value_focus.find((item) => item.key === key)?.label ??
    VALUE_FOCUS_FALLBACK_LABELS[key]
  );
}

export function outputLabel(key: SalesCopyOutputKey, labels: SalesCopyLabels | null): string {
  return (
    labels?.outputs.find((item) => item.key === key)?.label ??
    SALES_COPY_OUTPUT_FALLBACK_LABELS[key]
  );
}

/** 未生成的记录（矩阵行没有 record_id）在界面上统一按「未生成」而不是「零分」呈现。 */
export function isGenerated(row: SalesCopyMatrixRow): boolean {
  return row.record_id !== null;
}

/* --------------------------------------------------- §34 / §48 强化辅助 */

export function intensifyLevelLabel(
  level: IntensifyLevel,
  labels: SalesCopyLabels | null
): string {
  return labels?.intensify_button_labels[level] ?? INTENSIFY_LEVEL_FALLBACK_LABELS[level];
}

export function intensifyButtonMeta(
  level: IntensifyLevel,
  labels: SalesCopyLabels | null
): IntensifyButtonMeta | null {
  return labels?.intensify_button.find((item) => item.level === level) ?? null;
}

/** 被改写位置的显示名：去掉 `[n]` 下标后查表，查不到的路径原样显示（不静默吞掉）。 */
export function intensifyChangedElementLabel(key: string): string {
  const base = key.replace(/\[\d+\]$/, "");
  return INTENSIFY_CHANGED_ELEMENT_LABELS[base] ?? base;
}

export function intensifySelfCheckLabel(key: IntensifySelfCheckKey): string {
  return INTENSIFY_SELF_CHECK_FALLBACK_LABELS[key];
}

/** §7 兜底映射：与后端 `INTENSIFY_LEVEL_TO_COPY_INTENSITY` 同口径，优先使用合同返回值。 */
export const INTENSIFY_LEVEL_TO_INTENSITY_FALLBACK: Record<IntensifyLevel, CopyIntensity> = {
  NORMAL: 2,
  STRONG: 3,
  VIRAL: 4,
  KING: 5
};

/**
 * 这一版还能不能点「再狠一点」。
 *
 * 与后端 `intensifyGuardReason()` 同一套口径：轮次上限 3 轮、只升不降；
 * 前端提前禁用并给出理由，避免用户点了才吃 400。
 */
export function intensifyBlockReason(
  record: Pick<SalesCopyRecordView, "intensity" | "intensify_rounds"> | null,
  level: IntensifyLevel,
  options: { maxAutoRounds: number; mapping?: Record<IntensifyLevel, CopyIntensity> | null }
): string | null {
  if (!record) {
    return "还没有强成交话术：先生成一版再强化（§34）";
  }
  if (record.intensify_rounds >= options.maxAutoRounds) {
    return `这一版已经自动强化过 ${options.maxAutoRounds} 轮，必须人工处理（§48）`;
  }
  const mapped = options.mapping?.[level] ?? INTENSIFY_LEVEL_TO_INTENSITY_FALLBACK[level];
  if (mapped < record.intensity) {
    return `这一版已经是 Level ${record.intensity}，「${INTENSIFY_LEVEL_FALLBACK_LABELS[level]}」档不能把强度调低（§7 / §34）`;
  }
  if (mapped === record.intensity) {
    return `这一版已经是「${INTENSIFY_LEVEL_FALLBACK_LABELS[level]}」强度，请点更高的一档（§7）`;
  }
  return null;
}

/* ------------------------------------------------------------ 数据钩子 */

/** 合同自检：五档强度、九种输出、八项评分、Level 5 七项与红线全部按后端口径渲染。 */
export function useSalesCopyContract(token: string | null): {
  contract: SalesCopyContract | null;
  engine: SalesCopyEngineInfo | null;
  downstream: SalesCopyDownstreamItem[];
  loading: boolean;
  error: string | null;
} {
  const [contract, setContract] = useState<SalesCopyContract | null>(null);
  const [engine, setEngine] = useState<SalesCopyEngineInfo | null>(null);
  const [downstream, setDownstream] = useState<SalesCopyDownstreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<SalesCopyContractResponse>("/api/sales-copy/contract", {
        token
      });
      setContract(result.contract);
      setEngine(result.engine);
      setDownstream(result.downstream ?? []);
      setError(null);
    } catch {
      setError("读取 §21–§47 强成交话术合同失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { contract, engine, downstream, loading, error };
}

export function useSalesCopyLabels(token: string | null): {
  labels: SalesCopyLabels | null;
  loading: boolean;
  error: string | null;
} {
  const [labels, setLabels] = useState<SalesCopyLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<SalesCopyLabels>("/api/sales-copy/labels", { token });
      setLabels(result);
      setError(null);
    } catch {
      setError("读取强成交话术文案失败");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { labels, loading, error };
}
