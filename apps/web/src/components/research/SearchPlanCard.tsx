import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  GENERATOR_LABELS,
  QUERY_TYPE_LABELS,
  formatDateTime,
  type SearchPlanResponse
} from "../../lib/research.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

export interface SearchPlanCardProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  /** 研究流水线已生成策略时，用它触发父级刷新。 */
  refreshKey?: number;
}

/**
 * Agent 2｜搜索策略（规格 §12 / §40）。
 *
 * 策略必须能被人工看到：目标不是「谁最贵」，而是构建可比产品池 + 价格证据池。
 * 未落库时以即时预览呈现，并明确标注「未落库」，避免被当成已确认策略。
 */
export function SearchPlanCard({ productId, token, canWrite, refreshKey }: SearchPlanCardProps): ReactElement {
  const { notify } = useToast();
  const [data, setData] = useState<SearchPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"rule" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest<SearchPlanResponse>(`/api/products/${productId}/search-plan`, {
        token
      });
      setData(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取搜索策略失败");
    } finally {
      setLoading(false);
    }
  }, [productId, token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function generate(useAi: boolean): Promise<void> {
    setBusy(useAi ? "ai" : "rule");
    try {
      const result = await apiRequest<SearchPlanResponse>(
        `/api/products/${productId}/search-plan/generate`,
        { method: "POST", token, body: { use_ai: useAi, max_per_type: 12 } }
      );
      setData(result);
      notify(
        `搜索策略已生成：${result.query_count} 条查询（${GENERATOR_LABELS[result.generator] ?? result.generator}）`,
        "ok"
      );
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "生成搜索策略失败", "error");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <Card title="搜索策略（Agent 2）" spec="§12 / §40">
        <LoadingState label="正在读取搜索策略" />
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card title="搜索策略（Agent 2）" spec="§12 / §40">
        <ErrorState description={error} onRetry={() => void load()} />
      </Card>
    );
  }

  if (!data) {
    return (
      <Card title="搜索策略（Agent 2）" spec="§12 / §40">
        <EmptyState title="暂无搜索策略" description="请先运行研究流水线或手动生成搜索策略。" />
      </Card>
    );
  }

  const order = Object.keys(QUERY_TYPE_LABELS);

  return (
    <Card
      title="搜索策略（Agent 2）"
      spec="§12 / §40"
      subtitle="策略目标：构建可比产品池与价格证据池。查询词只来自已录入字段与 Value DNA，凭空出现的硬事实会被丢弃。"
      actions={
        <>
          <Pill tone={data.stored ? "ok" : "warn"}>{data.stored ? "已落库" : "未落库（即时预览）"}</Pill>
          <Pill tone="neutral">{GENERATOR_LABELS[data.generator] ?? data.generator}</Pill>
          {data.stale ? <Pill tone="warn">Value DNA 已更新，建议重新生成</Pill> : null}
          <Pill tone="info">共 {data.query_count} 条查询</Pill>
          <button
            type="button"
            className="secondary"
            disabled={!canWrite || busy !== null}
            onClick={() => void generate(false)}
          >
            {busy === "rule" ? "生成中…" : "按规则生成"}
          </button>
          <button
            type="button"
            disabled={!canWrite || busy !== null}
            onClick={() => void generate(true)}
          >
            {busy === "ai" ? "生成中…" : "AI 辅助生成"}
          </button>
        </>
      }
    >
      {data.warnings.map((warning) => (
        <Alert key={warning} tone="warn">
          {warning}
        </Alert>
      ))}

      {data.dropped.length > 0 ? (
        <Alert tone="error">
          AI 策略中 {data.dropped.length} 条查询凭空出现输入里没有的硬事实，已丢弃：
          {data.dropped.slice(0, 3).map((drop) => drop.query).join("、")}
          {data.dropped.length > 3 ? " 等" : ""}
        </Alert>
      ) : null}

      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">查询总数</div>
          <div className="metric-value">{data.query_count}</div>
          <div className="metric-hint">覆盖 9 类检索意图</div>
        </div>
        <div className="metric">
          <div className="metric-label">策略版本</div>
          <div className="metric-value" style={{ fontSize: 16 }}>
            {data.generated_at ? formatDateTime(data.generated_at) : "未落库"}
          </div>
          <div className="metric-hint">
            {data.prompt_version ? `Prompt v${data.prompt_version}` : "未使用 AI Prompt"}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">基于 DNA</div>
          <div className="metric-value">v{data.dna_version ?? "—"}</div>
          <div className="metric-hint">策略随 DNA 变化会标记过期</div>
        </div>
        <div className="metric">
          <div className="metric-label">Provider</div>
          <div className="metric-value" style={{ fontSize: 16 }}>
            {data.provider ?? "规则引擎"}
          </div>
          <div className="metric-hint">{data.model ?? "不调用外部模型"}</div>
        </div>
      </div>

      <div className="query-grid">
        {order.map((type) => {
          const queries = data.plan[type] ?? [];
          const isOpen = expanded === type;
          return (
            <div key={type} className={queries.length === 0 ? "query-card empty" : "query-card"}>
              <div className="query-card-head">
                <strong>{QUERY_TYPE_LABELS[type]}</strong>
                <Pill tone={queries.length > 0 ? "brand" : "neutral"}>{queries.length}</Pill>
              </div>
              <code className="mono">{type}</code>
              <div className="chip-list">
                {(isOpen ? queries : queries.slice(0, 3)).map((query) => (
                  <span key={query} className="chip">
                    {query}
                  </span>
                ))}
                {!isOpen && queries.length > 3 ? (
                  <button type="button" className="ghost sm" onClick={() => setExpanded(type)}>
                    还有 {queries.length - 3} 条
                  </button>
                ) : null}
                {isOpen && queries.length > 3 ? (
                  <button type="button" className="ghost sm" onClick={() => setExpanded(null)}>
                    收起
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
