import type { ReactElement } from "react";
import type { ValueCodeContract, ValueCodeLabels } from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface ValueCodeDictionaryTableProps {
  contract: ValueCodeContract | null;
  labels: ValueCodeLabels | null;
  loading: boolean;
  error: string | null;
}

/**
 * 16 个 Value Code 的字典（规格 §18 / §44）。
 *
 * 这张表回答的是「Code 本身是什么」，不是「这款茶做到了没有」：
 * `requirement` 是高价值产品形成之前必须凑齐的底层条件，`contribution` 是它对「为什么贵得起」的贡献，
 * `evidence_refs` 是**唯一允许被引用**的本产品字段。顺序与 §18 完全一致，不允许增删或重排。
 */
export function ValueCodeDictionaryTable({
  contract,
  labels,
  loading,
  error
}: ValueCodeDictionaryTableProps): ReactElement {
  const codes = contract?.codes ?? [];
  const timeDependent = codes.filter((item) => item.time_dependent).length;
  const dimensionLabels = labels?.dimension_labels ?? {};
  const dimensionLookup = new Map(
    (contract?.dimensions ?? []).map((item) => [item.dimension, item.label])
  );

  return (
    <Card
      title="Value Code 字典"
      spec="§18 / §44"
      subtitle="16 个 Code 的定义、底层条件与允许引用的证据字段：Code 只回答「高价值需要在哪个位置不将就」，不替任何一款茶下结论。"
      actions={
        <>
          <Pill tone="neutral">共 {codes.length || 16} 个</Pill>
          <Pill tone="info">时间依赖型 {timeDependent} 个</Pill>
        </>
      }
    >
      {loading && codes.length === 0 ? <LoadingState label="正在读取 Code 字典" /> : null}
      {error && codes.length === 0 ? (
        <ErrorState title="Code 字典读取失败" description={error} />
      ) : null}

      {codes.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>Code</th>
                <th>定义（内部分析口径）</th>
                <th>分析维度</th>
                <th>底层条件（§44）</th>
                <th>对「为什么贵得起」的贡献</th>
                <th>允许引用的证据字段</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((item, index) => (
                <tr key={item.code}>
                  <td className="nowrap muted">C{String(index + 1).padStart(2, "0")}</td>
                  <td className="nowrap">
                    <strong>{item.label}</strong>
                    <div className="muted mono mt-1">{item.code}</div>
                    {item.time_dependent ? (
                      <Pill tone="info">时间依赖</Pill>
                    ) : null}
                  </td>
                  <td>{item.definition}</td>
                  <td className="nowrap">
                    {item.dimensions
                      .map(
                        (dimension) =>
                          dimensionLabels[dimension] ?? dimensionLookup.get(dimension) ?? dimension
                      )
                      .join(" / ")}
                  </td>
                  <td className="muted">{item.requirement}</td>
                  <td className="muted">{item.contribution}</td>
                  <td className="mono muted">{item.evidence_refs.join("、")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="muted mt-2">
        时间依赖型 Code 今天不成立，只能写「有没有把未来需要的底子先做好」，不得承诺未来（§19）。
        不具备（NOT_HAVE）必须能指到具体的已录入事实，不是「没录」，而是「已确认不成立」。
      </p>
    </Card>
  );
}
