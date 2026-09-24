import { useState, type ReactElement } from "react";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  componentShortLabel,
  formatDateTime,
  ratioSourceLabel,
  type FormulaPhilosophyLabels,
  type FormulaPhilosophyOverview,
  type FormulaPhilosophyRecordView
} from "../../lib/formula-philosophy.js";
import { Card } from "../ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface FormulaPhilosophyOverviewCardProps {
  overview: FormulaPhilosophyOverview | null;
  /** 当前正在查看的那一版（可能是历史版本） */
  record: FormulaPhilosophyRecordView | null;
  labels: FormulaPhilosophyLabels | null;
  canWrite: boolean;
  busy: "generate" | "confirm" | null;
  loading: boolean;
  error: string | null;
  onGenerate: (notes: string | null, ratioData: Record<string, string> | null) => void;
  onConfirm: (record: FormulaPhilosophyRecordView, nextConfirmed: boolean) => void;
  onRetry: () => void;
}

const RATIO_ROWS = 3;

/**
 * 配方哲学总览与操作区（规格 §6.1 / §6.2 / §17 / §57 / §62-15）。
 *
 * 四件事必须在这里说清：
 * 1. **为什么是现在这个模式**——有可靠对标走 Benchmark Mode，没有走自建高端标准（§17）；
 * 2. **五个分量写实了几个**——事实不足的分量显示为缺口，而不是被弱化；
 * 3. **比例到底是什么状态**——未知就是未知，绝不用一句「经典配比」糊过去（§6.1）；
 * 4. **这一版能不能用**——人工确认只表示「这一版被审过」，不改写正文也不妨碍继续派生新版。
 */
export function FormulaPhilosophyOverviewCard({
  overview,
  record,
  labels,
  canWrite,
  busy,
  loading,
  error,
  onGenerate,
  onConfirm,
  onRetry
}: FormulaPhilosophyOverviewCardProps): ReactElement {
  const [notes, setNotes] = useState("");
  const [ratioOpen, setRatioOpen] = useState(false);
  const [ratioRows, setRatioRows] = useState<{ name: string; value: string }[]>(
    Array.from({ length: RATIO_ROWS }, () => ({ name: "", value: "" }))
  );

  if (loading && !overview) {
    return (
      <Card title="配方哲学总览" spec="§6 / §57">
        <LoadingState label="正在读取配方哲学" />
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card title="配方哲学总览" spec="§6 / §57">
        <ErrorState title="配方哲学读取失败" description={error ?? "未知错误"} onRetry={onRetry} />
      </Card>
    );
  }

  const latest = overview.record;
  const isLatest = record !== null && latest !== null && record.id === latest.id;
  const acceptance = record?.acceptance ?? null;
  const ratioEntries = record?.ratio.known_ratio
    ? Object.entries(record.ratio.ratio_data ?? {})
    : [];

  function ratioPayload(): Record<string, string> | null {
    const entries = Object.fromEntries(
      ratioRows
        .map((row) => [row.name.trim(), row.value.trim()] as const)
        .filter(([name, value]) => name.length > 0 && value.length > 0)
    );
    return Object.keys(entries).length > 0 ? entries : null;
  }

  function updateRatioRow(index: number, patch: { name?: string; value?: string }): void {
    setRatioRows((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row))
    );
  }

  return (
    <Card
      title="配方哲学总览"
      spec="§6 / §46 / §57"
      subtitle="先把骨架、香气、回甘、汤感、收口各自的任务摆正：这一步不编比例、不新增原料，只回答「为什么这么设计」。"
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
          <div className="metric-label">已写实分量</div>
          <div className="metric-value">{record ? `${record.component_counts.written} / 5` : "—"}</div>
          <div className="metric-hint">有已录入事实可回查的分量</div>
        </div>
        <div className="metric">
          <div className="metric-label">事实不足（留空）</div>
          <div className="metric-value">{record ? record.component_counts.gap : "—"}</div>
          <div className="metric-hint">
            {overview.missing_components.length === 0
              ? "五个分量都取到了事实"
              : `待补：${overview.missing_components
                  .map((key) => componentShortLabel(key, labels))
                  .join(" / ")}`}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">配方比例</div>
          <div className="metric-value">
            {record ? (record.ratio.known_ratio ? `${ratioEntries.length} 项` : "未确认") : "—"}
          </div>
          <div className="metric-hint">
            {record?.ratio.known_ratio
              ? ratioSourceLabel(record.ratio.ratio_source)
              : "未确认比例 = 正文里不出现任何比例"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">§57 验收</div>
          <div className="metric-value">
            {acceptance ? (acceptance.passed ? "通过" : "未通过") : "—"}
          </div>
          <div className="metric-hint">没有比例也能写出设计逻辑</div>
        </div>
      </div>

      {acceptance ? (
        <div className="chip-list mt-3">
          <span className="chip">设计逻辑成稿：{acceptance.design_logic_ready ? "是" : "否"}</span>
          <span className="chip">
            无比例时正文干净：{acceptance.no_fabricated_ratio ? "是" : "否"}
          </span>
          <span className="chip">
            写实 {acceptance.written_components} / 至少 {acceptance.required_min_components} 个
          </span>
          <span className="chip">
            五分量覆盖：{acceptance.coverage_passed ? "全写实" : "有缺口"}
          </span>
        </div>
      ) : null}

      {record ? (
        <p className="muted mt-2">
          生成当时的模式：
          {record.mode === "BENCHMARK" ? "Benchmark Mode" : "Category Creator Mode"}（
          {ANCHOR_RESOLVE_SOURCE_LABELS[record.resolved_by]}
          ）· 引用事实字段 {record.fact_refs.length} 个 · Value DNA {record.value_dna_refs.length} 项
          · 缺口 {record.evidence_gaps.length} 条 · 产品结构上下文
          {record.architecture_version === null
            ? "未生成"
            : `v${record.architecture_version}（§57 ${
                record.architecture_acceptance_passed ? "已通过" : "未通过"
              }）`}
          。
        </p>
      ) : (
        <p className="muted mt-2">
          尚无配方哲学：先把产地、用料、工艺与品饮事实录进产品，再生成一版；生成不会自动补全任何未录入内容，
          也不会替你造一个配方比例。
        </p>
      )}

      {overview.architecture === null ? (
        <Alert tone="info">
          尚未生成产品结构（§5 / §45）：配方哲学的骨架与汤感通常来自产品结构，建议先在「产品结构」里生成一版。
          这不影响本阶段生成，但缺口清单会如实记下这一点。
        </Alert>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!canWrite ? (
        <Alert tone="info">当前账号为只读：可以查看五个分量、比例状态与缺口，但不能生成或确认版本。</Alert>
      ) : null}

      {canWrite ? (
        <>
          <div className="sub-title mt-4">生成新版配方哲学</div>
          <div className="filter-bar">
            <label>
              <span className="muted">备注（可选）</span>
              <input
                type="text"
                value={notes}
                maxLength={2000}
                placeholder="例如：补齐中后段表现后重建"
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary sm"
              onClick={() => setRatioOpen((value) => !value)}
            >
              {ratioOpen ? "收起比例登记" : "登记已确认比例（可选）"}
            </button>
            <button
              type="button"
              className="primary sm"
              disabled={busy !== null || !overview.can_generate}
              onClick={() => {
                onGenerate(notes.trim() ? notes.trim() : null, ratioPayload());
                setNotes("");
                setRatioRows(Array.from({ length: RATIO_ROWS }, () => ({ name: "", value: "" })));
              }}
            >
              {busy === "generate" ? "生成中…" : "生成新版"}
            </button>
          </div>
          <p className="muted">
            {overview.can_generate
              ? "生成新版不会改写历史版本；补一批事实就重建一版，便于对照。"
              : overview.block_reason ?? "当前不可生成新版。"}
          </p>

          {ratioOpen ? (
            <>
              <div className="table-wrap mt-2">
                <table>
                  <thead>
                    <tr>
                      <th>原料 / 山头 / 用料（逐字）</th>
                      <th>比例</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ratioRows.map((row, index) => (
                      <tr key={`ratio-row-${index}`}>
                        <td>
                          <input
                            type="text"
                            value={row.name}
                            placeholder="例如：布朗山"
                            onChange={(event) => updateRatioRow(index, { name: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={row.value}
                            placeholder="例如：60% 或 60"
                            onChange={(event) => updateRatioRow(index, { value: event.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="alert warn mt-2">
                只接受「本产品已录入的原料 / 山头 / 用料里逐字查得到」的名字（最多 20 项）；
                只要有一项查不到，整次生成会被直接拒绝（§6.1 / §46）——宁可没有比例，也不编一个。
                留空则按「未确认比例」处理，正文里一个比例字样都不会出现，但设计逻辑照写。
              </div>
            </>
          ) : null}

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
                  : "人工确认只标记「这一版被审过」，不改写正文、不新增版本"}
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {record?.notes ? <p className="muted mt-3">备注：{record.notes}</p> : null}
    </Card>
  );
}
