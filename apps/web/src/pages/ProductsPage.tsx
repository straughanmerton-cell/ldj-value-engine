import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Card, PageHeader } from "../components/ui/Card.js";
import { EmptyState, ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

interface ProductRow {
  id: string;
  product_name: string;
  year: number;
  tea_type: string;
  mountain: string | null;
  benchmark_mode_preference: string;
  copy_intensity_default: number;
  updated_at: string;
}

interface ProductListResponse {
  items: ProductRow[];
  total: number;
  page: number;
  totalPages: number;
}

export function ProductsPage(): ReactElement {
  const { token } = useAuth();
  const [data, setData] = useState<ProductListResponse | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (search: string) => {
      if (!token) {
        return;
      }
      try {
        const result = await apiRequest<ProductListResponse>(
          `/api/products?pageSize=50${search ? `&q=${encodeURIComponent(search)}` : ""}`,
          { token }
        );
        setData(result);
        setError(null);
      } catch {
        setError("读取产品列表失败");
      }
    },
    [token]
  );

  useEffect(() => {
    void load("");
  }, [load]);

  return (
    <section>
      <PageHeader
        title="产品中心"
        subtitle="产品事实的登记入口：录入越完整，Value DNA、锚点与话术的可用度越高。"
        actions={
          <Link to="/products/new">
            <button type="button">新建产品</button>
          </Link>
        }
      />
      <Card
        title="检索"
        actions={
          <Pill tone="neutral">共 {data?.total ?? "…"} 个产品</Pill>
        }
      >
        <div className="row">
          <input
            placeholder="按产品名称 / 系列 / 山头检索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void load(query);
              }
            }}
          />
          <button className="secondary" onClick={() => void load(query)}>
            检索
          </button>
        </div>
      </Card>

      {error ? (
        <Card title="产品列表">
          <ErrorState description={error} onRetry={() => void load(query)} />
        </Card>
      ) : null}

      {!data && !error ? (
        <Card title="产品列表">
          <LoadingState label="正在读取产品列表" />
        </Card>
      ) : null}

      {data ? (
        <Card title="产品列表">
          {data.items.length === 0 ? (
            <EmptyState
              title="暂无产品"
              description="录入第一个产品后，系统会自动生成规则引擎版的 Value DNA。"
              action={
                <Link to="/products/new">
                  <button type="button">新建产品</button>
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>产品</th>
                    <th>年份</th>
                    <th>茶类</th>
                    <th>山头</th>
                    <th>对标模式</th>
                    <th>文案强度</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <Link to={`/products/${product.id}`}>{product.product_name}</Link>
                      </td>
                      <td>{product.year}</td>
                      <td>{product.tea_type}</td>
                      <td>{product.mountain ?? "—"}</td>
                      <td>
                        <Pill tone={product.benchmark_mode_preference === "AUTO" ? "neutral" : "info"}>
                          {product.benchmark_mode_preference === "AUTO"
                            ? "自动"
                            : product.benchmark_mode_preference}
                        </Pill>
                      </td>
                      <td>Level {product.copy_intensity_default}</td>
                      <td className="nowrap">
                        <Link to={`/products/${product.id}`}>详情</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </section>
  );
}
