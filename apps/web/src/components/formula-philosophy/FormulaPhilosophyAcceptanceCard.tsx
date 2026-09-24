import type { ReactElement } from "react";
import {
  FORMULA_COMPONENT_ORDER,
  componentLabel,
  componentStatusLabel,
  ratioSourceLabel,
  type FormulaPhilosophyLabels,
  type FormulaPhilosophyRecordView
} from "../../lib/formula-philosophy.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface FormulaPhilosophyAcceptanceCardProps {
  record: FormulaPhilosophyRecordView | null;
  labels: FormulaPhilosophyLabels | null;
}

/**
 * §57 验收卡：配方哲学必须能回答「没有具体配方比例时，不编比例且仍然写得出设计逻辑」。
 *
 * 三个机械条件缺一不可，界面逐条标出：
 * 1. 设计逻辑成稿——没有比例也要说得清「谁承担什么任务」；
 * 2. 无确认比例时正文里一个比例字样都没有——连抄进来的都不算；
 * 3. 写实分量达到 §6.2 的下限。
 *
 * 五个分量的覆盖度单独记账：它不参与 §57 通过判定，但决定这款茶能讲到多细。
 */
export function FormulaPhilosophyAcceptanceCard({
  record,
  labels
}: FormulaPhilosophyAcceptanceCardProps): ReactElement {
  const acceptance = record?.acceptance ?? null;

  return (
    <Card
      title="§57 验收：没有比例时的设计逻辑"
      spec="§57"
      subtitle="配方哲学不是「有没有配方表」，而是没有比例时能不能把设计逻辑讲清楚。"
      actions={
        acceptance ? (
          <Pill tone={acceptance.passed ? "ok" : "danger"}>
            {acceptance.passed ? "验收通过" : "验收未通过"}
          </Pill>
        ) : (
          <Pill tone="neutral">尚未生成</Pill>
        )
      }
    >
      {!acceptance ? (
        <EmptyState
          title="还没有生成配方哲学"
          description="生成之后这里会逐条标出 §57 的三个机械条件、五个分量的覆盖度与比例口径。"
        />
      ) : (
        <>
          <p className="muted">{acceptance.question}</p>

          <div className="table-wrap mt-3">
            <table>
              <thead>
                <tr>
                  <th>§57 条件</th>
                  <th>判定口径</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="nowrap">设计逻辑成稿</td>
                  <td className="muted">
                    写实分量不少于 {acceptance.required_min_components} 个，且 formula_strategy 非空
                  </td>
                  <td className="nowrap">
                    <Pill tone={acceptance.design_logic_ready ? "ok" : "danger"}>
                      {acceptance.design_logic_ready ? "成稿" : "未成稿"}
                    </Pill>
                  </td>
                </tr>
                <tr>
                  <td className="nowrap">不编比例</td>
                  <td className="muted">
                    未确认比例时，正文与成交层解释里不得出现任何比例字样（§6.1）
                  </td>
                  <td className="nowrap">
                    <Pill tone={acceptance.no_fabricated_ratio ? "ok" : "danger"}>
                      {acceptance.no_fabricated_ratio ? "干净" : "出现了比例字样"}
                    </Pill>
                  </td>
                </tr>
                <tr>
                  <td className="nowrap">写实分量下限</td>
                  <td className="muted">
                    当前写实 {acceptance.written_components} / 至少 {acceptance.required_min_components} 个
                  </td>
                  <td className="nowrap">
                    <Pill
                      tone={
                        acceptance.written_components >= acceptance.required_min_components
                          ? "ok"
                          : "danger"
                      }
                    >
                      {acceptance.written_components >= acceptance.required_min_components
                        ? "达到下限"
                        : "不足下限"}
                    </Pill>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="sub-title mt-3">五个分量的覆盖度（§6.3，不参与 §57 通过判定）</div>
          <div className="chip-list">
            {FORMULA_COMPONENT_ORDER.map((key) => {
              const component = record?.components.find((item) => item.key === key) ?? null;
              return (
                <span
                  className="chip"
                  key={key}
                  title={component ? componentStatusLabel(component.status, labels) : "未生成"}
                >
                  {component?.label ?? componentLabel(key, labels)}
                  <span className="muted">
                    {" "}
                    {component ? componentStatusLabel(component.status, labels) : "未生成"}
                  </span>
                </span>
              );
            })}
          </div>
          <p className="muted mt-1">
            {acceptance.coverage_passed
              ? "五个分量全部写实：这一版可以讲到骨架 / 香气 / 回甘 / 汤感 / 收口的每一层。"
              : "仍有分量留空：覆盖度不影响 §57 通过，但下游话术在这些层上会留缺口。"}
          </p>

          <div className="sub-title mt-3">比例口径（§6.1）</div>
          {record?.ratio.known_ratio ? (
            <p className="muted">
              已确认比例，来源：{ratioSourceLabel(record.ratio.ratio_source)}；逐字证据{" "}
              {record.ratio.ratio_evidence.length} 条。已知比例可以使用，但不得与未知比例混用。
            </p>
          ) : (
            <p className="muted">
              未确认配方比例：本版一律不出现比例，仍然输出设计逻辑——这正是 §57 要验的那件事。
            </p>
          )}
        </>
      )}
    </Card>
  );
}
