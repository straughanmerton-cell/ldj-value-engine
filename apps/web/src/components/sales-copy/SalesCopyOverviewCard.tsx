import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  COPY_INTENSITY_ORDER,
  INTENSIFY_LEVEL_ORDER,
  INTENSIFY_LEVEL_TO_INTENSITY_FALLBACK,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  SALES_COPY_OUTPUT_ORDER,
  VALUE_FOCUS_ORDER,
  formatDateTime,
  intensityLabel,
  intensifyBlockReason,
  intensifyButtonMeta,
  intensifyChangedElementLabel,
  intensifyLevelLabel,
  outputLabel,
  valueFocusLabel,
  type CopyIntensity,
  type IntensifyLevel,
  type SalesCopyContract,
  type SalesCopyComplianceRisk,
  type SalesCopyIntensifyResult,
  type SalesCopyLabels,
  type SalesCopyOverview,
  type SalesCopyRecordView,
  type ValueFocusKey
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface SalesCopyGenerateInput {
  intensity: CopyIntensity;
  valueFocus: ValueFocusKey[];
  notes: string | null;
}

export interface SalesCopyOverviewCardProps {
  overview: SalesCopyOverview | null;
  /** 当前正在查看的那一版（可能是历史版本） */
  record: SalesCopyRecordView | null;
  labels: SalesCopyLabels | null;
  contract: SalesCopyContract | null;
  canWrite: boolean;
  busy: "generate" | "confirm" | "intensify" | null;
  /** §34 / §48：最近一次「再狠一点」的结论（含改写位置与八项自检） */
  intensifyResult: SalesCopyIntensifyResult | null;
  loading: boolean;
  error: string | null;
  onGenerate: (input: SalesCopyGenerateInput) => void;
  onConfirm: (record: SalesCopyRecordView, nextConfirmed: boolean) => void;
  onIntensify: (level: IntensifyLevel) => void;
  onRetry: () => void;
}

function riskTone(risk: SalesCopyComplianceRisk): "ok" | "warn" | "danger" {
  if (risk === "RED") {
    return "danger";
  }
  return risk === "YELLOW" ? "warn" : "ok";
}

/** 兜底：§48 最多自动强化 3 轮；界面以后端合同 `max_auto_rounds` 为唯一准。 */
const SALES_COPY_MAX_INTENSIFY_ROUNDS_FALLBACK = 3;

/** §23 / §48 分数线兜底：只有 Level 4 / Level 5 有硬性下限（85 / 90）。 */
function fallbackMinScore(level: CopyIntensity): number {
  if (level === 5) {
    return 90;
  }
  return level === 4 ? 85 : 0;
}

function riskLabel(risk: SalesCopyComplianceRisk): string {
  if (risk === "RED") {
    return "RED｜禁止发布";
  }
  return risk === "YELLOW" ? "YELLOW｜可发布但需复核" : "GREEN｜无风险命中";
}

/**
 * 强成交话术总览与操作区（规格 §21 / §22 / §23 / §26 / §33 / §34 / §48 / §57 / §62-15）。
 *
 * 六件事必须在这里说清：
 * 1. **为什么是现在这个模式**——有可靠价格锚点走 Benchmark Mode，没有走自建高端标准（§17）；
 * 2. **这一版有多狠**——成交冲击力总分、分档、是否过 Level 4 / Level 5 的最低分（§23）；
 * 3. **有没有编**——合规自检是 GREEN / YELLOW / RED，RED 一律不得发布（§24 / §57）；
 * 4. **价格高度怎么讲的**——没有可靠价格锚点时逐字用 §22 标准句，不得写任何具体价格故事（§22 / §25）；
 * 5. **人工确认只表示「这一版被审过」**——不改写正文、不升版本，重新生成只新增版本（§62-15）；
 * 6. **「再狠一点」到底动了哪里**——四档按钮只升档、不新增事实，改写位置与 §48 八项自检逐条摊开（§34 / §48）。
 */
export function SalesCopyOverviewCard({
  overview,
  record,
  labels,
  contract,
  canWrite,
  busy,
  intensifyResult,
  loading,
  error,
  onGenerate,
  onConfirm,
  onIntensify,
  onRetry
}: SalesCopyOverviewCardProps): ReactElement {
  const [intensity, setIntensity] = useState<CopyIntensity>(overview?.default_intensity ?? 4);
  const [valueFocus, setValueFocus] = useState<ValueFocusKey[]>([...VALUE_FOCUS_ORDER]);
  const [notes, setNotes] = useState("");

  /** 切换产品时回到该产品的默认强度与「八项价值重点全选」，避免把上一款茶的选择带过去。 */
  useEffect(() => {
    setIntensity(overview?.default_intensity ?? 4);
    setValueFocus([...VALUE_FOCUS_ORDER]);
    setNotes("");
  }, [overview?.default_intensity, overview?.product_id]);

  if (loading && !overview) {
    return (
      <Card title="强成交话术总览" spec="§21 / §57">
        <LoadingState label="正在读取强成交话术" />
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card title="强成交话术总览" spec="§21 / §57">
        <ErrorState title="强成交话术读取失败" description={error ?? "未知错误"} onRetry={onRetry} />
      </Card>
    );
  }

  const latest = overview.record;
  const isLatest = record !== null && latest !== null && record.id === latest.id;
  const acceptance = record?.acceptance ?? null;
  const impact = record?.impact_score ?? null;
  const outputsDone = record
    ? record.output_statuses.filter((item) => item.status === "DONE").length
    : 0;
  const factRefs = record?.fact_refs.length ?? 0;

  /** §7 / §34 / §48：按钮映射、轮次上限与分数线全部来自合同，前端不另写一套。 */
  const mapping: Record<IntensifyLevel, CopyIntensity> =
    contract?.intensify_button.mapping ?? INTENSIFY_LEVEL_TO_INTENSITY_FALLBACK;
  const maxAutoRounds =
    contract?.intensify_button.max_auto_rounds ?? SALES_COPY_MAX_INTENSIFY_ROUNDS_FALLBACK;
  const minScore = (level: CopyIntensity): number =>
    contract?.impact_score.min_score_by_intensity[level] ?? fallbackMinScore(level);
  /** 「再狠一点」永远作用于当前查看的这一版——历史版本也可以继续往上升档。 */
  const intensifySource = record ?? latest;
  /** 强化结论只在与当前查看的版本相关时展示，避免把 A 版的结论挂在 B 版下面。 */
  const intensifyResultRelevant =
    intensifyResult !== null &&
    (intensifySource === null ||
      intensifySource.version === intensifyResult.record.version ||
      intensifySource.version === intensifyResult.previous.version);

  function toggleFocus(key: ValueFocusKey, checked: boolean): void {
    setValueFocus((current) => {
      if (!checked) {
        return current.filter((option) => option !== key);
      }
      /** 勾选后按 §33 固定顺序重排，保证传给后端的顺序稳定。 */
      return VALUE_FOCUS_ORDER.filter((option) => option === key || current.includes(option));
    });
  }

  return (
    <Card
      title="强成交话术总览"
      spec="§21 / §23 / §26 / §57"
      subtitle="主播拿起来就能讲、够狠、不变成说明书，而且一个字都没有编——这一版到底做到了几分，全在这里。"
      actions={
        <>
          <Pill tone={RESOLVED_MODE_TONES[overview.mode]}>{RESOLVED_MODE_LABELS[overview.mode]}</Pill>
          <Pill tone={ANCHOR_RESOLVE_SOURCE_TONES[overview.resolved_by]}>
            {ANCHOR_RESOLVE_SOURCE_LABELS[overview.resolved_by]}
          </Pill>
          <Pill tone="neutral">{overview.versions.length} 版</Pill>
        </>
      }
    >
      <p className="muted">{overview.mode_reason}</p>

      <div className="metric-grid mt-3">
        <div className="metric">
          <div className="metric-label">当前查看</div>
          <div className="metric-value">{record ? `v${record.version}` : "—"}</div>
          <div className="metric-hint">
            {record
              ? `${isLatest ? "最新版本" : "历史版本"} · ${formatDateTime(record.created_at)}`
              : "尚未生成"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">成交冲击力（§23）</div>
          <div className="metric-value">{impact ? `${impact.total} / ${impact.max}` : "—"}</div>
          <div className="metric-hint">
            {impact
              ? `${impact.band_label}｜${record ? intensityLabel(record.intensity, labels) : ""}`
              : "八项评分合计 100 分制"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">§26 九种输出</div>
          <div className="metric-value">
            {record ? `${outputsDone} / ${SALES_COPY_OUTPUT_ORDER.length}` : "—"}
          </div>
          <div className="metric-hint">
            {overview.missing_outputs.length > 0
              ? `缺：${overview.missing_outputs.map((key) => outputLabel(key, labels)).join(" / ")}`
              : record
                ? "九种输出齐备"
                : "金句 / 四档时长稿 / 发布稿 / 经销商版 / 异议"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">§22 Level 5</div>
          <div className="metric-value">
            {record ? (record.level5.required ? "强制" : "本档不强制") : "—"}
          </div>
          <div className="metric-hint">
            {record
              ? record.level5.required
                ? record.level5.satisfied
                  ? "七项全部落地"
                  : `缺 ${record.level5.missing.length} 项`
                : `强度 ${record.intensity} 未触发七项强制`
              : "王者话术七项强制"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">合规自检</div>
          <div className="metric-value">
            {record ? <Pill tone={riskTone(record.compliance.risk)}>{record.compliance.risk}</Pill> : "—"}
          </div>
          <div className="metric-hint">
            {record ? riskLabel(record.compliance.risk) : "RED 一律不得发布"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">§57 验收</div>
          <div className="metric-value">
            {acceptance ? (acceptance.passed ? "通过" : "未通过") : "—"}
          </div>
          <div className="metric-hint">
            {acceptance
              ? acceptance.required_score === null
                ? "本档位不设硬性分数门槛"
                : `本档最低分 ${acceptance.required_score}`
              : "够狠、不编、九种输出齐备"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">§34 增强轮次</div>
          <div className="metric-value">
            {record ? `${record.intensify_rounds} / ${maxAutoRounds}` : "—"}
          </div>
          <div className="metric-hint">
            {record
              ? record.intensify_rounds >= maxAutoRounds
                ? "已达上限，必须人工处理"
                : "点「再狠一点」只升档、不新增事实"
              : "强化只新增版本"}
          </div>
        </div>
      </div>

      {acceptance ? (
        <div className="chip-list mt-3">
          <span className="chip">
            分数：{acceptance.impact_score}
            {acceptance.required_score === null
              ? "（本档无门槛）"
              : ` / 门槛 ${acceptance.required_score}`}
          </span>
          <span className="chip">
            金句：{acceptance.quotes_total} 句（核心 {acceptance.core_quotes} + 备用{" "}
            {acceptance.backup_quotes}，至少 {acceptance.min_quotes} 句）
          </span>
          <span className="chip">九种输出齐备：{acceptance.outputs_complete ? "是" : "否"}</span>
          <span className="chip">Level 5 七项：{acceptance.level5_passed ? "通过" : "未通过"}</span>
          <span className="chip">合规：{acceptance.compliance_passed ? "通过" : "未通过"}</span>
          <span className="chip">引用已录入事实 {factRefs} 个字段</span>
        </div>
      ) : null}

      {record ? (
        <p className="muted mt-2">
          生成当时的模式：
          {record.mode_at_generation === "BENCHMARK" ? "Benchmark Mode" : "Category Creator Mode"}（
          {ANCHOR_RESOLVE_SOURCE_LABELS[record.resolved_by]}）· 强度{" "}
          {intensityLabel(record.intensity, labels)} · 价值重点 {record.value_focus.length} / 8 项 · 增强轮次{" "}
          {record.intensify_rounds} / {maxAutoRounds}
          {record.is_confirmed
            ? ` · 已于 ${formatDateTime(record.confirmed_at)} 人工确认`
            : " · 尚未人工确认"}
          。
        </p>
      ) : (
        <p className="muted mt-2">
          尚无强成交话术：先把产品事实、产品结构、配方哲学与市场价格锚点补齐，再生成一版——生成不会替你编一句事实，
          也不会因为缺上游就把稿子写成说明书。
        </p>
      )}

      <div className="sub-title mt-3">价格锚点口径（§22 / §25）</div>
      {overview.anchor.has_reliable_price_anchor ? (
        <div className="chip-list">
          <span className="chip">可靠价格锚点：有</span>
          <span className="chip">主锚点：{overview.anchor.primary_anchor_name ?? "—"}</span>
          <span className="chip">可用锚点 {overview.anchor.anchor_count} 个</span>
          <span className="chip">允许讲价格高度叙事</span>
        </div>
      ) : (
        <div className="chip-list">
          <span className="chip">可靠价格锚点：无</span>
          <span className="chip">价格高度叙事逐字使用 §22 标准句</span>
          <span className="chip">不得写任何具体价格故事</span>
          <span className="chip">
            <Link to="/market-prices">去市场价格中心看锚点</Link>
          </span>
        </div>
      )}

      <div className="sub-title mt-3">上游到位情况（§60：有就用，没有就留缺口）</div>
      <div className="chip-list">
        <span className="chip">
          产品结构：
          {overview.upstream.architecture_version === null
            ? "未生成"
            : `v${overview.upstream.architecture_version}（§57 ${
                overview.upstream.architecture_acceptance_passed ? "已通过" : "未通过"
              }）`}
        </span>
        <span className="chip">
          配方哲学：
          {overview.upstream.philosophy_version === null
            ? "未生成"
            : `v${overview.upstream.philosophy_version}（§57 ${
                overview.upstream.philosophy_acceptance_passed ? "已通过" : "未通过"
              }）`}
        </span>
        <span className="chip">自建标准：{overview.upstream.category_creator_ready ? "已就绪" : "未就绪"}</span>
        <span className="chip">价值映射：{overview.upstream.value_codes_ready ? "已就绪" : "未就绪"}</span>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!canWrite ? (
        <Alert tone="info">
          当前账号为只读：可以查看九种输出、八项评分、Level 5 与合规自检，但不能生成或确认版本。
        </Alert>
      ) : null}

      {canWrite ? (
        <>
          <div className="sub-title mt-4">生成新版强成交话术</div>
          <div className="filter-bar">
            <label>
              强度（§21）
              <select
                value={String(intensity)}
                onChange={(event) => setIntensity(Number(event.target.value) as CopyIntensity)}
              >
                {COPY_INTENSITY_ORDER.map((level) => (
                  <option key={level} value={String(level)}>
                    {intensityLabel(level, labels)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              备注（可选）
              <input
                type="text"
                value={notes}
                maxLength={2000}
                placeholder="例如：补齐价格锚点后重建"
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary sm"
              disabled={busy !== null || !overview.can_generate || valueFocus.length === 0}
              onClick={() => {
                onGenerate({ intensity, valueFocus, notes: notes.trim() ? notes.trim() : null });
                setNotes("");
              }}
            >
              {busy === "generate" ? "生成中…" : "生成新版"}
            </button>
          </div>
          <p className="muted">
            {overview.can_generate
              ? "生成新版不会改写历史版本；补一批事实或锚点就重建一版，便于对照。"
              : overview.block_reason ?? "当前不可生成新版。"}
          </p>

          <div className="sub-title mt-4">§34「再狠一点」（牛逼化按钮）</div>
          <p className="muted">
            只升档、不新增事实：点哪一档就用同一份事实、更高一档的机械画像重跑一次总装，落成
            <strong>新版本</strong>，源版本原封不动保留（§34 / §62-15）。没有可升的档位时按钮会直接禁用并写明原因。
          </p>
          <div className="btn-row">
            {INTENSIFY_LEVEL_ORDER.map((level) => {
              const button = intensifyButtonMeta(level, labels);
              const mapped = mapping[level];
              const reason = intensifyBlockReason(intensifySource, level, {
                maxAutoRounds,
                mapping
              });
              return (
                <button
                  key={level}
                  type="button"
                  className={level === "KING" ? "primary sm" : "secondary sm"}
                  disabled={busy !== null || reason !== null}
                  title={reason ?? `把当前查看的这一版强化到 ${intensityLabel(mapped, labels)}`}
                  onClick={() => onIntensify(level)}
                >
                  {busy === "intensify" ? "强化中…" : `再狠一点 · ${button?.label ?? level}`}
                  <span className="muted"> → {intensityLabel(mapped, labels)}</span>
                </button>
              );
            })}
          </div>
          <div className="chip-list mt-2">
            <span className="chip">
              拟强化的版本：v{intensifySource?.version ?? "—"} ·{" "}
              {intensifySource ? intensityLabel(intensifySource.intensity, labels) : "尚未生成"}
            </span>
            <span className="chip">
              已自动强化 {intensifySource?.intensify_rounds ?? 0} / {maxAutoRounds} 轮
            </span>
            <span className="chip">
              §48 分数线：Level 4 ≥ {minScore(4)}、Level 5 ≥ {minScore(5)}
            </span>
            <span className="chip">八项自检缺一项都不算达标</span>
          </div>
          <p className="muted">
            {intensifySource
              ? `「再狠一点」强化的是当前查看的这一版（v${intensifySource.version}）：每一档都只能升档，同一档或更低档会被拒绝（§7）；历史版本同样可以继续强化，强化结果永远是一条新版本。`
              : "先生成一版强成交话术，才有可以强化的源版本（§34）。"}
          </p>

          {intensifyResult !== null && intensifyResultRelevant ? (
            <div className="alert info mt-3">
              <div className="sub-title">
                §48 强化结论：v{intensifyResult.previous.version}（Level{" "}
                {intensifyResult.previous.intensity} · {intensifyResult.previous.impact_score} 分）→
                v{intensifyResult.record.version}（Level {intensifyResult.intensity} ·{" "}
                {intensifyResult.self_check.score} 分）
              </div>
              <div className="chip-list mt-2">
                <span className="chip">
                  按钮档位：{intensifyLevelLabel(intensifyResult.level, labels)}
                </span>
                <span className="chip">
                  第 {intensifyResult.round} / {intensifyResult.max_auto_rounds} 轮自动强化
                </span>
                <span className="chip">改写 {intensifyResult.changed_elements.length} 处</span>
                <span className="chip">
                  新增事实 {intensifyResult.added_facts.length} 条（§34 必须为 0）
                </span>
                <span className="chip">
                  §48 自检：
                  {intensifyResult.self_check.passed
                    ? "通过"
                    : `未通过（缺 ${intensifyResult.self_check.missing.length} 项）`}
                </span>
              </div>
              <p className="muted mt-2">{intensifyResult.self_check.note}</p>

              <div className="sub-title mt-2">这一轮被改写的位置（逐格对比，便于人工抽查）</div>
              {intensifyResult.changed_elements.length === 0 ? (
                <p className="muted">
                  这一轮没有整格被替换（更高档位的机械动作已经全部满足），正文与源版本逐字一致。
                </p>
              ) : (
                <div className="chip-list">
                  {intensifyResult.changed_elements.map((key) => (
                    <span className="chip" key={key}>
                      {intensifyChangedElementLabel(key)}
                    </span>
                  ))}
                </div>
              )}

              <div className="sub-title mt-2">§48 Agent 10 八项自检</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>自检项</th>
                      <th>结论</th>
                      <th>判定依据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intensifyResult.self_check.items.map((item) => (
                      <tr key={item.key}>
                        <td className="nowrap">{item.label}</td>
                        <td className="nowrap">
                          {item.passed ? <Pill tone="ok">通过</Pill> : <Pill tone="danger">未通过</Pill>}
                        </td>
                        <td className="muted">{item.evidence ?? item.check}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="sub-title mt-3">§33 价值重点（默认八项全选，至少选一项）</div>
          <div className="grid-2">
            {VALUE_FOCUS_ORDER.map((key) => (
              <label className="checkbox-label" key={key}>
                <input
                  type="checkbox"
                  checked={valueFocus.includes(key)}
                  onChange={(event) => toggleFocus(key, event.target.checked)}
                />
                {valueFocusLabel(key, labels)}
              </label>
            ))}
          </div>

          {record ? (
            <div className="btn-row mt-3">
              <button
                type="button"
                className={record.is_confirmed ? "secondary sm" : "primary sm"}
                disabled={busy !== null}
                onClick={() => onConfirm(record, !record.is_confirmed)}
              >
                {busy === "confirm"
                  ? "处理中…"
                  : record.is_confirmed
                    ? `取消 v${record.version} 的人工确认`
                    : `人工确认 v${record.version}`}
              </button>
              <span className="muted">
                {record.is_confirmed
                  ? `已于 ${formatDateTime(record.confirmed_at)} 确认`
                  : "人工确认只标记「这一版被审过」，不改写正文、不新增版本；事实审核与 RED 拦截在 Phase 14 接线"}
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {record?.notes ? <p className="muted mt-3">备注：{record.notes}</p> : null}
    </Card>
  );
}
