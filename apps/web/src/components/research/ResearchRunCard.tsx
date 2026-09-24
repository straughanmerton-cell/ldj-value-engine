import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  JOB_STATUS_LABELS,
  formatDateTime,
  type ResearchJob,
  type ResearchProgressResponse,
  type ResearchRunResponse
} from "../../lib/research.js";
import { Card } from "../ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { StageProgress } from "./StageProgress.js";

export interface ResearchRunCardProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  aiProvider?: string | null;
  /** 研究完成后通知父级刷新搜索策略与来源列表。 */
  onFinished?: () => void;
}

interface RunFormState {
  maxQueries: number;
  maxResultsPerQuery: number;
  maxSources: number;
  autoExtract: boolean;
  useAi: boolean;
}

const DEFAULT_FORM: RunFormState = {
  maxQueries: 18,
  maxResultsPerQuery: 6,
  maxSources: 8,
  autoExtract: true,
  useAi: false
};

function SummaryMetric({ label, value, hint }: { label: string; value: string; hint: string }): ReactElement {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ fontSize: 16 }}>
        {value}
      </div>
      <div className="metric-hint">{hint}</div>
    </div>
  );
}

/**
 * 研究流水线执行（规格 §55 / §56）。
 *
 * Phase 4 覆盖前 6 个阶段，Phase 5 追加「候选池归并 + §13 相似度分档」两个阶段：
 * 事实整理 → Value DNA → 搜索策略 → 全网检索 → 抓取 → 网页抽取 → 候选池 → 相似度。
 * 参数暴露给操作者，是因为真实检索有成本，必须能控制一轮跑多少查询、抓多少页。
 */
export function ResearchRunCard({
  productId,
  token,
  canWrite,
  aiProvider,
  onFinished
}: ResearchRunCardProps): ReactElement {
  const { notify } = useToast();
  const [progress, setProgress] = useState<ResearchProgressResponse | null>(null);
  const [runs, setRuns] = useState<ResearchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<RunFormState>(DEFAULT_FORM);
  const [lastRun, setLastRun] = useState<ResearchRunResponse | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const [progressResult, runsResult] = await Promise.all([
        apiRequest<ResearchProgressResponse>(`/api/products/${productId}/research/progress`, { token }),
        apiRequest<{ items: ResearchJob[] }>(`/api/products/${productId}/research/runs?limit=10`, { token })
      ]);
      setProgress(progressResult);
      setRuns(runsResult.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取研究进度失败");
    } finally {
      setLoading(false);
    }
  }, [productId, token]);

  useEffect(() => {
    setLastRun(null);
    setLoading(true);
    void load();
  }, [load]);

  async function run(): Promise<void> {
    setRunning(true);
    try {
      const result = await apiRequest<ResearchRunResponse>(`/api/products/${productId}/research/runs`, {
        method: "POST",
        token,
        body: {
          use_ai: form.useAi,
          max_queries: form.maxQueries,
          max_results_per_query: form.maxResultsPerQuery,
          max_sources: form.maxSources,
          auto_extract: form.autoExtract
        }
      });
      setLastRun(result);
      notify(
        `研究完成：新增来源 ${result.sources_created} · 抓取 ${result.sources_fetched} · 抽取 ${result.extractions}`,
        result.status === "SUCCEEDED" ? "ok" : "warn"
      );
      await load();
      onFinished?.();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "研究流水线执行失败", "error");
    } finally {
      setRunning(false);
    }
  }

  if (loading && !progress) {
    return (
      <Card title="研究流水线" spec="§55 / §56">
        <LoadingState label="正在读取研究进度" />
      </Card>
    );
  }

  if (error && !progress) {
    return (
      <Card title="研究流水线" spec="§55 / §56">
        <ErrorState description={error} onRetry={() => void load()} />
      </Card>
    );
  }

  const job = progress?.job ?? null;
  const summary = job?.summary ?? null;

  return (
    <>
      <Card
        title="运行研究流水线"
        spec="§55 / §56"
        subtitle="一轮研究覆盖：事实整理 → Value DNA → 搜索策略 → 全网检索 → 来源抓取 → 网页事实抽取 → 候选池归并 → §13 相似度分档 → §14 价格证据 → §15 异常值检测 → §16 锚点构建。后续 Phase 阶段在进度中显式标注。"
        actions={
          <>
            {job ? (
              <Pill tone={job.status === "SUCCEEDED" ? "ok" : job.status === "FAILED" ? "danger" : "info"}>
                最近一轮：{JOB_STATUS_LABELS[job.status] ?? job.status}
              </Pill>
            ) : (
              <Pill tone="warn">尚未开始研究</Pill>
            )}
            <button type="button" disabled={!canWrite || running} onClick={() => void run()}>
              {running ? "研究中…（可能持续数十秒）" : "开始研究"}
            </button>
          </>
        }
      >
        <div className="grid-3">
          <label>
            最多执行查询数
            <input
              type="number"
              min={1}
              max={60}
              value={form.maxQueries}
              onChange={(event) => setForm({ ...form, maxQueries: Number(event.target.value) })}
            />
          </label>
          <label>
            每条查询结果数
            <input
              type="number"
              min={1}
              max={20}
              value={form.maxResultsPerQuery}
              onChange={(event) => setForm({ ...form, maxResultsPerQuery: Number(event.target.value) })}
            />
          </label>
          <label>
            最多抓取来源数
            <input
              type="number"
              min={0}
              max={50}
              value={form.maxSources}
              onChange={(event) => setForm({ ...form, maxSources: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="row mt-3">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.autoExtract}
              onChange={(event) => setForm({ ...form, autoExtract: event.target.checked })}
            />
            抓取后自动运行 Agent 3 网页事实抽取
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.useAi}
              onChange={(event) => setForm({ ...form, useAi: event.target.checked })}
            />
            允许调用 AI（搜索策略 / 抽取）
          </label>
        </div>
        {aiProvider === "mock" ? (
          <p className="muted mt-2">
            当前 AI Provider 为 mock：即使勾选 AI，也只是结构占位输出，真实质量需要配置 Key 后复验。
          </p>
        ) : null}
        {!canWrite ? (
          <Alert tone="warn">当前角色为只读：启动研究需要 ADMIN / RESEARCHER 权限。</Alert>
        ) : null}
        {form.maxSources === 0 ? (
          <Alert tone="info">
            抓取数设为 0 时，抓取与网页抽取阶段会被标记为「已跳过」，仅完成检索与来源登记。
          </Alert>
        ) : null}
      </Card>

      {lastRun ? (
        <Card title="本轮结果" spec="§55">
          <div className="metric-grid">
            <SummaryMetric label="新增来源" value={String(lastRun.sources_created)} hint="按规范化 URL 去重" />
            <SummaryMetric label="抓取成功" value={String(lastRun.sources_fetched)} hint="有正文才算成功" />
            <SummaryMetric label="网页抽取" value={String(lastRun.extractions)} hint="只落证据，不写产品事实" />
            <SummaryMetric
              label="已执行阶段"
              value={String(lastRun.stages_run.length)}
              hint={lastRun.stages_run.join(" → ")}
            />
            <SummaryMetric
              label="候选池"
              value={`${lastRun.candidates_created} 新增 / ${lastRun.candidates_updated} 合并`}
              hint={`同款茶只留一条 · 共 ${lastRun.candidates_total} 条`}
            />
            <SummaryMetric
              label="相似度分档"
              value={`核心 ${lastRun.candidate_band_counts["CORE_COMPARABLE"] ?? 0} · 有效 ${
                lastRun.candidate_band_counts["VALID_COMPARABLE"] ?? 0
              }`}
              hint={`外围 ${lastRun.candidate_band_counts["PERIPHERAL_REFERENCE"] ?? 0} · 拒绝 ${
                lastRun.candidate_band_counts["REJECT"] ?? 0
              } · 价格不参与打分`}
            />
            <SummaryMetric
              label="价格证据"
              value={`${lastRun.price_offers_created} 新增 / ${lastRun.price_offers_updated} 合并`}
              hint={`强证据 ${lastRun.price_evidence_band_counts["STRONG"] ?? 0} · 可用 ${
                lastRun.price_evidence_band_counts["USABLE"] ?? 0
              } · 弱 ${lastRun.price_evidence_band_counts["WEAK"] ?? 0} · 共 ${lastRun.price_offers_total} 条`}
            />
            <SummaryMetric
              label="价格可用性"
              value={lastRun.price_level}
              hint={`可靠价格 ${lastRun.price_reliable} 条 · 异常值 ${lastRun.price_outliers} 条（只标记不删除）`}
            />
            <SummaryMetric
              label="锚点与模式"
              value={lastRun.anchor_mode}
              hint={`共 ${lastRun.anchor_count} 条锚点 · 最高价值 ${
                lastRun.anchor_types["HIGHEST_VALUE"] ?? 0
              } · 高相似度 ${lastRun.anchor_types["SIMILARITY_HIGH_VALUE"] ?? 0} · 强成交 ${
                lastRun.anchor_types["SALES_ANCHOR"] ?? 0
              }`}
            />
          </div>
        </Card>
      ) : null}

      <Card
        title="研究进度"
        spec="§56"
        subtitle="逐阶段状态来自后端实时记录：PENDING / RUNNING / SUCCEEDED / FAILED / SKIPPED。"
        actions={
          job ? (
            <>
              <Pill tone="neutral">开始 {formatDateTime(job.started_at)}</Pill>
              <Pill tone="neutral">结束 {formatDateTime(job.finished_at)}</Pill>
            </>
          ) : null
        }
      >
        {summary ? (
          <div className="metric-grid mb-3">
            <SummaryMetric label="搜索命中" value={String(summary.search_results ?? "—")} hint={`查询 ${summary.queries_run ?? 0} 条`} />
            <SummaryMetric label="策略查询数" value={String(summary.query_count ?? "—")} hint={`生成器 ${summary.plan_generator ?? "—"}`} />
            <SummaryMetric label="价格证据" value={String(summary.extracted_prices ?? "—")} hint="来自网页原文，类型未换算" />
            <SummaryMetric label="抽取事实" value={String(summary.extracted_facts ?? "—")} hint="需人工在事实清单确认" />
            <SummaryMetric
              label="候选池"
              value={typeof summary.candidates_total === "number" ? String(summary.candidates_total) : "—"}
              hint={`本轮新增 ${summary.candidates_created ?? 0} · 合并 ${summary.candidates_updated ?? 0}`}
            />
            <SummaryMetric
              label="价格证据"
              value={typeof summary.price_offers_total === "number" ? String(summary.price_offers_total) : "—"}
              hint={`本轮新增 ${summary.price_offers_created ?? 0} · 可靠 ${
                typeof summary.price_reliable === "number" ? summary.price_reliable : "—"
              } 条`}
            />
            <SummaryMetric
              label="锚点 / 模式"
              value={typeof summary.anchor_count === "number" ? String(summary.anchor_count) : "—"}
              hint={`模式 ${summary.anchor_mode ?? "—"} · 锚点判定见「高价值锚点」Tab`}
            />
          </div>
        ) : null}
        <StageProgress
          job={job}
          progress={progress?.progress ?? []}
          modeNotes={
            job?.mode_notes ?? {
              BENCHMARK: "有可靠锚点：进入高价值对标模式（Benchmark Mode）",
              CATEGORY_CREATOR: "没有可靠锚点：强制切换自建高端标准模式（Category Creator Mode）"
            }
          }
        />
      </Card>

      <Card title="历史研究任务" spec="§62-15" subtitle="每轮研究都保留记录，不做覆盖。">
        {runs.length === 0 ? (
          <p className="muted">暂无研究任务记录。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>开始时间</th>
                  <th>状态</th>
                  <th>完成阶段</th>
                  <th>抓取成功</th>
                  <th>失败原因</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((item) => (
                  <tr key={item.id}>
                    <td className="nowrap">{formatDateTime(item.started_at)}</td>
                    <td>
                      <Pill
                        tone={
                          item.status === "SUCCEEDED" ? "ok" : item.status === "FAILED" ? "danger" : "info"
                        }
                      >
                        {JOB_STATUS_LABELS[item.status] ?? item.status}
                      </Pill>
                    </td>
                    <td>
                      {item.progress_summary.succeeded} / {item.progress_summary.total}
                    </td>
                    <td>{String(item.summary?.sources_fetched ?? "—")}</td>
                    <td className="muted">{item.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
