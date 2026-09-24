import { useCallback, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DeliveryContractCard } from "../components/delivery/DeliveryContractCard.js";
import { HostCenterMatrixTable } from "../components/delivery/HostCenterMatrixTable.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { Pill } from "../components/ui/State.js";
import { useAuth } from "../lib/auth.js";
import {
  DELIVERY_GATE_STATE_FALLBACK,
  DELIVERY_GATE_STATE_ORDER,
  exportFormatLabel,
  exportScopeLabel,
  gateStateIndex,
  useDeliveryContract,
  useDeliveryLabels,
  useHostCenterList,
  type DeliveryExportFormat,
  type DeliveryExportScope,
  type DeliveryGateStateKey,
  type HostCenterQuery
} from "../lib/delivery.js";

const READY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "全部产品" },
  { value: "true", label: "只看今天能上播的（可交付）" },
  { value: "false", label: "只看被卡住的（不可交付）" }
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];

const EXPORT_FORMATS: DeliveryExportFormat[] = ["MARKDOWN", "TEXT"];
const EXPORT_SCOPES: DeliveryExportScope[] = ["HOST", "DEALER", "ALL"];

/** 三态筛选必须显式分支：`?ready=false` 是「只看反面」，不是「不筛」（§62-14）。 */
function parseReady(value: string | null): boolean | null {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

/**
 * 主播中心（规格 §31 一级导航 / §51 主播中心十项 / §60 导出）。
 *
 * 运营每天打开这一页只问一个问题：**今天哪几款茶能上播**。所以页面结构固定为四段：
 * 排产表（谁可交付、谁卡住了）→ 交付层合同（口径从哪来）→ 状态字典（六态怎么读）→ 导出说明。
 * 具体的十项正文不在这里摊开——那是产品详情「最终资料」Tab 的事，避免两处各讲一套（§62-14）。
 */
export function HostCenterPage(): ReactElement {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [keyword, setKeyword] = useState(searchParams.get("q") ?? "");
  const [readyFilter, setReadyFilter] = useState(searchParams.get("ready") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1") || 1);
  const [pageSize, setPageSize] = useState(Number(searchParams.get("pageSize") ?? "20") || 20);
  const [contractOpen, setContractOpen] = useState(false);

  const {
    contract,
    downstream,
    limits,
    loading: contractLoading,
    error: contractError
  } = useDeliveryContract(token);
  const { labels, error: labelsError } = useDeliveryLabels(token);

  const query: HostCenterQuery = {
    page,
    pageSize,
    q: keyword.trim(),
    ready: parseReady(readyFilter)
  };
  const { data, loading, error, reload } = useHostCenterList(token, query);

  /** 筛选条件进 URL：把「今天这个视角」直接发给同事复核。 */
  const syncParams = useCallback(
    (next: { q: string; ready: string; page: number; pageSize: number }) => {
      const params = new URLSearchParams();
      if (next.q.trim()) {
        params.set("q", next.q.trim());
      }
      if (next.ready) {
        params.set("ready", next.ready);
      }
      if (next.page > 1) {
        params.set("page", String(next.page));
      }
      if (next.pageSize !== 20) {
        params.set("pageSize", String(next.pageSize));
      }
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  function apply(next: { q?: string; ready?: string; pageSize?: number }): void {
    const nextKeyword = next.q ?? keyword;
    const nextReady = next.ready ?? readyFilter;
    const nextPageSize = next.pageSize ?? pageSize;
    setKeyword(nextKeyword);
    setReadyFilter(nextReady);
    setPageSize(nextPageSize);
    setPage(1);
    syncParams({ q: nextKeyword, ready: nextReady, page: 1, pageSize: nextPageSize });
  }

  function changePage(nextPage: number): void {
    setPage(nextPage);
    syncParams({ q: keyword, ready: readyFilter, page: nextPage, pageSize });
  }

  function reset(): void {
    setKeyword("");
    setReadyFilter("");
    setPageSize(20);
    setPage(1);
    setSearchParams(new URLSearchParams(), { replace: true });
  }

  const items = data?.items ?? [];
  const readyCount = items.filter((row) => row.ready).length;
  const blockedCount = items.length - readyCount;
  const activeFilterCount = (keyword.trim() ? 1 : 0) + (readyFilter ? 1 : 0);

  return (
    <section>
      <PageHeader
        title="主播中心"
        subtitle="主播拿起来就能讲：今天必讲 3 点、一句话定位、60 秒稿、3 分钟稿、5 句金句与异议回答。可交付永远只认「最新一版成稿 + 这一版自己的审核」。"
        actions={
          <>
            <Pill tone="ok">Phase 15 已交付：主播中心与导出</Pill>
            <Pill tone={contract?.publish_gate.requires_approved === false ? "danger" : "ok"}>
              必须已人工审批
            </Pill>
            <Pill tone="ok">RED 阻断句一律不得发布</Pill>
          </>
        }
      />

      <Card
        title="筛选"
        spec="§31 / §51"
        subtitle="口径与后端列表完全一致：搜索产品名，按「今天能不能上播」三态筛选；可交付的排在前面。"
        actions={
          <>
            {activeFilterCount > 0 ? <Pill tone="info">已启用 {activeFilterCount} 个筛选</Pill> : null}
            {labelsError ? <Pill tone="warn">状态文案读取失败，已用基线兜底文案</Pill> : null}
          </>
        }
      >
        <div className="filter-bar">
          <label>
            关键词
            <input
              placeholder="产品名"
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
            交付状态
            <select value={readyFilter} onChange={(event) => apply({ ready: event.target.value })}>
              {READY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            每页条数
            <select
              value={String(pageSize)}
              onChange={(event) => apply({ pageSize: Number(event.target.value) })}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={String(size)}>
                  {size} 条
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
          <button type="button" className="secondary" onClick={reload}>
            刷新
          </button>
        </div>

        {items.length > 0 ? (
          <p className="muted mt-3">
            本页 {items.length} 款产品：可交付 {readyCount} 款 · 被卡住 {blockedCount} 款
            {limits ? `　｜　单页最多 ${limits.maxPageSize} 条，单次导出正文上限 ${limits.maxExportChars} 字` : ""}
          </p>
        ) : null}
      </Card>

      <HostCenterMatrixTable
        items={items}
        labels={labels}
        total={data?.total ?? 0}
        page={data?.page ?? page}
        pageSize={data?.pageSize ?? pageSize}
        totalPages={data?.totalPages ?? 1}
        loading={loading}
        error={error}
        onPageChange={changePage}
        onRetry={reload}
      />

      <DeliveryContractCard
        contract={contract}
        downstream={downstream}
        limits={limits}
        loading={contractLoading}
        error={contractError}
        open={contractOpen}
        onToggle={() => setContractOpen((value) => !value)}
      />

      <Card
        title="交付状态字典（六态）"
        spec="§53 / §57 / §62-14"
        subtitle="排产表里的「交付闸门」只有这六种取值，判定条件与「下一步去哪里」由后端给出，前端不另写一套说法。"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>状态</th>
                <th>含义与判定</th>
                <th>下一步</th>
              </tr>
            </thead>
            <tbody>
              {DELIVERY_GATE_STATE_ORDER.map((key: DeliveryGateStateKey, index: number) => {
                const meta = labels?.gate_states[gateStateIndex(key)] ?? null;
                const fallback = DELIVERY_GATE_STATE_FALLBACK[key];
                return (
                  <tr key={key}>
                    <td className="nowrap muted">{index + 1}</td>
                    <td className="nowrap">
                      <Pill tone={meta?.tone ?? fallback.tone}>{meta?.label ?? fallback.label}</Pill>
                      <div className="muted mono mt-1">{key}</div>
                    </td>
                    <td>{meta?.reason ?? fallback.reason ?? "已通过全部闸门，可直接交付。"}</td>
                    <td className="nowrap">
                      {meta?.next_action ?? fallback.next_action ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="导出最终资料包"
        spec="§60 / §62-15"
        subtitle="导出是派生视图：正文逐字来自主播中心 / 经销商中心，只做排版，不新增一个字，并永远标注成稿版本与第几次审核。"
        actions={
          <Link to="/products">
            <button type="button" className="secondary sm">
              去产品中心
            </button>
          </Link>
        }
      >
        <div className="grid-2">
          <div>
            <div className="sub-title">两种格式</div>
            <ul className="rule-list">
              {EXPORT_FORMATS.map((format) => {
                const meta = labels?.export_formats.find((item) => item.key === format) ?? null;
                return (
                  <li key={format}>
                    <strong>{meta?.label ?? exportFormatLabel(format, null)}</strong>
                    {meta ? `（${meta.extension}）` : ""}——{meta?.hint ?? "已由后端合同定义。"}
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <div className="sub-title">三种范围</div>
            <ul className="rule-list">
              {EXPORT_SCOPES.map((scope) => {
                const meta = labels?.export_scopes.find((item) => item.key === scope) ?? null;
                return (
                  <li key={scope}>
                    <strong>{meta?.label ?? exportScopeLabel(scope, null)}</strong>——{meta?.hint ?? "已由后端合同定义。"}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <div className="alert info mt-3">
          闸门未通过时导出接口会直接返回 <span className="mono">409</span>，并把阻断句与下一步一起返回；
          页面会把后端给的拒绝理由原样摆出来，绝不产出「看起来能用其实没审过」的文件（§53 / §57）。
          真正的导出按钮在产品的「最终资料」Tab —— 只要那一版还卡在审核，按钮就是禁用状态。
        </div>
      </Card>
    </section>
  );
}
