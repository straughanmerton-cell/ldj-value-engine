import type { ReactElement } from "react";
import {
  FORMULA_COMPONENT_ORDER,
  formatDateTime,
  type FormulaPhilosophyOverview,
  type FormulaPhilosophyVersionSummary
} from "../../lib/formula-philosophy.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface FormulaPhilosophyVersionListProps {
  overview: FormulaPhilosophyOverview | null;
  /** 当前正在查看的那一版；为空表示在看最新版 */
  selectedId: string | null;
  latestId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 配方哲学版本列表（规格 §6.1 / §62-15）。
 *
 * 补一批事实就重生成一版，所以「哪一版写了几个分量、比例是什么状态」必须一眼可查：
 * 版本号、写实分量数、正文条数、比例是否已确认、§57 是否通过、有没有被人工确认，全部列出来。
 * 所有版本只增不删，任何一版都能重新打开对照。
 */
export function FormulaPhilosophyVersionList({
  overview,
  selectedId,
  latestId,
  onSelect
}: FormulaPhilosophyVersionListProps): ReactElement {
  const versions: FormulaPhilosophyVersionSummary[] = overview?.versions ?? [];
  const activeId = selectedId ?? latestId;

  return (
    <Card
      title="配方哲学版本"
      spec="§62-15"
      subtitle="所有版本必须保留：重新生成只新增版本，人工确认只改确认状态，都不改写历史结论。"
      actions={<Pill tone="neutral">共 {versions.length} 版</Pill>}
    >
      {versions.length === 0 ? (
        <EmptyState
          title="还没有任何版本"
          description="生成第一版之后，这里会记录每次重建写了几个分量、比例口径与人工确认情况。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>写实分量</th>
                <th>正文条数</th>
                <th>配方比例</th>
                <th>设计逻辑</th>
                <th>§57 验收</th>
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
                    {item.written_components} / {FORMULA_COMPONENT_ORDER.length}
                  </td>
                  <td className="nowrap muted">{item.texts_total}</td>
                  <td className="nowrap">
                    {item.known_ratio ? (
                      <Pill tone="info">已确认</Pill>
                    ) : (
                      <Pill tone="outline">未确认</Pill>
                    )}
                  </td>
                  <td className="nowrap">
                    {item.design_logic_ready ? (
                      <Pill tone="ok">成稿</Pill>
                    ) : (
                      <Pill tone="danger">未成稿</Pill>
                    )}
                  </td>
                  <td className="nowrap">
                    {item.acceptance_passed ? (
                      <Pill tone="ok">通过</Pill>
                    ) : (
                      <Pill tone="danger">未通过</Pill>
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
