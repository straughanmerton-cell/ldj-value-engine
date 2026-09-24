import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  CANDIDATE_EVIDENCE_KIND_LABELS,
  CANDIDATE_SORT_LABELS,
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_TONES,
  SIMILARITY_BAND_LABELS,
  SIMILARITY_BAND_ORDER,
  SIMILARITY_BAND_TONES,
  SIMILARITY_DIMENSION_LABELS,
  contractDimensionMap,
  formatCandidateSpec,
  formatSimilarityScore,
  useCandidatesContract,
  type CandidateListResponse,
  type CandidateRebuildResult,
  type CandidateRow,
  type CandidateSort,
  type CandidateStatus,
  type SimilarityBand,
  type SimilarityDimension
} from "../../lib/candidates.js";
import {
  PRICE_TYPE_LABELS,
  PRICE_TYPE_TONES,
  UNIT_SCOPE_LABELS,
  formatDateTime,
  formatPrice,
  type ProductOption
} from "../../lib/research.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

export interface CandidatesPanelProps {
  token: string | null;
  canWrite: boolean;
  isAdmin: boolean;
  /** 传入产品 ID 时为产品级候选池；不传时用于跨产品的「高价值茶数据库」视图。 */
  productId?: string;
  /** 跨产品视图的产品筛选下拉数据源。 */
  products?: ProductOption[];
  refreshKey?: number;
  /** 摘要模式（研究页 / 产品详情）：列表更短，保留全部能力但不铺满页面。 */
  compact?: boolean;
  /** 产品筛选变化时同步到 URL（高价值茶数据库用）。 */
  onProductFilterChange?: (productId: string) => void;
  /** 候选池变化（重建 / 评审）后通知上层刷新。 */
  onChanged?: () => void;
}

interface Filters {
  keyword: string;
  band: "" | SimilarityBand;
  status: "" | CandidateStatus;
  minScore: string;
  productId: string;
  sort: CandidateSort;
}

const EMPTY_FILTERS: Filters = {
  keyword: "",
  band: "",
  status: "",
  minScore: "",
  productId: "",
  sort: "-score"
};

function splitKeywords(value: string): string[] {
  return value
    .split(/[,，、;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 40);
}

function optionalNumber(value: string): number | null {
  const text = value.trim();
  if (text.length === 0) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 候选池与相似度分档（规格 §13 可比性评分 / §36 高价值茶数据库 / §42 Agent 4）。
 *
 * 界面只做三件事，且每件都可追溯到基线：
 * 1. 把 §13 的十个维度、权重与分档原样摊开（分数怎么来的必须能解释）；
 * 2. 把「未知维度按 0 分」与「价格不参与相似度」写成显式提示，不让观察价看起来像打分因子；
 * 3. 人工评审优先：重算分数不会覆盖已确认 / 已拒绝的结论（keep_reviewed）。
 */
export function CandidatesPanel({
  token,
  canWrite,
  isAdmin,
  productId,
  products,
  refreshKey,
  compact,
  onProductFilterChange,
  onChanged
}: CandidatesPanelProps): ReactElement {
  const { notify } = useToast();
  const { contract } = useCandidatesContract(token);
  const dimensions = useMemo(() => contractDimensionMap(contract), [contract]);
  const bandLabels = contract?.comparable.bands ?? SIMILARITY_BAND_LABELS;
  const [data, setData] = useState<CandidateListResponse | null>(null);
  const [bandCounts, setBandCounts] = useState<Record<SimilarityBand, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CandidateRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMinScore, setRebuildMinScore] = useState("55");
  const [keepReviewed, setKeepReviewed] = useState(true);
  const [lastRebuild, setLastRebuild] = useState<CandidateRebuildResult | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [showForm, setShowForm] = useState(false);

  const pageSize = compact ? 10 : 20;

  const listPath = useCallback(
    (params: URLSearchParams): string => {
      const query = params.toString();
      return productId ? `/api/products/${productId}/candidates?${query}` : `/api/candidates?${query}`;
    },
    [productId]
  );

  const baseParams = useCallback(
    (filters: Filters): URLSearchParams => {
      const params = new URLSearchParams({ sort: filters.sort });
      if (filters.keyword.trim()) {
        params.set("q", filters.keyword.trim());
      }
      if (filters.band) {
        params.set("band", filters.band);
      }
      if (filters.status) {
        params.set("status", filters.status);
      }
      const minScore = optionalNumber(filters.minScore);
      if (minScore !== null) {
        params.set("min_score", String(Math.round(minScore)));
      }
      if (!productId && filters.productId) {
        params.set("product_id", filters.productId);
      }
      return params;
    },
    [productId]
  );

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    const params = baseParams(applied);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    try {
      const result = await apiRequest<CandidateListResponse>(listPath(params), { token });
      setData(result);
      setError(null);
      const counts = await Promise.all(
        SIMILARITY_BAND_ORDER.map(async (band) => {
          const bandParams = baseParams(applied);
          bandParams.set("band", band);
          bandParams.set("page", "1");
          bandParams.set("pageSize", "1");
          const response = await apiRequest<CandidateListResponse>(listPath(bandParams), { token });
          return [band, response.total] as const;
        })
      );
      const next = { REJECT: 0, PERIPHERAL_REFERENCE: 0, VALID_COMPARABLE: 0, CORE_COMPARABLE: 0 };
      for (const [band, total] of counts) {
        next[band] = total;
      }
      setBandCounts(next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取候选池失败");
    } finally {
      setLoading(false);
    }
  }, [applied, baseParams, listPath, page, pageSize, token]);

  useEffect(() => {
    void load();
  }, [load, refreshKey, reloadTick]);

  const reload = useCallback(() => setReloadTick((current) => current + 1), []);

  function applyFilters(next: Filters): void {
    setApplied(next);
    setPage(1);
  }

  async function review(candidate: CandidateRow, status: CandidateStatus, note?: string): Promise<void> {
    setBusyId(candidate.id);
    try {
      const updated = await apiRequest<CandidateRow>(
        `/api/products/${candidate.product_id}/candidates/${candidate.id}`,
        {
          method: "PATCH",
          token,
          body: { status, review_note: note ?? candidate.review_note ?? undefined }
        }
      );
      notify(`已更新为「${CANDIDATE_STATUS_LABELS[status]}」`, status === "APPROVED" ? "ok" : "warn");
      if (selected?.id === candidate.id) {
        setSelected(updated);
      }
      reload();
      onChanged?.();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "评审失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(candidate: CandidateRow): Promise<void> {
    setBusyId(candidate.id);
    try {
      await apiRequest(`/api/products/${candidate.product_id}/candidates/${candidate.id}`, {
        method: "DELETE",
        token
      });
      notify("候选已删除", "warn");
      if (selected?.id === candidate.id) {
        setSelected(null);
      }
      reload();
      onChanged?.();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "删除候选失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function rebuild(): Promise<void> {
    if (!productId) {
      return;
    }
    setRebuilding(true);
    try {
      const minScore = optionalNumber(rebuildMinScore) ?? 55;
      const result = await apiRequest<CandidateRebuildResult>(
        `/api/products/${productId}/candidates/rebuild`,
        {
          method: "POST",
          token,
          body: { min_score: Math.round(minScore), keep_reviewed: keepReviewed }
        }
      );
      setLastRebuild(result);
      notify(
        `候选池已重建：新增 ${result.created} · 更新 ${result.updated} · 共 ${result.total} 条`,
        "ok"
      );
      reload();
      onChanged?.();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "重建候选池失败", "error");
    } finally {
      setRebuilding(false);
    }
  }

  const items = data?.items ?? [];
  const totalCandidates = bandCounts
    ? SIMILARITY_BAND_ORDER.reduce((sum, band) => sum + bandCounts[band], 0)
    : (data?.total ?? 0);
  const priceObservationCount = items.reduce((sum, item) => sum + item.observed_prices.length, 0);
  const pendingCount = items.filter((item) => item.status === "PENDING_REVIEW").length;
  const activeFilterCount =
    (applied.keyword.trim() ? 1 : 0) +
    (applied.band ? 1 : 0) +
    (applied.status ? 1 : 0) +
    (applied.minScore.trim() ? 1 : 0) +
    (!productId && applied.productId ? 1 : 0);

  return (
    <>
      <Card
        title="候选池与相似度分档"
        spec="§13 / §36"
        subtitle="候选 = 被来源提到的一款茶 + §13 十维相似度 + 可回溯原话；同一款茶被多个来源提到只保留一条，来源多不等于证据厚。"
        actions={
          <>
            <Pill tone={contract?.comparable.price_in_similarity ? "danger" : "ok"}>
              价格不参与相似度
            </Pill>
            <Pill tone="neutral">共 {totalCandidates} 条候选</Pill>
          </>
        }
      >
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">候选总数</div>
            <div className="metric-value">{totalCandidates}</div>
            <div className="metric-hint">按 品牌|名称|年份|规格 去重</div>
          </div>
          {SIMILARITY_BAND_ORDER.map((band) => (
            <div className="metric" key={band}>
              <div className="metric-label">{bandLabels[band]}</div>
              <div className="metric-value">{bandCounts ? bandCounts[band] : "—"}</div>
              <div className="metric-hint">
                {band === "CORE_COMPARABLE"
                  ? "可用于高价值锚点（仍需价格证据）"
                  : band === "VALID_COMPARABLE"
                    ? "可作有效对标"
                    : band === "PERIPHERAL_REFERENCE"
                      ? "只作氛围背景，不撑价格锚"
                      : "不作为对标使用"}
              </div>
            </div>
          ))}
          <div className="metric">
            <div className="metric-label">本页待评审</div>
            <div className="metric-value">{pendingCount}</div>
            <div className="metric-hint">人工评审结果不会被重算覆盖</div>
          </div>
          <div className="metric">
            <div className="metric-label">本页观察价</div>
            <div className="metric-value">{priceObservationCount}</div>
            <div className="metric-hint">仅原话证据，进入市场价格中心才参与价格引擎</div>
          </div>
        </div>
        <Alert tone="info">
          §13 的十个维度共 100 分：任一侧缺少某维度信息时该维度按 0 分计并列入「信息缺失」，
          未知不等于相似；这里也不做任何跨单位价格换算（§62-2 / §62-3）。
        </Alert>
      </Card>

      {productId && canWrite ? (
        <Card
          title="重建候选池"
          spec="§36 / §42"
          subtitle="由已抽取的来源重建候选池：同一款茶（品牌 + 名称 + 年份 + 规格）合并成一条并重算分数。"
        >
          <div className="filter-bar">
            <label>
              本次构建阈值（分）
              <input
                type="number"
                min={0}
                max={100}
                value={rebuildMinScore}
                onChange={(event) => setRebuildMinScore(event.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={keepReviewed}
                onChange={(event) => setKeepReviewed(event.target.checked)}
              />
              保留已人工评审的结论（不退回待评审）
            </label>
            <button type="button" disabled={rebuilding} onClick={() => void rebuild()}>
              {rebuilding ? "重建中…" : "重建候选池"}
            </button>
          </div>
          <p className="muted mt-2">
            低于阈值（默认 §13 拒绝线 55）的候选仍会入库并标记为拒绝，便于审计与复盘，
            不会被静默丢弃。
          </p>
          {lastRebuild ? (
            <div className="metric-grid mt-3">
              <div className="metric">
                <div className="metric-label">新增</div>
                <div className="metric-value">{lastRebuild.created}</div>
                <div className="metric-hint">阈值 {lastRebuild.min_score} 分</div>
              </div>
              <div className="metric">
                <div className="metric-label">合并更新</div>
                <div className="metric-value">{lastRebuild.updated}</div>
                <div className="metric-hint">同一身份键合并</div>
              </div>
              <div className="metric">
                <div className="metric-label">保留人工结论</div>
                <div className="metric-value">{lastRebuild.kept_reviewed}</div>
                <div className="metric-hint">已确认 / 已拒绝不被覆盖</div>
              </div>
              <div className="metric">
                <div className="metric-label">低于阈值</div>
                <div className="metric-value">{lastRebuild.below_min_score}</div>
                <div className="metric-hint">入库但标记拒绝</div>
              </div>
              <div className="metric">
                <div className="metric-label">无产品名跳过</div>
                <div className="metric-value">{lastRebuild.stats.skipped_no_name}</div>
                <div className="metric-hint">页面上没写清是哪款茶</div>
              </div>
            </div>
          ) : null}
          {lastRebuild?.reached_limit ? (
            <Alert tone="warn">
              已达到单产品候选上限（{contract?.pool.limits.maxCandidatesPerProduct ?? 400} 条），
              本轮只更新既有候选，不再新增。
            </Alert>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="筛选与手工登记"
        spec="§13 / §54"
        actions={
          <>
            {activeFilterCount > 0 ? <Pill tone="info">已启用 {activeFilterCount} 个筛选</Pill> : null}
            {canWrite && productId ? (
              <button type="button" className="secondary sm" onClick={() => setShowForm((value) => !value)}>
                {showForm ? "收起手工登记" : "手工登记候选"}
              </button>
            ) : null}
          </>
        }
      >
        <div className="filter-bar">
          <label>
            关键词
            <input
              placeholder="候选名称或品牌"
              value={draft.keyword}
              onChange={(event) => setDraft({ ...draft, keyword: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyFilters(draft);
                }
              }}
            />
          </label>
          <label>
            分档
            <select
              value={draft.band}
              onChange={(event) => setDraft({ ...draft, band: event.target.value as "" | SimilarityBand })}
            >
              <option value="">全部</option>
              {SIMILARITY_BAND_ORDER.map((band) => (
                <option key={band} value={band}>
                  {bandLabels[band]}
                </option>
              ))}
            </select>
          </label>
          <label>
            评审状态
            <select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value as "" | CandidateStatus })}
            >
              <option value="">全部</option>
              {Object.entries(CANDIDATE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            最低分
            <input
              type="number"
              min={0}
              max={100}
              placeholder="0"
              value={draft.minScore}
              onChange={(event) => setDraft({ ...draft, minScore: event.target.value })}
            />
          </label>
          {!productId && products ? (
            <label>
              目标产品
              <select
                value={draft.productId}
                onChange={(event) => {
                  const next = { ...draft, productId: event.target.value };
                  setDraft(next);
                  applyFilters(next);
                  onProductFilterChange?.(event.target.value);
                }}
              >
                <option value="">全部产品</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.product_name}（{product.year} · {product.tea_type}）
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            排序
            <select
              value={draft.sort}
              onChange={(event) => setDraft({ ...draft, sort: event.target.value as CandidateSort })}
            >
              {Object.entries(CANDIDATE_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary" onClick={() => applyFilters(draft)}>
            应用筛选
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              applyFilters(EMPTY_FILTERS);
              onProductFilterChange?.("");
            }}
          >
            清空
          </button>
        </div>

        {!canWrite ? (
          <p className="muted mt-3">当前角色为只读：评审、重建与手工登记需要 ADMIN / RESEARCHER 权限。</p>
        ) : null}

        {showForm && canWrite && productId ? (
          <ManualCandidateForm
            productId={productId}
            token={token}
            onCreated={(created) => {
              notify(`候选已登记：总分 ${created.similarity_total} · ${bandLabels[created.similarity_band]}`, "ok");
              setSelected(created);
              reload();
              onChanged?.();
            }}
          />
        ) : null}
      </Card>

      {error && !data ? (
        <Card title="候选列表">
          <ErrorState description={error} onRetry={() => void load()} />
        </Card>
      ) : null}

      {loading && !data ? (
        <Card title="候选列表">
          <LoadingState label="正在读取候选池" />
        </Card>
      ) : null}

      {data ? (
        <div className="candidate-layout">
          <Card
            title="候选列表"
            spec="§36 / §54"
            actions={<Pill tone="neutral">命中 {data.total} 条 · 第 {data.page} / {data.totalPages} 页</Pill>}
          >
            {items.length === 0 ? (
              <EmptyState
                title="当前条件下没有候选"
                description={
                  productId
                    ? "先运行研究流水线抽取来源，或手工登记一条候选；重建候选池会把同款茶合并成一条。"
                    : "先在具体产品下完成研究并重建候选池，跨产品视图才会出现数据。"
                }
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>候选</th>
                      <th>相似度</th>
                      <th>来源证据</th>
                      <th>评审</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.id} className={selected?.id === row.id ? "row-selected" : ""}>
                        <td>
                          <button type="button" className="link" onClick={() => setSelected(row)}>
                            {row.brand_name ? `${row.brand_name} ` : ""}
                            {row.name}
                          </button>
                          <div className="muted">{formatCandidateSpec(row)}</div>
                          {!productId && row.product_name ? (
                            <div className="muted">
                              目标产品：
                              <Link to={`/high-value-db?productId=${row.product_id}`}>{row.product_name}</Link>
                            </div>
                          ) : null}
                          {row.similarity.unknown_dimensions.length > 0 ? (
                            <div className="muted">
                              {row.similarity.unknown_dimensions.length} 个维度信息缺失（按 0 分）
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <Pill tone={SIMILARITY_BAND_TONES[row.similarity_band]}>
                            {bandLabels[row.similarity_band]}
                          </Pill>
                          <div className="sim-score">{formatSimilarityScore(row.similarity_total)}</div>
                          <div className="sim-bar">
                            <div
                              className={`sim-bar-fill band-${row.similarity_band.toLowerCase()}`}
                              style={{ width: `${Math.max(row.similarity_total, 2)}%` }}
                            />
                          </div>
                        </td>
                        <td className="nowrap">
                          <Pill tone={row.merged_sources > 1 ? "info" : "neutral"}>
                            来源 {row.merged_sources}
                          </Pill>{" "}
                          <Pill tone={row.observed_prices.length > 0 ? "warn" : "neutral"}>
                            观察价 {row.observed_prices.length}
                          </Pill>
                          {row.observed_prices[0] ? (
                            <div className="muted">“{row.observed_prices[0].quote}”</div>
                          ) : null}
                        </td>
                        <td>
                          <Pill tone={CANDIDATE_STATUS_TONES[row.status]}>
                            {CANDIDATE_STATUS_LABELS[row.status]}
                          </Pill>
                          {row.reviewed_at ? (
                            <div className="muted">{formatDateTime(row.reviewed_at)}</div>
                          ) : null}
                        </td>
                        <td>
                          <div className="btn-row">
                            <button type="button" className="secondary sm" onClick={() => setSelected(row)}>
                              详情
                            </button>
                            {canWrite && row.status !== "APPROVED" ? (
                              <button
                                type="button"
                                className="secondary sm"
                                disabled={busyId === row.id}
                                onClick={() => void review(row, "APPROVED")}
                              >
                                确认对标
                              </button>
                            ) : null}
                            {canWrite && row.status !== "REJECTED" ? (
                              <button
                                type="button"
                                className="ghost sm"
                                disabled={busyId === row.id}
                                onClick={() => void review(row, "REJECTED")}
                              >
                                拒绝
                              </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                                type="button"
                                className="danger sm"
                                disabled={busyId === row.id}
                                onClick={() => void remove(row)}
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
            {data.totalPages > 1 ? (
              <div className="row between mt-3">
                <button
                  type="button"
                  className="secondary sm"
                  disabled={data.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </button>
                <span className="muted">
                  第 {data.page} / {data.totalPages} 页 · 每页 {data.pageSize} 条
                </span>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                </button>
              </div>
            ) : null}
            {compact ? (
              <p className="muted mt-3">
                此处只展示当前条件下的 {items.length} 条；完整候选池见「高价值茶数据库」。
              </p>
            ) : null}
          </Card>

          {selected ? (
            <CandidateDetail
              candidate={selected}
              bandLabels={bandLabels}
              dimensions={dimensions}
              canWrite={canWrite}
              isAdmin={isAdmin}
              busy={busyId === selected.id}
              onReview={review}
              onRemove={remove}
              onClose={() => setSelected(null)}
            />
          ) : (
            <Card title="候选详情" spec="§13">
              <EmptyState
                title="选择左侧一条候选"
                description="详情会摊开 §13 十个维度的命中依据、缺失维度与来源原话，方便人工判断能不能当对标。"
              />
            </Card>
          )}
        </div>
      ) : null}
    </>
  );
}

interface CandidateDetailProps {
  candidate: CandidateRow;
  bandLabels: Record<SimilarityBand, string>;
  dimensions: Map<SimilarityDimension, { label: string; weight: number }>;
  canWrite: boolean;
  isAdmin: boolean;
  busy: boolean;
  onReview: (candidate: CandidateRow, status: CandidateStatus, note?: string) => Promise<void>;
  onRemove: (candidate: CandidateRow) => Promise<void>;
  onClose: () => void;
}

/**
 * 候选详情：把「分数怎么来的」摊开给人工复核。
 * 十维明细 + 缺失维度 + 警告 + 原话证据四块缺一不可——缺了任何一块，分数就成了黑箱。
 */
function CandidateDetail({
  candidate,
  bandLabels,
  dimensions,
  canWrite,
  isAdmin,
  busy,
  onReview,
  onRemove,
  onClose
}: CandidateDetailProps): ReactElement {
  const [status, setStatus] = useState<CandidateStatus>(candidate.status);
  const [note, setNote] = useState(candidate.review_note ?? "");

  useEffect(() => {
    setStatus(candidate.status);
    setNote(candidate.review_note ?? "");
  }, [candidate.id, candidate.status, candidate.review_note]);

  return (
    <Card
      title="候选详情"
      spec="§13 / §42"
      actions={
        <>
          <Pill tone={SIMILARITY_BAND_TONES[candidate.similarity_band]}>
            {bandLabels[candidate.similarity_band]}
          </Pill>
          <button type="button" className="ghost sm" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <h4 className="detail-title">
        {candidate.brand_name ? `${candidate.brand_name} ` : ""}
        {candidate.name}
      </h4>
      <div className="context-meta">
        <Pill tone="brand">{formatSimilarityScore(candidate.similarity_total)}</Pill>
        <Pill tone="neutral">{formatCandidateSpec(candidate)}</Pill>
        <Pill tone={CANDIDATE_STATUS_TONES[candidate.status]}>
          {CANDIDATE_STATUS_LABELS[candidate.status]}
        </Pill>
      </div>
      <p className="muted">
        身份键 <code className="mono">{candidate.identity_key || "（空）"}</code> ·
        被 {candidate.merged_sources} 条来源提到 · 登记于 {formatDateTime(candidate.created_at)}
      </p>
      {candidate.notes ? <p className="muted">备注：{candidate.notes}</p> : null}

      <div className="sub-title">§13 十维明细（共 100 分）</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>维度</th>
              <th>权重</th>
              <th>命中度</th>
              <th>得分</th>
              <th>依据</th>
            </tr>
          </thead>
          <tbody>
            {candidate.similarity.dimensions.map((item) => (
              <tr key={item.dimension}>
                <td>
                  {dimensions.get(item.dimension)?.label ?? item.label}
                  {item.matched ? <Pill tone="ok">命中</Pill> : <Pill tone="neutral">未命中</Pill>}
                </td>
                <td className="nowrap">{dimensions.get(item.dimension)?.weight ?? item.weight}</td>
                <td className="nowrap">{Math.round(item.ratio * 100)}%</td>
                <td className="nowrap">{item.score}</td>
                <td className="muted">{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {candidate.similarity.unknown_dimensions.length > 0 ? (
        <Alert tone="warn">
          信息缺失维度（按 0 分，未知不等于相似）：
          {candidate.similarity.unknown_dimensions
            .map((dimension) => dimensions.get(dimension)?.label ?? SIMILARITY_DIMENSION_LABELS[dimension])
            .join("、")}
        </Alert>
      ) : null}
      {candidate.similarity.warnings.length > 0 ? (
        <ul className="prov-list">
          {candidate.similarity.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="sub-title">观察价（原话证据，不参与相似度）</div>
      {candidate.observed_prices.length === 0 ? (
        <p className="muted">该候选在来源中没有可回溯的价格原话。</p>
      ) : (
        <ul className="prov-list">
          {candidate.observed_prices.map((price, index) => (
            <li key={`${price.quote}-${index}`}>
              <Pill tone={PRICE_TYPE_TONES[price.price_type] ?? "neutral"}>
                {PRICE_TYPE_LABELS[price.price_type] ?? price.price_type}
              </Pill>{" "}
              <strong>{price.value === null ? "金额未写明" : formatPrice(price.value, price.currency)}</strong>{" "}
              <span className="muted">
                {price.unit_scope ? UNIT_SCOPE_LABELS[price.unit_scope] ?? price.unit_scope : "单位未写明"}
              </span>
              <div className="quote">“{price.quote}”</div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">
        观察价只是来源原话：挂牌价不等于成交价、整件价不等于单饼价，任何换算都留给 Phase 6 价格引擎（§62-2 / §62-3）。
      </p>

      <div className="sub-title">来源证据（{candidate.evidence.length} 条）</div>
      {candidate.evidence.length === 0 ? (
        <p className="muted">该候选暂无逐条原话证据。</p>
      ) : (
        <ul className="prov-list">
          {candidate.evidence.map((item, index) => (
            <li key={`${item.field}-${item.quote}-${index}`}>
              <Pill tone="outline">{CANDIDATE_EVIDENCE_KIND_LABELS[item.kind] ?? item.kind}</Pill>{" "}
              <code className="mono">{item.field}</code>
              {item.value ? <strong> {item.value}</strong> : null}
              <div className="quote">“{item.quote}”</div>
              {item.url ? (
                <a className="muted mono" href={item.url} target="_blank" rel="noreferrer">
                  {item.domain ?? item.url}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form
          className="stack mt-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void onReview(candidate, status, note.trim() ? note.trim() : undefined);
          }}
        >
          <div className="sub-title">人工评审</div>
          <label>
            评审结论
            <select value={status} onChange={(event) => setStatus(event.target.value as CandidateStatus)}>
              {Object.entries(CANDIDATE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            评审意见（可留空）
            <textarea
              rows={3}
              value={note}
              placeholder="例如：产地与原料一致，价格证据为挂牌价，只能作外围参考。"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="btn-row">
            <button type="submit" disabled={busy}>
              {busy ? "提交中…" : "保存评审"}
            </button>
            {isAdmin ? (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void onRemove(candidate)}
              >
                删除候选
              </button>
            ) : null}
          </div>
          {candidate.reviewed_at ? (
            <p className="muted">上次评审：{formatDateTime(candidate.reviewed_at)}</p>
          ) : null}
        </form>
      ) : (
        <Alert tone="info">
          当前角色为只读：候选的确认 / 拒绝 / 归档需要 ADMIN / RESEARCHER 权限。
        </Alert>
      )}
    </Card>
  );
}

interface ManualCandidateFormProps {
  productId: string;
  token: string | null;
  onCreated: (candidate: CandidateRow) => void;
}

interface ManualFormState {
  name: string;
  brandName: string;
  year: string;
  teaType: string;
  mountain: string;
  originRegion: string;
  rawMaterial: string;
  weightG: string;
  specNotes: string;
  notes: string;
  naming: string;
  aroma: string;
  taste: string;
  positioning: string;
  craft: string;
}

const EMPTY_MANUAL_FORM: ManualFormState = {
  name: "",
  brandName: "",
  year: "",
  teaType: "",
  mountain: "",
  originRegion: "",
  rawMaterial: "",
  weightG: "",
  specNotes: "",
  notes: "",
  naming: "",
  aroma: "",
  taste: "",
  positioning: "",
  craft: ""
};

/**
 * 手工登记候选：走与流水线完全相同的十维评分。
 * 只接受人工真正知道的信息——留空即视为未知（按 0 分），不做任何推断补全。
 */
function ManualCandidateForm({ productId, token, onCreated }: ManualCandidateFormProps): ReactElement {
  const { notify } = useToast();
  const [form, setForm] = useState<ManualFormState>(EMPTY_MANUAL_FORM);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!form.name.trim()) {
      notify("候选名称必填", "error");
      return;
    }
    const facet: Record<string, unknown> = {};
    const naming = splitKeywords(form.naming);
    const aroma = splitKeywords(form.aroma);
    const taste = splitKeywords(form.taste);
    const positioning = splitKeywords(form.positioning);
    const craft = splitKeywords(form.craft);
    if (naming.length > 0) {
      facet.naming = naming;
    }
    if (aroma.length > 0) {
      facet.aroma = aroma;
    }
    if (taste.length > 0) {
      facet.taste = taste;
    }
    if (positioning.length > 0) {
      facet.positioning = positioning;
    }
    if (craft.length > 0) {
      facet.craft = craft;
    }

    const year = optionalNumber(form.year);
    const weightG = optionalNumber(form.weightG);
    setBusy(true);
    try {
      const created = await apiRequest<CandidateRow>(`/api/products/${productId}/candidates`, {
        method: "POST",
        token,
        body: {
          name: form.name.trim(),
          brand_name: form.brandName.trim() || undefined,
          year: year === null ? undefined : Math.round(year),
          tea_type: form.teaType.trim() || undefined,
          mountain: form.mountain.trim() || undefined,
          origin_region: form.originRegion.trim() || undefined,
          raw_material: form.rawMaterial.trim() || undefined,
          weight_g: weightG === null ? undefined : weightG,
          spec_notes: form.specNotes.trim() || undefined,
          notes: form.notes.trim() || undefined,
          facet
        }
      });
      setForm(EMPTY_MANUAL_FORM);
      onCreated(created);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "登记候选失败", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack mt-3" onSubmit={submit}>
      <div className="sub-title">手工登记候选（走同一套 §13 十维评分）</div>
      <div className="grid-3">
        <label>
          候选名称 *
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如：7542"
          />
        </label>
        <label>
          品牌
          <input value={form.brandName} onChange={(event) => setForm({ ...form, brandName: event.target.value })} />
        </label>
        <label>
          年份
          <input
            type="number"
            min={1900}
            max={2100}
            value={form.year}
            onChange={(event) => setForm({ ...form, year: event.target.value })}
          />
        </label>
        <label>
          茶类
          <input
            value={form.teaType}
            onChange={(event) => setForm({ ...form, teaType: event.target.value })}
            placeholder="例如：普洱生茶"
          />
        </label>
        <label>
          山头 / 茶区
          <input value={form.mountain} onChange={(event) => setForm({ ...form, mountain: event.target.value })} />
        </label>
        <label>
          产地（省 / 市）
          <input
            value={form.originRegion}
            onChange={(event) => setForm({ ...form, originRegion: event.target.value })}
          />
        </label>
        <label>
          原料
          <input
            value={form.rawMaterial}
            onChange={(event) => setForm({ ...form, rawMaterial: event.target.value })}
            placeholder="例如：大树春茶"
          />
        </label>
        <label>
          规格（g）
          <input
            type="number"
            min={1}
            value={form.weightG}
            onChange={(event) => setForm({ ...form, weightG: event.target.value })}
          />
        </label>
        <label>
          规格备注
          <input
            value={form.specNotes}
            onChange={(event) => setForm({ ...form, specNotes: event.target.value })}
            placeholder="例如：357g 饼"
          />
        </label>
      </div>
      <div className="grid-3">
        <label>
          命名概念（逗号分隔）
          <input value={form.naming} onChange={(event) => setForm({ ...form, naming: event.target.value })} />
        </label>
        <label>
          香气（逗号分隔）
          <input value={form.aroma} onChange={(event) => setForm({ ...form, aroma: event.target.value })} />
        </label>
        <label>
          滋味（逗号分隔）
          <input value={form.taste} onChange={(event) => setForm({ ...form, taste: event.target.value })} />
        </label>
        <label>
          市场定位（逗号分隔）
          <input
            value={form.positioning}
            onChange={(event) => setForm({ ...form, positioning: event.target.value })}
          />
        </label>
        <label>
          工艺（逗号分隔）
          <input value={form.craft} onChange={(event) => setForm({ ...form, craft: event.target.value })} />
        </label>
        <label>
          备注
          <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </div>
      <Alert tone="info">
        留空的字段一律视为「未知」并按 0 分处理，系统不会替你推断树龄、山头、年份或价格。
        手工登记只接受你能给出出处的信息。
      </Alert>
      <div className="btn-row">
        <button type="submit" disabled={busy}>
          {busy ? "登记中…" : "登记候选"}
        </button>
        <button type="button" className="ghost" onClick={() => setForm(EMPTY_MANUAL_FORM)}>
          重置
        </button>
      </div>
    </form>
  );
}
