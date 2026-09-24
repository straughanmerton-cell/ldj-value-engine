import { useState, type ReactElement } from "react";
import {
  FORMULA_COMPONENT_ORDER,
  componentShortLabel,
  componentStatusLabel,
  componentStatusTone,
  ratioSourceLabel,
  type FormulaComponentKey,
  type FormulaComponentView,
  type FormulaPhilosophyLabels,
  type FormulaPhilosophyRecordView
} from "../../lib/formula-philosophy.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface FormulaPhilosophyComponentBoardProps {
  record: FormulaPhilosophyRecordView | null;
  labels: FormulaPhilosophyLabels | null;
  loading: boolean;
}

/**
 * 五个分量板（规格 §6.2 / §6.3 / §46）。
 *
 * 这是本模块的主视图：**每一张卡就是一个分量**，写实了就展示正文与它引用的字段，
 * 没写实就展示缺口与「要写实它至少需要哪些事实」。
 * 界面刻意不提供「补一句形容词」的入口：缺口只能靠补录事实来关掉（§11 / §62-7）。
 *
 * 往下一层是 §46 的两张角色表：`ingredient_roles`（原料 / 山头 / 用料承担什么）
 * 与 `taste_roles`（香气 / 回甘 / 汤感 / 收口落在哪一层）——两者都是从五个分量推导的，不是另写的口径。
 */
export function FormulaPhilosophyComponentBoard({
  record,
  labels,
  loading
}: FormulaPhilosophyComponentBoardProps): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const componentByKey = new Map<FormulaComponentKey, FormulaComponentView>(
    (record?.components ?? []).map((component) => [component.key, component])
  );
  const ordered = FORMULA_COMPONENT_ORDER.map((key) => componentByKey.get(key)).filter(
    (component): component is FormulaComponentView => component !== undefined
  );

  function toggle(key: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const ratioEntries =
    record && record.ratio.known_ratio ? Object.entries(record.ratio.ratio_data ?? {}) : [];

  return (
    <Card
      title="五个分量（每一部分各自承担什么任务）"
      spec="§6.3 / §46"
      subtitle="骨架 / 香气 / 回甘 / 汤感 / 收口——顺序由 §6.3 固定，缺事实的分量留空；没有比例时仍然要写出设计逻辑（§6.2）。"
      actions={
        record ? (
          <>
            <Pill tone="ok">已写实 {record.component_counts.written}</Pill>
            <Pill tone={record.component_counts.gap > 0 ? "danger" : "ok"}>
              留空 {record.component_counts.gap}
            </Pill>
          </>
        ) : (
          <Pill tone="neutral">尚未生成</Pill>
        )
      }
    >
      {!record ? (
        <EmptyState
          title={loading ? "正在读取配方哲学…" : "还没有生成配方哲学"}
          description="生成一版之后，这里会按 §6.3 的五个分量逐个展开：谁承担骨架、谁负责香气身份、谁负责回甘与收口……"
        />
      ) : (
        <>
          <div className="grid-3">
            {ordered.map((component) => {
              const isOpen = expanded.has(component.key);
              return (
                <div className="card" key={component.key}>
                  <header className="card-head">
                    <h3>
                      {component.label}
                      <span className="spec">{component.spec_ref}</span>
                    </h3>
                    <div className="card-actions">
                      <Pill tone={componentStatusTone(component.status, labels)}>
                        {componentStatusLabel(component.status, labels)}
                      </Pill>
                    </div>
                  </header>
                  <p className="muted">{component.definition}</p>
                  <p className="muted mt-1">
                    §46 输出：<span className="mono">{component.agent8_output}</span>　｜　存储：
                    <span className="mono"> {component.storage_field}</span>
                  </p>

                  {component.status === "WRITTEN" ? (
                    <>
                      {component.texts.map((text) => (
                        <p className="quote mt-2" key={text}>
                          {text}
                        </p>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="muted mt-2">
                        这一层现在还不能写：没有取到可用事实，按 §11 / §62-7 留空，不用形容词补圆。
                      </p>
                      {component.gap ? <div className="alert warn mt-2">{component.gap}</div> : null}
                    </>
                  )}

                  <p className="muted mt-2">写实它至少需要：{component.requirement}</p>

                  {component.status === "WRITTEN" ? (
                    <>
                      <div className="row between mt-2">
                        <span className="muted">
                          引用字段 {component.evidence_refs.length} · 事实原文{" "}
                          {component.citations.length}
                        </span>
                        <button
                          type="button"
                          className="ghost sm"
                          onClick={() => toggle(component.key)}
                        >
                          {isOpen ? "收起引用" : "查看引用"}
                        </button>
                      </div>
                      {isOpen ? (
                        <>
                          <div className="sub-title mt-2">证据字段</div>
                          <div className="chip-list">
                            {component.evidence_refs.map((ref) => (
                              <span className="chip derived mono" key={ref}>
                                {ref}
                              </span>
                            ))}
                          </div>
                          <div className="sub-title mt-3">已录入事实原文（逐字比对）</div>
                          {component.citations.length === 0 ? (
                            <p className="muted">引用了字段但没有可逐字比对的事实原文。</p>
                          ) : (
                            <ul>
                              {component.citations.map((citation) => (
                                <li key={citation} className="muted mono">
                                  {citation}
                                </li>
                              ))}
                            </ul>
                          )}
                        </>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="sub-title mt-4">设计逻辑（§46 formula_strategy，本阶段的核心交付）</div>
          {record.formula_strategy ? (
            <p className="quote">{record.formula_strategy}</p>
          ) : (
            <p className="muted">
              还没有设计逻辑：§6.2 要求至少 {record.acceptance.required_min_components} 个分量写实，才谈得上
              「不是把料混起来，而是让每一类原料承担自己的任务」。当前写实{" "}
              {record.component_counts.written} 个，不足时这一栏必须留空——不硬写。
            </p>
          )}

          <div className="grid-2 mt-3">
            <div>
              <div className="sub-title">设计目标（§6.2 design_goal）</div>
              <p className="muted">{record.design_goal || "设计逻辑未成稿时不输出设计目标。"}</p>
            </div>
            <div>
              <div className="sub-title">成交层解释（§46 sales_explanation / RHETORIC）</div>
              <p className="muted">
                {record.sales_explanation || "尚未生成成交层解释：本阶段只交付设计逻辑，不代写成交文案（§60）。"}
              </p>
            </div>
          </div>

          <div className="sub-title mt-4">配方比例（§6.1）</div>
          {record.ratio.known_ratio ? (
            <>
              <div className="chip-list">
                {ratioEntries.map(([name, value]) => (
                  <span className="chip" key={name}>
                    {name} {value}
                  </span>
                ))}
              </div>
              <p className="muted mt-1">
                来源：{ratioSourceLabel(record.ratio.ratio_source)}　｜　逐字证据：
                {record.ratio.ratio_evidence.length} 条
              </p>
              {record.ratio.ratio_evidence.length > 0 ? (
                <ul>
                  {record.ratio.ratio_evidence.map((evidence) => (
                    <li key={evidence} className="muted mono">
                      {evidence}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="muted">
              未确认配方比例：本版正文与设计逻辑一律不出现比例，比例只能来自已录入事实或人工登记，绝不自动编（§6.1）。
            </p>
          )}

          <div className="sub-title mt-4">§46 ingredient_roles：原料 / 山头 / 用料承担什么</div>
          {record.ingredient_roles.length === 0 ? (
            <p className="muted">没有可归入原料层的引用：写实分量里没有取到产地或用料事实。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>原料 / 山头 / 用料</th>
                    <th>承担什么</th>
                    <th>落在哪个分量</th>
                    <th>逐字证据字段</th>
                  </tr>
                </thead>
                <tbody>
                  {record.ingredient_roles.map((role) => (
                    <tr key={`${role.component}-${role.evidence_ref}-${role.ingredient}`}>
                      <td>{role.ingredient}</td>
                      <td>{role.role}</td>
                      <td className="nowrap">{componentShortLabel(role.component, labels)}</td>
                      <td className="nowrap muted mono">{role.evidence_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="sub-title mt-4">§46 taste_roles：感官表现落在哪一层</div>
          {record.taste_roles.length === 0 ? (
            <p className="muted">没有可归入滋味层的引用：写实分量里没有取到感官事实。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>感官表现</th>
                    <th>落在哪一层</th>
                    <th>对应分量</th>
                    <th>逐字证据字段</th>
                  </tr>
                </thead>
                <tbody>
                  {record.taste_roles.map((role) => (
                    <tr key={`${role.component}-${role.evidence_ref}-${role.taste}`}>
                      <td>{role.taste}</td>
                      <td>{role.role}</td>
                      <td className="nowrap">{componentShortLabel(role.component, labels)}</td>
                      <td className="nowrap muted mono">{role.evidence_ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
