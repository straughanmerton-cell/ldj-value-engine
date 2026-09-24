import { useEffect, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { DealerCenterPanel } from "../components/dealer-center/DealerCenterPanel.js";
import { NoProductState, ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { useAuth } from "../lib/auth.js";

/**
 * 经销商培训中心（规格 §31 一级导航 / §52 经销商中心十项）。
 *
 * 经销商真正要回答的是「这款茶为什么值这个价、终端问起来我怎么说」，所以这一页
 * 只服务一个产品：先选产品，再摊开 §52 十项。跨产品比较、排名一律不做——
 * 每款茶的锚点与价格高度只对它自己成立（§62-5 / §62-7）。
 */
export function DealerCenterPage(): ReactElement {
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
        title="经销商培训"
        subtitle="让经销商清楚产品怎么定位、怎么解释、怎么卖：为什么值这个价、同赛道市场认知与主要锚点、产品结构、配方哲学、消费人群与常见问题。"
        actions={
          <>
            <Pill tone="ok">Phase 15 已交付：经销商中心与导出</Pill>
            <Pill tone="info">与主播中心共用同一版已审批成稿</Pill>
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
          spec="§52"
          subtitle="同一款茶在主播与经销商两侧看到的是同一版成稿，只是按各自的使用场景重排——不存在第二套说法。"
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

      {current ? (
        <DealerCenterPanel productId={current.id} token={token} />
      ) : null}
    </section>
  );
}

