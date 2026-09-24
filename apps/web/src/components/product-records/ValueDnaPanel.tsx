import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { VALUE_DNA_DIMENSIONS } from "@ldj/schemas";
import { ApiError, apiRequest } from "../../lib/api.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import type { PanelProps } from "./ProductFactsPanel.js";

/**
 * 价值 DNA（规格 §9）+ Agent 1 事实归一试跑（规格 §39）。
 *
 * 界面必须让操作者一眼看清三件事：
 * 1. 这版 DNA 是怎么来的（规则引擎 / AI 辅助 + 来源溯源）；
 * 2. 哪些维度还是空的、哪些字段没录入（禁止自动补全）；
 * 3. 重新生成会不会改变产品资料（不会，独立版本号）。
 */

type DimensionKey = (typeof VALUE_DNA_DIMENSIONS)[number];

const DIMENSION_LABELS: Record<DimensionKey, { label: string; hint: string }> = {
  identity: { label: "产品身份", hint: "名称 / 系列拆出的身份词" },
  category: { label: "品类", hint: "茶类与细分品类" },
  origin: { label: "产区", hint: "省市 / 山头 / 村寨" },
  material: { label: "原料", hint: "原料、树型、树龄、季节" },
  process: { label: "工艺", hint: "杀青 / 揉捻 / 干燥 / 压制 / 仓储" },
  flavor: { label: "香气", hint: "干茶 / 热杯 / 汤香 / 冷杯" },
  taste: { label: "滋味", hint: "入口、回甘、生津、茶气、水路" },
  positioning: { label: "定位", hint: "对标模式、研发关系、价格带" },
  collection: { label: "收藏", hint: "仓储与陈化基础" },
  naming_concepts: { label: "命名概念", hint: "星级 / 图腾 / 生肖 / 概念词" },
  architecture_signals: { label: "结构信号", hint: "由已有事实推导的骨架信号" }
};

const KIND_LABELS: Record<string, string> = {
  FACT: "录入事实",
  DERIVED: "已推导",
  AI_TRACEABLE: "AI 补充（可回溯）"
};

const KIND_CLASS: Record<string, string> = {
  FACT: "chip",
  DERIVED: "chip derived",
  AI_TRACEABLE: "chip ai"
};

const GENERATOR_LABELS: Record<string, string> = {
  RULE_BASED: "规则引擎",
  AI_ASSISTED: "AI 辅助"
};

const STATUS_LABELS: Record<string, string> = {
  OFFICIAL_CONFIRMED: "官方确认",
  INTERNAL_CONFIRMED: "内部确认",
  TASTING_CONFIRMED: "品饮确认",
  RND_CONFIRMED: "研发确认",
  SUPPLIER_PROVIDED: "供应商提供",
  UNCONFIRMED: "未确认"
};

interface ProvenanceEntry {
  value: string;
  kind: string;
  source: string;
  fact_id: string | null;
  fact_status: string | null;
}

interface ValueDnaMetaShape {
  generator: string;
  prompt_key: string | null;
  prompt_version: number | null;
  provider: string | null;
  model: string | null;
  generated_at: string;
  version: number;
  product_version: number;
  fact_count: number;
  tasting_count: number;
  rnd_count: number;
  source_fact_ids: string[];
  provenance: Record<string, ProvenanceEntry[]>;
  missing_dimensions: string[];
  warnings: string[];
}

interface ValueDnaResponse {
  product_id: string;
  stored: boolean;
  value_dna: Record<string, string[]>;
  meta: ValueDnaMetaShape | null;
  stale: boolean;
  missing_dimensions: string[];
  warnings: string[];
  current: {
    product_version: number;
    fact_count: number;
    tasting_count: number;
    rnd_count: number;
  };
  spec_ref: string;
}

interface NormalizationItem {
  field: string;
  value: string;
  evidence_note: string | null;
}

interface NormalizationDrop {
  category: string;
  field: string;
  value: string;
  reason: string;
  details: string[];
}

interface NormalizationResponse {
  ai_used: boolean;
  prompt_key: string;
  prompt_version: number | null;
  provider: string | null;
  model: string | null;
  output: {
    confirmed_facts: NormalizationItem[];
    tasting_facts: NormalizationItem[];
    rnd_facts: NormalizationItem[];
    user_opinions: NormalizationItem[];
    inferences: NormalizationItem[];
    missing: { field: string; reason: string | null }[];
  };
  candidates: {
    category: string;
    fact_status: string | null;
    field: string;
    value: string;
    evidence_note: string | null;
  }[];
  dropped: NormalizationDrop[];
  warnings: string[];
  persisted: boolean;
  spec_ref: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  confirmed_fact: "已确认事实",
  tasting_fact: "品饮事实",
  rnd_fact: "研发事实",
  user_opinion: "用户观点",
  inference: "推断",
  missing: "缺失项"
};

const DROP_REASON_LABELS: Record<string, string> = {
  NOT_TRACEABLE_VALUE: "源文本中无法回溯",
  FORBIDDEN_FABRICATION: "禁止虚构的硬事实",
  RND_REQUIRES_EVIDENCE: "研发关系缺少证据"
};

export function ValueDnaPanel({ productId, token, canWrite }: PanelProps): ReactElement {
  const { notify } = useToast();
  const [data, setData] = useState<ValueDnaResponse | null>(null);
  const [normalization, setNormalization] = useState<NormalizationResponse | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"rule" | "ai" | "normalize" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const [dna, meta] = await Promise.all([
        apiRequest<ValueDnaResponse>(`/api/products/${productId}/value-dna`, { token }),
        apiRequest<{ ai_provider: string }>("/api/meta/core-features", { token }).catch(() => null)
      ]);
      setData(dna);
      if (meta) {
        setProvider(meta.ai_provider);
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取价值 DNA 失败");
    } finally {
      setLoading(false);
    }
  }, [productId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function regenerate(useAi: boolean): Promise<void> {
    setBusy(useAi ? "ai" : "rule");
    try {
      const result = await apiRequest<ValueDnaResponse>(`/api/products/${productId}/value-dna/generate`, {
        method: "POST",
        token,
        body: { use_ai: useAi }
      });
      setData(result);
      notify(
        `已生成 Value DNA v${result.meta?.version ?? "?"}（${GENERATOR_LABELS[result.meta?.generator ?? ""] ?? "规则引擎"}）`,
        "ok"
      );
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "重新生成失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function runNormalize(useAi: boolean): Promise<void> {
    setBusy("normalize");
    try {
      const result = await apiRequest<NormalizationResponse>(
        `/api/products/${productId}/facts/normalize`,
        { method: "POST", token, body: { use_ai: useAi } }
      );
      setNormalization(result);
      notify(
        result.dropped.length > 0
          ? `事实归一试跑完成：${result.candidates.length} 条候选，丢弃 ${result.dropped.length} 条`
          : `事实归一试跑完成：${result.candidates.length} 条候选（未写库）`,
        result.dropped.length > 0 ? "warn" : "ok"
      );
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "事实归一试跑失败", "error");
    } finally {
      setBusy(null);
    }
  }

  const coverage = useMemo(() => {
    if (!data) {
      return { filled: 0, total: VALUE_DNA_DIMENSIONS.length, entries: 0 };
    }
    const filled = VALUE_DNA_DIMENSIONS.filter(
      (dimension) => (data.value_dna[dimension] ?? []).length > 0
    ).length;
    const entries = VALUE_DNA_DIMENSIONS.reduce(
      (sum, dimension) => sum + (data.value_dna[dimension] ?? []).length,
      0
    );
    return { filled, total: VALUE_DNA_DIMENSIONS.length, entries };
  }, [data]);

  if (loading && !data) {
    return (
      <Card title="价值 DNA" spec="§9">
        <LoadingState label="正在读取价值 DNA" />
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card title="价值 DNA" spec="§9">
        <ErrorState description={error} onRetry={() => void load()} />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card title="价值 DNA" spec="§9">
        <EmptyState title="暂无 DNA 数据" description="产品创建后系统会自动生成一版规则引擎 DNA。" />
      </Card>
    );
  }

  const meta = data.meta;
  const missingDimensions = data.missing_dimensions;
  const isMockProvider = provider === "mock";

  return (
    <>
      <Card
        title="价值 DNA"
        spec="§9"
        subtitle="产品创建后自动生成；DNA 只承载已录入字段、事实清单、品饮档案与研发参考中已有的内容，任何未提供的硬事实一律留空。"
        actions={
          <>
            {meta ? (
              <Pill tone={meta.generator === "AI_ASSISTED" ? "info" : "neutral"}>
                {GENERATOR_LABELS[meta.generator] ?? meta.generator}
              </Pill>
            ) : null}
            {data.stale ? <Pill tone="warn">有上游更新，建议重新生成</Pill> : <Pill tone="ok">与当前资料一致</Pill>}
            <button
              type="button"
              className="secondary"
              disabled={!canWrite || busy !== null}
              onClick={() => void regenerate(false)}
            >
              {busy === "rule" ? "生成中…" : "重新生成"}
            </button>
            <button
              type="button"
              disabled={!canWrite || busy !== null}
              title={isMockProvider ? "当前为 Mock Provider，AI 输出仅占位，建议先配置真实 Key" : "调用当前启用 Prompt 做 AI 辅助补充"}
              onClick={() => void regenerate(true)}
            >
              {busy === "ai" ? "生成中…" : "AI 辅助生成"}
            </button>
          </>
        }
      >
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">DNA 版本</div>
            <div className="metric-value">v{meta?.version ?? "—"}</div>
            <div className="metric-hint">重新生成不会改变产品资料版本</div>
          </div>
          <div className="metric">
            <div className="metric-label">维度覆盖</div>
            <div className="metric-value">
              {coverage.filled}/{coverage.total}
            </div>
            <div className="metric-hint">共 {coverage.entries} 条 DNA 条目</div>
          </div>
          <div className="metric">
            <div className="metric-label">上游事实</div>
            <div className="metric-value">{data.current.fact_count}</div>
            <div className="metric-hint">生成时记录 {meta?.fact_count ?? 0} 条</div>
          </div>
          <div className="metric">
            <div className="metric-label">品饮档案</div>
            <div className="metric-value">{data.current.tasting_count}</div>
            <div className="metric-hint">生成时记录 {meta?.tasting_count ?? 0} 份</div>
          </div>
          <div className="metric">
            <div className="metric-label">研发参考</div>
            <div className="metric-value">{data.current.rnd_count}</div>
            <div className="metric-hint">生成时记录 {meta?.rnd_count ?? 0} 条</div>
          </div>
          <div className="metric">
            <div className="metric-label">AI Provider</div>
            <div className="metric-value" style={{ fontSize: 16 }}>
              {provider ?? "未知"}
            </div>
            <div className="metric-hint">
              {meta?.model ? `${meta.model}｜Prompt v${meta.prompt_version ?? "—"}` : isMockProvider ? "无 Key 时回退 Mock" : "仅规则引擎"}
            </div>
          </div>
        </div>

        {!canWrite ? (
          <p className="muted mt-3">当前角色为只读：重新生成与事实归一需要 ADMIN / RESEARCHER 权限。</p>
        ) : null}

        {meta ? (
          <p className="muted mt-3">
            生成时间：{new Date(meta.generated_at).toLocaleString("zh-CN")}
            {meta.prompt_key ? `　｜　Prompt：${meta.prompt_key}` : ""}
            {meta.source_fact_ids.length > 0 ? `　｜　引用事实 ${meta.source_fact_ids.length} 条` : ""}
          </p>
        ) : null}
      </Card>

      {missingDimensions.length > 0 ? (
        <Card title="待补充维度" spec="§9 / §62-8">
          <Alert tone="warn">
            以下维度暂无任何来源内容。系统不会自动补出树龄、山头、年份、获奖、大师、研发关系或配方比例，
            需要人工在这些字段上提供事实。
          </Alert>
          <div className="chip-list">
            {missingDimensions.map((dimension) => (
              <span key={dimension} className="chip muted">
                {DIMENSION_LABELS[dimension as DimensionKey]?.label ?? dimension}
                <code style={{ marginLeft: 6 }}>{dimension}</code>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="11 个维度" spec="§9" subtitle="每条 DNA 都带来源：录入事实（棕）、由已有内容推导（蓝）、AI 补充且可逐字回溯（紫）。">
        <div className="dna-grid">
          {VALUE_DNA_DIMENSIONS.map((dimension) => {
            const values = data.value_dna[dimension] ?? [];
            const provenance = meta?.provenance?.[dimension] ?? [];
            const kindOf = (value: string): string =>
              provenance.find((entry) => entry.value === value)?.kind ?? "FACT";
            return (
              <div key={dimension} className={values.length === 0 ? "dna-card empty" : "dna-card"}>
                <div className="dna-card-head">
                  <strong>{DIMENSION_LABELS[dimension].label}</strong>
                  <code>{dimension}</code>
                </div>
                {values.length === 0 ? (
                  <span className="muted">{DIMENSION_LABELS[dimension].hint} · 暂无内容</span>
                ) : (
                  <div className="chip-list">
                    {values.map((value) => (
                      <span key={`${dimension}-${value}`} className={KIND_CLASS[kindOf(value)] ?? "chip"}>
                        {value}
                      </span>
                    ))}
                  </div>
                )}
                {provenance.length > 0 ? (
                  <ul className="prov-list">
                    {provenance.slice(0, 6).map((entry) => (
                      <li key={`${entry.value}-${entry.source}`}>
                        <span>
                          {entry.value}
                          <span className="muted"> · {KIND_LABELS[entry.kind] ?? entry.kind}</span>
                        </span>
                        <code>{entry.source}</code>
                      </li>
                    ))}
                    {provenance.length > 6 ? (
                      <li className="muted">其余 {provenance.length - 6} 条来源已省略</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      {data.warnings.length > 0 ? (
        <Card title="生成告警" spec="§11 / §39" subtitle="下游话术不得把这些内容当作已确认事实使用。">
          {data.warnings.map((warning) => (
            <Alert key={warning} tone="warn">
              {warning}
            </Alert>
          ))}
        </Card>
      ) : null}

      <Card
        title="事实归一试跑（Agent 1）"
        spec="§39"
        subtitle="把已录入内容按六分类整理，输出候选事实供人工确认。试跑只读，不会写入事实清单。"
        actions={
          <>
            <button
              type="button"
              className="secondary"
              disabled={!canWrite || busy !== null}
              onClick={() => void runNormalize(false)}
            >
              {busy === "normalize" ? "整理中…" : "按录入字段整理"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={!canWrite || busy !== null}
              onClick={() => void runNormalize(true)}
            >
              AI 归类试跑
            </button>
          </>
        }
      >
        {!normalization ? (
          <EmptyState
            title="尚未运行"
            description="点击上方按钮整理当前产品的已录入内容；系统只会整理已有内容，不会补出新事实。"
          />
        ) : (
          <>
            <div className="metric-grid">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const count = normalization.output[key as keyof NormalizationResponse["output"]].length;
                return (
                  <div className="metric" key={key}>
                    <div className="metric-label">{label}</div>
                    <div className="metric-value">{count}</div>
                    <div className="metric-hint" style={{ fontFamily: "Consolas, monospace" }}>
                      {key}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted mt-3">
              本次{normalization.ai_used ? "使用 AI 归类" : "按录入字段规则分类"}
              {normalization.prompt_version ? `（Prompt v${normalization.prompt_version}，${normalization.provider}/${normalization.model}）` : ""}
              ｜ 未写库（persisted={String(normalization.persisted)}）
            </p>

            {normalization.dropped.length > 0 ? (
              <Alert tone="error">
                AI 输出中 {normalization.dropped.length} 条未通过校验被丢弃：
                {normalization.dropped
                  .slice(0, 5)
                  .map((drop) => `${drop.value}（${DROP_REASON_LABELS[drop.reason] ?? drop.reason}）`)
                  .join("、")}
                {normalization.dropped.length > 5 ? ` 等 ${normalization.dropped.length} 条` : ""}
              </Alert>
            ) : null}

            <div className="table-wrap mt-3">
              <table>
                <thead>
                  <tr>
                    <th>分类</th>
                    <th>字段</th>
                    <th>内容</th>
                    <th>候选状态</th>
                    <th>证据说明</th>
                  </tr>
                </thead>
                <tbody>
                  {normalization.candidates.map((candidate) => (
                    <tr key={`${candidate.category}-${candidate.field}-${candidate.value}`}>
                      <td className="muted">{CATEGORY_LABELS[candidate.category] ?? candidate.category}</td>
                      <td className="mono">{candidate.field}</td>
                      <td>{candidate.value}</td>
                      <td>
                        <Pill tone={candidate.fact_status === "UNCONFIRMED" ? "warn" : "ok"}>
                          {STATUS_LABELS[candidate.fact_status ?? ""] ?? "待确认"}
                        </Pill>
                      </td>
                      <td className="muted">{candidate.evidence_note ?? "—"}</td>
                    </tr>
                  ))}
                  {normalization.candidates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        暂无候选：产品资料与事实清单均为空。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {normalization.output.missing.length > 0 ? (
              <>
                <h4 style={{ fontSize: 13.5, marginBottom: 4 }}>缺失项（禁止自动补全）</h4>
                <div className="chip-list">
                  {normalization.output.missing.map((item) => (
                    <span key={item.field} className="chip muted" title={item.reason ?? ""}>
                      {item.field}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
