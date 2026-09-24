import { useState, type FormEvent, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import type { MarketOfferView } from "../../lib/market-offers.js";
import { PRICE_TYPE_LABELS, UNIT_SCOPE_LABELS } from "../../lib/research.js";
import { Alert } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

export interface OfferOption {
  id: string;
  label: string;
}

export interface MarketOfferCreateFormProps {
  productId: string;
  token: string | null;
  candidates: OfferOption[];
  sources: OfferOption[];
  onCreated: (offer: MarketOfferView) => void;
}

interface FormState {
  value: string;
  priceType: string;
  unitScope: string;
  currency: string;
  weightG: string;
  piecesPerCase: string;
  subjectName: string;
  subjectBrand: string;
  subjectYear: string;
  subjectSpec: string;
  candidateId: string;
  sourceId: string;
  quote: string;
  observedAt: string;
  note: string;
}

const PRICE_TYPES = ["VERIFIED_TRANSACTION", "AUCTION_HAMMER", "OFFICIAL_RETAIL", "LISTING", "HISTORICAL_REFERENCE", "UNKNOWN"];

const EMPTY_FORM: FormState = {
  value: "",
  priceType: "LISTING",
  unitScope: "",
  currency: "CNY",
  weightG: "",
  piecesPerCase: "",
  subjectName: "",
  subjectBrand: "",
  subjectYear: "",
  subjectSpec: "",
  candidateId: "",
  sourceId: "",
  quote: "",
  observedAt: "",
  note: ""
};

function optionalNumber(value: string): number | null {
  const text = value.trim();
  if (text.length === 0) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 人工登记价格证据（§14 / §15）。
 *
 * 三条与流水线完全一致的口径必须写死在表单里：
 * 1. 价格类型按来源原文判定（挂牌不得录成成交）；
 * 2. 单位必须显式选择，规格重量只录来源写明的值，没写就留空；
 * 3. 引文必填——没有原文引文的价格不是证据，是传闻。
 */
export function MarketOfferCreateForm({
  productId,
  token,
  candidates,
  sources,
  onCreated
}: MarketOfferCreateFormProps): ReactElement {
  const { notify } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = optionalNumber(form.value);
    if (value === null || value <= 0) {
      notify("金额必填，且必须大于 0", "error");
      return;
    }
    if (!form.subjectName.trim()) {
      notify("必须写清这条价格对应的产品名（写不出就只能当作无身份价格）", "error");
      return;
    }
    if (!form.quote.trim()) {
      notify("原文引文必填：价格证据必须能回到来源原话", "error");
      return;
    }
    const weightG = optionalNumber(form.weightG);
    const pieces = optionalNumber(form.piecesPerCase);
    const year = optionalNumber(form.subjectYear);
    setBusy(true);
    try {
      const created = await apiRequest<MarketOfferView>(`/api/products/${productId}/market-offers`, {
        method: "POST",
        token,
        body: {
          value,
          price_type: form.priceType,
          unit_scope: form.unitScope || undefined,
          currency: form.currency.trim() || undefined,
          weight_g: weightG === null ? undefined : Math.round(weightG),
          pieces_per_case: pieces === null ? undefined : Math.round(pieces),
          subject_name: form.subjectName.trim(),
          subject_brand: form.subjectBrand.trim() || undefined,
          subject_year: year === null ? undefined : Math.round(year),
          subject_spec: form.subjectSpec.trim() || undefined,
          candidate_id: form.candidateId || undefined,
          source_id: form.sourceId || undefined,
          quote: form.quote.trim(),
          observed_at: form.observedAt.trim() || undefined,
          note: form.note.trim() || undefined
        }
      });
      setForm({ ...EMPTY_FORM, priceType: form.priceType, currency: form.currency });
      onCreated(created);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "登记价格证据失败", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack mt-3" onSubmit={submit}>
      <div className="sub-title">人工登记价格证据（走同一套 §15 五项证据分）</div>
      <div className="grid-3">
        <label>
          金额 *
          <input
            type="number"
            min={0.01}
            step="0.01"
            value={form.value}
            onChange={(event) => setForm({ ...form, value: event.target.value })}
            placeholder="来源原话里的数字"
          />
        </label>
        <label>
          价格类型 *
          <select
            value={form.priceType}
            onChange={(event) => setForm({ ...form, priceType: event.target.value })}
          >
            {PRICE_TYPES.map((value) => (
              <option key={value} value={value}>
                {PRICE_TYPE_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </label>
        <label>
          币种
          <input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })} />
        </label>
        <label>
          单位口径
          <select value={form.unitScope} onChange={(event) => setForm({ ...form, unitScope: event.target.value })}>
            <option value="">来源未写明</option>
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
            value={form.weightG}
            onChange={(event) => setForm({ ...form, weightG: event.target.value })}
            placeholder="没写就留空，不推断"
          />
        </label>
        <label>
          每件片数
          <input
            type="number"
            min={1}
            value={form.piecesPerCase}
            onChange={(event) => setForm({ ...form, piecesPerCase: event.target.value })}
          />
        </label>
      </div>
      <div className="grid-3">
        <label>
          产品名 *
          <input
            value={form.subjectName}
            onChange={(event) => setForm({ ...form, subjectName: event.target.value })}
            placeholder="来源原话里的产品名"
          />
        </label>
        <label>
          品牌
          <input value={form.subjectBrand} onChange={(event) => setForm({ ...form, subjectBrand: event.target.value })} />
        </label>
        <label>
          年份
          <input
            type="number"
            min={1900}
            max={2100}
            value={form.subjectYear}
            onChange={(event) => setForm({ ...form, subjectYear: event.target.value })}
          />
        </label>
        <label>
          规格备注
          <input
            value={form.subjectSpec}
            onChange={(event) => setForm({ ...form, subjectSpec: event.target.value })}
            placeholder="例如：357g 饼"
          />
        </label>
        <label>
          观察时间
          <input
            value={form.observedAt}
            onChange={(event) => setForm({ ...form, observedAt: event.target.value })}
            placeholder="例如：2026-03"
          />
        </label>
        <label>
          备注
          <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
      </div>
      <div className="grid-2">
        <label>
          挂到对标候选（可选）
          <select
            value={form.candidateId}
            onChange={(event) => setForm({ ...form, candidateId: event.target.value })}
          >
            <option value="">不挂候选</option>
            {candidates.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          来源（可选）
          <select value={form.sourceId} onChange={(event) => setForm({ ...form, sourceId: event.target.value })}>
            <option value="">无来源（按人工登记最保守给分）</option>
            {sources.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        原文引文 *
        <textarea
          rows={3}
          value={form.quote}
          onChange={(event) => setForm({ ...form, quote: event.target.value })}
          placeholder="把来源里那一句原话抄进来，例如：2025 年春拍成交价 ¥12,000/饼（357g）。"
        />
      </label>
      <Alert tone="warn">
        人工登记的价格不会被「重建价格证据」覆盖；但引文无法逐字回溯时会扣分，
        且挂牌价不得录成成交价、整件价不得录成单饼价（§62-2 / §62-3）。
      </Alert>
      <div className="btn-row">
        <button type="submit" disabled={busy}>
          {busy ? "登记中…" : "登记价格证据"}
        </button>
        <button type="button" className="ghost" onClick={() => setForm(EMPTY_FORM)}>
          重置
        </button>
      </div>
    </form>
  );
}
