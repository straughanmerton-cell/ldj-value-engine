import { useEffect, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CandidatesPanel } from "../components/research/CandidatesPanel.js";
import { NoProductState, ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { SourcesPanel } from "../components/research/SourcesPanel.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { useAuth } from "../lib/auth.js";

/**
 * 高价值茶数据库（规格 §11 / §12 / §36）。
 *
 * Phase 4 交付「来源与证据池」，Phase 5 在同一入口交付「候选池与相似度分档」：
 * 平台是「产品 → 来源 → 候选 → 锚点」的证据链，先有来源才可能有候选，先有候选才可能有锚点。
 */
export function HighValueDbPage(): ReactElement {
  const { token, user } = useAuth();
  const { products, loading, error } = useProductOptions(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedId = searchParams.get("productId") ?? "";
  const current = products.find((product) => product.id === selectedId) ?? products[0] ?? null;
  const canWrite = user?.role === "ADMIN" || user?.role === "RESEARCHER";
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (!selectedId && current) {
      setSearchParams({ productId: current.id }, { replace: true });
    }
  }, [current, selectedId, setSearchParams]);

  return (
    <section>
      <PageHeader
        title="高价值茶数据库"
        subtitle="沉淀来源、候选与相似度分档：来源只登记一次，候选按 品牌|名称|年份|规格 归并，分数只由 §13 十个维度决定。"
        actions={
          <>
            <Pill tone="info">Phase 4 已交付：来源与证据池</Pill>
            <Pill tone="ok">Phase 5 已交付：候选池与相似度分档</Pill>
            <Pill tone="ok">Phase 6 已交付：价格证据引擎</Pill>
            <Pill tone="ok">Phase 7 已交付：高价值锚点与对标模式判定</Pill>
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

      {token ? (
        <CandidatesPanel
          token={token}
          canWrite={canWrite}
          isAdmin={isAdmin}
          products={products}
          onProductFilterChange={(productId) => {
            if (productId) {
              setSearchParams({ productId });
            }
          }}
        />
      ) : null}

      {products.length > 0 ? (
        <Card
          title="关联产品"
          spec="§36"
          subtitle="来源与证据按产品维度沉淀：同一页面在不同产品下分别登记，避免证据串用。"
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
              </div>
            ) : null}
          </div>
          <Alert tone="info">
            来源数量直接影响证据密度，因此系统对同一规范化 URL 只保留一条记录；
            重复登记不会让证据看起来更厚。
          </Alert>
        </Card>
      ) : null}

      {current ? (
        <SourcesPanel
          productId={current.id}
          token={token}
          canWrite={canWrite}
          isAdmin={isAdmin}
          evidenceLink
        />
      ) : null}
    </section>
  );
}
