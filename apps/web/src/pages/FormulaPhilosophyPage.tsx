import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { FormulaPhilosophyContractCard } from "../components/formula-philosophy/FormulaPhilosophyContractCard.js";
import { FormulaPhilosophyMatrixTable } from "../components/formula-philosophy/FormulaPhilosophyMatrixTable.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Pill } from "../components/ui/State.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import {
  FORMULA_COMPONENT_ORDER,
  FORMULA_PHILOSOPHY_SORT_LABELS,
  FORMULA_RATIO_SOURCE_LABELS,
  componentLabel,
  useFormulaPhilosophyContract,
  useFormulaPhilosophyLabels,
  type FormulaPhilosophyLibraryResponse,
  type FormulaPhilosophySort
} from "../lib/formula-philosophy.js";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部模式" },
  { value: "BENCHMARK", label: "高价值对标模式（Benchmark Mode）" },
  { value: "CATEGORY_CREATOR", label: "自建高端标准模式（Category Creator Mode）" }
];

const KNOWN_RATIO_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部比例状态" },
  { value: "true", label: "只看已确认比例" },
  { value: "false", label: "只看未确认比例（正文不含比例）" }
];

const PAGE_SIZE = 20;

/**
 * 配方哲学库（跨产品，规格 §6 / §31 / §46）。
 *
 * 与产品结构库同理：**生成与人工确认都在产品内进行**（产品详情「配方哲学」Tab），
 * 因为「这款茶为什么这么设计」只能由它自己的已录入事实回答（§46 / §62-5）。
 * 这一页做三件事：说清口径与红线（合同）、摊开进度（矩阵）、提供分量字典（五个分量各自要什么事实）。
 */
export function FormulaPhilosophyPage(): ReactElement {
  const { token } = useAuth();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useFormulaPhilosophyContract(token);
  const { labels, loading: labelsLoading, error: labelsError } = useFormulaPhilosophyLabels(token);

  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
  const [mode, setMode] = useState(searchParams.get("mode") ?? "");
  const [component, setComponent] = useState(searchParams.get("component") ?? "");
  const [knownRatio, setKnownRatio] = useState(searchParams.get("known_ratio") ?? "");
  const [sort, setSort] = useState<FormulaPhilosophySort>(
    (searchParams.get("sort") as FormulaPhilosophySort | null) ?? "-updated_at"
  );
  const [missingOnly, setMissingOnly] = useState(searchParams.get("missing") === "true");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1") || 1);

  const [data, setData] = useState<FormulaPhilosophyLibraryResponse | null>(null);
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
      component: string;
      known_ratio: string;
      sort: FormulaPhilosophySort;
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
      if (next.component) {
        params.set("component", next.component);
      }
      if (next.known_ratio) {
        params.set("known_ratio", next.known_ratio);
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
    if (component) {
      params.set("component", component);
    }
    if (knownRatio) {
      params.set("known_ratio", knownRatio);
    }
    if (mode) {
      params.set("mode", mode);
    }
    if (missingOnly) {
      params.set("missing", "true");
    }
    apiRequest<FormulaPhilosophyLibraryResponse>(`/api/formula-philosophy?${params.toString()}`, {
      token
    })
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
        setError(caught instanceof ApiError ? caught.message : "读取配方哲学库失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [component, keyword, knownRatio, missingOnly, mode, page, reloadTick, sort, token]);

  function apply(next: {
    q?: string;
    mode?: string;
    component?: string;
    known_ratio?: string;
    sort?: FormulaPhilosophySort;
    missing?: boolean;
  }): void {
    const nextKeyword = next.q ?? keyword;
    const nextMode = next.mode ?? mode;
    const nextComponent = next.component ?? component;
    const nextKnownRatio = next.known_ratio ?? knownRatio;
    const nextSort = next.sort ?? sort;
    const nextMissing = next.missing ?? missingOnly;
    setKeyword(nextKeyword);
    setMode(nextMode);
    setComponent(nextComponent);
    setKnownRatio(nextKnownRatio);
    setSort(nextSort);
    setMissingOnly(nextMissing);
    setPage(1);
    syncParams({
      q: nextKeyword,
      mode: nextMode,
      component: nextComponent,
      known_ratio: nextKnownRatio,
      sort: nextSort,
      missing: nextMissing,
      page: 1
    });
  }

  function changePage(nextPage: number): void {
    setPage(nextPage);
    syncParams({
      q: keyword,
      mode,
      component,
      known_ratio: knownRatio,
      sort,
      missing: missingOnly,
      page: nextPage
    });
  }

  function reset(): void {
    apply({
      q: "",
      mode: "",
      component: "",
      known_ratio: "",
      sort: "-updated_at",
      missing: false
    });
  }

  const items = data?.items ?? [];
  const activeFilterCount =
    (keyword.trim() ? 1 : 0) +
    (component ? 1 : 0) +
    (knownRatio ? 1 : 0) +
    (mode ? 1 : 0) +
    (missingOnly ? 1 : 0) +
    (sort !== "-updated_at" ? 1 : 0);
  const generatedCount = items.filter((row) => row.record_id !== null).length;
  const writtenTotal = items.reduce((sum, row) => sum + row.written_components, 0);
  const passedCount = items.filter((row) => row.acceptance_passed).length;
  const knownRatioCount = items.filter((row) => row.known_ratio).length;

  return (
    <section>
      <PageHeader
        title="配方哲学库"
        subtitle="没有确切比例也能讲清设计逻辑：先定骨架、再定香气、再定回甘，最后收口。缺事实的分量留空写缺口，绝不编一个配比。"
        actions={
          <>
            <Pill tone="ok">Phase 11 已交付：配方哲学</Pill>
            <Pill tone={engine?.no_fabricated_ratio === false ? "danger" : "ok"}>
              未确认比例时正文零比例
            </Pill>
            <Pill tone={engine?.no_new_ingredient === false ? "danger" : "ok"}>不新增原料</Pill>
          </>
        }
      />

      <FormulaPhilosophyContractCard
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
        spec="§6 / §46"
        subtitle="筛选口径与后端列表完全一致；跨产品视图只用于检索与排产，分量落位始终发生在具体产品内。"
        actions={
          <>
            {activeFilterCount > 0 ? (
              <Pill tone="info">已启用 {activeFilterCount} 个筛选</Pill>
            ) : null}
            {labelsError ? (
              <Pill tone="warn">标签文案读取失败，已用内置兜底文案</Pill>
            ) : null}
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
            已写实分量
            <select value={component} onChange={(event) => apply({ component: event.target.value })}>
              <option value="">全部分量</option>
              {FORMULA_COMPONENT_ORDER.map((option) => (
                <option key={option} value={option}>
                  {componentLabel(option, labels)}
                </option>
              ))}
            </select>
          </label>
          <label>
            比例状态
            <select
              value={knownRatio}
              onChange={(event) => apply({ known_ratio: event.target.value })}
            >
              {KNOWN_RATIO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
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
              onChange={(event) => apply({ sort: event.target.value as FormulaPhilosophySort })}
            >
              {Object.entries(FORMULA_PHILOSOPHY_SORT_LABELS).map(([value, label]) => (
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
            只看还没生成配方哲学的产品
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
            本页 {items.length} 款产品：已生成 {generatedCount} 款 · 已写实分量合计 {writtenTotal} 个
            · 已确认比例 {knownRatioCount} 款 · §57 验收通过 {passedCount} 款
          </p>
        ) : null}

        {labelsLoading ? <p className="muted mt-2">正在读取分量文案…</p> : null}
      </Card>

      <FormulaPhilosophyMatrixTable
        items={items}
        total={data?.total ?? 0}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? PAGE_SIZE}
        totalPages={data?.totalPages ?? 1}
        loading={loading}
        error={error}
        onPageChange={changePage}
        onRetry={reload}
      />

      <Card
        title="五个分量字典"
        spec="§6.3 / §46"
        subtitle="每个分量承担什么任务、写实它至少需要哪些已录入事实、主要喂给 §46 的哪一项输出——口径与后端合同完全一致。"
      >
        {contract ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>分量</th>
                    <th>它承担什么任务</th>
                    <th>至少要有哪些已录入事实</th>
                    <th>主要喂给（§46）</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.components.map((item, index) => (
                    <tr key={item.key}>
                      <td className="nowrap muted">{index + 1}</td>
                      <td className="nowrap">
                        <strong>{item.label}</strong>
                        <div className="muted mono mt-1">{item.key}</div>
                        <div className="muted mono mt-1">{item.storage_field}</div>
                      </td>
                      <td>{item.definition}</td>
                      <td className="muted">{item.requirement}</td>
                      <td className="nowrap">
                        <Pill tone="outline">{item.agent8_output}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid-2 mt-3">
              <div>
                <div className="sub-title">比例口径（§6.1）</div>
                <ul className="muted">
                  {Object.entries(FORMULA_RATIO_SOURCE_LABELS).map(([key, label]) => (
                    <li key={key}>
                      {label}（<span className="mono">{key}</span>）
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  登记比例时必须逐字命中本产品已录入的原料 / 山头 / 用料，最多{" "}
                  {contract.limits.maxRatioEntries} 项；查不到就整次拒绝——宁可没有比例，也不编一个。
                </p>
              </div>
              <div>
                <div className="sub-title">§57 验收问题</div>
                <p className="muted">{contract.acceptance.question}</p>
                <p className="muted">
                  至少 {contract.acceptance.min_written_components} 个分量写实且设计逻辑成稿才算通过；
                  没有比例时，正文里不允许出现任何比例字样。
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">正在读取分量字典…</p>
        )}
      </Card>
    </section>
  );
}
