import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  VALUE_CODE_STATUS_ORDER,
  codeLabel,
  countOf,
  formatDateTime,
  statusShortLabel,
  statusTone,
  totalCount,
  type ValueCodeContract,
  type ValueCodeLabels,
  type ValueCodeMatrixRow
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface ValueCodeLibraryTableProps {
  items: ValueCodeMatrixRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  labels: ValueCodeLabels | null;
  contract: ValueCodeContract | null;
  /** 是否展示「尚未生成」的产品行（未生成时列会显示为一组 0）。 */
  onPageChange: (page: number) => void;
  onRetry?: () => void;
}

/**
 * 价值密码库（跨产品，规格 §18 / §30）。
 *
 * 一行 = 一款产品的最新一版价值映射。它只回答「这些产品各自把价值拆到了什么程度」，
 * 不做跨产品比较：不同产品的 Code 状态不可互相印证，缺事实就是缺事实（§44 / §62-5）。
 */
export function ValueCodeLibraryTable({
  items,
  total,
  page,
  pageSize,
  totalPages,
  loading,
  error,
  labels,
  contract,
  onPageChange,
  onRetry
}: ValueCodeLibraryTableProps): ReactElement {
  return (
    <Card
      title="价值映射矩阵"
      spec="§18 / §30"
      subtitle="每一行是一款产品的最新一版：状态分布、时间依赖 Code、未录入 Code 与人工确认状态一览。"
      actions={<Pill tone="neutral">共 {total} 款产品</Pill>}
    >
      {error ? <ErrorState description={error} onRetry={onRetry} /> : null}

      {loading && items.length === 0 && !error ? (
        <LoadingState label="正在读取价值密码库" />
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState
          title="还没有任何价值映射"
          description="在产品的「价值拆解」Tab 里生成一版之后，这里会列出它的 16 个 Code 落位。"
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
                  <th>状态分布</th>
                  <th>时间依赖</th>
                  <th>未录入</th>
                  <th>人工确认</th>
                  <th>生成时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.profile_id ?? row.product_id}>
                    <td>
                      <Link to={`/products/${row.product_id}`}>{row.product_name}</Link>
                      {row.version === null ? (
                        <div className="muted mt-1">尚未生成价值映射</div>
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
                      <div className="chip-list">
                        {VALUE_CODE_STATUS_ORDER.map((status) => (
                          <span
                            key={status}
                            className="chip"
                            title={`${statusShortLabel(status, labels)}：${countOf(
                              row.code_counts,
                              status
                            )} / ${totalCount(row.code_counts)}`}
                          >
                            {statusShortLabel(status, labels)} {countOf(row.code_counts, status)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {row.time_dependent_codes.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div className="chip-list">
                          {row.time_dependent_codes.map((code) => (
                            <span key={code} className="chip" title={code}>
                              {codeLabel(code, contract)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      {row.unknown_codes.length === 0 ? (
                        <Pill tone="ok">0</Pill>
                      ) : (
                        <>
                          <Pill tone="danger">{row.unknown_codes.length}</Pill>
                          <div className="muted mt-1">
                            {row.unknown_codes.map((code) => codeLabel(code, contract)).join(" / ")}
                          </div>
                        </>
                      )}
                    </td>
                    <td>
                      {row.profile_id === null ? (
                        <span className="muted">—</span>
                      ) : row.is_confirmed ? (
                        <Pill tone="ok">已确认</Pill>
                      ) : (
                        <Pill tone="neutral">未确认</Pill>
                      )}
                    </td>
                    <td>{row.generated_at ? formatDateTime(row.generated_at) : <span className="muted">—</span>}</td>
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
        跨产品视图只用来看进度：每个 Code 只引用本产品已录入事实，竞品事实不会被移植到自有产品（§44 / §62-5）。
      </Alert>
    </Card>
  );
}
