import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { RND_CLAIM_RULES, factStatuses, rndReferenceTypes } from "@ldj/schemas";
import { ApiError, apiRequest } from "../../lib/api.js";
import type { PanelProps } from "./ProductFactsPanel.js";

interface RndReferenceApi {
  id: string;
  reference_product_id: string | null;
  reference_product_name: string;
  reference_type: string;
  description: string;
  verification_status: string;
  evidence_note: string | null;
  claims_allowed: boolean;
  updated_at: string;
}

interface ListResponse {
  items: RndReferenceApi[];
  total: number;
}

const TYPE_LABELS: Record<string, string> = {
  sensory: "感官参考",
  formula_structure: "拼配结构研究",
  positioning: "产品定位参考",
  concept: "包装概念参考",
  other: "其他"
};

const STATUS_LABELS: Record<string, string> = {
  OFFICIAL_CONFIRMED: "官方确认",
  INTERNAL_CONFIRMED: "内部确认",
  TASTING_CONFIRMED: "品饮确认",
  RND_CONFIRMED: "研发确认（可声明研发关系）",
  SUPPLIER_PROVIDED: "供应商提供",
  UNCONFIRMED: "未确认"
};

const ADMIN_ONLY_STATUS = "OFFICIAL_CONFIRMED";

export function RndReferencesPanel({ productId, token, canWrite, isAdmin }: PanelProps): ReactElement {
  const [references, setReferences] = useState<RndReferenceApi[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(rndReferenceTypes[0]);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<string>("UNCONFIRMED");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await apiRequest<ListResponse>(
        `/api/products/${productId}/rnd-references?pageSize=100`,
        { token }
      );
      setReferences(response.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取研发参考失败");
    }
  }, [productId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/products/${productId}/rnd-references`, {
        method: "POST",
        token,
        body: {
          reference_product_name: name.trim(),
          reference_type: type,
          description: description.trim(),
          verification_status: status,
          ...(evidenceNote.trim() === "" ? {} : { evidence_note: evidenceNote.trim() })
        }
      });
      setName("");
      setDescription("");
      setEvidenceNote("");
      setStatus("UNCONFIRMED");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "研发参考保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(reference: RndReferenceApi, nextStatus: string): Promise<void> {
    setError(null);
    try {
      await apiRequest(`/api/products/${productId}/rnd-references/${reference.id}`, {
        method: "PUT",
        token,
        body: { verification_status: nextStatus }
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "研发参考更新失败");
    }
  }

  async function remove(reference: RndReferenceApi): Promise<void> {
    try {
      await apiRequest(`/api/products/${productId}/rnd-references/${reference.id}`, {
        method: "DELETE",
        token
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "删除失败");
    }
  }

  const selectableStatuses = isAdmin
    ? factStatuses
    : factStatuses.filter((value) => value !== ADMIN_ONLY_STATUS);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, fontSize: 15 }}>研发参考</h3>
      <p className="muted">
        规格 §25：只有 <strong>{RND_CLAIM_RULES.evidence_status}</strong>（研发记录 / 评审记录 /
        配方实验 / 对标品饮）才允许说「研发时曾参考 X」「团队拆解过 X」。禁止表述：
        {RND_CLAIM_RULES.restricted_phrases.join("、")}。参考产品的原料、价格、年份等事实不会移植到本产品。
      </p>

      {canWrite ? (
        <form onSubmit={submit}>
          <div className="grid-2">
            <label>
              参考产品名称 *
              <input required value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              参考方式
              <select value={type} onChange={(event) => setType(event.target.value)}>
                {rndReferenceTypes.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              证据状态
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {selectableStatuses.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              证据说明（非未确认状态必填）
              <input value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} />
            </label>
          </div>
          <label style={{ marginTop: 12 }}>
            参考说明 *
            <textarea
              rows={3}
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={busy}>
              保存研发参考
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">当前角色只有只读权限，录入研发参考需要 ADMIN / RESEARCHER。</p>
      )}

      {error ? <p className="error">{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>参考产品</th>
            <th>参考方式</th>
            <th>参考说明</th>
            <th>证据状态</th>
            <th>能否声明研发关系</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {references.map((reference) => (
            <tr key={reference.id}>
              <td>{reference.reference_product_name}</td>
              <td>{TYPE_LABELS[reference.reference_type] ?? reference.reference_type}</td>
              <td>{reference.description}</td>
              <td>
                {canWrite ? (
                  <select
                    value={reference.verification_status}
                    onChange={(event) => void updateStatus(reference, event.target.value)}
                  >
                    {selectableStatuses.map((value) => (
                      <option key={value} value={value}>
                        {STATUS_LABELS[value] ?? value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="badge">{STATUS_LABELS[reference.verification_status] ?? reference.verification_status}</span>
                )}
              </td>
              <td>
                {reference.claims_allowed ? (
                  <span className="badge badge-ok">允许</span>
                ) : (
                  <span className="badge badge-warn">仅内部参考</span>
                )}
              </td>
              <td>
                {isAdmin ? (
                  <button className="secondary" type="button" onClick={() => void remove(reference)}>
                    删除
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {references.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                暂无研发参考记录。没有研发证据时，系统不会自动生成任何研发 / 对标关系。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
