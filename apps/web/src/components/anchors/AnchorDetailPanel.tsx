import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import {
  ANCHOR_OFFER_BASIS_LABELS,
  ANCHOR_TYPE_TONES,
  SALES_ANCHOR_COMPONENT_LABELS,
  anchorCandidateSpec,
  anchorDisplayName,
  anchorTypeLabel,
  formatPricePercentile,
  type AnchorType,
  type AnchorView
} from "../../lib/anchors.js";
import {
  CANDIDATE_EVIDENCE_KIND_LABELS,
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_TONES,
  SIMILARITY_BAND_LABELS,
  SIMILARITY_BAND_TONES
} from "../../lib/candidates.js";
import {
  MARKET_OFFER_ATTRIBUTION_LABELS,
  MARKET_OFFER_ATTRIBUTION_TONES,
  PRICE_EVIDENCE_BAND_LABELS,
  PRICE_EVIDENCE_BAND_TONES,
  type MarketOfferAttribution,
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
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface AnchorDetailPanelProps {
  anchor: AnchorView | null;
  canWrite: boolean;
  isAdmin: boolean;
  busy: boolean;
  typeLabels: Record<AnchorType, string>;
  onSetPrimary: (anchor: AnchorView) => Promise<void>;
  onSaveRationale: (anchor: AnchorView, rationale: string) => Promise<void>;
  onRemove: (anchor: AnchorView) => Promise<void>;
  onClose: () => void;
}

/**
 * 锚点明细（§16 / §17）：把「这个候选为什么有资格当锚点」摊开给人工复核。
 *
 * 三块缺一不可：候选的十维相似度明细（为什么像）、价格证据与百分位（价格站得住吗）、
 * 强成交六项加权（按 §16.3 的哪一项得的分）。少了任何一块，锚点就成了黑箱结论。
 */
export function AnchorDetailPanel({
  anchor,
  canWrite,
  isAdmin,
  busy,
  typeLabels,
  onSetPrimary,
  onSaveRationale,
  onRemove,
  onClose
}: AnchorDetailPanelProps): ReactElement {
  if (!anchor) {
    return (
      <Card title="锚点明细" spec="§16 / §17">
        <EmptyState
          title="选择左侧一条锚点"
          description="明细会摊开候选十维相似度、价格证据与百分位、强成交六项加权，以及人工设为主锚点 / 追加理由的入口。"
        />
      </Card>
    );
  }

  return (
    <AnchorDetail
      key={anchor.id}
      anchor={anchor}
      canWrite={canWrite}
      isAdmin={isAdmin}
      busy={busy}
      typeLabels={typeLabels}
      onSetPrimary={onSetPrimary}
      onSaveRationale={onSaveRationale}
      onRemove={onRemove}
      onClose={onClose}
    />
  );
}

interface AnchorDetailProps {
  anchor: AnchorView;
  canWrite: boolean;
  isAdmin: boolean;
  busy: boolean;
  typeLabels: Record<AnchorType, string>;
  onSetPrimary: (anchor: AnchorView) => Promise<void>;
  onSaveRationale: (anchor: AnchorView, rationale: string) => Promise<void>;
  onRemove: (anchor: AnchorView) => Promise<void>;
  onClose: () => void;
}

function AnchorDetail({
  anchor,
  canWrite,
  isAdmin,
  busy,
  typeLabels,
  onSetPrimary,
  onSaveRationale,
  onRemove,
  onClose
}: AnchorDetailProps): ReactElement {
  const [rationale, setRationale] = useState(anchor.rationale);
  useEffect(() => {
    setRationale(anchor.rationale);
  }, [anchor.id, anchor.rationale]);

  const candidate = anchor.snapshot.candidate;
  const offer = anchor.snapshot.market_offer;
  const similarity = candidate.similarity;
  const salesAnchor = anchor.sales_anchor;
  const rationaleChanged = rationale.trim() !== anchor.rationale.trim();

  return (
    <Card
      title="锚点明细"
      spec="§16 / §17"
      actions={
        <>
          <Pill tone={ANCHOR_TYPE_TONES[anchor.anchor_type] ?? "neutral"}>
            {anchorTypeLabel(anchor.anchor_type, typeLabels)}
          </Pill>
          {anchor.is_primary ? <Pill tone="brand">主锚点</Pill> : null}
          <button type="button" className="ghost sm" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <h4 className="detail-title">{anchorDisplayName(anchor)}</h4>
      <div className="context-meta">
        <Pill tone="neutral">名次 #{anchor.rank}</Pill>
        <Pill tone={SIMILARITY_BAND_TONES[candidate.similarity_band] ?? "neutral"}>
          相似度 {candidate.similarity_total}（
          {SIMILARITY_BAND_LABELS[candidate.similarity_band] ?? candidate.similarity_band}）
        </Pill>
        <Pill tone="info">价格证据 {anchor.price_evidence_score}</Pill>
        <Pill tone="neutral">{formatPricePercentile(anchor.price_percentile)}</Pill>
        <Pill tone={CANDIDATE_STATUS_TONES[candidate.status] ?? "neutral"}>
          {CANDIDATE_STATUS_LABELS[candidate.status] ?? candidate.status}
        </Pill>
        {anchor.is_manual ? <Pill tone="warn">人工锚点</Pill> : <Pill tone="neutral">自动锚点</Pill>}
      </div>
      <p className="muted">
        {anchorCandidateSpec(anchor)} · 身份键{" "}
        <code className="mono">{candidate.identity_key || "未登记"}</code> · 来源印证{" "}
        {candidate.merged_sources} 个 · 入选 {formatDateTime(anchor.selected_at ?? anchor.created_at)}
      </p>

      <div className="sub-title">判定理由</div>
      <p className="quote">{anchor.rationale}</p>

      <div className="sub-title">候选十维相似度（§13，价格不参与）</div>
      {similarity ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>维度</th>
                <th>权重</th>
                <th>得分</th>
                <th>判定依据</th>
              </tr>
            </thead>
            <tbody>
              {similarity.dimensions.map((dimension) => (
                <tr key={dimension.dimension}>
                  <td>
                    {dimension.label}
                    {dimension.matched ? <Pill tone="ok">命中</Pill> : null}
                  </td>
                  <td className="nowrap">{dimension.weight}</td>
                  <td className="nowrap">{dimension.score}</td>
                  <td className="muted">{dimension.note}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>合计</strong>
                </td>
                <td className="nowrap">100</td>
                <td className="nowrap">
                  <strong>{similarity.total}</strong>
                </td>
                <td className="muted">
                  分档：
                  {SIMILARITY_BAND_LABELS[similarity.band] ?? similarity.band}
                  （≥ 70 才有资格作可靠锚点，§16.1）
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <Alert tone="warn">该锚点未冻结相似度明细，无法复核十维依据（请重建锚点）。</Alert>
      )}
      {similarity && similarity.unknown_dimensions.length > 0 ? (
        <p className="muted">
          来源未写明、按最保守口径处理的维度：{similarity.unknown_dimensions.join("、")}（未知 ≠ 一致，§13）。
        </p>
      ) : null}

      <div className="sub-title">价格证据（§15 / §16）</div>
      {offer ? (
        <>
          <div className="context-meta">
            <Pill tone={PRICE_TYPE_TONES[offer.price_type] ?? "neutral"}>
              {PRICE_TYPE_LABELS[offer.price_type] ?? offer.price_type}
            </Pill>
            <Pill tone="brand">{formatPrice(offer.value, offer.currency)}</Pill>
            <Pill tone="neutral">
              {offer.unit_scope
                ? (UNIT_SCOPE_LABELS[offer.unit_scope] ?? offer.unit_scope)
                : "单位未写明"}
              {offer.weight_g !== null ? ` · ${offer.weight_g}g` : ""}
            </Pill>
            <Pill
              tone={
                PRICE_EVIDENCE_BAND_TONES[offer.evidence_band as PriceEvidenceBand] ?? "neutral"
              }
            >
              {PRICE_EVIDENCE_BAND_LABELS[offer.evidence_band as PriceEvidenceBand] ??
                offer.evidence_band}
            </Pill>
            <Pill
              tone={
                MARKET_OFFER_ATTRIBUTION_TONES[
                  offer.attribution as MarketOfferAttribution
                ] ?? "neutral"
              }
            >
              {MARKET_OFFER_ATTRIBUTION_LABELS[offer.attribution as MarketOfferAttribution] ??
                offer.attribution}
            </Pill>
          </div>
          <ul className="prov-list">
            <li>
              证据分：<strong>{offer.evidence_score} / 100</strong>
              （低于 75 的价格不得作最高价值锚点的价格依据，§16.1）
            </li>
            <li>
              可比价：{offer.comparable_value.toLocaleString("zh-CN")} ·{" "}
              {ANCHOR_OFFER_BASIS_LABELS[offer.comparable_basis] ?? offer.comparable_basis}
              （整件价不折算 357g 单饼价，§62-3）
            </li>
            <li>
              可靠价格样本：{anchor.snapshot.reliable_price_count} 条 ·{" "}
              {formatPricePercentile(anchor.price_percentile)}
            </li>
            {offer.observed_at ? <li>观察时间：{offer.observed_at}</li> : null}
          </ul>
          <div className="quote">“{offer.quote}”</div>
          <p className="muted">
            {offer.quote_traceable
              ? "引文可在来源正文中逐字回溯。"
              : "引文无法在来源正文中逐字回溯：按最保守口径给分。"}
            {offer.domain ? ` · 来源 ${offer.domain}` : ""}
          </p>
          {offer.url ? (
            <a className="muted mono" href={offer.url} target="_blank" rel="noreferrer">
              {offer.url}
            </a>
          ) : null}
        </>
      ) : (
        <Alert tone="warn">
          该锚点没有冻结价格证据：高相似度锚点与强成交锚点可以在价格证据不足时存在，
          但不得把「相似」说成「同价」（§16.2 / §62-2）。
        </Alert>
      )}
      <p className="muted">{anchor.snapshot.evidence_note}</p>

      {salesAnchor ? (
        <>
          <div className="sub-title">强成交锚点六项加权（§16.3）</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>分项</th>
                  <th>权重</th>
                  <th>得分</th>
                  <th>加权贡献</th>
                  <th>判定依据</th>
                </tr>
              </thead>
              <tbody>
                {salesAnchor.items.map((item) => (
                  <tr key={item.component}>
                    <td>
                      {SALES_ANCHOR_COMPONENT_LABELS[item.component] ?? item.label}{" "}
                      <code className="mono">{item.component}</code>
                    </td>
                    <td className="nowrap">{item.weight}</td>
                    <td className="nowrap">{item.score}</td>
                    <td className="nowrap">{item.contribution}</td>
                    <td className="muted">{item.note}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>合计</strong>
                  </td>
                  <td className="nowrap">100</td>
                  <td className="nowrap">—</td>
                  <td className="nowrap">
                    <strong>{salesAnchor.total}</strong>
                  </td>
                  <td className="muted">强成交得分（越高越能撑起成交叙事）</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted">{salesAnchor.formula}</p>
        </>
      ) : (
        <>
          <div className="sub-title">强成交锚点六项加权（§16.3）</div>
          <p className="muted">
            该锚点不是强成交锚点，因此没有六项加权明细。强成交得分只在 SALES_ANCHOR
            口径下计算（相似度 30 · 价格水平 25 · 市场认知 15 · 故事价值 15 · 概念 10 · 证据 5）。
          </p>
        </>
      )}

      <div className="sub-title">候选证据与观察价格</div>
      {candidate.evidence.length > 0 ? (
        <ul className="prov-list">
          {candidate.evidence.slice(0, 8).map((item, index) => (
            <li key={`${item.kind}-${item.field}-${index}`}>
              {CANDIDATE_EVIDENCE_KIND_LABELS[item.kind] ?? item.kind} · {item.field}：
              {item.value ?? "—"}
              <div className="quote">“{item.quote}”</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">该候选没有登记网页证据。</p>
      )}
      {candidate.observed_prices.length > 0 ? (
        <ul className="prov-list">
          {candidate.observed_prices.slice(0, 6).map((price, index) => (
            <li key={`${price.price_type}-${index}`}>
              {price.value === null
                ? "价格未写明"
                : formatPrice(price.value, price.currency ?? "CNY")}
              {" · "}
              {PRICE_TYPE_LABELS[price.price_type] ?? price.price_type}
              <div className="quote">“{price.quote}”</div>
            </li>
          ))}
        </ul>
      ) : null}

      {canWrite ? (
        <form
          className="stack mt-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (rationaleChanged) {
              void onSaveRationale(anchor, rationale.trim());
            }
          }}
        >
          <div className="sub-title">人工维护</div>
          <label>
            判定理由（人工修改后本锚点标记为人工锚点，重建时默认保留）
            <textarea
              rows={3}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
            />
          </label>
          <div className="btn-row">
            <button type="submit" disabled={busy || !rationaleChanged}>
              {busy ? "提交中…" : "保存理由"}
            </button>
            {!anchor.is_primary ? (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void onSetPrimary(anchor)}
              >
                设为主锚点
              </button>
            ) : (
              <Pill tone="brand">当前主锚点</Pill>
            )}
            {isAdmin ? (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void onRemove(anchor)}
              >
                删除锚点
              </button>
            ) : null}
          </div>
          <Alert tone="info">
            人工只做两件事：换主锚点、改判定理由。相似度、价格证据分与强成交得分由引擎计算，
            不接受手工改写——否则锚点就不再是证据（§17 / §62-10）。
          </Alert>
        </form>
      ) : (
        <Alert tone="info">当前角色为只读：设为主锚点、追加理由与删除需要 ADMIN / RESEARCHER 权限。</Alert>
      )}
    </Card>
  );
}
