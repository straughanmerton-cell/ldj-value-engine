import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  PRODUCT_ARCHITECTURE_ROLE_ORDER,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  formatDateTime,
  roleShortLabel,
  type ProductArchitectureLabels,
  type ProductArchitectureMatrixRow
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface ProductArchitectureMatrixTableProps {
  items: ProductArchitectureMatrixRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  labels: ProductArchitectureLabels | null;
  onPageChange: (page: number) => void;
  onRetry?: () => void;
}

/**
 * 产品结构矩阵（跨产品，规格 §5 / §31）。
 *
 * 一行 = 一款产品的最新一版产品结构，**尚未生成的产品也会出现**（九角色全缺），
 * 这样「哪些产品还没把结构讲清」一眼可见。
 *
 * 这里只做检索与排产，不做跨产品比较：每款茶的九个角色只引用它自己的已录入事实（§45 / §62-5）。
 */
export function ProductArchitectureMatrixTable({
  items,
  total,
  page,
  pageSize,
  totalPages,
  loading,
  error,
  labels,
  onPageChange,
  onRetry
}: ProductArchitectureMatrixTableProps): ReactElement {
  return (
    <Card
      title="产品结构矩阵"
      spec="§5 / §31"
      subtitle="每一行是一款产品的最新一版：九个角色写实了几个、§57 验收缺什么、有没有人工确认。"
      actions={<Pill tone="neutral">共 {total} 款产品</Pill>}
    >
      {error ? <ErrorState description={error} onRetry={onRetry} /> : null}

      {loading && items.length === 0 && !error ? (
        <LoadingState label="正在读取产品结构库" />
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState
          title="还没有任何产品结构"
          description="在产品的「产品结构」Tab 里生成一版之后，这里会列出它的九个角色落位。"
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
                  <th>角色落位</th>
                  <th>§57 验收</th>
                  <th>人工确认</th>
                  <th>生成时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.product_id}>
                    <td>
                      <Link to={`/products/${row.product_id}`}>{row.product_name}</Link>
                      {row.version === null ? (
                        <div className="muted mt-1">尚未生成产品结构</div>
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
                      <Pill tone={row.written_roles > 0 ? "ok" : "neutral"}>
                        已写实 {row.written_roles} / {PRODUCT_ARCHITECTURE_ROLE_ORDER.length}
                      </Pill>
                      {row.gap_roles > 0 ? (
                        <Pill tone="danger">留空 {row.gap_roles}</Pill>
                      ) : (
                        <Pill tone="ok">无缺口</Pill>
                      )}
                    </td>
                    <td>
                      {row.version === null ? (
                        <span className="muted">—</span>
                      ) : row.acceptance_passed ? (
                        <Pill tone="ok">通过</Pill>
                      ) : (
                        <>
                          <Pill tone="danger">缺 {row.missing_acceptance_keys.length} 项</Pill>
                          <div className="muted mt-1">
                            {row.missing_acceptance_keys
                              .map((key) => roleShortLabel(key, labels))
                              .join(" / ")}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      {row.record_id === null ? (
                        <span className="muted">—</span>
                      ) : row.is_confirmed ? (
                        <Pill tone="ok">已确认</Pill>
                      ) : (
                        <Pill tone="neutral">未确认</Pill>
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
                ))}
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
        跨产品视图只用来看进度：每个角色只引用本产品已录入字段，缺事实就留空写缺口，不会用竞品事实补圆（§45 / §62-5）。
      </Alert>
    </Card>
  );
}
