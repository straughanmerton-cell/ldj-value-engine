import type { ReactElement } from "react";
import {
  PRICE_BASIS_LABELS,
  type PriceSummary
} from "../../lib/market-offers.js";
import {
  PRICE_TYPE_LABELS,
  PRICE_TYPE_TONES,
  UNIT_SCOPE_LABELS,
  formatPrice
} from "../../lib/research.js";
import { Card } from "../ui/Card.js";
import { Alert, LoadingState, Pill } from "../ui/State.js";

export interface PriceSummaryCardProps {
  summary: PriceSummary | null;
  loading: boolean;
  /** 重建 / 登记 / 排除后由上层递增，用于显示「这是最新一次汇总」的提示。 */
  staleHint?: string | null;
}

/**
 * 价格汇总卡（§14 / §16.1）：Phase 7 锚点引擎判断「这个产品有没有可靠价格锚点」的依据。
 *
 * 汇总只统计未被人工排除的价格，且成交 / 挂牌分开计数：
 * 「有价格」不等于「有成交价」，缺成交证据时必须明说，不允许把挂牌价说成成交价。
 */
export function PriceSummaryCard({ summary, loading, staleHint }: PriceSummaryCardProps): ReactElement {
  if (loading && !summary) {
    return (
      <Card title="价格汇总" spec="§14 / §16.1">
        <LoadingState label="正在读取价格汇总" />
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card title="价格汇总" spec="§14 / §16.1">
        <Alert tone="info">选择产品后显示该产品的价格证据汇总。</Alert>
      </Card>
    );
  }

  const level = summary.price_level;

  return (
    <Card
      title="价格汇总"
      spec="§14 / §16.1"
      subtitle="成交价与挂牌价分开统计；整件价只参与 1kg 等价；可靠价格锚点要求证据分 ≥ 75 且不是异常值。"
      actions={
        <>
          <Pill tone={summary.reliable_count > 0 ? "ok" : "warn"}>
            可靠锚点 {summary.reliable_count} 条
          </Pill>
          <Pill tone="neutral">计入 {summary.counted_offers} / 共 {summary.total_offers}</Pill>
        </>
      }
    >
      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">成交价</div>
          <div className="metric-value">{summary.transaction_count}</div>
          <div className="metric-hint">已验证成交价（VERIFIED_TRANSACTION）</div>
        </div>
        <div className="metric">
          <div className="metric-label">挂牌 / 报价</div>
          <div className="metric-value">{summary.listing_count}</div>
          <div className="metric-hint">挂牌价 ≠ 成交价（§62-2）</div>
        </div>
        <div className="metric">
          <div className="metric-label">强 / 可用 / 弱</div>
          <div className="metric-value" style={{ fontSize: 18 }}>
            {summary.strong_offers} · {summary.usable_offers} · {summary.weak_offers}
          </div>
          <div className="metric-hint">按五项加权证据分分档</div>
        </div>
        <div className="metric">
          <div className="metric-label">异常值 / 已排除</div>
          <div className="metric-value" style={{ fontSize: 18 }}>
            {summary.outlier_count} · {summary.excluded_count}
          </div>
          <div className="metric-hint">异常值只标记不删除（§62-15）</div>
        </div>
        <div className="metric">
          <div className="metric-label">未写明身份</div>
          <div className="metric-value">{summary.unattributed_count}</div>
          <div className="metric-hint">不参与跨来源印证</div>
        </div>
        <div className="metric">
          <div className="metric-label">价格水平基准</div>
          <div className="metric-value" style={{ fontSize: 15 }}>
            {PRICE_BASIS_LABELS[level.basis] ?? level.basis}
          </div>
          <div className="metric-hint">样本 {level.sample_size} 条（已剔除异常值）</div>
        </div>
        <div className="metric">
          <div className="metric-label">中位 1kg 等价</div>
          <div className="metric-value" style={{ fontSize: 15 }}>
            {level.median_price_per_kg === null ? "—" : formatPrice(level.median_price_per_kg, level.currency)}
          </div>
          <div className="metric-hint">缺规格重量时为「—」</div>
        </div>
        <div className="metric">
          <div className="metric-label">中位 357g 等价</div>
          <div className="metric-value" style={{ fontSize: 15 }}>
            {level.median_price_357g === null ? "—" : formatPrice(level.median_price_357g, level.currency)}
          </div>
          <div className="metric-hint">整件价不输出单饼等价（§62-3）</div>
        </div>
      </div>

      {staleHint ? <Alert tone="info">{staleHint}</Alert> : null}

      <div className="sub-title">价格带（同类型 + 同单位分组，绝不跨类型混算）</div>
      {summary.buckets.length === 0 ? (
        <p className="muted">暂无可计入的价格证据。</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>价格类型</th>
                <th>单位</th>
                <th>条数</th>
                <th>中位金额</th>
                <th>中位 1kg 等价</th>
                <th>中位 357g 等价</th>
                <th>强证据</th>
                <th>异常值</th>
              </tr>
            </thead>
            <tbody>
              {summary.buckets.map((bucket) => (
                <tr key={`${bucket.price_type}-${bucket.unit_scope ?? "UNKNOWN"}`}>
                  <td>
                    <Pill tone={PRICE_TYPE_TONES[bucket.price_type] ?? "neutral"}>
                      {PRICE_TYPE_LABELS[bucket.price_type] ?? bucket.price_type}
                    </Pill>
                  </td>
                  <td className="nowrap">
                    {bucket.unit_scope
                      ? (UNIT_SCOPE_LABELS[bucket.unit_scope] ?? bucket.unit_scope)
                      : "单位未写明"}
                  </td>
                  <td className="nowrap">{bucket.count}</td>
                  <td className="nowrap">
                    {bucket.median_value === null ? "—" : formatPrice(bucket.median_value)}
                  </td>
                  <td className="nowrap">
                    {bucket.median_price_per_kg === null ? "—" : formatPrice(bucket.median_price_per_kg)}
                  </td>
                  <td className="nowrap">
                    {bucket.median_price_357g === null ? "—" : formatPrice(bucket.median_price_357g)}
                  </td>
                  <td className="nowrap">{bucket.strong_count}</td>
                  <td className="nowrap">{bucket.outlier_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.notes.length > 0 ? (
        <>
          <div className="sub-title">口径提示</div>
          <ul className="prov-list">
            {summary.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="muted">
        汇总口径：{summary.spec_ref}；异常值与人工排除的条目不参与价格水平基准，但始终保留在库里（§62-15）。
      </p>
    </Card>
  );
}
