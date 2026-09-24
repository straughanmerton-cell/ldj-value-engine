import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { SENSORY_FIELDS } from "@ldj/schemas";
import { ApiError, apiRequest } from "../../lib/api.js";
import type { PanelProps } from "./ProductFactsPanel.js";

type SensoryValues = Record<string, string>;

type TastingProfileApi = SensoryValues & {
  id: string;
  taster_name: string | null;
  tasted_at: string | null;
  conclusion: string | null;
  version: number;
  updated_at: string;
};

interface ListResponse {
  items: TastingProfileApi[];
  total: number;
}

const EMPTY_SENSORY: SensoryValues = Object.fromEntries(SENSORY_FIELDS.map((field) => [field.key, ""]));

export function TastingProfilesPanel({ productId, token, canWrite, isAdmin }: PanelProps): ReactElement {
  const [profiles, setProfiles] = useState<TastingProfileApi[]>([]);
  const [sensory, setSensory] = useState<SensoryValues>(EMPTY_SENSORY);
  const [tasterName, setTasterName] = useState("");
  const [tastedAt, setTastedAt] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await apiRequest<ListResponse>(
        `/api/products/${productId}/tasting-profiles?pageSize=100`,
        { token }
      );
      setProfiles(response.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取品饮档案失败");
    }
  }, [productId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {};
    for (const field of SENSORY_FIELDS) {
      const value = sensory[field.key];
      if (value && value.trim() !== "") {
        body[field.key] = value.trim();
      }
    }
    if (tasterName.trim() !== "") {
      body.taster_name = tasterName.trim();
    }
    if (tastedAt.trim() !== "") {
      body.tasted_at = tastedAt.trim();
    }
    if (conclusion.trim() !== "") {
      body.conclusion = conclusion.trim();
    }

    try {
      await apiRequest(`/api/products/${productId}/tasting-profiles`, { method: "POST", token, body });
      setSensory(EMPTY_SENSORY);
      setTasterName("");
      setTastedAt("");
      setConclusion("");
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "品饮档案保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(profile: TastingProfileApi): Promise<void> {
    try {
      await apiRequest(`/api/products/${productId}/tasting-profiles/${profile.id}`, {
        method: "DELETE",
        token
      });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "删除失败");
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0, fontSize: 15 }}>品饮档案</h3>
      <p className="muted">
        规格 §10.4 的 20 项感官字段可多次记录：同一产品可以有不同品饮人、不同日期、不同轮次的档案。
        只填写实际品饮到的项，未品饮到的项保持空白，不做推测。
      </p>

      {canWrite ? (
        <form onSubmit={submit}>
          <div className="grid-2">
            <label>
              品饮人
              <input value={tasterName} onChange={(event) => setTasterName(event.target.value)} />
            </label>
            <label>
              品饮日期
              <input type="date" value={tastedAt} onChange={(event) => setTastedAt(event.target.value)} />
            </label>
          </div>
          <div className="grid-2" style={{ marginTop: 12 }}>
            {SENSORY_FIELDS.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  value={sensory[field.key] ?? ""}
                  onChange={(event) =>
                    setSensory((previous) => ({ ...previous, [field.key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <label style={{ marginTop: 12 }}>
            品饮结论
            <textarea
              rows={3}
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
            />
          </label>
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={busy}>
              保存品饮档案
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">当前角色只有只读权限，录入品饮档案需要 ADMIN / RESEARCHER。</p>
      )}

      {error ? <p className="error">{error}</p> : null}

      {profiles.map((profile) => (
        <div key={profile.id} className="card" style={{ marginTop: 16 }}>
          <div className="topbar" style={{ marginBottom: 8 }}>
            <strong>
              {profile.taster_name ?? "未署名品饮人"}
              {profile.tasted_at ? `　${profile.tasted_at.slice(0, 10)}` : ""}
            </strong>
            <span className="badge">版本 v{profile.version}</span>
          </div>
          <table>
            <tbody>
              {SENSORY_FIELDS.filter((field) => {
                const value = profile[field.key];
                return typeof value === "string" && value.trim() !== "";
              }).map((field) => (
                <tr key={field.key}>
                  <th style={{ width: 120 }}>{field.label}</th>
                  <td>{profile[field.key]}</td>
                </tr>
              ))}
              {profile.conclusion ? (
                <tr>
                  <th>结论</th>
                  <td>{profile.conclusion}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {isAdmin ? (
            <div style={{ marginTop: 10 }}>
              <button className="secondary" type="button" onClick={() => void remove(profile)}>
                删除档案
              </button>
            </div>
          ) : null}
        </div>
      ))}

      {profiles.length === 0 ? <p className="muted">暂无品饮档案。</p> : null}
    </div>
  );
}
