import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { NoProductState, ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { SourceEvidencePanel } from "../components/research/SourceEvidencePanel.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { EmptyState, ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import {
  EXTRACTION_STATUS_LABELS,
  EXTRACTION_STATUS_TONES,
  FETCH_STATUS_LABELS,
  FETCH_STATUS_TONES,
  type SourceListResponse,
  type SourceRow
} from "../lib/research.js";

interface SourceRailProps {
  productId: string;
  token: string | null;
  selectedId: string | null;
  onSelect: (sourceId: string) => void;
}

/** 左栏来源检索条：证据中心的核心交互是「选一条来源 → 看它的正文与抽取」。 */
function SourceRail({ productId, token, selectedId, onSelect }: SourceRailProps): ReactElement {
  const [items, setItems] = useState<SourceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (applied.trim()) {
      params.set("keyword", applied.trim());
    }
    try {
      const result = await apiRequest<SourceListResponse>(
        `/api/products/${productId}/sources?${params.toString()}`,
        { token }
      );
      setItems(result.items);
      setTotal(result.total);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "读取来源失败");
    } finally {
      setLoading(false);
    }
  }, [productId, token, applied]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card title="来源" spec="§11" actions={<Pill tone="neutral">{total}</Pill>}>
      <div className="row">
        <input
          placeholder="检索标题或 URL"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setApplied(keyword);
            }
          }}
        />
        <button type="button" className="secondary sm" onClick={() => setApplied(keyword)}>
          检索
        </button>
      </div>

      {error ? <ErrorState description={error} onRetry={() => void load()} /> : null}
      {loading && items.length === 0 && !error ? <LoadingState label="正在读取来源" /> : null}
      {!loading && items.length === 0 && !error ? (
        <EmptyState
          title="暂无来源"
          description="先到「AI价值研究」跑一轮研究，或在「高价值茶数据库」手工登记来源。"
          action={
            <Link to={`/research?productId=${productId}`}>
              <button type="button" className="secondary sm">
                去跑研究
              </button>
            </Link>
          }
        />
      ) : null}

      <ul className="source-rail">
        {items.map((source) => (
          <li key={source.id}>
            <button
              type="button"
              className={selectedId === source.id ? "source-rail-item active" : "source-rail-item"}
              onClick={() => onSelect(source.id)}
            >
              <span className="sri-title">{source.title ?? source.url}</span>
              <span className="sri-domain mono">{source.domain}</span>
              <span className="sri-pills">
                <Pill tone={FETCH_STATUS_TONES[source.fetch_status] ?? "neutral"}>
                  {FETCH_STATUS_LABELS[source.fetch_status] ?? source.fetch_status}
                </Pill>
                <Pill tone={EXTRACTION_STATUS_TONES[source.extraction_status] ?? "neutral"}>
                  {EXTRACTION_STATUS_LABELS[source.extraction_status] ?? source.extraction_status}
                </Pill>
                {source.price_count > 0 ? <Pill tone="warn">价 {source.price_count}</Pill> : null}
                {source.fact_count > 0 ? <Pill tone="info">事实 {source.fact_count}</Pill> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * 证据中心（规格 §11 / §24 / §53）。
 *
 * Phase 4 交付「来源 → 正文 → 抽取证据」的可追溯链路；
 * Phase 14 已交付 FACT / INTERPRETATION / RHETORIC 逐句标注与 RED 审批拦截
 * （在产品详情「事实审核」Tab 里逐句查看，本页负责来源侧的可追溯链路）。
 */
export function EvidencePage(): ReactElement {
  const { token, user } = useAuth();
  const { products, loading, error } = useProductOptions(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedProductId = searchParams.get("productId") ?? "";
  const selectedSourceId = searchParams.get("sourceId");
  const current = products.find((product) => product.id === selectedProductId) ?? products[0] ?? null;
  const canWrite = user?.role === "ADMIN" || user?.role === "RESEARCHER";

  useEffect(() => {
    if (!selectedProductId && current) {
      setSearchParams({ productId: current.id }, { replace: true });
    }
  }, [current, selectedProductId, setSearchParams]);

  return (
    <section>
      <PageHeader
        title="证据中心"
        subtitle="每条事实与价格都能追到来源：网页写了什么就记什么，抽取结果不会自动变成产品事实。"
        actions={
          <>
            <Pill tone="info">Phase 4 已交付：来源证据链路</Pill>
            <Pill tone="ok">Phase 14 已交付：事实审核在「产品详情 → 事实审核」</Pill>
          </>
        }
      />

      {error ? (
        <Card title="产品选择">
          <ErrorState description={error} />
        </Card>
      ) : null}

      {loading && products.length === 0 && !error ? (
        <Card title="产品选择">
          <LoadingState label="正在读取产品列表" />
        </Card>
      ) : null}

      {!loading && products.length === 0 && !error ? (
        <Card title="产品选择">
          <NoProductState />
        </Card>
      ) : null}

      {products.length > 0 ? (
        <Card title="证据归属产品" spec="§36">
          <div className="research-context">
            <ProductSelect
              products={products}
              value={current?.id ?? ""}
              loading={loading}
              onChange={(productId) => setSearchParams({ productId })}
            />
            {current ? (
              <div className="context-meta">
                <Pill tone="neutral">
                  {current.year} 年 · {current.tea_type}
                </Pill>
                <Pill tone="outline">证据随产品隔离</Pill>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {current ? (
        <div className="evidence-layout">
          <div>
            <SourceRail
              productId={current.id}
              token={token}
              selectedId={selectedSourceId}
              onSelect={(sourceId) => setSearchParams({ productId: current.id, sourceId })}
            />
          </div>
          <div>
            {selectedSourceId ? (
              <SourceEvidencePanel
                productId={current.id}
                sourceId={selectedSourceId}
                token={token}
                canWrite={canWrite}
                refreshKey={refreshKey}
              />
            ) : (
              <Card title="来源证据" spec="§41">
                <EmptyState
                  title="请选择一条来源"
                  description="左侧点击来源标题，即可查看抓取正文、价格证据、网页事实与被丢弃条目。"
                  action={
                    <button
                      type="button"
                      className="secondary sm"
                      onClick={() => setRefreshKey((key) => key + 1)}
                    >
                      刷新来源列表
                    </button>
                  }
                />
              </Card>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
