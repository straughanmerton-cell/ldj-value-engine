import type { ReactElement } from "react";
import {
  CATEGORY_CREATOR_TRIGGER_LABELS,
  CATEGORY_READINESS_SHORT_LABELS,
  CATEGORY_READINESS_TONES,
  formatDateTime,
  type CategoryCreatorVersionSummary
} from "../../lib/category-creator.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface CategoryCreatorVersionListProps {
  versions: CategoryCreatorVersionSummary[];
  /** 当前正在查看的那一版；为空表示在看最新版 */
  selectedId: string | null;
  latestId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 自建标准版本列表（§62-15）。
 *
 * 自建标准会被反复重建（每补一批事实就该重生成一版），所以「哪一版在讲什么」必须一眼可查：
 * 触发条件说明它为什么进来，成立度说明当时能讲到什么程度，人工确认说明这一版有没有被审过。
 * 所有版本只增不删，任何一版都能重新打开对照。
 */
export function CategoryCreatorVersionList({
  versions,
  selectedId,
  latestId,
  onSelect
}: CategoryCreatorVersionListProps): ReactElement {
  const activeId = selectedId ?? latestId;

  return (
    <Card
      title="自建标准版本"
      spec="§62-15"
      subtitle="所有版本必须保留：补事实后重新生成只会新增版本，不会改写历史结论。"
      actions={<Pill tone="neutral">共 {versions.length} 版</Pill>}
    >
      {versions.length === 0 ? (
        <EmptyState
          title="还没有任何版本"
          description="生成第一版之后，这里会记录每次重建的触发条件、成立度与人工确认状态。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>触发条件</th>
                <th>成立度</th>
                <th>拿到事实的轴</th>
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
                  <td>{CATEGORY_CREATOR_TRIGGER_LABELS[item.trigger]}</td>
                  <td className="nowrap">
                    <Pill tone={CATEGORY_READINESS_TONES[item.readiness]}>
                      {CATEGORY_READINESS_SHORT_LABELS[item.readiness]}
                    </Pill>
                  </td>
                  <td className="nowrap">
                    {item.supported_axes} / {item.total_axes}
                  </td>
                  <td className="nowrap">
                    {item.is_confirmed ? <Pill tone="ok">已确认</Pill> : <Pill tone="outline">未确认</Pill>}
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
