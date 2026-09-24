import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { SalesCopyContractCard } from "../components/sales-copy/SalesCopyContractCard.js";
import { SalesCopyMatrixTable } from "../components/sales-copy/SalesCopyMatrixTable.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Alert, Pill } from "../components/ui/State.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import {
  COPY_INTENSITY_ORDER,
  SALES_COPY_OUTPUT_ORDER,
  SALES_COPY_SORT_LABELS,
  VALUE_FOCUS_ORDER,
  intensityLabel,
  outputLabel,
  useSalesCopyContract,
  useSalesCopyLabels,
  valueFocusLabel,
  type SalesCopyLibraryResponse,
  type SalesCopySort
} from "../lib/sales-copy.js";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部模式" },
  { value: "BENCHMARK", label: "高价值对标模式（Benchmark Mode）" },
  { value: "CATEGORY_CREATOR", label: "自建高端标准模式（Category Creator Mode）" }
];

const LEVEL5_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部 Level 5 状态" },
  { value: "true", label: "只看 Level 5 成立" },
  { value: "false", label: "只看 Level 5 未成立" }
];

const ANCHOR_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部锚点状态" },
  { value: "true", label: "只看有可靠价格锚点" },
  { value: "false", label: "只看无可靠价格锚点（用标准句）" }
];

const PAGE_SIZE = 20;

/**
 * 强成交话术库（跨产品，规格 §21 / §26 / §31 / §47）。
 *
 * 与产品结构库、配方哲学库同理：**生成与人工确认都在产品内进行**（产品详情「强成交话术」Tab），
 * 因为「这款茶主播该怎么讲」只能由它自己已录入的事实与锚点回答（§47 / §62-5）。
 * 这一页做三件事：说清口径与红线（合同）、摊开进度（矩阵）、提供一份话术字典
 * （五档强度 / 九种输出 / 八项评分 / Level 5 七项 / 价值重点八项各自要什么）。
 */
export function SalesCopyPage(): ReactElement {
  const { token } = useAuth();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useSalesCopyContract(token);
  const { labels, loading: labelsLoading, error: labelsError } = useSalesCopyLabels(token);

  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
  const [intensity, setIntensity] = useState(searchParams.get("intensity") ?? "");
  const [level5, setLevel5] = useState(searchParams.get("level5") ?? "");
  const [hasAnchor, setHasAnchor] = useState(searchParams.get("has_anchor") ?? "");
  const [mode, setMode] = useState(searchParams.get("mode") ?? "");
  const [sort, setSort] = useState<SalesCopySort>(
    (searchParams.get("sort") as SalesCopySort | null) ?? "-updated_at"
  );
  const [missingOnly, setMissingOnly] = useState(searchParams.get("missing") === "true");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1") || 1);

  const [data, setData] = useState<SalesCopyLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [contractOpen, setContractOpen] = useState(false);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  /** 筛选条件写进 URL：可以把这个视角直接发给同事复核。 */
  const syncParams = useCallback(
    (next: {
      q: string;
      intensity: string;
      level5: string;
      has_anchor: string;
      mode: string;
      sort: SalesCopySort;
      missing: boolean;
      page: number;
    }) => {
      const params = new URLSearchParams();
      if (next.q.trim()) {
        params.set("q", next.q.trim());
      }
      if (next.intensity) {
        params.set("intensity", next.intensity);
      }
      if (next.level5) {
        params.set("level5", next.level5);
      }
      if (next.has_anchor) {
        params.set("has_anchor", next.has_anchor);
      }
      if (next.mode) {
        params.set("mode", next.mode);
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
    if (intensity) {
      params.set("intensity", intensity);
    }
    if (level5) {
      params.set("level5", level5);
    }
    if (hasAnchor) {
      params.set("has_anchor", hasAnchor);
    }
    if (mode) {
      params.set("mode", mode);
    }
    if (missingOnly) {
      params.set("missing", "true");
    }
    apiRequest<SalesCopyLibraryResponse>(`/api/sales-copy?${params.toString()}`, { token })
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
        setError(caught instanceof ApiError ? caught.message : "读取强成交话术库失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasAnchor, intensity, keyword, level5, missingOnly, mode, page, reloadTick, sort, token]);

  function apply(next: {
    q?: string;
    intensity?: string;
    level5?: string;
    has_anchor?: string;
    mode?: string;
    sort?: SalesCopySort;
    missing?: boolean;
  }): void {
    const nextKeyword = next.q ?? keyword;
    const nextIntensity = next.intensity ?? intensity;
    const nextLevel5 = next.level5 ?? level5;
    const nextHasAnchor = next.has_anchor ?? hasAnchor;
    const nextMode = next.mode ?? mode;
    const nextSort = next.sort ?? sort;
    const nextMissing = next.missing ?? missingOnly;
    setKeyword(nextKeyword);
    setIntensity(nextIntensity);
    setLevel5(nextLevel5);
    setHasAnchor(nextHasAnchor);
    setMode(nextMode);
    setSort(nextSort);
    setMissingOnly(nextMissing);
    setPage(1);
    syncParams({
      q: nextKeyword,
      intensity: nextIntensity,
      level5: nextLevel5,
      has_anchor: nextHasAnchor,
      mode: nextMode,
      sort: nextSort,
      missing: nextMissing,
      page: 1
    });
  }

  function changePage(nextPage: number): void {
    setPage(nextPage);
    syncParams({
      q: keyword,
      intensity,
      level5,
      has_anchor: hasAnchor,
      mode,
      sort,
      missing: missingOnly,
      page: nextPage
    });
  }

  function reset(): void {
    apply({
      q: "",
      intensity: "",
      level5: "",
      has_anchor: "",
      mode: "",
      sort: "-updated_at",
      missing: false
    });
  }

  const items = data?.items ?? [];
  const activeFilterCount =
    (keyword.trim() ? 1 : 0) +
    (intensity ? 1 : 0) +
    (level5 ? 1 : 0) +
    (hasAnchor ? 1 : 0) +
    (mode ? 1 : 0) +
    (missingOnly ? 1 : 0) +
    (sort !== "-updated_at" ? 1 : 0);
  const generatedCount = items.filter((row) => row.record_id !== null).length;
  const level5Count = items.filter((row) => row.level5_passed).length;
  const acceptanceCount = items.filter((row) => row.acceptance_passed).length;
  const anchorCount = items.filter((row) => row.has_reliable_price_anchor).length;

  return (
    <section>
      <PageHeader
        title="强成交话术库"
        subtitle="主播拿起来就能讲、够狠、不变成说明书，而且一个字都没有编。没有可靠价格锚点就用 §22 标准句立标准，绝不编一个价格高度。"
        actions={
          <>
            <Pill tone="ok">Phase 12 已交付：强成交话术</Pill>
            <Pill tone={engine?.ai_wired === false ? "outline" : "warn"}>
              {engine?.ai_wired === false ? "本阶段不接 AI（纯规则）" : "AI 状态待确认"}
            </Pill>
            <Pill tone={contract?.red_blocks_publish === false ? "danger" : "ok"}>RED 禁发布</Pill>
          </>
        }
      />

      <SalesCopyContractCard
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
        spec="§21 / §26 / §47"
        subtitle="筛选口径与后端列表完全一致；跨产品视图只用于检索与排产，生成始终发生在具体产品内。"
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
            成交强度
            <select value={intensity} onChange={(event) => apply({ intensity: event.target.value })}>
              <option value="">全部强度</option>
              {COPY_INTENSITY_ORDER.map((level) => (
                <option key={level} value={String(level)}>
                  {intensityLabel(level, labels)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Level 5
            <select value={level5} onChange={(event) => apply({ level5: event.target.value })}>
              {LEVEL5_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            价格锚点
            <select
              value={hasAnchor}
              onChange={(event) => apply({ has_anchor: event.target.value })}
            >
              {ANCHOR_OPTIONS.map((option) => (
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
              onChange={(event) => apply({ sort: event.target.value as SalesCopySort })}
            >
              {Object.entries(SALES_COPY_SORT_LABELS).map(([value, label]) => (
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
            只看还没生成强成交话术的产品
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
            本页 {items.length} 款产品：已生成 {generatedCount} 款 · Level 5 成立 {level5Count} 款 · §57
            验收通过 {acceptanceCount} 款 · 有可靠价格锚点 {anchorCount} 款
          </p>
        ) : null}

        {labelsLoading ? <p className="muted mt-2">正在读取话术文案…</p> : null}
      </Card>

      <SalesCopyMatrixTable
        items={items}
        labels={labels}
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
        title="话术字典"
        spec="§21 / §22 / §23 / §26 / §33"
        subtitle="五档强度、九种输出、八项评分、Level 5 七项、价值重点八项各自要什么——口径与后端合同完全一致。"
      >
        {contract ? (
          <>
            <div className="sub-title">§21 五档成交强度</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>档位</th>
                    <th>名称</th>
                    <th>定义</th>
                    <th>要求</th>
                    <th>规格</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.levels.map((item) => (
                    <tr key={item.level}>
                      <td className="nowrap">
                        <Pill tone={item.tone}>Level {item.level}</Pill>
                        {item.is_king ? <Pill tone="brand">王者</Pill> : null}
                      </td>
                      <td className="nowrap">{item.label}</td>
                      <td>{item.definition}</td>
                      <td className="muted">{item.requirement}</td>
                      <td className="nowrap muted mono">{item.spec_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sub-title mt-3">§23 八项成交冲击力评分（合计 {contract.impact_score.max} 分）</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>评分项</th>
                    <th>权重</th>
                    <th>机械判定标准</th>
                    <th>规格</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.impact_score.items.map((item, index) => (
                    <tr key={item.key}>
                      <td className="nowrap muted">{index + 1}</td>
                      <td className="nowrap">
                        <strong>{item.label}</strong>
                        <div className="muted mono mt-1">{item.key}</div>
                      </td>
                      <td className="nowrap">{item.weight} 分</td>
                      <td className="muted">{item.criterion}</td>
                      <td className="nowrap muted mono">{item.spec_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row mt-2">
              {contract.impact_score.bands.map((band) => (
                <Pill key={band.band} tone={band.tone}>
                  {band.label}（≥ {band.min}）
                </Pill>
              ))}
              <Pill tone="outline">
                Level 4 ≥ {contract.impact_score.min_score_by_intensity[4] ?? 85} 分
              </Pill>
              <Pill tone="brand">
                Level 5 ≥ {contract.impact_score.min_score_by_intensity[5] ?? 90} 分
              </Pill>
            </div>

            <div className="sub-title mt-3">
              §22 Level 5 王者话术七项强制要求（共 {contract.level5_requirement_count} 项）
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>强制项</th>
                    <th>要求</th>
                    <th>判定</th>
                    <th>规格</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.level5_requirements.map((item, index) => (
                    <tr key={item.key}>
                      <td className="nowrap muted">{index + 1}</td>
                      <td className="nowrap">
                        <strong>{item.label}</strong>
                        <div className="muted mono mt-1">{item.key}</div>
                      </td>
                      <td>{item.requirement}</td>
                      <td className="muted">{item.check}</td>
                      <td className="nowrap muted mono">{item.spec_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sub-title mt-3">§26 九种主播输出</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>输出</th>
                    <th>要求</th>
                    <th>来源</th>
                    <th>规格</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.outputs.map((item, index) => (
                    <tr key={item.key}>
                      <td className="nowrap muted">{index + 1}</td>
                      <td className="nowrap">
                        <strong>{item.label}</strong>
                        <div className="muted mono mt-1">{item.key}</div>
                      </td>
                      <td className="muted">{item.requirement}</td>
                      <td className="nowrap muted">{item.source}</td>
                      <td className="nowrap muted mono">{item.spec_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid-2 mt-3">
              <div>
                <div className="sub-title">§33 价值重点八项</div>
                <div className="chip-list">
                  {VALUE_FOCUS_ORDER.map((key) => (
                    <Pill key={key} tone="outline">
                      {valueFocusLabel(key, labels)}
                    </Pill>
                  ))}
                </div>
                <p className="muted mt-2">
                  默认全选（{contract.default_value_focus.length} 项），主推时可只勾本次要放大的价值；勾选只影响
                  §33 呈现重心，不改变事实口径。
                </p>
                <div className="sub-title mt-3">§27 三分钟八段</div>
                <ul className="muted">
                  {contract.min3_timeline.map((segment) => (
                    <li key={segment.key}>
                      <span className="mono">{segment.time_range}</span> · {segment.label}：
                      {segment.requirement}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="sub-title">§22 无锚点标准句（逐字使用，不得改写）</div>
                <p className="quote">{contract.no_anchor_standard_sentence}</p>
                <div className="sub-title mt-3">§7 牛逼化按钮映射</div>
                <ul className="muted">
                  {contract.intensify_button.levels.map((level) => (
                    <li key={level.level}>
                      <strong>{level.label}</strong>（{level.level}）→ Level {level.copy_intensity} 档：
                      {level.note}
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  最多自动增强 {contract.intensify_button.max_auto_rounds} 轮；
                  {contract.intensify_button.note}
                </p>
                <p className="muted">
                  §48 八项自检（开头 3 秒抓人 / 身份拉满 / 价值高度拉满 / 产品结构讲清楚 / 短视频金句密度 /
                  记忆点立得住 / 成交推进收口 / 说明书味太重）缺一项都不算达标；Level 4 门槛 85 分、Level 5 门槛 90 分，
                  第三轮之后必须人工处理，不造假也不压分。
                </p>
              </div>
            </div>

            <Alert tone="warn">
              {SALES_COPY_OUTPUT_ORDER.length} 种输出缺一不可、八项评分合计{" "}
              {contract.impact_score.max} 分：缺输出或分数不达标就不得当成品用；
              {outputLabel("core_quotes", labels)}不足 {contract.limits.coreQuoteCount} 句同样不算完成。
            </Alert>
          </>
        ) : (
          <p className="muted">正在读取话术字典…</p>
        )}
      </Card>
    </section>
  );
}
