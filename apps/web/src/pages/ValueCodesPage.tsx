import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Pill } from "../components/ui/State.js";
import { ValueCodeDictionaryTable } from "../components/value-codes/ValueCodeDictionaryTable.js";
import { ValueCodeLibraryTable } from "../components/value-codes/ValueCodeLibraryTable.js";
import { ValueCodesContractCard } from "../components/value-codes/ValueCodesContractCard.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import {
  VALUE_CODE_SORT_LABELS,
  VALUE_CODE_STATUS_ORDER,
  countOf,
  statusLabel,
  useValueCodeLabels,
  useValueCodesContract,
  type ValueCodeLibraryResponse,
  type ValueCodeSort
} from "../lib/value-codes.js";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部模式" },
  { value: "BENCHMARK", label: "高价值对标模式（Benchmark Mode）" },
  { value: "CATEGORY_CREATOR", label: "自建高端标准模式（Category Creator Mode）" }
];

const PAGE_SIZE = 20;

/**
 * 价值密码库（跨产品，规格 §18 / §19 / §20 / §30）。
 *
 * 这一页是可审计的只读总览：**状态判定与生成都在产品内进行**（产品详情「价值拆解」Tab），
 * 因为一个 Code 成不成立取决于这款茶自己的事实，不存在「在库里改一下状态」这种操作（§44 / §62-5）。
 * 页面做三件事：说清口径（合同）、摊开进度（矩阵）、提供 Code 字典（16 个 Code 是什么）。
 */
export function ValueCodesPage(): ReactElement {
  const { token } = useAuth();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useValueCodesContract(token);
  const { labels, loading: labelsLoading, error: labelsError } = useValueCodeLabels(token);

  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
  const [mode, setMode] = useState(searchParams.get("mode") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [sort, setSort] = useState<ValueCodeSort>(
    (searchParams.get("sort") as ValueCodeSort | null) ?? "-updated_at"
  );
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1") || 1);

  const [data, setData] = useState<ValueCodeLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [contractOpen, setContractOpen] = useState(false);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  /** 筛选条件写进 URL：可以把这个视角直接发给同时复核。 */
  const syncParams = useCallback(
    (next: { q: string; mode: string; status: string; sort: ValueCodeSort; page: number }) => {
      const params = new URLSearchParams();
      if (next.q.trim()) {
        params.set("q", next.q.trim());
      }
      if (next.mode) {
        params.set("mode", next.mode);
      }
      if (next.status) {
        params.set("status", next.status);
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
    if (mode) {
      params.set("mode", mode);
    }
    if (status) {
      params.set("status", status);
    }
    apiRequest<ValueCodeLibraryResponse>(`/api/value-codes?${params.toString()}`, { token })
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
        setError(caught instanceof ApiError ? caught.message : "读取价值密码库失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [keyword, mode, page, reloadTick, sort, status, token]);

  function apply(next: { q?: string; mode?: string; status?: string; sort?: ValueCodeSort }): void {
    const nextKeyword = next.q ?? keyword;
    const nextMode = next.mode ?? mode;
    const nextStatus = next.status ?? status;
    const nextSort = next.sort ?? sort;
    setKeyword(nextKeyword);
    setMode(nextMode);
    setStatus(nextStatus);
    setSort(nextSort);
    setPage(1);
    syncParams({ q: nextKeyword, mode: nextMode, status: nextStatus, sort: nextSort, page: 1 });
  }

  function changePage(nextPage: number): void {
    setPage(nextPage);
    syncParams({ q: keyword, mode, status, sort, page: nextPage });
  }

  function reset(): void {
    apply({ q: "", mode: "", status: "", sort: "-updated_at" });
  }

  const items = data?.items ?? [];
  const activeFilterCount =
    (keyword.trim() ? 1 : 0) + (mode ? 1 : 0) + (status ? 1 : 0) + (sort !== "-updated_at" ? 1 : 0);
  const totals = items.reduce<Record<string, number>>((accumulator, row) => {
    for (const codeStatus of VALUE_CODE_STATUS_ORDER) {
      accumulator[codeStatus] = (accumulator[codeStatus] ?? 0) + countOf(row.code_counts, codeStatus);
    }
    return accumulator;
  }, {});

  return (
    <section>
      <PageHeader
        title="价值密码库"
        subtitle="把「这款茶凭什么贵得起」拆成 16 个可判定的 Code：有事实才成立，没事实写未录入，时间依赖型不承诺未来，竞品事实不移植。"
        actions={
          <>
            <Pill tone="ok">Phase 9 已交付：价值映射</Pill>
            <Pill tone={engine?.unknown_is_written_as_unknown === false ? "danger" : "ok"}>
              未录入不得书写
            </Pill>
            <Pill tone={engine?.time_dependent_not_promise === false ? "danger" : "ok"}>
              时间依赖不承诺未来
            </Pill>
          </>
        }
      />

      <ValueCodesContractCard
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
        spec="§18 / §30"
        subtitle="筛选口径与后端列表完全一致；跨产品视图只用于检索与复盘，状态判定始终发生在具体产品内。"
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
              placeholder="产品名 / 系列 / 茶类"
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
            状态
            <select value={status} onChange={(event) => apply({ status: event.target.value })}>
              <option value="">全部状态</option>
              {VALUE_CODE_STATUS_ORDER.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option, labels)}
                </option>
              ))}
            </select>
          </label>
          <label>
            排序
            <select
              value={sort}
              onChange={(event) => apply({ sort: event.target.value as ValueCodeSort })}
            >
              {Object.entries(VALUE_CODE_SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
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
            本页 {items.length} 款产品合计：{VALUE_CODE_STATUS_ORDER.map((codeStatus) => (
              <span key={codeStatus}>
                {statusLabel(codeStatus, labels)} {totals[codeStatus] ?? 0}
                {"　"}
              </span>
            ))}
          </p>
        ) : null}

        {labelsLoading ? <p className="muted mt-2">正在读取状态文案…</p> : null}
      </Card>

      <ValueCodeLibraryTable
        items={items}
        total={data?.total ?? 0}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? PAGE_SIZE}
        totalPages={data?.totalPages ?? 1}
        loading={loading}
        error={error}
        labels={labels}
        contract={contract}
        onPageChange={changePage}
        onRetry={reload}
      />

      <ValueCodeDictionaryTable
        contract={contract}
        labels={labels}
        loading={contractLoading}
        error={contractError}
      />
    </section>
  );
}
