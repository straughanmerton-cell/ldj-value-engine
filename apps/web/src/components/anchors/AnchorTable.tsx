import type { ReactElement } from "react";
import {
  ANCHOR_TYPE_TONES,
  formatPricePercentile,
  anchorCandidateSpec,
  anchorDisplayName,
  anchorTypeLabel,
  type AnchorType,
  type AnchorView
} from "../../lib/anchors.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface AnchorTableProps {
  items: AnchorView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  canWrite: boolean;
  isAdmin: boolean;
  busyId: string | null;
  typeLabels: Record<AnchorType, string>;
  /** 跨产品视图（高价值锚点库不限定产品时）需要展示所属产品。 */
  showProduct?: boolean;
  onSelect: (anchor: AnchorView) => void;
  onPageChange: (page: number) => void;
  onSetPrimary?: (anchor: AnchorView) => void;
  onRemove?: (anchor: AnchorView) => void;
  onRetry?: () => void;
}

/**
 * 高价值锚点列表（§16）。
 *
 * 每一行都要能自证「凭什么入选」：名次与类型说明它属于哪种口径，
 * 相似度与价格证据分说明它是否真的过线，强成交得分说明它按 §16.3 排到哪里，
 * 主锚点标记说明当前拿谁当标杆。任何一格缺席，锚点都会变成拍脑袋。
 */
export function AnchorTable({
  items,
  total,
  page,
  pageSize,
  totalPages,
  loading,
  error,
  selectedId,
  canWrite,
  isAdmin,
  busyId,
  typeLabels,
  showProduct,
  onSelect,
  onPageChange,
  onSetPrimary,
  onRemove,
  onRetry
}: AnchorTableProps): ReactElement {
  const bandOf = (anchor: AnchorView): string => anchor.snapshot.candidate.similarity_band;

  return (
    <Card
      title="高价值锚点"
      spec="§16"
      subtitle="三种锚点分别回答「最高价值」「最像谁」「最能成交」；同一候选可以同时出现在多种口径里，但判定依据必须分开写。"
      actions={<Pill tone="neutral">共 {total} 条</Pill>}
    >
      {error ? <ErrorState description={error} onRetry={onRetry} /> : null}
      {loading && items.length === 0 && !error ? <LoadingState label="正在读取锚点" /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="当前条件下没有锚点"
          description="先跑研究流水线（ANCHOR_BUILD 阶段）或手工重建：没有达标候选时不会硬凑竞品，而是进入自建高端标准模式（§17）。"
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名次 / 类型</th>
                  <th>锚点候选</th>
                  <th>相似度</th>
                  <th>价格证据</th>
                  <th>价格百分位</th>
                  <th>强成交得分</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((anchor) => (
                  <tr
                    key={anchor.id}
                    className={selectedId === anchor.id ? "row-selected" : undefined}
                  >
                    <td className="nowrap">
                      <div className="anchor-rank">#{anchor.rank}</div>
                      <Pill tone={ANCHOR_TYPE_TONES[anchor.anchor_type] ?? "neutral"}>
                        {anchorTypeLabel(anchor.anchor_type, typeLabels)}
                      </Pill>
                    </td>
                    <td>
                      <div className="anchor-name">{anchorDisplayName(anchor)}</div>
                      <div className="muted">{anchorCandidateSpec(anchor)}</div>
                      {showProduct && anchor.product_name ? (
                        <div className="muted">{anchor.product_name}</div>
                      ) : null}
                      <div className="quote">{anchor.rationale}</div>
                    </td>
                    <td>
                      <div className="sim-score">{anchor.similarity_score} / 100</div>
                      <div className={`sim-bar band-${bandOf(anchor).toLowerCase()}`}>
                        <div
                          className={`sim-bar-fill band-${bandOf(anchor).toLowerCase()}`}
                          style={{ width: `${Math.max(anchor.similarity_score, 2)}%` }}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="sim-score">{anchor.price_evidence_score} / 100</div>
                      <div className="muted">
                        {anchor.snapshot.market_offer
                          ? `可比价 ${
                              anchor.snapshot.market_offer.comparable_value.toLocaleString("zh-CN")
                            }（${
                              anchor.snapshot.market_offer.comparable_basis === "price_per_kg"
                                ? "1kg"
                                : anchor.snapshot.market_offer.comparable_basis === "price_357g"
                                  ? "357g"
                                  : "原始金额"
                            }）`
                          : "无可靠价格"}
                      </div>
                      <div className="muted">
                        可靠价格样本 {anchor.snapshot.reliable_price_count} 条
                      </div>
                    </td>
                    <td className="nowrap">{formatPricePercentile(anchor.price_percentile)}</td>
                    <td className="nowrap">
                      {anchor.sales_anchor_score === null ? (
                        <span className="muted">—</span>
                      ) : (
                        <strong>{anchor.sales_anchor_score}</strong>
                      )}
                    </td>
                    <td className="nowrap">
                      {anchor.is_primary ? <Pill tone="brand">主锚点</Pill> : null}
                      {anchor.is_manual ? <Pill tone="warn">人工</Pill> : <Pill tone="neutral">自动</Pill>}
                    </td>
                    <td>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="secondary sm"
                          onClick={() => onSelect(anchor)}
                        >
                          查看明细
                        </button>
                        {canWrite && onSetPrimary && !anchor.is_primary ? (
                          <button
                            type="button"
                            className="ghost sm"
                            disabled={busyId === anchor.id}
                            onClick={() => onSetPrimary(anchor)}
                          >
                            设为主锚点
                          </button>
                        ) : null}
                        {isAdmin && onRemove ? (
                          <button
                            type="button"
                            className="danger sm"
                            disabled={busyId === anchor.id}
                            onClick={() => onRemove(anchor)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
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
        锚点只描述「为什么可以对标」：删除锚点不会删除候选与价格证据，重建会按当前候选池与价格证据重新判定模式（§17）。
      </Alert>
    </Card>
  );
}
