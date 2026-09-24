import type { ReactElement } from "react";
import {
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  VALUE_CODE_STATUS_ORDER,
  countOf,
  formatDateTime,
  type ValueCodeLabels,
  type ValueCodeVersionSummary,
  type ValueCodeOverview
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface ValueCodeVersionListProps {
  overview: ValueCodeOverview | null;
  labels: ValueCodeLabels | null;
  /** 当前正在查看的那一版；为空表示在看最新版 */
  selectedId: string | null;
  latestId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 价值映射版本列表（规格 §62-15）。
 *
 * 补一批事实就重生成一版，所以「哪一版在讲什么」必须一眼可查：
 * 模式、时间依赖数、未录入数、有没有被人工确认，全部列出来。
 * 所有版本只增不删，任何一版都能重新打开对照。
 */
export function ValueCodeVersionList({
  overview,
  labels,
  selectedId,
  latestId,
  onSelect
}: ValueCodeVersionListProps): ReactElement {
  const versions: ValueCodeVersionSummary[] = overview?.versions ?? [];
  const activeId = selectedId ?? latestId;

  return (
    <Card
      title="价值映射版本"
      spec="§62-15"
      subtitle="所有版本必须保留：重新生成只新增版本，人工确认只改确认状态，都不改写历史结论。"
      actions={<Pill tone="neutral">共 {versions.length} 版</Pill>}
    >
      {versions.length === 0 ? (
        <EmptyState
          title="还没有任何版本"
          description="生成第一版之后，这里会记录每次重建的模式、状态分布与人工确认情况。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>模式</th>
                <th>状态分布</th>
                <th>成交表达资格</th>
                <th>人工确认</th>
                <th>生成时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((item) => (
                <tr key={item.id} className={activeId === item.id ? "row-selected" : undefined}>
                  <td className="nowrap">
                    <strong>v{item.version}</strong>
                    {latestId === item.id ? <Pill tone="brand">最新</Pill> : null}
                  </td>
                  <td className="nowrap">
                    <Pill tone={RESOLVED_MODE_TONES[item.mode_at_generation]}>
                      {RESOLVED_MODE_LABELS[item.mode_at_generation]}
                    </Pill>
                  </td>
                  <td className="nowrap">
                    {VALUE_CODE_STATUS_ORDER.map((status) => (
                      <span className="muted" key={status}>
                        {labels?.status_short_labels[status] ?? status}{" "}
                        {countOf(item.code_counts, status)}
                        {"　"}
                      </span>
                    ))}
                  </td>
                  <td className="nowrap">
                    {item.time_dependent_count > 0 ? (
                      <Pill tone="info">有时间依赖 {item.time_dependent_count} 项</Pill>
                    ) : (
                      <Pill tone="outline">无</Pill>
                    )}
                  </td>
                  <td className="nowrap">
                    {item.is_confirmed ? (
                      <Pill tone="ok">已确认</Pill>
                    ) : (
                      <Pill tone="outline">未确认</Pill>
                    )}
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
      )}

      <p className="muted mt-2">
        单产品最多保留 20 版活跃版本；超出后需先归档历史版本，不允许直接覆盖旧版本。
      </p>
    </Card>
  );
}
