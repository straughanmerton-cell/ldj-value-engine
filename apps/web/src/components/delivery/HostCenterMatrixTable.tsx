import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  approvalStatusLabel,
  approvalStatusTone,
  formatDateTime,
  gateLabelTone,
  gateOfRow,
  type DeliveryLabels,
  type HostCenterRow
} from "../../lib/delivery.js";
import { impactBandMeta, intensityLabel, intensityTone } from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface HostCenterMatrixTableProps {
  items: HostCenterRow[];
  labels: DeliveryLabels | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  onPageChange: (page: number) => void;
  onRetry?: () => void;
}

/**
 * §31 跨产品排产表（主播中心首页）。
 *
 * 一行 = 一款产品的最新一版成稿 + 这一版自己的审核结论。运营每天问的是
 * 「今天哪几款能上播、哪几款卡在审核」，所以可交付的排在最前面，卡住的行直接写出卡在哪一步。
 *
 * 这里不做跨产品比较：每款茶的分数、强度、锚点都只对自己有效（§62-5 / §62-7）。
 */
export function HostCenterMatrixTable({
  items,
  labels,
  total,
  page,
  pageSize,
  totalPages,
  loading,
  error,
  onPageChange,
  onRetry
}: HostCenterMatrixTableProps): ReactElement {
  const readyCount = items.filter((row) => row.ready).length;

  return (
    <Card
      title="交付排产表"
      spec="§31 / §51 / §53"
      subtitle="可交付的排在前面；不可交付的行会直接说明卡在哪一步，点「打开产品」即可补上游。"
      actions={
        <>
          <Pill tone="neutral">共 {total} 款产品</Pill>
          <Pill tone={readyCount > 0 ? "ok" : "outline"}>本页可交付 {readyCount} 款</Pill>
        </>
      }
    >
      {error ? <ErrorState description={error} onRetry={onRetry} /> : null}

      {loading && items.length === 0 && !error ? <LoadingState label="正在读取交付排产" /> : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState
          title="没有符合条件的产品"
          description="换一个交付状态筛选，或先在产品的「强成交话术」Tab 里生成一版主播稿再送审。"
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>产品</th>
                  <th>年份 / 茶类 / 山头</th>
                  <th>成稿</th>
                  <th>强度</th>
                  <th>成交冲击力</th>
                  <th>Level 5</th>
                  <th>合规</th>
                  <th>审核</th>
                  <th>审批</th>
                  <th>交付闸门</th>
                  <th>卡在哪一步</th>
                  <th>一句话定位</th>
                  <th>生成时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const gate = gateLabelTone(gateOfRow(row), labels);
                  return (
                    <tr key={row.product_id}>
                      <td>
                        <Link to={`/products/${row.product_id}`}>{row.product_name}</Link>
                      </td>
                      <td>
                        {row.year} 年 · {row.tea_type}
                        {row.mountain ? <div className="muted mt-1">{row.mountain}</div> : null}
                      </td>
                      <td className="nowrap">
                        {row.copy_version === null ? (
                          <span className="muted">尚未生成</span>
                        ) : (
                          <Pill tone="neutral">v{row.copy_version}</Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.intensity === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <Pill tone={intensityTone(row.intensity, null)}>
                            {intensityLabel(row.intensity, null)}
                          </Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.impact_score === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            <Pill tone="neutral">{row.impact_score} 分</Pill>
                            {row.impact_band ? (
                              <div className="muted mt-1">{impactBandMeta(row.impact_band, null).label}</div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.copy_version === null ? (
                          <span className="muted">—</span>
                        ) : row.level5_passed ? (
                          <Pill tone="ok">成立</Pill>
                        ) : (
                          <Pill tone="outline">未成立</Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.copy_version === null ? (
                          <span className="muted">—</span>
                        ) : row.compliance_passed ? (
                          <Pill tone="ok">通过</Pill>
                        ) : (
                          <Pill tone="danger">未通过</Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.review_version === null ? (
                          <span className="muted">未送审</span>
                        ) : (
                          <>
                            <Pill tone="neutral">第 {row.review_version} 次</Pill>
                            {row.red_count > 0 ? (
                              <div className="muted mt-1">RED {row.red_count} 条</div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="nowrap">
                        <Pill tone={approvalStatusTone(row.approval_status)}>
                          {approvalStatusLabel(row.approval_status)}
                        </Pill>
                      </td>
                      <td className="nowrap">
                        <Pill tone={gate.tone}>{gate.label}</Pill>
                      </td>
                      <td>
                        {row.ready ? (
                          <span className="muted">—</span>
                        ) : row.gate_reason ? (
                          <span className="muted">{row.gate_reason}</span>
                        ) : (
                          <span className="muted">未知</span>
                        )}
                      </td>
                      <td>
                        {row.one_liner ?? <span className="muted">—</span>}
                      </td>
                      <td className="nowrap">
                        {row.generated_at ? formatDateTime(row.generated_at) : <span className="muted">—</span>}
                      </td>
                      <td>
                        <Link to={`/products/${row.product_id}`}>
                          <button type="button" className="secondary sm">
                            打开产品
                          </button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="row between mt-3">
              <button
                type="button"
                className="secondary sm"
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
              >
                上一页
              </button>
              <span className="muted">
                第 {page} / {totalPages} 页 · 每页 {pageSize} 条
              </span>
              <button
                type="button"
                className="secondary sm"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <Alert tone="info">
        跨产品视图只用来看排产：每一款茶的可交付结论都来自它自己「最新一版成稿 + 这一版自己的审核」，
        上一版通过不会漂到这一版上（§57 / §62-14）。
      </Alert>
    </Card>
  );
}
