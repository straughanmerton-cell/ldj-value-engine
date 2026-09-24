import { useEffect, useState, type ReactElement } from "react";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS
} from "../../lib/anchors.js";
import {
  CATEGORY_CREATOR_TRIGGER_LABELS,
  CATEGORY_CREATOR_TRIGGER_TONES,
  CATEGORY_READINESS_LABELS,
  CATEGORY_READINESS_TONES,
  formatDateTime,
  triggerLabel,
  type CategoryCreatorContract,
  type CategoryCreatorOverview,
  type CategoryCreatorProfileView,
  type CategoryCreatorTrigger
} from "../../lib/category-creator.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, LoadingState, Pill } from "../ui/State.js";

export interface CategoryCreatorOverviewCardProps {
  overview: CategoryCreatorOverview | null;
  /** 当前正在查看的那一版（可能是历史版本），不是永远等于 overview.profile */
  profile: CategoryCreatorProfileView | null;
  contract: CategoryCreatorContract | null;
  loading: boolean;
  error: string | null;
  canWrite: boolean;
  busy: "generate" | "confirm" | null;
  onGenerate: (input: { trigger: CategoryCreatorTrigger; notes: string | null }) => void;
  onConfirm: (profile: CategoryCreatorProfileView, nextConfirmed: boolean) => void;
  onRetry: () => void;
}

const PREFERENCE_LABELS: Record<string, string> = {
  AUTO: "自动判定",
  BENCHMARK: "指定对标模式",
  CATEGORY_CREATOR: "指定自建标准模式"
};

/**
 * 自建标准总览卡（§4.2 / §17 / §29）。
 *
 * 这张卡是「为什么这款茶要走自建标准」的结论 + 操作台：
 * 结论（当前模式与判定来源）、依据（模式判定理由）、现状（最新一版的成立度）、动作（生成 / 人工确认）。
 * 生成按钮不会自动降级：事实不足时照样生成完整标准文档，只是缺口清单更长、且不含成交表达。
 */
export function CategoryCreatorOverviewCard({
  overview,
  profile,
  contract,
  loading,
  error,
  canWrite,
  busy,
  onGenerate,
  onConfirm,
  onRetry
}: CategoryCreatorOverviewCardProps): ReactElement {
  const [trigger, setTrigger] = useState<CategoryCreatorTrigger>("NO_RELIABLE_ANCHOR");
  const [notes, setNotes] = useState("");

  const suggested = overview?.suggested_trigger ?? null;
  useEffect(() => {
    if (suggested) {
      setTrigger(suggested);
    }
  }, [suggested]);

  if (error) {
    return (
      <Card title="自建高端标准（Category Creator Mode）" spec="§4.2 / §17">
        <Alert tone="warn">{error}</Alert>
        <div className="btn-row mt-3">
          <button type="button" className="secondary sm" onClick={onRetry}>
            重新读取
          </button>
        </div>
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card title="自建高端标准（Category Creator Mode）" spec="§4.2 / §17">
        <LoadingState label={loading ? "正在读取自建标准总览" : "尚未读取"} />
      </Card>
    );
  }

  const nextVersion = Math.max(0, ...overview.versions.map((item) => item.version)) + 1;
  const resolvedBy = overview.resolved_by;
  const minSupportedAxes = contract?.min_supported_axes ?? 2;

  return (
    <Card
      title="自建高端标准（Category Creator Mode）"
      spec="§4.2 / §17 / §29"
      subtitle="没有达标对标时，系统不允许硬凑竞品：必须从自身已录入事实出发，先立标准，再谈价格。"
      actions={
        <>
          <Pill tone={overview.mode === "CATEGORY_CREATOR" ? "warn" : "ok"}>
            {RESOLVED_MODE_LABELS[overview.mode] ?? overview.mode}
          </Pill>
          <Pill tone={ANCHOR_RESOLVE_SOURCE_TONES[resolvedBy] ?? "neutral"}>
            {ANCHOR_RESOLVE_SOURCE_LABELS[resolvedBy] ?? resolvedBy}
          </Pill>
          <Pill tone="neutral">产品偏好：{PREFERENCE_LABELS[overview.preference] ?? overview.preference}</Pill>
        </>
      }
    >
      <div className="mode-banner" data-mode={overview.mode}>
        <div className="mode-banner-head">
          <strong>
            {overview.mode === "CATEGORY_CREATOR"
              ? "自建高端标准模式（Category Creator Mode）"
              : "当前仍处高价值对标模式（Benchmark Mode）"}
          </strong>
          <span className="muted">
            建议触发条件：{triggerLabel(overview.suggested_trigger, contract?.triggers)}
          </span>
        </div>
        <p className="mode-reason">{overview.mode_reason}</p>
      </div>

      <div className="metric-grid mt-3">
        <div className="metric">
          <div className="metric-label">当前查看版本</div>
          <div className="metric-value">{profile ? `v${profile.version}` : "—"}</div>
          <div className="metric-hint">
            {overview.versions.length === 0
              ? "尚未生成自建标准"
              : `已保留 ${overview.versions.length} 版（版本只增不删）`}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">标准成立度</div>
          <div className="metric-value" style={{ fontSize: 16 }}>
            {profile ? CATEGORY_READINESS_LABELS[profile.readiness] : "—"}
          </div>
          <div className="metric-hint">READY ≥ 4 轴 SUPPORTED · PARTIAL ≥ {minSupportedAxes} 轴</div>
        </div>
        <div className="metric">
          <div className="metric-label">拿到事实的标准轴</div>
          <div className="metric-value">
            {profile ? `${profile.supported_axes} / ${profile.total_axes}` : "—"}
          </div>
          <div className="metric-hint">只有单点事实的轴不计入 SUPPORTED</div>
        </div>
        <div className="metric">
          <div className="metric-label">成交表达</div>
          <div className="metric-value" style={{ fontSize: 16 }}>
            {profile ? (profile.value_logic.sales_line_ready ? "已具备" : "尚未具备") : "—"}
          </div>
          <div className="metric-hint">事实不足时不出 RHETORIC 段（§24 / §4.2）</div>
        </div>
      </div>

      {profile ? (
        <div className="context-meta mt-3">
          <Pill tone={CATEGORY_CREATOR_TRIGGER_TONES[profile.trigger]}>
            {triggerLabel(profile.trigger, contract?.triggers)}
          </Pill>
          <Pill tone={CATEGORY_READINESS_TONES[profile.readiness]}>
            {CATEGORY_READINESS_LABELS[profile.readiness]}
          </Pill>
          <Pill tone="neutral">生成时间 {formatDateTime(profile.created_at)}</Pill>
          {profile.is_confirmed ? (
            <Pill tone="ok">
              人工已确认{profile.confirmed_at ? ` · ${formatDateTime(profile.confirmed_at)}` : ""}
            </Pill>
          ) : (
            <Pill tone="outline">尚未人工确认</Pill>
          )}
        </div>
      ) : (
        <EmptyState
          title="尚未生成自建标准"
          description="生成不是让 AI 编一个品类，而是把当前已录入事实按六个标准轴摆正：事实不足时得到的是更长的缺口清单，而不是弱化版文案。"
        />
      )}

      {canWrite ? (
        <>
          <div className="sub-title">生成新版自建标准</div>
          <div className="grid-2">
            <label>
              触发条件
              <select
                value={trigger}
                onChange={(event) => setTrigger(event.target.value as CategoryCreatorTrigger)}
                disabled={busy !== null}
              >
                <option value="NO_RELIABLE_ANCHOR">
                  {CATEGORY_CREATOR_TRIGGER_LABELS.NO_RELIABLE_ANCHOR}
                </option>
                <option value="USER_OPT_OUT">{CATEGORY_CREATOR_TRIGGER_LABELS.USER_OPT_OUT}</option>
              </select>
            </label>
            <label>
              备注（可选，写入版本记录）
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="例如：补完产区与原料事实后重建标准"
                disabled={busy !== null}
              />
            </label>
          </div>
          <div className="btn-row mt-3">
            <button
              type="button"
              disabled={busy !== null || !overview.can_generate}
              onClick={() => onGenerate({ trigger, notes: notes.trim() ? notes.trim() : null })}
            >
              {busy === "generate" ? "生成中…" : `生成自建标准（v${nextVersion}）`}
            </button>
            {profile ? (
              <button
                type="button"
                className="secondary"
                disabled={busy !== null}
                onClick={() => onConfirm(profile, !profile.is_confirmed)}
              >
                {busy === "confirm"
                  ? "处理中…"
                  : profile.is_confirmed
                    ? "取消人工确认"
                    : `人工确认 v${profile.version}`}
              </button>
            ) : null}
            <span className="muted">重新生成只新增版本，历史版本全部保留（§62-15）。</span>
          </div>
          {!overview.can_generate && overview.block_reason ? (
            <Alert tone="warn">{overview.block_reason}</Alert>
          ) : null}
        </>
      ) : (
        <Alert tone="info">
          当前角色为只读：可以查看自建标准与版本历史，生成新版与人工确认需要 ADMIN / RESEARCHER 权限。
        </Alert>
      )}

      <Alert tone={overview.resolved_by === "NO_RELIABLE_ANCHOR" ? "warn" : "info"}>
        {overview.resolved_by === "NO_RELIABLE_ANCHOR"
          ? "本产品的模式判定为「无达标候选强制切换」：不得硬凑竞品、不得下调阈值、不得编造对标（§17 / §62-10）。"
          : "本产品仍有达标对标；此时生成自建标准代表产品负责人主动选择「不使用对标」，两个触发条件都必须如实记录（§4.2）。"}
      </Alert>
    </Card>
  );
}
