import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import {
  MARKET_OFFER_ATTRIBUTION_LABELS,
  MARKET_OFFER_ATTRIBUTION_TONES,
  PRICE_EVIDENCE_BAND_LABELS,
  PRICE_EVIDENCE_BAND_TONES,
  formatEquivalents,
  priceStatusLabel,
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
import { Alert, EmptyState, Pill } from "../ui/State.js";

/** PATCH 只接受这五个字段：价格数值、价格类型与引文一律不可改（§62-2·3·4）。 */
export interface MarketOfferUpdatePatch {
  unit_scope?: string;
  weight_g?: number | null;
  pieces_per_case?: number | null;
  manual_note?: string | null;
  is_excluded?: boolean;
}

export interface MarketOfferEvidencePanelProps {
  offer: MarketOfferView | null;
  bandLabels?: Record<PriceEvidenceBand, string>;
  canWrite: boolean;
  isAdmin: boolean;
  busy: boolean;
  onUpdate: (offer: MarketOfferView, patch: MarketOfferUpdatePatch) => Promise<void>;
  onRemove: (offer: MarketOfferView) => Promise<void>;
  onClose: () => void;
}

/**
 * 价格证据明细（§15）：把「这条价格为什么能 / 不能用」摊开给人工复核。
 *
 * 五项证据分明细与判定理由必须原样展示——缺了明细，证据分就成了黑箱；
 * 同时必须展示异常值判据与原文引文，让审核人员能自己复核而不是相信一个数字。
 */
export function MarketOfferEvidencePanel({
  offer,
  bandLabels,
  canWrite,
  isAdmin,
  busy,
  onUpdate,
  onRemove,
  onClose
}: MarketOfferEvidencePanelProps): ReactElement {
  if (!offer) {
    return (
      <Card title="价格证据明细" spec="§15">
        <EmptyState
          title="选择左侧一条价格证据"
          description="明细会摊开 §15 五项证据分的逐项判定理由、原文引文、异常值判据与人工修正入口。"
        />
      </Card>
    );
  }

  return (
    <MarketOfferDetail
      key={offer.id}
      offer={offer}
      bandLabels={bandLabels ?? PRICE_EVIDENCE_BAND_LABELS}
      canWrite={canWrite}
      isAdmin={isAdmin}
      busy={busy}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onClose={onClose}
    />
  );
}

interface MarketOfferDetailProps {
  offer: MarketOfferView;
  bandLabels: Record<PriceEvidenceBand, string>;
  canWrite: boolean;
  isAdmin: boolean;
  busy: boolean;
  onUpdate: (offer: MarketOfferView, patch: MarketOfferUpdatePatch) => Promise<void>;
  onRemove: (offer: MarketOfferView) => Promise<void>;
  onClose: () => void;
}

function textOf(offer: MarketOfferView): string {
  const parts: string[] = [];
  if (offer.subject_brand) {
    parts.push(offer.subject_brand);
  }
  if (offer.subject_name) {
    parts.push(offer.subject_name);
  }
  return parts.length > 0 ? parts.join(" ") : "未写明产品身份的价格";
}

function optionalNumber(value: string): number | null {
  const text = value.trim();
  if (text.length === 0) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function MarketOfferDetail({
  offer,
  bandLabels,
  canWrite,
  isAdmin,
  busy,
  onUpdate,
  onRemove,
  onClose
}: MarketOfferDetailProps): ReactElement {
  const [unitScope, setUnitScope] = useState(offer.unit_scope ?? "");
  const [weightG, setWeightG] = useState(offer.weight_g === null ? "" : String(offer.weight_g));
  const [pieces, setPieces] = useState(offer.pieces_per_case === null ? "" : String(offer.pieces_per_case));
  const [manualNote, setManualNote] = useState(offer.manual_note ?? "");
  const [excluded, setExcluded] = useState(offer.is_excluded);

  useEffect(() => {
    setUnitScope(offer.unit_scope ?? "");
    setWeightG(offer.weight_g === null ? "" : String(offer.weight_g));
    setPieces(offer.pieces_per_case === null ? "" : String(offer.pieces_per_case));
    setManualNote(offer.manual_note ?? "");
    setExcluded(offer.is_excluded);
  }, [offer.id, offer.unit_scope, offer.weight_g, offer.pieces_per_case, offer.manual_note, offer.is_excluded]);

  const patch: MarketOfferUpdatePatch = {};
  if (unitScope !== (offer.unit_scope ?? "")) {
    patch.unit_scope = unitScope;
  }
  if (weightG !== (offer.weight_g === null ? "" : String(offer.weight_g))) {
    patch.weight_g = optionalNumber(weightG);
  }
  if (pieces !== (offer.pieces_per_case === null ? "" : String(offer.pieces_per_case))) {
    patch.pieces_per_case = optionalNumber(pieces);
  }
  if (manualNote !== (offer.manual_note ?? "")) {
    patch.manual_note = manualNote.trim().length > 0 ? manualNote.trim() : null;
  }
  if (excluded !== offer.is_excluded) {
    patch.is_excluded = excluded;
  }
  const changed = Object.keys(patch).length > 0;

  return (
    <Card
      title="价格证据明细"
      spec="§15"
      actions={
        <>
          <Pill tone={PRICE_EVIDENCE_BAND_TONES[offer.evidence_band]}>
            {bandLabels[offer.evidence_band]}
          </Pill>
          <button type="button" className="ghost sm" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <h4 className="detail-title">{textOf(offer)}</h4>
      <div className="context-meta">
        <Pill tone={PRICE_TYPE_TONES[offer.price_type] ?? "neutral"}>
          {PRICE_TYPE_LABELS[offer.price_type] ?? offer.price_type}
        </Pill>
        <Pill tone="brand">{formatPrice(offer.value, offer.currency)}</Pill>
        <Pill tone="neutral">
          {offer.unit_scope
            ? (UNIT_SCOPE_LABELS[offer.unit_scope] ?? offer.unit_scope)
            : "单位未写明"}
        </Pill>
        <Pill tone={MARKET_OFFER_ATTRIBUTION_TONES[offer.attribution]}>
          {MARKET_OFFER_ATTRIBUTION_LABELS[offer.attribution]}
        </Pill>
        {offer.is_outlier ? <Pill tone="warn">异常值</Pill> : null}
        {offer.is_excluded ? <Pill tone="neutral">已人工排除</Pill> : null}
      </div>
      <p className="muted">
        状态：{priceStatusLabel(offer)} · 身份键{" "}
        <code className="mono">{offer.identity_key || "（来源未写明产品身份）"}</code> ·
        登记 {formatDateTime(offer.created_at)}
      </p>
      {offer.candidate_name ? (
        <p className="muted">已挂到对标候选：{offer.candidate_name}</p>
      ) : null}

      <div className="sub-title">价格与等价（没有写 = 不计算）</div>
      <ul className="prov-list">
        <li>
          原始金额：<strong>{formatPrice(offer.value, offer.currency)}</strong>
          {offer.weight_g !== null ? ` · 规格重量 ${offer.weight_g}g` : " · 来源未写规格重量"}
          {offer.pieces_per_case !== null ? ` · 每件 ${offer.pieces_per_case} 片` : ""}
        </li>
        {formatEquivalents(offer, formatPrice).map((line) => (
          <li key={line} className="muted">
            {line}
          </li>
        ))}
      </ul>
      <p className="muted">
        等价价只由「来源写明的单位与规格重量」算出：整件价不折算 357g 单饼价，
        缺规格重量时两个等价价都不输出（§62-3）。
      </p>

      <div className="sub-title">§15 五项证据分明细（满分 100）</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>证据维度</th>
              <th>权重</th>
              <th>得分</th>
              <th>判定依据</th>
            </tr>
          </thead>
          <tbody>
            {offer.evidence.items.map((item) => (
              <tr key={item.component}>
                <td>
                  {item.label} <code className="mono">{item.component}</code>
                </td>
                <td className="nowrap">{item.weight}</td>
                <td className="nowrap">{item.score}</td>
                <td className="muted">{item.note}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>合计</strong>
              </td>
              <td className="nowrap">
                100
              </td>
              <td className="nowrap">
                <strong>{offer.evidence_score}</strong>
              </td>
              <td className="muted">
                分档：{bandLabels[offer.evidence_band]}（≥ 75 才算可靠价格锚点，§16.1）
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {offer.evidence.notes.length > 0 ? (
        <ul className="prov-list">
          {offer.evidence.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div className="sub-title">原文引文与来源</div>
      <div className="quote">“{offer.quote}”</div>
      <p className="muted">
        {offer.quote_traceable
          ? "引文可在来源正文中逐字回溯。"
          : "引文无法在来源正文中逐字回溯（人工登记且无来源正文，或来源未保存正文）：按最保守口径给分。"}
      </p>
      <ul className="prov-list">
        <li>
          来源类型：{offer.source_kind ?? "未分类"}
          {offer.domain ? ` · ${offer.domain}` : ""}
        </li>
        <li>
          时间：观察时间 {offer.observed_at ?? "来源未写"} · 发布时间 {offer.published_at ?? "来源未写"}
          （没有写时间按 4 分，未知 ≠ 新鲜）
        </li>
        {offer.url ? (
          <li>
            <a className="muted mono" href={offer.url} target="_blank" rel="noreferrer">
              {offer.url}
            </a>
          </li>
        ) : (
          <li className="muted">人工登记，无来源链接</li>
        )}
      </ul>
      {offer.note ? <p className="muted">来源备注：{offer.note}</p> : null}
      {offer.manual_note ? <p className="muted">人工备注：{offer.manual_note}</p> : null}

      {offer.is_outlier ? (
        <>
          <div className="sub-title">异常值判据（只标记，不删除）</div>
          <Alert tone="warn">
            {offer.outlier_reason ?? "同组偏离中位数，已标记为异常值。"}
          </Alert>
          <ul className="prov-list">
            <li>
              同组中位数：
              {offer.outlier_median === null ? "—" : formatPrice(offer.outlier_median, offer.currency)}
            </li>
            <li>同组样本：{offer.outlier_sample_size ?? 0} 条（少于 4 条不判定）</li>
            <li>
              分组键 <code className="mono">{offer.outlier_group_key || "—"}</code>
              （类型 + 单位 + 币种 + 规格；挂牌与成交、整件与单饼永不混算）
            </li>
          </ul>
        </>
      ) : null}

      {canWrite ? (
        <form
          className="stack mt-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (changed) {
              void onUpdate(offer, patch);
            }
          }}
        >
          <div className="sub-title">人工修正（只允许补规格 / 改单位 / 加备注 / 排除）</div>
          <div className="grid-3">
            <label>
              单位口径
              <select value={unitScope} onChange={(event) => setUnitScope(event.target.value)}>
                <option value="">（保持来源原样）</option>
                {Object.entries(UNIT_SCOPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              规格重量（g）
              <input
                type="number"
                min={1}
                placeholder="来源未写就留空"
                value={weightG}
                onChange={(event) => setWeightG(event.target.value)}
              />
            </label>
            <label>
              每件片数
              <input
                type="number"
                min={1}
                value={pieces}
                onChange={(event) => setPieces(event.target.value)}
              />
            </label>
          </div>
          <label>
            人工备注
            <textarea
              rows={3}
              value={manualNote}
              placeholder="例如：来源页面写的是整件价，规格重量来自同页参数表。"
              onChange={(event) => setManualNote(event.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={excluded}
              onChange={(event) => setExcluded(event.target.checked)}
            />
            人工排除本条（仍保留在库里、仍可审计，只是不进汇总与锚点判断）
          </label>
          <Alert tone="warn">
            金额、价格类型与引文不可修改：改了就等于篡改证据。若来源原文有误，
            请删除本条并按正确口径重新登记（§62-2 / §62-3）。
          </Alert>
          <div className="btn-row">
            <button type="submit" disabled={busy || !changed}>
              {busy ? "提交中…" : "保存修正"}
            </button>
            {isAdmin ? (
              <button type="button" className="danger" disabled={busy} onClick={() => void onRemove(offer)}>
                删除本条
              </button>
            ) : null}
          </div>
          <p className="muted">
            {changed ? "有未保存的修改。" : "当前没有修改内容。"}
            最近更新：{formatDateTime(offer.updated_at)}
          </p>
        </form>
      ) : (
        <Alert tone="info">
          当前角色为只读：补规格、改单位、排除与删除需要 ADMIN / RESEARCHER 权限。
        </Alert>
      )}
    </Card>
  );
}
