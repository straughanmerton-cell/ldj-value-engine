import type { ReactElement } from "react";
import {
  engineLabel,
  formatDateTime,
  riskLabel,
  type FactReviewLabels,
  type FactReviewOverview,
  type FactReviewVersionSummary
} from "../../lib/fact-review.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface FactReviewVersionListProps {
  overview: FactReviewOverview | null;
  labels: FactReviewLabels | null;
  /** 当前正在查看的那次审核；为空表示在看最新一次 */
  selectedId: string | null;
  latestId: string | null;
  /** 跨成稿版本的全量历史审核（`/fact-review/versions`）；未展开时为空 */
  history: FactReviewVersionSummary[];
  historyOpen: boolean;
  onToggleHistory: () => void;
  onSelect: (id: string) => void;
}

function VersionRows({
  items,
  labels,
  activeId,
  latestId,
  onSelect
}: {
  items: FactReviewVersionSummary[];
  labels: FactReviewLabels | null;
  activeId: string | null;
  latestId: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="nowrap">审核版本</th>
            <th className="nowrap">成稿版本</th>
            <th className="nowrap">引擎</th>
            <th className="nowrap">§49 三档</th>
            <th className="nowrap">引用事实</th>
            <th className="nowrap">发布结论</th>
            <th className="nowrap">审核时间</th>
            <th className="nowrap">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className={activeId === item.id ? "row-selected" : undefined}>
              <td className="nowrap">
                <strong>v{item.version}</strong>
                {latestId === item.id ? <Pill tone="brand">最新</Pill> : null}
              </td>
              <td className="nowrap muted">成稿 v{item.copy_version}</td>
              <td className="nowrap muted">{engineLabel(item.engine)}</td>
              <td className="nowrap">
                <Pill tone="ok">{item.green}</Pill>
                <Pill tone="warn">{item.yellow}</Pill>
                <Pill tone={item.red > 0 ? "danger" : "ok"}>{item.red}</Pill>
              </td>
              <td className="nowrap muted">{item.facts_used} 条</td>
              <td className="nowrap">
                <Pill tone={item.publishable ? "ok" : "danger"}>
                  {item.publishable ? "可审批" : "禁止审批"}
                </Pill>
                <div className="muted">{riskLabel(item.overall_risk, labels)}</div>
              </td>
              <td className="nowrap muted">{formatDateTime(item.created_at)}</td>
              <td>
                <button
                  type="button"
                  className={activeId === item.id ? "secondary sm" : "ghost sm"}
                  onClick={() => onSelect(item.id)}
                >
                  {activeId === item.id ? "正在查看" : "查看该版"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 事实审核版本列表（规格 §53 / §57 / §62-15）。
 *
 * 两层版本必须分开看，否则很容易误读成「审过一次就一直有效」：
 * 1. **当前成稿的审核版本**——同一版成稿最多保留 20 次审核，重新送审只新增版本；
 * 2. **跨成稿版本的全量历史**——生成新版话术后，旧成稿的审核结论不会被覆盖，需要时展开查看。
 *
 * 人工结论记在被审批的那一版上：审批 / 否决都留痕，任何版本都能重新打开对照。
 */
export function FactReviewVersionList({
  overview,
  labels,
  selectedId,
  latestId,
  history,
  historyOpen,
  onToggleHistory,
  onSelect
}: FactReviewVersionListProps): ReactElement {
  const versions = overview?.versions ?? [];
  const activeId = selectedId ?? latestId;
  const historyOnly = history.filter((item) => item.copy_version !== overview?.copy_version);

  return (
    <Card
      title="事实审核版本"
      spec="§53 / §57 / §62-15"
      subtitle="所有版本必须保留：重新送审只新增审核版本，人工审批与否决都留痕，旧成稿的结论不会被新版覆盖。"
      actions={
        <>
          <Pill tone="neutral">当前成稿 {versions.length} 次审核</Pill>
          <button type="button" className="ghost sm" onClick={onToggleHistory}>
            {historyOpen ? "收起全量历史" : "展开全量历史"}
          </button>
        </>
      }
    >
      {versions.length === 0 ? (
        <EmptyState
          title="还没有任何审核版本"
          description="送审第一版之后，这里会记录每次审核的三档风险分布、引用事实条数、发布结论与人工留痕。"
        />
      ) : (
        <VersionRows
          items={versions}
          labels={labels}
          activeId={activeId}
          latestId={latestId}
          onSelect={onSelect}
        />
      )}

      {historyOpen ? (
        <>
          <div className="sub-title mt-3">
            全量历史审核（{historyOnly.length}，含历史成稿版本）
          </div>
          {historyOnly.length === 0 ? (
            <p className="muted">
              目前只有当前成稿的审核记录：生成新版话术后，旧版本的审核结论会继续留在这里。
            </p>
          ) : (
            <VersionRows
              items={historyOnly}
              labels={labels}
              activeId={activeId}
              latestId={latestId}
              onSelect={onSelect}
            />
          )}
          <p className="muted mt-2">
            打开历史成稿的审核记录时，审批按钮会自动失效：审批只对当前要对外讲的那一版生效（§57）。
          </p>
        </>
      ) : null}

      <p className="muted mt-2">
        单版成稿最多保留 {labels?.limits.maxVersionsPerCopy ?? 20} 次事实审核；
        审核对象永远是已落库的成稿，正文与锚点取那一版冻结的值，今天补录的事实不会改写历史审核（§57 / §62-15）。
      </p>
    </Card>
  );
}
