import { useState, type ReactElement } from "react";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS,
  formatDateTime,
  roleShortLabel,
  type ProductArchitectureLabels,
  type ProductArchitectureOverview,
  type ProductArchitectureRecordView
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface ProductArchitectureOverviewCardProps {
  overview: ProductArchitectureOverview | null;
  /** 当前正在查看的那一版（可能是历史版本） */
  record: ProductArchitectureRecordView | null;
  labels: ProductArchitectureLabels | null;
  canWrite: boolean;
  busy: "generate" | "confirm" | null;
  loading: boolean;
  error: string | null;
  onGenerate: (notes: string | null) => void;
  onConfirm: (record: ProductArchitectureRecordView, nextConfirmed: boolean) => void;
  onRetry: () => void;
}

/**
 * 产品结构总览与操作区（规格 §5 / §17 / §57 / §62-15）。
 *
 * 三件事必须在这里说清：
 * 1. **为什么是现在这个模式**——有可靠对标走 Benchmark Mode，没有走自建高端标准（§17）；
 * 2. **九个角色写实了几个**——事实不足的角色会显示为缺口，而不是被弱化；
 * 3. **这一版能不能用**——人工确认只表示「这一版被审过」，既不改写正文也不阻止继续派生新版。
 */
export function ProductArchitectureOverviewCard({
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
}: ProductArchitectureOverviewCardProps): ReactElement {
  const [notes, setNotes] = useState("");

  if (loading && !overview) {
    return (
      <Card title="产品结构总览" spec="§5 / §57">
        <LoadingState label="正在读取产品结构" />
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card title="产品结构总览" spec="§5 / §57">
        <ErrorState title="产品结构读取失败" description={error ?? "未知错误"} onRetry={onRetry} />
      </Card>
    );
  }

  const latest = overview.record;
  const isLatest = record !== null && latest !== null && record.id === latest.id;
  const missing =
    record?.acceptance.missing_keys ?? overview.missing_acceptance_keys ?? [];
  const acceptancePassed = record?.acceptance.passed ?? false;

  return (
    <Card
      title="产品结构总览"
      spec="§5 / §45 / §57"
      subtitle="把已录入事实摆成九个角色：这一步不编原料、不改配方，只回答「每一部分各自在干什么」。"
      actions={
        <>
          <Pill tone={RESOLVED_MODE_TONES[overview.mode]}>
            {RESOLVED_MODE_LABELS[overview.mode]}
          </Pill>
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
          <div className="metric-label">已写实角色</div>
          <div className="metric-value">
            {record ? `${record.role_counts.written} / 9` : "—"}
          </div>
          <div className="metric-hint">有已录入事实可回查的角色</div>
        </div>
        <div className="metric">
          <div className="metric-label">事实不足（留空）</div>
          <div className="metric-value">{record ? record.role_counts.gap : "—"}</div>
          <div className="metric-hint">留空 + 缺口，不写弱化版</div>
        </div>
        <div className="metric">
          <div className="metric-label">§57 验收</div>
          <div className="metric-value">
            {record ? (acceptancePassed ? "通过" : `缺 ${missing.length}`) : "—"}
          </div>
          <div className="metric-hint">
            {PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS.map((key) => roleShortLabel(key, labels)).join(
              " / "
            )}
          </div>
        </div>
      </div>

      {record ? (
        <div className="chip-list mt-3">
          {PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS.map((key) => (
            <span className="chip" key={key}>
              {roleShortLabel(key, labels)} {record.acceptance.written_keys.includes(key) ? "✓" : "缺"}
            </span>
          ))}
        </div>
      ) : null}

      {record ? (
        <p className="muted mt-2">
          生成当时的模式：
          {record.mode === "BENCHMARK" ? "Benchmark Mode" : "Category Creator Mode"}
          （{ANCHOR_RESOLVE_SOURCE_LABELS[record.resolved_by]}）· 引用事实字段{" "}
          {record.fact_refs.length} 个 · Value DNA {record.value_dna_refs.length} 项 · 缺口{" "}
          {record.evidence_gaps.length} 条。
        </p>
      ) : (
        <p className="muted mt-2">
          尚无产品结构：先把产地、用料、工艺与品饮事实录进产品，再生成一版；生成不会自动补全任何未录入内容。
        </p>
      )}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!canWrite ? (
        <Alert tone="info">当前账号为只读：可以查看九个角色与缺口，但不能生成或确认版本。</Alert>
      ) : null}

      {canWrite ? (
        <>
          <div className="sub-title mt-4">生成新版产品结构</div>
          <div className="filter-bar">
            <label>
              <span className="muted">备注（可选）</span>
              <input
                type="text"
                value={notes}
                maxLength={2000}
                placeholder="例如：补齐工艺与中后段表现后重建"
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="primary sm"
              disabled={busy !== null || !overview.can_generate}
              onClick={() => {
                onGenerate(notes.trim() ? notes.trim() : null);
                setNotes("");
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
