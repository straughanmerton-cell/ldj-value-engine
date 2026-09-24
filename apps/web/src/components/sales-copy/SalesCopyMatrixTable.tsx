import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  SALES_COPY_OUTPUT_ORDER,
  formatDateTime,
  impactBandMeta,
  intensityLabel,
  intensityTone,
  isGenerated,
  type SalesCopyLabels,
  type SalesCopyMatrixRow
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface SalesCopyMatrixTableProps {
  items: SalesCopyMatrixRow[];
  labels: SalesCopyLabels | null;
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
 * 强成交话术矩阵（跨产品，规格 §21 / §26 / §47）。
 *
 * 一行 = 一款产品的最新一版强成交话术，**尚未生成的产品也会出现**，
 * 这样「哪些产品还没把主播稿备好、哪些分了但输出没齐」一眼可见。
 *
 * 这里只用于排产：每款茶的话术只能引用它自己的已录入事实，不做跨产品比较、不互相借事实（§62-5）。
 */
export function SalesCopyMatrixTable({
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
}: SalesCopyMatrixTableProps): ReactElement {
  return (
    <Card
      title="强成交话术矩阵"
      spec="§21 / §31"
      subtitle="每一行是一款产品的最新一版：几档强度、打了多少分、九种输出齐不齐、Level 5 是否成立、合规与 §57 是否通过。"
      actions={<Pill tone="neutral">共 {total} 款产品</Pill>}
    >
      {error ? <ErrorState description={error} onRetry={onRetry} /> : null}

      {loading && items.length === 0 && !error ? (
        <LoadingState label="正在读取强成交话术库" />
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState
          title="还没有任何强成交话术"
          description="在产品的「强成交话术」Tab 里生成一版之后，这里会列出它的强度、成交冲击力与输出完成度。"
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
                  <th>模式</th>
                  <th>可靠价格锚点</th>
                  <th>强度</th>
                  <th>成交冲击力</th>
                  <th>九种输出</th>
                  <th>Level 5</th>
                  <th>合规</th>
                  <th>§57 验收</th>
                  <th>人工确认</th>
                  <th>一句话定位</th>
                  <th>生成时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const generated = isGenerated(row);
                  return (
                    <tr key={row.product_id}>
                      <td>
                        <Link to={`/products/${row.product_id}`}>{row.product_name}</Link>
                        {row.version === null ? (
                          <div className="muted mt-1">尚未生成话术</div>
                        ) : (
                          <div className="muted mt-1">v{row.version}</div>
                        )}
                      </td>
                      <td>
                        {row.year} 年 · {row.tea_type}
                        {row.mountain ? <div className="muted mt-1">{row.mountain}</div> : null}
                      </td>
                      <td>
                        <Pill tone={RESOLVED_MODE_TONES[row.mode]}>
                          {row.mode === "BENCHMARK" ? "Benchmark" : "Category Creator"}
                        </Pill>
                        <div className="muted mt-1">
                          {row.preference === "AUTO" ? "自动判定" : RESOLVED_MODE_LABELS[row.mode]}
                        </div>
                      </td>
                      <td>
                        {row.has_reliable_price_anchor ? (
                          <Pill tone="info">有</Pill>
                        ) : (
                          <Pill tone="outline">无（自建标准句）</Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.intensity === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <Pill tone={intensityTone(row.intensity, labels)}>
                            {intensityLabel(row.intensity, labels)}
                          </Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.impact_score === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            <Pill tone={row.acceptance_passed ? "ok" : "warn"}>
                              {row.impact_score} 分
                            </Pill>
                            {row.band ? (
                              <div className="muted mt-1">
                                {impactBandMeta(row.band, labels).label}（{row.band}）
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td>
                        {!generated ? (
                          <span className="muted">—</span>
                        ) : row.outputs_complete ? (
                          <Pill tone="ok">九种齐备</Pill>
                        ) : (
                          <>
                            <Pill tone="danger">缺 {row.missing_outputs.length} 种</Pill>
                            <div className="muted">
                              共 {SALES_COPY_OUTPUT_ORDER.length} 种
                            </div>
                          </>
                        )}
                      </td>
                      <td className="nowrap">
                        {!generated ? (
                          <span className="muted">—</span>
                        ) : row.level5_passed ? (
                          <Pill tone="ok">成立</Pill>
                        ) : (
                          <Pill tone="danger">未成立</Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {!generated ? (
                          <span className="muted">—</span>
                        ) : row.compliance_passed ? (
                          <Pill tone="ok">通过</Pill>
                        ) : (
                          <Pill tone="danger">未通过</Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.version === null ? (
                          <span className="muted">—</span>
                        ) : row.acceptance_passed ? (
                          <Pill tone="ok">通过</Pill>
                        ) : (
                          <Pill tone="danger">未通过</Pill>
                        )}
                      </td>
                      <td className="nowrap">
                        {row.record_id === null ? (
                          <span className="muted">—</span>
                        ) : row.is_confirmed ? (
                          <Pill tone="ok">已确认</Pill>
                        ) : (
                          <Pill tone="neutral">未确认</Pill>
                        )}
                      </td>
                      <td>
                        {row.one_liner ? (
                          row.one_liner
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {row.generated_at ? (
                          formatDateTime(row.generated_at)
                        ) : (
                          <span className="muted">—</span>
                        )}
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
        跨产品视图只用来看排产进度：每一款茶的话术只引用它自己已录入的事实与锚点，缺事实就留缺口，
        不会用别的产品的事实补圆（§47 / §62-5）。
      </Alert>
    </Card>
  );
}
