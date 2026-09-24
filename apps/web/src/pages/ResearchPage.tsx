import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CandidatesPanel } from "../components/research/CandidatesPanel.js";
import { NoProductState, ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { ResearchRunCard } from "../components/research/ResearchRunCard.js";
import { SearchPlanCard } from "../components/research/SearchPlanCard.js";
import { SourcesPanel } from "../components/research/SourcesPanel.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

/**
 * AI价值研究工作台（规格 §12 / §40 / §41 / §55 / §56）。
 *
 * 一个入口串起「选产品 → 跑研究 → 看 22 阶段进度 → 审搜索策略 → 看来源证据」。
 * Phase 4 之后的阶段（候选池、相似度、价格、锚点、话术）在进度中显式登记，
 * 不会因为尚未实现就从界面上消失。
 */
export function ResearchPage(): ReactElement {
  const { token, user } = useAuth();
  const { products, loading, error } = useProductOptions(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);
  const [aiProvider, setAiProvider] = useState<string | null>(null);

  const selectedId = searchParams.get("productId") ?? "";
  const current = products.find((product) => product.id === selectedId) ?? products[0] ?? null;
  const canWrite = user?.role === "ADMIN" || user?.role === "RESEARCHER";
  const isAdmin = user?.role === "ADMIN";

  const loadMeta = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const meta = await apiRequest<{ ai_provider: string }>("/api/meta/core-features", { token });
      setAiProvider(meta.ai_provider);
    } catch {
      setAiProvider(null);
    }
  }, [token]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!selectedId && current) {
      setSearchParams({ productId: current.id }, { replace: true });
    }
  }, [current, selectedId, setSearchParams]);

  return (
    <section>
      <PageHeader
        title="AI价值研究工作台"
        subtitle="研究不是问答：系统按 §55 流水线逐步执行检索、抓取与抽取，产出可追溯的证据与锚点。"
        actions={
          <>
            <Pill tone="info">Phase 4 已交付：检索 / 抓取 / 网页抽取</Pill>
            <Pill tone="ok">Phase 5 已交付：候选池与相似度分档</Pill>
            {aiProvider ? (
              <Pill tone={aiProvider === "mock" ? "warn" : "ok"}>AI Provider：{aiProvider}</Pill>
            ) : null}
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
        <Card
          title="研究对象"
          spec="§55"
          subtitle="所有研究资产（来源、抽取、候选、锚点）都挂在具体产品下，先选产品再开始研究。"
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
              loading={loading}
              onChange={(productId) => setSearchParams({ productId })}
            />
            {current ? (
              <div className="context-meta">
                <Pill tone="neutral">
                  {current.year} 年 · {current.tea_type}
                </Pill>
                {current.mountain ? <Pill tone="outline">{current.mountain}</Pill> : null}
                <Pill tone="info">
                  {current.benchmark_mode_preference === "AUTO"
                    ? "对标模式：自动判定"
                    : `对标模式：${current.benchmark_mode_preference}`}
                </Pill>
                <Pill tone="neutral">默认文案强度 Level {current.copy_intensity_default}</Pill>
              </div>
            ) : null}
          </div>
          <Alert tone="info">
            研究必须基于真实检索结果：系统不会用模型记忆代替搜索（§62-1），也不会用竞品事实推断自有产品事实。
          </Alert>
        </Card>
      ) : null}

      {current ? (
        <>
          <ResearchRunCard
            productId={current.id}
            token={token}
            canWrite={canWrite}
            aiProvider={aiProvider}
            onFinished={() => setRefreshKey((key) => key + 1)}
          />
          <SearchPlanCard
            productId={current.id}
            token={token}
            canWrite={canWrite}
            refreshKey={refreshKey}
          />
          <SourcesPanel
            productId={current.id}
            token={token}
            canWrite={canWrite}
            isAdmin={isAdmin}
            refreshKey={refreshKey}
            compact
            evidenceLink
          />
          <CandidatesPanel
            productId={current.id}
            token={token}
            canWrite={canWrite}
            isAdmin={isAdmin}
            refreshKey={refreshKey}
            compact
          />
        </>
      ) : null}
    </section>
  );
}
