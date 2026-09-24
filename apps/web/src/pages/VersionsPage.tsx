import { useEffect, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { VersionHistoryPanel } from "../components/delivery/VersionHistoryPanel.js";
import { NoProductState, ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { useAuth } from "../lib/auth.js";

/**
 * 版本管理（规格 §31 一级导航 / §34 / §50 / §57 / §62-15）。
 *
 * 「所有版本必须保留」在界面上要能被验证：这一页按产品摊开**成稿版本**与**审核版本**两条线，
 * 并明确交付层的口径——只交付最新一版成稿 + 这一版自己的审核，历史版本只读不改。
 */
export function VersionsPage(): ReactElement {
  const { token } = useAuth();
  const { products, loading, error } = useProductOptions(token);
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedId = searchParams.get("productId") ?? "";
  const current = products.find((product) => product.id === selectedId) ?? products[0] ?? null;

  useEffect(() => {
    if (!selectedId && current) {
      setSearchParams({ productId: current.id }, { replace: true });
    }
  }, [current, selectedId, setSearchParams]);

  return (
    <section>
      <PageHeader
        title="版本管理"
        subtitle="所有版本必须保留：产品结构、配方哲学、强成交话术与事实审核都可回溯；重新生成只新增版本，旧版本原样保留。"
        actions={
          <>
            <Pill tone="ok">Phase 15 已交付：历史版本与最终资料</Pill>
            <Pill tone="info">旧版本只读不改</Pill>
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
          title="产品选择"
          spec="§34 / §50"
          subtitle="版本按产品归属：换产品即换一套版本线，跨产品不会串号。"
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
        </Card>
      ) : null}

      {current ? <VersionHistoryPanel productId={current.id} token={token} /> : null}

      {products.length > 0 ? (
        <Alert tone="info">
          版本管理的产品内入口在「产品详情 → 历史版本」Tab：同一份数据，只是在产品上下文里看更顺。
          交付层永远只读「最新一版成稿 + 这一版自己的审核」，历史版本不参与交付（§57 / §62-14）。
        </Alert>
      ) : null}
    </section>
  );
}
