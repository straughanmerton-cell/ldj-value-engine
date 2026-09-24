import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MarketOfferCreateForm, type OfferOption } from "../components/prices/MarketOfferCreateForm.js";
import { MarketOfferEvidencePanel, type MarketOfferUpdatePatch } from "../components/prices/MarketOfferEvidencePanel.js";
import { MarketOfferTable } from "../components/prices/MarketOfferTable.js";
import { PriceContractCard } from "../components/prices/PriceContractCard.js";
import { PriceRebuildCard } from "../components/prices/PriceRebuildCard.js";
import { PriceSummaryCard } from "../components/prices/PriceSummaryCard.js";
import { NoProductState, ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { useToast } from "../components/ui/Toast.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import type { CandidateListResponse } from "../lib/candidates.js";
import {
  MARKET_OFFER_ATTRIBUTION_LABELS,
  MARKET_OFFER_SORT_LABELS,
  PRICE_EVIDENCE_BAND_ORDER,
  usePriceContract,
  type MarketOfferListResponse,
  type MarketOfferRebuildResult,
  type MarketOfferSort,
  type MarketOfferView,
  type PriceSummary
} from "../lib/market-offers.js";
import {
  PRICE_TYPE_LABELS,
  UNIT_SCOPE_LABELS,
  type SourceListResponse
} from "../lib/research.js";

type Scope = "product" | "all";

interface Filters {
  keyword: string;
  priceType: string;
  unitScope: string;
  band: string;
  attribution: string;
  outliersOnly: boolean;
  includeExcluded: boolean;
  sort: MarketOfferSort;
}

const EMPTY_FILTERS: Filters = {
  keyword: "",
  priceType: "",
  unitScope: "",
  band: "",
  attribution: "",
  outliersOnly: false,
  includeExcluded: false,
  sort: "-value"
};

/**
 * 市场价格中心（规格 §14 市场价格系统 / §15 Price Evidence Score / §16.1 锚点价格条件）。
 *
 * 页面只做一件事：把「哪些价格能被当作锚点」讲清楚，并把判定依据摊开。
 * 因此「价格证据合同」「价格汇总」「证据列表」「证据明细」四块缺一不可——
 * 少了合同，用户不知道分数怎么算；少了明细，用户无法复核；少了汇总，用户不知道能不能用。
 */
export function MarketPricesPage(): ReactElement {
  const { token, user } = useAuth();
  const { notify } = useToast();
  const { contract, engine, attributionLabels, loading: contractLoading, error: contractError } =
    usePriceContract(token);
  const { products, loading: productsLoading, error: productsError } = useProductOptions(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedId = searchParams.get("productId") ?? "";
  const current = products.find((product) => product.id === selectedId) ?? products[0] ?? null;
  const canWrite = user?.role === "ADMIN" || user?.role === "RESEARCHER";
  const isAdmin = user?.role === "ADMIN";
  const bandLabels = contract?.evidence_bands ?? null;

  const [scope, setScope] = useState<Scope>("product");
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MarketOfferListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PriceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [staleHint, setStaleHint] = useState<string | null>(null);
  const [selected, setSelected] = useState<MarketOfferView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [candidates, setCandidates] = useState<OfferOption[]>([]);
  const [sources, setSources] = useState<OfferOption[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  const pageSize = 20;
  const productId = current?.id ?? "";

  useEffect(() => {
    if (!selectedId && current) {
      setSearchParams({ productId: current.id }, { replace: true });
    }
  }, [current, selectedId, setSearchParams]);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  const listPath = useCallback(
    (params: URLSearchParams): string => {
      const query = params.toString();
      if (scope === "all") {
        return `/api/market-offers?${query}`;
      }
      return `/api/products/${productId}/market-offers?${query}`;
    },
    [productId, scope]
  );

  const loadList = useCallback(async () => {
    if (!token || (scope === "product" && !productId)) {
      return;
    }
    setListLoading(true);
    const params = new URLSearchParams({ sort: applied.sort });
    if (applied.keyword.trim()) {
      params.set("q", applied.keyword.trim());
    }
    if (applied.priceType) {
      params.set("price_type", applied.priceType);
    }
    if (applied.unitScope) {
      params.set("unit_scope", applied.unitScope);
    }
    if (applied.band) {
      params.set("evidence_band", applied.band);
    }
    if (applied.attribution) {
      params.set("attribution", applied.attribution);
    }
    if (applied.outliersOnly) {
      params.set("is_outlier", "true");
    }
    if (applied.includeExcluded) {
      params.set("include_excluded", "true");
    }
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    try {
      const result = await apiRequest<MarketOfferListResponse>(listPath(params), { token });
      setData(result);
      setListError(null);
    } catch (caught) {
      setListError(caught instanceof ApiError ? caught.message : "读取价格证据失败");
    } finally {
      setListLoading(false);
    }
  }, [applied, listPath, page, pageSize, productId, scope, token]);

  const loadSummary = useCallback(async () => {
    if (!token || !productId) {
      setSummary(null);
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    try {
      const result = await apiRequest<PriceSummary>(`/api/products/${productId}/price-summary`, { token });
      setSummary(result);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [productId, token]);

  useEffect(() => {
    void loadList();
  }, [loadList, reloadTick]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, reloadTick]);

  /** 人工登记表单要能挂候选与来源；两者都属于当前产品，所以随产品切换重新读取。 */
  useEffect(() => {
    if (!token || !productId || !canWrite) {
      setCandidates([]);
      setSources([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      apiRequest<CandidateListResponse>(`/api/products/${productId}/candidates?pageSize=100&sort=-score`, { token }),
      apiRequest<SourceListResponse>(`/api/products/${productId}/sources?pageSize=100`, { token })
    ])
      .then(([candidateResult, sourceResult]) => {
        if (cancelled) {
          return;
        }
        setCandidates(
          candidateResult.items.map((row) => ({
            id: row.id,
            label: `${row.brand_name ? `${row.brand_name} ` : ""}${row.name}${row.year ? ` · ${row.year}` : ""}（相似度 ${row.similarity_total}）`
          }))
        );
        setSources(
          sourceResult.items.map((row) => ({
            id: row.id,
            label: `${row.title ?? row.url} · ${row.domain}`
          }))
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCandidates([]);
          setSources([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canWrite, productId, token]);

  const items = useMemo(() => data?.items ?? [], [data]);

  function applyFilters(next: Filters): void {
    setApplied(next);
    setPage(1);
  }

  async function patchOffer(offer: MarketOfferView, patch: MarketOfferUpdatePatch): Promise<void> {
    setBusyId(offer.id);
    try {
      const updated = await apiRequest<MarketOfferView>(
        `/api/products/${offer.product_id}/market-offers/${offer.id}`,
        { method: "PATCH", token, body: patch }
      );
      notify("价格证据已更新（原证据保留，版本可审计）", "ok");
      setSelected(updated);
      setStaleHint("价格汇总已按最近一次修正重新计算。");
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "更新价格证据失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleExclude(offer: MarketOfferView): Promise<void> {
    await patchOffer(offer, { is_excluded: !offer.is_excluded });
  }

  async function removeOffer(offer: MarketOfferView): Promise<void> {
    setBusyId(offer.id);
    try {
      await apiRequest(`/api/products/${offer.product_id}/market-offers/${offer.id}`, {
        method: "DELETE",
        token
      });
      notify("价格证据已删除", "warn");
      if (selected?.id === offer.id) {
        setSelected(null);
      }
      setStaleHint("价格汇总已按删除后的证据重新计算。");
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "删除价格证据失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  function handleRebuilt(result: MarketOfferRebuildResult): void {
    setSummary(result.summary);
    setStaleHint(
      `汇总来自最近一次重建：新增 ${result.created} · 更新 ${result.updated} · 保留人工结论 ${result.kept_manual}。`
    );
    reload();
  }

  function handleCreated(offer: MarketOfferView): void {
    notify(`已登记 ${offer.evidence_score} 分（${bandLabels?.[offer.evidence_band] ?? offer.evidence_band}）的价格证据`, "ok");
    setSelected(offer);
    setStaleHint("价格汇总已包含刚登记的价格证据。");
    reload();
  }

  const activeFilterCount =
    (applied.keyword.trim() ? 1 : 0) +
    (applied.priceType ? 1 : 0) +
    (applied.unitScope ? 1 : 0) +
    (applied.band ? 1 : 0) +
    (applied.attribution ? 1 : 0) +
    (applied.outliersOnly ? 1 : 0) +
    (applied.includeExcluded ? 1 : 0);

  return (
    <section>
      <PageHeader
        title="市场价格中心"
        subtitle="价格证据引擎：挂牌 ≠ 成交、整件 ≠ 单饼、没有写 = 不计算；每条价格都要能回到来源原话，异常值只标记不删除。"
        actions={
          <>
            <Pill tone="ok">Phase 6 已交付：价格证据引擎</Pill>
            <Pill tone={contract?.price_in_similarity ? "danger" : "ok"}>价格不参与相似度</Pill>
          </>
        }
      />

      <PriceContractCard
        contract={contract}
        engine={engine}
        loading={contractLoading}
        error={contractError}
      />

      {productsError ? (
        <Card title="产品选择">
          <ErrorState description={productsError} />
        </Card>
      ) : null}

      {productsLoading && products.length === 0 && !productsError ? (
        <Card title="产品选择">
          <LoadingState label="正在读取产品列表" />
        </Card>
      ) : null}

      {!productsLoading && products.length === 0 && !productsError ? (
        <Card title="产品选择">
          <NoProductState />
        </Card>
      ) : null}

      {products.length > 0 ? (
        <Card
          title="价格上下文"
          spec="§14"
          subtitle="价格证据挂在产品下：同一款茶的价格必须在同一个产品维度里比较，跨产品只做检索，不做锚点判断。"
          actions={
            current ? (
              <Link to={`/products/${current.id}`}>
                <button type="button" className="secondary sm">
                  打开产品详情
                </button>
              </Link>
            ) : null
          }
        >
          <div className="research-context">
            <ProductSelect
              products={products}
              value={current?.id ?? ""}
              loading={productsLoading}
              onChange={(next) => {
                setSelected(null);
                setStaleHint(null);
                setPage(1);
                setSearchParams({ productId: next });
              }}
            />
            <label>
              查看范围
              <select
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value as Scope);
                  setPage(1);
                }}
              >
                <option value="product">当前产品的价格证据</option>
                <option value="all">全部产品（检索 / 复盘用）</option>
              </select>
            </label>
            {current ? (
              <div className="context-meta">
                <Pill tone="neutral">
                  {current.year} 年 · {current.tea_type}
                </Pill>
                {current.mountain ? <Pill tone="outline">{current.mountain}</Pill> : null}
              </div>
            ) : null}
          </div>
          {scope === "all" ? (
            <Alert tone="info">
              跨产品视图只用于检索与复盘：锚点判断必须回到具体产品，因为不同产品的价格口径不可互相印证。
            </Alert>
          ) : (
            <Alert tone="warn">
              价格证据不会从来源自动变成产品事实，也不会因为报价多就升级为成交价；
              成交价与挂牌价分开统计，缺成交证据时必须明说（§62-2）。
            </Alert>
          )}
        </Card>
      ) : null}

      {scope === "product" && current ? (
        <PriceSummaryCard summary={summary} loading={summaryLoading} staleHint={staleHint} />
      ) : null}

      {scope === "product" && current ? (
        <PriceRebuildCard
          productId={current.id}
          token={token}
          canWrite={canWrite}
          engine={engine}
          onRebuilt={handleRebuilt}
        />
      ) : null}

      <Card
        title="筛选与人工登记"
        spec="§14 / §54"
        subtitle="筛选口径与后端列表完全一致；「只看异常值」「含已排除」是审计视角，不会改变汇总口径。"
        actions={
          <>
            {activeFilterCount > 0 ? <Pill tone="info">已启用 {activeFilterCount} 个筛选</Pill> : null}
            {canWrite && scope === "product" && current ? (
              <button type="button" className="secondary sm" onClick={() => setShowForm((value) => !value)}>
                {showForm ? "收起人工登记" : "人工登记价格证据"}
              </button>
            ) : null}
          </>
        }
      >
        <div className="filter-bar">
          <label>
            关键词
            <input
              placeholder="产品名 / 品牌 / 引文"
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
            价格类型
            <select
              value={draft.priceType}
              onChange={(event) => setDraft({ ...draft, priceType: event.target.value })}
            >
              <option value="">全部类型</option>
              {Object.entries(PRICE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            单位口径
            <select
              value={draft.unitScope}
              onChange={(event) => setDraft({ ...draft, unitScope: event.target.value })}
            >
              <option value="">全部单位</option>
              {Object.entries(UNIT_SCOPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            证据分档
            <select value={draft.band} onChange={(event) => setDraft({ ...draft, band: event.target.value })}>
              <option value="">全部分档</option>
              {PRICE_EVIDENCE_BAND_ORDER.map((band) => (
                <option key={band} value={band}>
                  {bandLabels?.[band] ?? band}
                </option>
              ))}
            </select>
          </label>
          <label>
            归属
            <select
              value={draft.attribution}
              onChange={(event) => setDraft({ ...draft, attribution: event.target.value })}
            >
              <option value="">全部归属</option>
              {Object.entries(MARKET_OFFER_ATTRIBUTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {attributionLabels[value as keyof typeof MARKET_OFFER_ATTRIBUTION_LABELS] ?? label}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序
            <select
              value={draft.sort}
              onChange={(event) => setDraft({ ...draft, sort: event.target.value as MarketOfferSort })}
            >
              {Object.entries(MARKET_OFFER_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.outliersOnly}
              onChange={(event) => setDraft({ ...draft, outliersOnly: event.target.checked })}
            />
            只看异常值
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.includeExcluded}
              onChange={(event) => setDraft({ ...draft, includeExcluded: event.target.checked })}
            />
            含已排除
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
            }}
          >
            清空
          </button>
        </div>

        {!canWrite ? (
          <p className="muted mt-3">当前角色为只读：登记、修正、排除与重建需要 ADMIN / RESEARCHER 权限。</p>
        ) : null}

        {showForm && canWrite && current ? (
          <MarketOfferCreateForm
            productId={current.id}
            token={token}
            candidates={candidates}
            sources={sources}
            onCreated={handleCreated}
          />
        ) : null}
      </Card>

      <div className="price-layout">
        <MarketOfferTable
          items={items}
          total={data?.total ?? 0}
          page={data?.page ?? page}
          pageSize={data?.pageSize ?? pageSize}
          totalPages={data?.totalPages ?? 1}
          loading={listLoading}
          error={listError}
          selectedId={selected?.id ?? null}
          canWrite={canWrite}
          isAdmin={isAdmin}
          busyId={busyId}
          showProduct={scope === "all"}
          bandLabels={bandLabels ?? undefined}
          onSelect={setSelected}
          onPageChange={setPage}
          onToggleExclude={canWrite ? (offer) => void toggleExclude(offer) : undefined}
          onRemove={isAdmin ? (offer) => void removeOffer(offer) : undefined}
          onRetry={reload}
        />
        <MarketOfferEvidencePanel
          offer={selected}
          bandLabels={bandLabels ?? undefined}
          canWrite={canWrite}
          isAdmin={isAdmin}
          busy={busyId !== null && busyId === selected?.id}
          onUpdate={patchOffer}
          onRemove={removeOffer}
          onClose={() => setSelected(null)}
        />
      </div>
    </section>
  );
}
