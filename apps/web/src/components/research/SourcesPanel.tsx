import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  EXTRACTION_STATUS_LABELS,
  EXTRACTION_STATUS_TONES,
  FETCH_STATUS_LABELS,
  FETCH_STATUS_TONES,
  formatDateTime,
  type SourceListResponse,
  type SourceRow
} from "../../lib/research.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

const SOURCE_KIND_LABELS: Record<string, string> = {
  SEARCH_RESULT: "搜索结果",
  PRODUCT_PAGE: "产品页",
  PRICE_PAGE: "价格页",
  MARKETPLACE: "交易平台",
  AUCTION_PAGE: "拍卖页",
  ARTICLE: "行业文章",
  FORUM: "论坛",
  SOCIAL: "社交媒体",
  OTHER: "其他"
};

export interface SourcesPanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  isAdmin: boolean;
  refreshKey?: number;
  selectedId?: string | null;
  onSelect?: (sourceId: string) => void;
  /** 证据中心需要在列表里直接跳到详情页。 */
  evidenceLink?: boolean;
  compact?: boolean;
}

interface Filters {
  keyword: string;
  kind: string;
  fetchStatus: string;
  extractionStatus: string;
}

const EMPTY_FILTERS: Filters = { keyword: "", kind: "", fetchStatus: "", extractionStatus: "" };

/**
 * 来源与证据池（规格 §11 / §41 / §54）。
 *
 * 一条来源只登记一次：同一规范化 URL 重复出现只刷新命中信息。
 * 列表里同时暴露抓取状态与抽取状态，因为「抓到正文」与「抽到可用信息」是两件事。
 */
export function SourcesPanel({
  productId,
  token,
  canWrite,
  isAdmin,
  refreshKey,
  selectedId,
  onSelect,
  evidenceLink,
  compact
}: SourcesPanelProps): ReactElement {
  const { notify } = useToast();
  const [data, setData] = useState<SourceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 输入区（draft）与生效筛选（applied）分离：避免每敲一个字符就打一次接口。 */
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [registering, setRegistering] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ limit: compact ? "15" : "100" });
    if (applied.keyword.trim()) {
      params.set("keyword", applied.keyword.trim());
    }
    if (applied.kind) {
      params.set("source_kind", applied.kind);
    }
    if (applied.fetchStatus) {
      params.set("fetch_status", applied.fetchStatus);
    }
    if (applied.extractionStatus) {
      params.set("extraction_status", applied.extractionStatus);
    }
    try {
      const result = await apiRequest<SourceListResponse>(
        `/api/products/${productId}/sources?${params.toString()}`,
        { token }
      );
      setData(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取来源列表失败");
    } finally {
      setLoading(false);
    }
  }, [productId, token, applied, compact]);

  useEffect(() => {
    void load();
  }, [load, refreshKey, reloadTick]);

  const reload = useCallback(() => setReloadTick((current) => current + 1), []);

  async function registerSource(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!manualUrl.trim()) {
      return;
    }
    setRegistering(true);
    try {
      const result = await apiRequest<{ source: SourceRow; created: boolean }>(
        `/api/products/${productId}/sources`,
        {
          method: "POST",
          token,
          body: {
            url: manualUrl.trim(),
            ...(manualTitle.trim() ? { title: manualTitle.trim() } : {})
          }
        }
      );
      notify(result.created ? "来源已登记" : "该 URL 已登记过，已复用同一条来源", result.created ? "ok" : "info");
      setManualUrl("");
      setManualTitle("");
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "登记来源失败", "error");
    } finally {
      setRegistering(false);
    }
  }

  async function fetchSource(source: SourceRow, force: boolean): Promise<void> {
    setBusyId(source.id);
    try {
      const result = await apiRequest<SourceRow>(
        `/api/products/${productId}/sources/${source.id}/fetch`,
        { method: "POST", token, body: { force } }
      );
      if (result.fetch_status === "FETCHED") {
        notify(`抓取成功：${result.content_chars ?? 0} 字`, "ok");
      } else {
        notify(`抓取失败：${result.fetch_error ?? "未知原因"}`, "error");
      }
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "抓取失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function extractSource(source: SourceRow, force: boolean): Promise<void> {
    setBusyId(source.id);
    try {
      const result = await apiRequest<{ price_count: number; extraction: { facts: unknown[] }; has_content: boolean }>(
        `/api/products/${productId}/sources/${source.id}/extract`,
        { method: "POST", token, body: { force } }
      );
      notify(
        `抽取完成：价格证据 ${result.price_count} 条 · 事实 ${result.extraction.facts.length} 条${
          result.has_content ? "" : "（页面没有明确写出可用信息）"
        }`,
        result.has_content ? "ok" : "warn"
      );
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "网页抽取失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeSource(source: SourceRow): Promise<void> {
    setBusyId(source.id);
    try {
      await apiRequest(`/api/products/${productId}/sources/${source.id}`, { method: "DELETE", token });
      notify("来源已删除（含其抽取记录）", "warn");
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "删除来源失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) {
    return (
      <Card title="来源与证据池" spec="§11 / §41">
        <LoadingState label="正在读取来源列表" />
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card title="来源与证据池" spec="§11 / §41">
        <ErrorState description={error} onRetry={() => void load()} />
      </Card>
    );
  }

  const items = data?.items ?? [];
  const fetched = items.filter((item) => item.fetch_status === "FETCHED").length;
  const extracted = items.filter((item) => item.extraction_status === "EXTRACTED").length;
  const priceCount = items.reduce((sum, item) => sum + item.price_count, 0);
  const factCount = items.reduce((sum, item) => sum + item.fact_count, 0);

  return (
    <>
      <Card
        title="来源与证据池"
        spec="§11 / §41"
        subtitle="来源是后续可比性评分、价格证据与锚点的唯一事实入口：重复 URL 只登记一次，抓取状态与抽取状态分别记录。"
        actions={<Pill tone="neutral">共 {data?.total ?? 0} 条</Pill>}
      >
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">来源总数</div>
            <div className="metric-value">{data?.total ?? 0}</div>
            <div className="metric-hint">按规范化 URL 去重</div>
          </div>
          <div className="metric">
            <div className="metric-label">已抓到正文</div>
            <div className="metric-value">{fetched}</div>
            <div className="metric-hint">抓取成功才有正文</div>
          </div>
          <div className="metric">
            <div className="metric-label">已抽取</div>
            <div className="metric-value">{extracted}</div>
            <div className="metric-hint">抽取结果只作证据</div>
          </div>
          <div className="metric">
            <div className="metric-label">价格证据</div>
            <div className="metric-value">{priceCount}</div>
            <div className="metric-hint">不换算、不推断类型</div>
          </div>
          <div className="metric">
            <div className="metric-label">网页事实</div>
            <div className="metric-value">{factCount}</div>
            <div className="metric-hint">需人工确认为产品事实</div>
          </div>
        </div>
      </Card>

      <Card title="筛选" spec="§54">
        <div className="filter-bar">
          <label>
            关键词
            <input
              placeholder="标题或 URL"
              value={draft.keyword}
              onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setApplied(draft);
                }
              }}
            />
          </label>
          <label>
            来源类型
            <select
              value={draft.kind}
              onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
            >
              <option value="">全部</option>
              {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            抓取状态
            <select
              value={draft.fetchStatus}
              onChange={(event) => setDraft({ ...draft, fetchStatus: event.target.value })}
            >
              <option value="">全部</option>
              {Object.entries(FETCH_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            抽取状态
            <select
              value={draft.extractionStatus}
              onChange={(event) => setDraft({ ...draft, extractionStatus: event.target.value })}
            >
              <option value="">全部</option>
              {Object.entries(EXTRACTION_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => setApplied(draft)}>
            应用筛选
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              setApplied(EMPTY_FILTERS);
            }}
          >
            清空
          </button>
        </div>

        {canWrite ? (
          <form className="filter-bar mt-3" onSubmit={registerSource}>
            <label style={{ flex: "2 1 320px" }}>
              手工登记来源 URL
              <input
                placeholder="https://…"
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
              />
            </label>
            <label style={{ flex: "1 1 200px" }}>
              标题（可选）
              <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} />
            </label>
            <button type="submit" disabled={registering || !manualUrl.trim()}>
              {registering ? "登记中…" : "登记来源"}
            </button>
          </form>
        ) : (
          <p className="muted mt-3">当前角色为只读：登记来源、抓取与抽取需要 ADMIN / RESEARCHER 权限。</p>
        )}
      </Card>

      <Card title="来源列表" spec="§41">
        {items.length === 0 ? (
          <EmptyState
            title="暂无来源"
            description="运行一次研究流水线，或手工登记一条来源作为起点。"
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>来源</th>
                  <th>类型</th>
                  <th>查询</th>
                  <th>抓取</th>
                  <th>抽取</th>
                  <th>证据</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((source) => (
                  <tr key={source.id} className={selectedId === source.id ? "row-selected" : ""}>
                    <td>
                      {onSelect ? (
                        <button type="button" className="link" onClick={() => onSelect(source.id)}>
                          {source.title ?? source.url}
                        </button>
                      ) : (
                        <span>{source.title ?? source.url}</span>
                      )}
                      <div className="muted mono">{source.domain}</div>
                      {source.fetch_error ? <div className="error">{source.fetch_error}</div> : null}
                    </td>
                    <td>
                      <Pill tone="outline">{SOURCE_KIND_LABELS[source.source_kind] ?? source.source_kind}</Pill>
                    </td>
                    <td className="muted">
                      {source.query ? source.query : "—"}
                      {source.query_type ? <div className="mono">{source.query_type}</div> : null}
                    </td>
                    <td>
                      <Pill tone={FETCH_STATUS_TONES[source.fetch_status] ?? "neutral"}>
                        {FETCH_STATUS_LABELS[source.fetch_status] ?? source.fetch_status}
                      </Pill>
                      {source.content_chars ? (
                        <div className="muted">{source.content_chars} 字</div>
                      ) : null}
                    </td>
                    <td>
                      <Pill tone={EXTRACTION_STATUS_TONES[source.extraction_status] ?? "neutral"}>
                        {EXTRACTION_STATUS_LABELS[source.extraction_status] ?? source.extraction_status}
                      </Pill>
                      {source.extracted_at ? (
                        <div className="muted">{formatDateTime(source.extracted_at)}</div>
                      ) : null}
                    </td>
                    <td className="nowrap">
                      <Pill tone={source.price_count > 0 ? "warn" : "neutral"}>价格 {source.price_count}</Pill>{" "}
                      <Pill tone={source.fact_count > 0 ? "info" : "neutral"}>事实 {source.fact_count}</Pill>
                    </td>
                    <td>
                      <div className="btn-row">
                        {canWrite ? (
                          <>
                            <button
                              type="button"
                              className="secondary sm"
                              disabled={busyId === source.id}
                              onClick={() => void fetchSource(source, source.fetch_status === "FETCHED")}
                            >
                              {source.fetch_status === "FETCHED" ? "重新抓取" : "抓取"}
                            </button>
                            <button
                              type="button"
                              className="secondary sm"
                              disabled={busyId === source.id}
                              onClick={() => void extractSource(source, false)}
                            >
                              抽取
                            </button>
                          </>
                        ) : null}
                        {evidenceLink ? (
                          <Link to={`/evidence?productId=${productId}&sourceId=${source.id}`}>
                            <button type="button" className="ghost sm">
                              证据
                            </button>
                          </Link>
                        ) : null}
                        {isAdmin ? (
                          <button
                            type="button"
                            className="danger sm"
                            disabled={busyId === source.id}
                            onClick={() => void removeSource(source)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {compact && (data?.total ?? 0) > items.length ? (
          <p className="muted mt-3">
            仅显示最近 {items.length} 条，共 {data?.total} 条。完整列表见「高价值茶数据库」。
          </p>
        ) : null}
      </Card>
    </>
  );
}
