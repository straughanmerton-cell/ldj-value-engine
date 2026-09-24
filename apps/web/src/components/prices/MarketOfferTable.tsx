import type { ReactElement } from "react";
import {
  MARKET_OFFER_ATTRIBUTION_LABELS,
  MARKET_OFFER_ATTRIBUTION_TONES,
  PRICE_EVIDENCE_BAND_LABELS,
  PRICE_EVIDENCE_BAND_TONES,
  formatEquivalents,
  type MarketOfferView,
  type PriceEvidenceBand
} from "../../lib/market-offers.js";
import {
  PRICE_TYPE_LABELS,
  PRICE_TYPE_TONES,
  UNIT_SCOPE_LABELS,
  formatDateTime,
  formatPrice
} from "../../lib/research.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface MarketOfferTableProps {
  items: MarketOfferView[];
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
  /** 跨产品视图（市场价格中心不传产品时为真）需要展示所属产品。 */
  showProduct?: boolean;
  bandLabels?: Record<PriceEvidenceBand, string>;
  onSelect: (offer: MarketOfferView) => void;
  onPageChange: (page: number) => void;
  onToggleExclude?: (offer: MarketOfferView) => void;
  onRemove?: (offer: MarketOfferView) => void;
  onRetry?: () => void;
}

/**
 * 价格证据列表（§14）。
 *
 * 每一行都必须同时回答四个问题：多少钱、什么性质（成交还是挂牌）、什么单位与等价价、
 * 这条证据有多可信。任何一格缺失都会让「价格锚点」变成拍脑袋，所以四格都在表里。
 */
export function MarketOfferTable({
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
  showProduct,
  bandLabels,
  onSelect,
  onPageChange,
  onToggleExclude,
  onRemove,
  onRetry
}: MarketOfferTableProps): ReactElement {
  const labels = bandLabels ?? PRICE_EVIDENCE_BAND_LABELS;

  return (
    <Card
      title="价格证据列表"
      spec="§14 / §15"
      subtitle="每条价格都带原文引文与来源；挂牌与成交、整件与单饼分列，异常值只标记不删除。"
      actions={<Pill tone="neutral">共 {total} 条</Pill>}
    >
      {error ? <ErrorState description={error} onRetry={onRetry} /> : null}
      {loading && items.length === 0 && !error ? <LoadingState label="正在读取价格证据" /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="当前条件下没有价格证据"
          description="价格证据来自已抽取的来源（研究流水线 PRICE_SEARCH 阶段）或人工登记：没有价格就不讲价格故事。"
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>价格</th>
                  <th>单位 / 等价</th>
                  <th>证据分</th>
                  <th>来源 / 归属</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((offer) => (
                  <tr key={offer.id} className={selectedId === offer.id ? "row-selected" : undefined}>
                    <td>
                      <div className="price-amount">{formatPrice(offer.value, offer.currency)}</div>
                      <Pill tone={PRICE_TYPE_TONES[offer.price_type] ?? "neutral"}>
                        {PRICE_TYPE_LABELS[offer.price_type] ?? offer.price_type}
                      </Pill>
                      {showProduct && offer.product_name ? (
                        <div className="muted">{offer.product_name}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="nowrap">
                        {offer.unit_scope
                          ? (UNIT_SCOPE_LABELS[offer.unit_scope] ?? offer.unit_scope)
                          : "单位未写明"}
                        {offer.weight_g !== null ? ` · ${offer.weight_g}g` : ""}
                      </div>
                      <div className="price-equiv">
                        {formatEquivalents(offer, formatPrice).join(" · ")}
                      </div>
                    </td>
                    <td>
                      <div className="sim-score">{offer.evidence_score} / 100</div>
                      <div className={`sim-bar band-${offer.evidence_band.toLowerCase()}`}>
                        <div
                          className={`sim-bar-fill band-${offer.evidence_band.toLowerCase()}`}
                          style={{ width: `${Math.max(offer.evidence_score, 2)}%` }}
                        />
                      </div>
                      <Pill tone={PRICE_EVIDENCE_BAND_TONES[offer.evidence_band]}>
                        {labels[offer.evidence_band]}
                      </Pill>
                    </td>
                    <td>
                      <Pill tone={MARKET_OFFER_ATTRIBUTION_TONES[offer.attribution]}>
                        {MARKET_OFFER_ATTRIBUTION_LABELS[offer.attribution]}
                      </Pill>
                      <div className="muted">
                        {offer.source_kind ?? "来源未分类"}
                        {offer.domain ? ` · ${offer.domain}` : ""}
                      </div>
                      {offer.url ? (
                        <a className="muted mono" href={offer.url} target="_blank" rel="noreferrer">
                          打开来源
                        </a>
                      ) : null}
                      <div className="quote">“{offer.quote}”</div>
                    </td>
                    <td className="nowrap">
                      {offer.is_excluded ? <Pill tone="neutral">已排除</Pill> : null}
                      {offer.is_outlier ? <Pill tone="warn">异常值</Pill> : null}
                      {!offer.quote_traceable ? <Pill tone="warn">引文不可回溯</Pill> : null}
                      {!offer.is_excluded && !offer.is_outlier && offer.quote_traceable ? (
                        <Pill tone="ok">正常</Pill>
                      ) : null}
                      <div className="muted">
                        {offer.observed_at ? `时间：${offer.observed_at}` : "来源未写时间"}
                      </div>
                      <div className="muted">登记 {formatDateTime(offer.created_at)}</div>
                    </td>
                    <td>
                      <div className="btn-row">
                        <button type="button" className="secondary sm" onClick={() => onSelect(offer)}>
                          证据明细
                        </button>
                        {canWrite && onToggleExclude ? (
                          <button
                            type="button"
                            className="ghost sm"
                            disabled={busyId === offer.id}
                            onClick={() => onToggleExclude(offer)}
                          >
                            {offer.is_excluded ? "恢复计入" : "排除"}
                          </button>
                        ) : null}
                        {isAdmin && onRemove ? (
                          <button
                            type="button"
                            className="danger sm"
                            disabled={busyId === offer.id}
                            onClick={() => onRemove(offer)}
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
        排除不会删除证据：被排除的价格仍然留在库里、仍然可审计，只是不进汇总与锚点判断（§62-15）。
      </Alert>
    </Card>
  );
}
