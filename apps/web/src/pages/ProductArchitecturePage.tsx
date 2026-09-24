import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { ProductArchitectureContractCard } from "../components/product-architecture/ProductArchitectureContractCard.js";
import { ProductArchitectureMatrixTable } from "../components/product-architecture/ProductArchitectureMatrixTable.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Pill } from "../components/ui/State.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import {
  PRODUCT_ARCHITECTURE_ROLE_ORDER,
  PRODUCT_ARCHITECTURE_SORT_LABELS,
  useProductArchitectureContract,
  useProductArchitectureLabels,
  type ProductArchitectureLibraryResponse,
  type ProductArchitectureSort
} from "../lib/product-architecture.js";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部模式" },
  { value: "BENCHMARK", label: "高价值对标模式（Benchmark Mode）" },
  { value: "CATEGORY_CREATOR", label: "自建高端标准模式（Category Creator Mode）" }
];

const PAGE_SIZE = 20;

/**
 * 产品结构库（跨产品，规格 §5 / §31 / §45）。
 *
 * 这一页是可审计的只读总览：**九个角色的生成与人工确认都在产品内进行**（产品详情「产品结构」Tab），
 * 因为「这款茶的每一部分各自在干什么」只能由它自己的已录入事实回答（§45 / §62-5）。
 * 页面做三件事：说清口径（合同）、摊开进度（矩阵）、提供角色字典（九个角色分别要什么事实）。
 */
export function ProductArchitecturePage(): ReactElement {
  const { token } = useAuth();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useProductArchitectureContract(token);
  const { labels, loading: labelsLoading, error: labelsError } = useProductArchitectureLabels(token);

  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
  const [mode, setMode] = useState(searchParams.get("mode") ?? "");
  const [role, setRole] = useState(searchParams.get("role") ?? "");
  const [sort, setSort] = useState<ProductArchitectureSort>(
    (searchParams.get("sort") as ProductArchitectureSort | null) ?? "-updated_at"
  );
  const [missingOnly, setMissingOnly] = useState(searchParams.get("missing") === "true");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1") || 1);

  const [data, setData] = useState<ProductArchitectureLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [contractOpen, setContractOpen] = useState(false);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  /** 筛选条件写进 URL：可以把这个视角直接发给同事复核。 */
  const syncParams = useCallback(
    (next: {
      q: string;
      mode: string;
      role: string;
      sort: ProductArchitectureSort;
      missing: boolean;
      page: number;
    }) => {
      const params = new URLSearchParams();
      if (next.q.trim()) {
        params.set("q", next.q.trim());
      }
      if (next.mode) {
        params.set("mode", next.mode);
      }
      if (next.role) {
        params.set("role", next.role);
      }
      if (next.missing) {
        params.set("missing", "true");
      }
      if (next.sort !== "-updated_at") {
        params.set("sort", next.sort);
      }
      if (next.page > 1) {
        params.set("page", String(next.page));
      }
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ sort, page: String(page), pageSize: String(PAGE_SIZE) });
    if (keyword.trim()) {
      params.set("q", keyword.trim());
    }
    if (role) {
      params.set("role", role);
    }
    if (mode) {
      params.set("mode", mode);
    }
    if (missingOnly) {
      params.set("missing", "true");
    }
    apiRequest<ProductArchitectureLibraryResponse>(
      `/api/product-architecture?${params.toString()}`,
      { token }
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setData(result);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setError(caught instanceof ApiError ? caught.message : "读取产品结构库失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [keyword, missingOnly, mode, page, reloadTick, role, sort, token]);

  function apply(next: {
    q?: string;
    mode?: string;
    role?: string;
    sort?: ProductArchitectureSort;
    missing?: boolean;
  }): void {
    const nextKeyword = next.q ?? keyword;
    const nextMode = next.mode ?? mode;
    const nextRole = next.role ?? role;
    const nextSort = next.sort ?? sort;
    const nextMissing = next.missing ?? missingOnly;
    setKeyword(nextKeyword);
    setMode(nextMode);
    setRole(nextRole);
    setSort(nextSort);
    setMissingOnly(nextMissing);
    setPage(1);
    syncParams({
      q: nextKeyword,
      mode: nextMode,
      role: nextRole,
      sort: nextSort,
      missing: nextMissing,
      page: 1
    });
  }

  function changePage(nextPage: number): void {
    setPage(nextPage);
    syncParams({ q: keyword, mode, role, sort, missing: missingOnly, page: nextPage });
  }

  function reset(): void {
    apply({ q: "", mode: "", role: "", sort: "-updated_at", missing: false });
  }

  const items = data?.items ?? [];
  const activeFilterCount =
    (keyword.trim() ? 1 : 0) +
    (role ? 1 : 0) +
    (mode ? 1 : 0) +
    (missingOnly ? 1 : 0) +
    (sort !== "-updated_at" ? 1 : 0);
  const totalWritten = items.reduce((sum, row) => sum + row.written_roles, 0);
  const passedCount = items.filter((row) => row.acceptance_passed).length;

  return (
    <section>
      <PageHeader
        title="产品结构库"
        subtitle="把参数解释成设计：谁负责骨架、谁负责香气身份、谁负责第一口冲击、谁负责回甘与记忆点。缺事实的角色留空，不用形容词补圆。"
        actions={
          <>
            <Pill tone="ok">Phase 10 已交付：产品结构</Pill>
            <Pill tone={engine?.no_new_facts === false ? "danger" : "ok"}>不新增原料或配方事实</Pill>
            <Pill tone={engine?.gap_stays_empty === false ? "danger" : "ok"}>
              事实不足留空写缺口
            </Pill>
          </>
        }
      />

      <ProductArchitectureContractCard
        contract={contract}
        engine={engine}
        downstream={downstream}
        loading={contractLoading}
        error={contractError}
        open={contractOpen}
        onToggle={() => setContractOpen((value) => !value)}
      />

      <Card
        title="筛选"
        spec="§5 / §45"
        subtitle="筛选口径与后端列表完全一致；跨产品视图只用于检索与排产，角色落位始终发生在具体产品内。"
        actions={
          <>
            {activeFilterCount > 0 ? <Pill tone="info">已启用 {activeFilterCount} 个筛选</Pill> : null}
            {labelsError ? <Pill tone="warn">标签文案读取失败，已用内置兜底文案</Pill> : null}
          </>
        }
      >
        <div className="filter-bar">
          <label>
            关键词
            <input
              placeholder="产品名 / 品牌"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  apply({});
                }
              }}
            />
          </label>
          <label>
            已写实角色
            <select value={role} onChange={(event) => apply({ role: event.target.value })}>
              <option value="">全部角色</option>
              {PRODUCT_ARCHITECTURE_ROLE_ORDER.map((option) => (
                <option key={option} value={option}>
                  {labels?.roles.find((item) => item.key === option)?.label ?? option}
                </option>
              ))}
            </select>
          </label>
          <label>
            模式
            <select value={mode} onChange={(event) => apply({ mode: event.target.value })}>
              {MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序
            <select
              value={sort}
              onChange={(event) => apply({ sort: event.target.value as ProductArchitectureSort })}
            >
              {Object.entries(PRODUCT_ARCHITECTURE_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={missingOnly}
              onChange={(event) => apply({ missing: event.target.checked })}
            />
            只看还没生成产品结构的产品
          </label>
          <button type="button" className="secondary" onClick={() => apply({})}>
            应用筛选
          </button>
          <button type="button" className="ghost" onClick={reset}>
            清空
          </button>
        </div>

        {items.length > 0 ? (
          <p className="muted mt-3">
            本页 {items.length} 款产品合计：已写实角色 {totalWritten} 个 · §57 验收通过 {passedCount} 款
          </p>
        ) : null}

        {labelsLoading ? <p className="muted mt-2">正在读取角色文案…</p> : null}
      </Card>

      <ProductArchitectureMatrixTable
        items={items}
        total={data?.total ?? 0}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? PAGE_SIZE}
        totalPages={data?.totalPages ?? 1}
        loading={loading}
        error={error}
        labels={labels}
        onPageChange={changePage}
        onRetry={reload}
      />

      <Card
        title="九个角色字典"
        spec="§5 / §45"
        subtitle="每个角色要回答什么、写实它至少需要哪些已录入事实、允许引用哪些字段——口径与后端合同完全一致。"
      >
        {contract ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>角色</th>
                  <th>它要回答什么</th>
                  <th>至少要有哪些已录入事实</th>
                  <th>§57 必答</th>
                </tr>
              </thead>
              <tbody>
                {contract.roles.map((item) => (
                  <tr key={item.key}>
                    <td className="nowrap">
                      <strong>{item.label}</strong>
                      <div className="muted mono mt-1">{item.key}</div>
                    </td>
                    <td>{item.question}</td>
                    <td className="muted">{item.requirement}</td>
                    <td className="nowrap">
                      {item.acceptance_required ? <Pill tone="brand">必答</Pill> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">正在读取角色字典…</p>
        )}
        <p className="muted mt-2">{engine?.acceptance_question ?? ""}</p>
      </Card>
    </section>
  );
}
