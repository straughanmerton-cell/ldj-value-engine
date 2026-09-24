import type { ReactElement } from "react";
import {
  formatDateTime,
  impactBandMeta,
  intensityLabel,
  type SalesCopyLabels,
  type SalesCopyOverview,
  type SalesCopyVersionSummary
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface SalesCopyVersionListProps {
  overview: SalesCopyOverview | null;
  labels: SalesCopyLabels | null;
  /** §48 自动强化轮次上限（来自合同 `intensify_button.max_auto_rounds`）。 */
  maxRounds: number;
  /** 当前正在查看的那一版；为空表示在看最新版 */
  selectedId: string | null;
  latestId: string | null;
  onSelect: (id: string) => void;
}

/**
 * 强成交话术版本列表（规格 §34 / §50 / §62-15）。
 *
 * 补一批事实或锚点就重生成一版，所以「哪一版是几档强度、打了几分、输出齐不齐、有没有被审过」
 * 必须一眼可查。所有版本只增不删：重新生成只新增版本，人工确认只改确认状态。
 */
export function SalesCopyVersionList({
  overview,
  labels,
  maxRounds,
  selectedId,
  latestId,
  onSelect
}: SalesCopyVersionListProps): ReactElement {
  const versions: SalesCopyVersionSummary[] = overview?.versions ?? [];
  const activeId = selectedId ?? latestId;
  const maxVersions = labels?.limits.maxVersionsPerProduct ?? 20;

  return (
    <Card
      title="强成交话术版本"
      spec="§34 / §62-15"
      subtitle="所有版本必须保留：重新生成只新增版本，人工确认只改确认状态，「再狠一点」每强化一次就多一条版本并记下轮次（最多 3 轮）。"
      actions={<Pill tone="neutral">共 {versions.length} 版</Pill>}
    >
      {versions.length === 0 ? (
        <EmptyState
          title="还没有任何版本"
          description="生成第一版之后，这里会记录每版的强度、成交冲击力、九种输出完成度与人工确认情况。"
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>强度</th>
                <th>增强轮次</th>
                <th>成交冲击力</th>
                <th>分档</th>
                <th>九种输出</th>
                <th>Level 5</th>
                <th>合规</th>
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
                  <td className="nowrap">{intensityLabel(item.intensity, labels)}</td>
                  <td className="nowrap">
                    {item.intensify_rounds > 0 ? (
                      <Pill tone="info">
                        第 {item.intensify_rounds} 轮 / {maxRounds}
                      </Pill>
                    ) : (
                      <span className="muted">生成稿（未强化）</span>
                    )}
                  </td>
                  <td className="nowrap">
                    <Pill tone={item.score_passed ? "ok" : "warn"}>{item.impact_score} 分</Pill>
                  </td>
                  <td className="nowrap muted">
                    {impactBandMeta(item.band, labels).label}
                  </td>
                  <td className="nowrap">
                    {item.outputs_complete ? (
                      <Pill tone="ok">齐备</Pill>
                    ) : (
                      <Pill tone="danger">有缺失</Pill>
                    )}
                  </td>
                  <td className="nowrap">
                    {item.level5_passed ? (
                      <Pill tone="ok">通过</Pill>
                    ) : (
                      <Pill tone="danger">未通过</Pill>
                    )}
                  </td>
                  <td className="nowrap">
                    {item.compliance_passed ? (
                      <Pill tone="ok">通过</Pill>
                    ) : (
                      <Pill tone="danger">未通过</Pill>
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
        单产品最多保留 {maxVersions} 版（§26 / §62-15）；
        历史版本不会被覆盖，任何一版都能重新打开对照；同一版最多自动强化 {maxRounds} 轮（§48）。
      </p>
    </Card>
  );
}
