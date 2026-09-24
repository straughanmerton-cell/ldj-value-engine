import { useState, type ReactElement } from "react";
import {
  VALUE_CODE_STATUS_ORDER,
  countOf,
  statusLabel,
  statusShortLabel,
  statusTone,
  type ValueCodeCounts,
  type ValueCodeItem,
  type ValueCodeLabels,
  type ValueCodeProfileView
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { EmptyState, LoadingState, Pill } from "../ui/State.js";

export interface ValueCodeMatrixTableProps {
  profile: ValueCodeProfileView | null;
  labels: ValueCodeLabels | null;
  loading: boolean;
}

type StatusFilter = "ALL" | (typeof VALUE_CODE_STATUS_ORDER)[number];

/**
 * 本产品价值拆解矩阵（规格 §18 / §19 / §11）。
 *
 * 每一行就是一个 Code 在这款茶上的落位：状态、引用了哪些已录入事实、能说什么、
 * 还缺什么。三种行必须能一眼区分——
 * 已具备（可以说）、单点事实（先补再放大）、未录入 / 不具备（不得书写）。
 */
export function ValueCodeMatrixTable({
  profile,
  labels,
  loading
}: ValueCodeMatrixTableProps): ReactElement {
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [keyword, setKeyword] = useState("");

  if (loading && !profile) {
    return (
      <Card title="16 个 Value Code 的落位" spec="§18 / §19">
        <LoadingState label="正在读取价值映射" />
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card title="16 个 Value Code 的落位" spec="§18 / §19">
        <EmptyState
          title="还没有生成价值映射"
          description="生成一版之后，这里会按 §18 的固定顺序列出每个 Code 的状态、证据与缺口。"
        />
      </Card>
    );
  }

  const counts: ValueCodeCounts = profile.code_counts;
  const trimmed = keyword.trim();
  const visible = profile.codes.filter((item) => {
    if (filter !== "ALL" && item.status !== filter) {
      return false;
    }
    if (!trimmed) {
      return true;
    }
    return [item.label, item.code, item.statement ?? "", item.gap ?? "", ...item.evidence].some(
      (value) => value.includes(trimmed)
    );
  });

  return (
    <Card
      title="16 个 Value Code 的落位"
      spec="§18 / §19"
      subtitle="顺序由 §18 固定；未录入一律写「未录入（不得书写）」，不具备必须写清是哪条事实排除了它。"
      actions={<Pill tone="neutral">v{profile.version}</Pill>}
    >
      <div className="metric-grid">
        {VALUE_CODE_STATUS_ORDER.map((status) => (
          <div className="metric" key={status}>
            <div className="metric-label">{statusShortLabel(status, labels)}</div>
            <div className="metric-value">{countOf(counts, status)}</div>
            <div className="metric-hint">{statusLabel(status, labels)}</div>
          </div>
        ))}
      </div>

      <div className="filter-bar mt-3">
        <label>
          <span className="muted">状态</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">全部（{profile.codes.length}）</option>
            {VALUE_CODE_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status, labels)}（{countOf(counts, status)}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted">关键词</span>
          <input
            type="search"
            value={keyword}
            placeholder="Code / 证据 / 缺口"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="ghost sm"
          onClick={() => {
            setFilter("ALL");
            setKeyword("");
          }}
        >
          重置
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="没有符合条件的 Code" description="换个状态或关键词再看。" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>Value Code</th>
                <th>状态</th>
                <th>本产品证据（只来自本产品）</th>
                <th>可说的表达</th>
                <th>缺口 / 限制</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <MatrixRow
                  key={item.code}
                  item={item}
                  ordinal={profile.codes.indexOf(item) + 1}
                  labels={labels}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted mt-2">
        共 {profile.codes.length} 个 Code，当前筛选出 {visible.length} 个。
        演示口径：只有「已具备」可以直接进入价值叙事与成交表达，单点事实必须补齐后才允许放大。
      </p>
    </Card>
  );
}

function MatrixRow({
  item,
  ordinal,
  labels
}: {
  item: ValueCodeItem;
  ordinal: number;
  labels: ValueCodeLabels | null;
}): ReactElement {
  return (
    <tr>
      <td className="nowrap muted">C{String(ordinal).padStart(2, "0")}</td>
      <td className="nowrap">
        <strong>{item.label}</strong>
        <div className="muted mono mt-1">{item.code}</div>
      </td>
      <td className="nowrap">
        <Pill tone={statusTone(item.status, labels)}>{statusShortLabel(item.status, labels)}</Pill>
        <div className="muted mt-1">{item.status_reason}</div>
      </td>
      <td>
        {item.evidence.length === 0 ? (
          <span className="muted">无可用事实</span>
        ) : (
          <div className="chip-list">
            {item.evidence.map((entry) => (
              <span className="chip derived mono" key={entry}>
                {entry}
              </span>
            ))}
          </div>
        )}
      </td>
      <td>
        {item.statement ? (
          <div className="quote">{item.statement}</div>
        ) : (
          <span className="muted">未录入事实，不得书写</span>
        )}
        <div className="muted mt-1">{item.contribution}</div>
      </td>
      <td className="muted">
        {item.gap ?? "—"}
        {item.safe_expression ? (
          <div className="mt-1">
            <Pill tone="info">§19 安全句式：{item.safe_expression}</Pill>
          </div>
        ) : null}
      </td>
    </tr>
  );
}
