import type { ReactElement } from "react";
import {
  PRODUCT_ARCHITECTURE_ROLE_ORDER,
  formatDateTime,
  roleShortLabel,
  type ProductArchitectureLabels,
  type ProductArchitectureOverview,
  type ProductArchitectureVersionSummary
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface ProductArchitectureVersionListProps {
  overview: ProductArchitectureOverview | null;
  labels: ProductArchitectureLabels | null;
  /** 当前正在查看的那一版；为空表示在看最新版 */
  selectedId: string | null;
  latestId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 产品结构版本列表（规格 §62-15）。
 *
 * 补一批事实就重生成一版，所以「哪一版写了几个角色」必须一眼可查：
 * 版本号、已写实角色数、§57 验收是否通过、缺哪些必答项、有没有被人工确认，全部列出来。
 * 所有版本只增不删，任何一版都能重新打开对照。
 */
export function ProductArchitectureVersionList({
  overview,
  labels,
  selectedId,
  latestId,
  onSelect
}: ProductArchitectureVersionListProps): ReactElement {
  const versions: ProductArchitectureVersionSummary[] = overview?.versions ?? [];
  const activeId = selectedId ?? latestId;

  return (
    <Card
      title="产品结构版本"
      spec="§62-15"
      subtitle="所有版本必须保留：重新生成只新增版本，人工确认只改确认状态，都不改写历史结论。"
      actions={<Pill tone="neutral">共 {versions.length} 版</Pill>}
    >
      {versions.length === 0 ? (
        <EmptyState
          title="还没有任何版本"
          description="生成第一版之后，这里会记录每次重建写了几个角色、§57 验收状态与人工确认情况。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>已写实角色</th>
                <th>§57 验收</th>
                <th>缺哪些必答项</th>
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
                  <td className="nowrap">{item.written_roles} / {PRODUCT_ARCHITECTURE_ROLE_ORDER.length}</td>
                  <td className="nowrap">
                    {item.acceptance_passed ? (
                      <Pill tone="ok">通过</Pill>
                    ) : (
                      <Pill tone="danger">缺 {item.missing_acceptance_keys.length} 项</Pill>
                    )}
                  </td>
                  <td>
                    {item.missing_acceptance_keys.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      <div className="chip-list">
                        {item.missing_acceptance_keys.map((key) => (
                          <span className="chip" key={key}>
                            {roleShortLabel(key, labels)}
                          </span>
                        ))}
                      </div>
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
