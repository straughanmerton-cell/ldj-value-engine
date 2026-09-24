import { useState, type ReactElement } from "react";
import {
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  VALUE_CODE_STATUS_ORDER,
  countOf,
  formatDateTime,
  statusShortLabel,
  type ValueCodeLabels,
  type ValueCodeOverview,
  type ValueCodeProfileView
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface ValueCodesOverviewCardProps {
  overview: ValueCodeOverview | null;
  /** 当前正在查看的那一版（可能是历史版本） */
  profile: ValueCodeProfileView | null;
  labels: ValueCodeLabels | null;
  canWrite: boolean;
  busy: "generate" | "confirm" | null;
  loading: boolean;
  error: string | null;
  onGenerate: (notes: string | null) => void;
  onConfirm: (profile: ValueCodeProfileView, nextConfirmed: boolean) => void;
  onRetry: () => void;
}

/**
 * 价值映射总览与操作区（规格 §18 / §19 / §62-15）。
 *
 * 两件事必须在这里说清：
 * 1. **为什么是现在这个模式**——有可靠对标走 Benchmark Mode，没有走自建高端标准（§17）；
 * 2. **这一版能不能用**——人工确认只表示「这一版被审过」，既不改写正文也不阻止继续派生新版。
 */
export function ValueCodesOverviewCard({
  overview,
  profile,
  labels,
  canWrite,
  busy,
  loading,
  error,
  onGenerate,
  onConfirm,
  onRetry
}: ValueCodesOverviewCardProps): ReactElement {
  const [notes, setNotes] = useState("");

  if (loading && !overview) {
    return (
      <Card title="价值映射总览" spec="§18 / §19">
        <LoadingState label="正在读取价值映射" />
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card title="价值映射总览" spec="§18 / §19">
        <ErrorState title="价值映射读取失败" description={error ?? "未知错误"} onRetry={onRetry} />
      </Card>
    );
  }

  const latest = overview.profile;
  const counts = profile?.code_counts ?? null;
  const isLatest = profile !== null && latest !== null && profile.id === latest.id;
  const canConfirm = canWrite && profile !== null;

  return (
    <Card
      title="价值映射总览"
      spec="§18 / §19 / §62-15"
      subtitle="把已录入事实按 16 个 Code 摆正：这一步不编故事，只回答「这款茶靠哪些底层条件贵得起」。"
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
          <div className="metric-value">{profile ? `v${profile.version}` : "—"}</div>
          <div className="metric-hint">
            {profile
              ? `${isLatest ? "最新版本" : "历史版本"} · ${formatDateTime(profile.created_at)}`
              : "尚未生成"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">可讲（已具备）</div>
          <div className="metric-value">{counts ? countOf(counts, "ALREADY_HAVE") : "—"}</div>
          <div className="metric-hint">至少两条可交叉印证的事实</div>
        </div>
        <div className="metric">
          <div className="metric-label">时间依赖</div>
          <div className="metric-value">{counts ? countOf(counts, "TIME_DEPENDENT") : "—"}</div>
          <div className="metric-hint">只能写 §19 固定安全句式</div>
        </div>
        <div className="metric">
          <div className="metric-label">未录入（不得书写）</div>
          <div className="metric-value">{counts ? countOf(counts, "UNKNOWN") : "—"}</div>
          <div className="metric-hint">先补事实，再谈表达</div>
        </div>
      </div>

      {profile ? (
        <div className="chip-list mt-3">
          {VALUE_CODE_STATUS_ORDER.map((status) => (
            <span className="chip" key={status}>
              {statusShortLabel(status, labels)} {countOf(profile.code_counts, status)}
            </span>
          ))}
        </div>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {!canWrite ? (
        <Alert tone="info">当前账号为只读：可以查看价值映射与缺口，但不能生成或确认版本。</Alert>
      ) : null}

      {canWrite ? (
        <>
          <div className="sub-title mt-4">生成新版价值映射</div>
          <div className="filter-bar">
            <label>
              <span className="muted">备注（可选）</span>
              <input
                type="text"
                value={notes}
                maxLength={2000}
                placeholder="例如：补齐了工艺与品饮档案后重建"
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

          {profile ? (
            <div className="btn-row mt-3">
              <button
                type="button"
                className={profile.is_confirmed ? "secondary sm" : "primary sm"}
                disabled={busy !== null || !canConfirm}
                onClick={() => onConfirm(profile, !profile.is_confirmed)}
              >
                {busy === "confirm"
                  ? "处理中…"
                  : profile.is_confirmed
                    ? `取消 v${profile.version} 的人工确认`
                    : `人工确认 v${profile.version}`}
              </button>
              <span className="muted">
                {profile.is_confirmed
                  ? `已于 ${formatDateTime(profile.confirmed_at)} 确认`
                  : "人工确认只标记「这一版被审过」，不改写正文、不新增版本"}
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {profile?.notes ? <p className="muted mt-3">备注：{profile.notes}</p> : null}
    </Card>
  );
}
