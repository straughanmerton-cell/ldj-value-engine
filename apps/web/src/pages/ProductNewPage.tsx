import { useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/Card.js";
import { Alert, Pill } from "../components/ui/State.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

interface FormState {
  product_name: string;
  series_name: string;
  year: string;
  tea_type: string;
  tea_subtype: string;
  origin_region: string;
  mountain: string;
  village: string;
  weight_g: string;
  raw_material: string;
  tree_type: string;
  tree_age: string;
  season: string;
  blend_description: string;
  dry_leaf_aroma: string;
  entry_taste: string;
  bitterness: string;
  huigan: string;
  salivation: string;
  cha_qi: string;
  benchmark_mode_preference: "AUTO" | "BENCHMARK" | "CATEGORY_CREATOR";
  copy_intensity_default: string;
  r_and_d_reference_enabled: "false" | "true";
  r_and_d_reference_notes: string;
}

const INITIAL: FormState = {
  product_name: "",
  series_name: "",
  year: String(new Date().getFullYear()),
  tea_type: "普洱生茶",
  tea_subtype: "",
  origin_region: "勐海",
  mountain: "",
  village: "",
  weight_g: "357",
  raw_material: "",
  tree_type: "",
  tree_age: "",
  season: "",
  blend_description: "",
  dry_leaf_aroma: "",
  entry_taste: "",
  bitterness: "",
  huigan: "",
  salivation: "",
  cha_qi: "",
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: "4",
  r_and_d_reference_enabled: "false",
  r_and_d_reference_notes: ""
};

export function ProductNewPage(): ReactElement {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    // 只提交用户实际填写的字段：未填写的字段保持 null，系统不会自动补出树龄 / 山头 / 配方等信息。
    const optional = (value: string): string | undefined => (value.trim() === "" ? undefined : value.trim());
    const payload: Record<string, unknown> = {
      product_name: form.product_name.trim(),
      year: Number(form.year),
      tea_type: form.tea_type.trim(),
      weight_g: Number(form.weight_g),
      benchmark_mode_preference: form.benchmark_mode_preference,
      copy_intensity_default: Number(form.copy_intensity_default),
      r_and_d_reference_enabled: form.r_and_d_reference_enabled === "true"
    };

    const optionalFields: Array<[keyof FormState, string]> = [
      ["series_name", "series_name"],
      ["tea_subtype", "tea_subtype"],
      ["origin_region", "origin_region"],
      ["mountain", "mountain"],
      ["village", "village"],
      ["raw_material", "raw_material"],
      ["tree_type", "tree_type"],
      ["tree_age", "tree_age"],
      ["season", "season"],
      ["blend_description", "blend_description"],
      ["dry_leaf_aroma", "dry_leaf_aroma"],
      ["entry_taste", "entry_taste"],
      ["bitterness", "bitterness"],
      ["huigan", "huigan"],
      ["salivation", "salivation"],
      ["cha_qi", "cha_qi"],
      ["r_and_d_reference_notes", "r_and_d_reference_notes"]
    ];

    for (const [key, payloadKey] of optionalFields) {
      const value = optional(String(form[key]));
      if (value !== undefined) {
        payload[payloadKey] = value;
      }
    }

    try {
      const created = await apiRequest<{ id: string }>("/api/products", {
        method: "POST",
        body: payload,
        token
      });
      navigate(`/products/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "VALIDATION_ERROR") {
        setError(`参数校验失败：${caught.message}`);
      } else {
        setError(caught instanceof ApiError ? caught.message : "创建失败");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <PageHeader
        title="新建产品"
        subtitle="只录入已知事实，留空即代表未知；系统不会替产品补全树龄、山头、年份或研发关系。"
        actions={
          <>
            <Pill tone="warn">留空 ≠ 默认值</Pill>
            <Link to="/products">
              <button type="button" className="secondary">
                返回产品中心
              </button>
            </Link>
          </>
        }
      />
      <Alert tone="info">
        保存后系统会自动生成一版规则引擎 Value DNA（规格 §9），并在产品详情页的「价值DNA」Tab 展示来源与缺失维度。
      </Alert>
      <form className="card" onSubmit={submit}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>基础资料</h3>
        <div className="grid-2">
          <label>
            产品名称 *
            <input required value={form.product_name} onChange={(e) => update("product_name", e.target.value)} />
          </label>
          <label>
            系列名称
            <input value={form.series_name} onChange={(e) => update("series_name", e.target.value)} />
          </label>
          <label>
            年份 *
            <input required value={form.year} onChange={(e) => update("year", e.target.value)} />
          </label>
          <label>
            茶类 *
            <input required value={form.tea_type} onChange={(e) => update("tea_type", e.target.value)} />
          </label>
          <label>
            子类
            <input value={form.tea_subtype} onChange={(e) => update("tea_subtype", e.target.value)} />
          </label>
          <label>
            产区
            <input value={form.origin_region} onChange={(e) => update("origin_region", e.target.value)} />
          </label>
          <label>
            山头
            <input value={form.mountain} onChange={(e) => update("mountain", e.target.value)} />
          </label>
          <label>
            村寨
            <input value={form.village} onChange={(e) => update("village", e.target.value)} />
          </label>
          <label>
            规格（g）*
            <input required value={form.weight_g} onChange={(e) => update("weight_g", e.target.value)} />
          </label>
        </div>

        <h3 style={{ fontSize: 15 }}>原料</h3>
        <div className="grid-2">
          <label>
            原料描述
            <input value={form.raw_material} onChange={(e) => update("raw_material", e.target.value)} />
          </label>
          <label>
            树型
            <input value={form.tree_type} onChange={(e) => update("tree_type", e.target.value)} />
          </label>
          <label>
            树龄（仅在已确认时填写）
            <input value={form.tree_age} onChange={(e) => update("tree_age", e.target.value)} />
          </label>
          <label>
            季节
            <input value={form.season} onChange={(e) => update("season", e.target.value)} />
          </label>
          <label>
            拼配说明（不含比例时留空比例）
            <input value={form.blend_description} onChange={(e) => update("blend_description", e.target.value)} />
          </label>
        </div>

        <h3 style={{ fontSize: 15 }}>感官</h3>
        <div className="grid-2">
          <label>
            干茶香
            <input value={form.dry_leaf_aroma} onChange={(e) => update("dry_leaf_aroma", e.target.value)} />
          </label>
          <label>
            入口滋味
            <input value={form.entry_taste} onChange={(e) => update("entry_taste", e.target.value)} />
          </label>
          <label>
            苦感
            <input value={form.bitterness} onChange={(e) => update("bitterness", e.target.value)} />
          </label>
          <label>
            回甘
            <input value={form.huigan} onChange={(e) => update("huigan", e.target.value)} />
          </label>
          <label>
            生津
            <input value={form.salivation} onChange={(e) => update("salivation", e.target.value)} />
          </label>
          <label>
            茶气
            <input value={form.cha_qi} onChange={(e) => update("cha_qi", e.target.value)} />
          </label>
        </div>

        <h3 style={{ fontSize: 15 }}>研发关系与成交设置</h3>
        <div className="grid-2">
          <label>
            对标模式偏好
            <select
              value={form.benchmark_mode_preference}
              onChange={(e) => update("benchmark_mode_preference", e.target.value as FormState["benchmark_mode_preference"])}
            >
              <option value="AUTO">自动判定（有强锚点走 Benchmark，否则 Category Creator）</option>
              <option value="BENCHMARK">Benchmark Mode</option>
              <option value="CATEGORY_CREATOR">Category Creator Mode</option>
            </select>
          </label>
          <label>
            默认文案强度
            <select value={form.copy_intensity_default} onChange={(e) => update("copy_intensity_default", e.target.value)}>
              <option value="2">普通（Level 2）</option>
              <option value="3">强势（Level 3）</option>
              <option value="4">爆款（Level 4）</option>
              <option value="5">王者（Level 5）</option>
            </select>
          </label>
          <label>
            是否有研发参考产品
            <select
              value={form.r_and_d_reference_enabled}
              onChange={(e) => update("r_and_d_reference_enabled", e.target.value as FormState["r_and_d_reference_enabled"])}
            >
              <option value="false">否</option>
              <option value="true">是（需在 Phase 2 补充证据）</option>
            </select>
          </label>
          <label>
            研发参考说明
            <input
              value={form.r_and_d_reference_notes}
              onChange={(e) => update("r_and_d_reference_notes", e.target.value)}
            />
          </label>
        </div>

        {error ? <p className="error">{error}</p> : null}
        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy}>
            保存产品
          </button>
        </div>
      </form>
    </section>
  );
}
