import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../../lib/api.js";
import type { ProductListResponse, ProductOption } from "../../lib/research.js";
import { EmptyState } from "../ui/State.js";

/**
 * 产品选择器：研究、数据库、证据三个工作台都以「当前产品」为上下文。
 * 没有产品时不允许进入后续流程——研究必须有对象，否则所有证据都无归属。
 */
export function useProductOptions(token: string | null): {
  products: ProductOption[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<ProductListResponse>("/api/products?pageSize=100", { token })
      .then((result) => {
        if (!cancelled) {
          setProducts(result.items);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取产品列表失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, tick]);

  const reload = useCallback(() => setTick((current) => current + 1), []);
  return { products, loading, error, reload };
}

export interface ProductSelectProps {
  products: ProductOption[];
  value: string;
  onChange: (productId: string) => void;
  loading?: boolean;
  label?: string;
}

export function ProductSelect({
  products,
  value,
  onChange,
  loading,
  label = "选择产品"
}: ProductSelectProps): ReactElement {
  return (
    <label>
      {label}
      <select
        value={value}
        disabled={loading || products.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {products.length === 0 ? <option value="">暂无产品</option> : null}
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.product_name}（{product.year} · {product.tea_type}
            {product.mountain ? ` · ${product.mountain}` : ""}）
          </option>
        ))}
      </select>
    </label>
  );
}

/** 产品选择器的空态：引导先建立产品档案，而不是让工作台空转。 */
export function NoProductState(): ReactElement {
  return (
    <EmptyState
      title="请先建立产品档案"
      description="研究流水线、来源证据与候选池都挂在具体产品下：没有产品就无法启动研究。"
      action={
        <Link to="/products/new">
          <button type="button">新建产品</button>
        </Link>
      }
    />
  );
}
