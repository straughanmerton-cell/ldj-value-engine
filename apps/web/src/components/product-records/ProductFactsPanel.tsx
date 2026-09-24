import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { FACT_KEY_CATALOG, factStatuses } from "@ldj/schemas";
import { ApiError, apiRequest } from "../../lib/api.js";

interface FactApi {
  id: string;
  fact_key: string;
  fact_label: string | null;
  fact_group: string;
  fact_value: string;
  fact_status: string;
  evidence_note: string | null;
  confirmed_at: string | null;
  updated_at: string;
}

interface ListResponse {
  items: FactApi[];
  total: number;
}

const STATUS_LABELS: Record<string, string> = {
  OFFICIAL_CONFIRMED: "官方确认",
  INTERNAL_CONFIRMED: "内部确认",
  TASTING_CONFIRMED: "品饮确认",
  RND_CONFIRMED: "研发确认",
  SUPPLIER_PROVIDED: "供应商提供",
  UNCONFIRMED: "未确认"
};

const GROUP_LABELS: Record<string, string> = {
  BASICS: "基础资料",
  MATERIAL: "原料",
  CRAFT: "工艺",
  SENSORY: "感官",
  RND: "研发关系",
  OTHER: "补充事实"
};

const ADMIN_ONLY_STATUS = "OFFICIAL_CONFIRMED";

export interface PanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  isAdmin: boolean;
}

export function ProductFactsPanel({ productId, token, canWrite, isAdmin }: PanelProps): ReactElement {
  const [facts, setFacts] = useState<FactApi[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [factKey, setFactKey] = useState<string>(FACT_KEY_CATALOG[0]?.key ?? "");
  const [factValue, setFactValue] = useState("");
  const [factStatus, setFactStatus] = useState<string>("UNCONFIRMED");
  const [evidenceNote, setEvidenceNote] = useState("");

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await apiRequest<ListResponse>(
        `/api/products/${productId}/facts?pageSize=100`,
        { token }
      );
      setFacts(response.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取事实清单失败");
    }
  }, [productId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  function describe(caught: unknown, fallback: string): string {
    if (caught instanceof ApiError) {
      return caught.code === "NOT_IMPLEMENTED" ? `${caught.message}` : caught.message;
    }
    return fallback;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/products/${productId}/facts`, {
        method: "POST",
        token,
        body: {
          fact_key: factKey,
          fact_value: factValue.trim(),
          fact_status: factStatus,
          ...(evidenceNote.trim() === "" ? {} : { evidence_note: evidenceNote.trim() })
        }
      });
      setFactValue("");
      setEvidenceNote("");
      setNotice("事实已录入。未确认状态不会被自动升级。");
      await load();
    } catch (caught) {
      setError(describe(caught, "事实录入失败"));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(fact: FactApi, nextStatus: string): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/products/${productId}/facts/${fact.id}`, {
        method: "PATCH",
        token,
        body: { fact_status: nextStatus }
      });
      await load();
    } catch (caught) {
      setError(describe(caught, "状态更新失败"));
    }
  }

  async function remove(fact: FactApi): Promise<void> {
    setError(null);
    try {
      await apiRequest(`/api/products/${productId}/facts/${fact.id}`, { method: "DELETE", token });
      await load();
    } catch (caught) {
      setError(describe(caught, "删除失败"));
    }
  }

  const optionalStatuses = isAdmin ? factStatuses : factStatuses.filter((status) => status !== ADMIN_ONLY_STATUS);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, fontSize: 15 }}>事实清单</h3>
      <p className="muted">
        规格 §11：事实状态六态，含 RND_CONFIRMED（研发记录 / 评审记录 / 配方实验 / 对标品饮）。
        状态非「未确认」时必须给出证据，系统不会自动补全任何事实。
      </p>

      {canWrite ? (
        <form onSubmit={submit}>
          <div className="grid-2">
            <label>
              事实键
              <select value={factKey} onChange={(event) => setFactKey(event.target.value)}>
                {FACT_KEY_CATALOG.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}（{entry.key}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              事实状态
              <select value={factStatus} onChange={(event) => setFactStatus(event.target.value)}>
                {optionalStatuses.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status] ?? status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              事实内容 *
              <input required value={factValue} onChange={(event) => setFactValue(event.target.value)} />
            </label>
            <label>
              证据说明（非未确认状态必填）
              <input value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={busy}>
              录入事实
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">当前角色只有只读权限，录入事实需要 ADMIN / RESEARCHER。</p>
      )}

      {notice ? <p className="muted">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <table>
        <thead>
          <tr>
            <th>分组</th>
            <th>事实</th>
            <th>内容</th>
            <th>状态</th>
            <th>证据</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {facts.map((fact) => (
            <tr key={fact.id}>
              <td className="muted">{GROUP_LABELS[fact.fact_group] ?? fact.fact_group}</td>
              <td>
                {fact.fact_label ?? fact.fact_key}
                <div className="muted">{fact.fact_key}</div>
              </td>
              <td>{fact.fact_value}</td>
              <td>
                {canWrite ? (
                  <select value={fact.fact_status} onChange={(event) => void changeStatus(fact, event.target.value)}>
                    {optionalStatuses.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status] ?? status}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="badge">{STATUS_LABELS[fact.fact_status] ?? fact.fact_status}</span>
                )}
              </td>
              <td className="muted">{fact.evidence_note ?? "—"}</td>
              <td>
                {isAdmin ? (
                  <button className="secondary" type="button" onClick={() => void remove(fact)}>
                    删除
                  </button>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {facts.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                暂无事实记录。留空即代表未知，系统不会自动补出树龄、山头、年份或研发关系。
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
