import type { ReactElement } from "react";
import type {
  FormulaPhilosophyContract,
  FormulaPhilosophyDownstreamItem,
  FormulaPhilosophyEngineInfo
} from "../../lib/formula-philosophy.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface FormulaPhilosophyContractCardProps {
  contract: FormulaPhilosophyContract | null;
  engine: FormulaPhilosophyEngineInfo | null;
  downstream: FormulaPhilosophyDownstreamItem[];
  loading: boolean;
  error: string | null;
  /** 默认展开：口径是这个模块的必读内容，不是补充说明。 */
  open: boolean;
  onToggle: () => void;
}

/**
 * 配方哲学合同卡（规格 §6 / §46 / §57）。
 *
 * 研究员必须先看懂四件事，才谈得上看结果：
 * 1. §6.3 的五个分量与顺序是固定的，不允许增删或重排；
 * 2. §46 Agent 8 必须输出五项，且 ingredient_roles / taste_roles 是由五个分量推导出来的；
 * 3. §57 验收问的是「没有比例时，能不能写出设计逻辑」——不是「有没有配方」；
 * 4. §6.1 明文：没有确切比例绝对不编比例；§46 明文：没有的原料绝对不新增。
 */
export function FormulaPhilosophyContractCard({
  contract,
  engine,
  downstream,
  loading,
  error,
  open,
  onToggle
}: FormulaPhilosophyContractCardProps): ReactElement {
  const componentCount = contract?.components.length ?? engine?.component_count ?? 5;
  const agent8Outputs = contract?.agent8_outputs ?? engine?.agent8_outputs ?? [];

  return (
    <Card
      title="配方哲学合同"
      spec="§6 / §46"
      subtitle="这张表决定「这款茶为什么这么设计」怎么被写出来，前端不另写一套口径。"
      actions={
        <>
          <Pill tone="neutral">{componentCount} 个分量</Pill>
          <Pill tone="neutral">§46 {agent8Outputs.length || 5} 项输出</Pill>
          <button type="button" className="secondary sm" onClick={onToggle}>
            {open ? "收起合同" : "展开合同"}
          </button>
        </>
      }
    >
      {loading && !contract ? <LoadingState label="正在读取配方哲学合同" /> : null}
      {error && !contract ? <ErrorState title="合同读取失败" description={error} /> : null}

      {contract ? (
        <>
          <div className="alert info">
            §6.1 明文：<strong>没有确切比例时绝对不创造比例</strong>；§46 明文：
            <strong>没有的原料绝对不新增</strong>。五个分量的正文只能引用本产品已录入字段与 Value DNA，
            没录入的部分留空并写缺口（§11 / §62-7）。
          </div>

          {!open ? (
            <p className="muted mt-2">
              展开后可查看五个分量的定义与所需事实、§46 Agent 8 的五项输出、§57 验收口径、8 条规则与下游
              Phase 交接关系。
            </p>
          ) : (
            <>
              <div className="sub-title mt-3">五个分量与所需事实（§6.3 顺序固定）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>分量</th>
                      <th>它在说什么</th>
                      <th>至少要有哪些已录入事实</th>
                      <th>喂给 §46 的哪一项</th>
                      <th>允许引用的字段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.components.map((component) => (
                      <tr key={component.key}>
                        <td className="nowrap">
                          <strong>{component.label}</strong>
                          <div className="muted mono mt-1">{component.key}</div>
                          <div className="muted mono">{component.storage_field}</div>
                        </td>
                        <td>{component.definition}</td>
                        <td>{component.requirement}</td>
                        <td className="mono muted">{component.agent8_output}</td>
                        <td>
                          <div className="chip-list">
                            {component.evidence_refs.map((ref) => (
                              <span className="chip derived mono" key={ref}>
                                {ref}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§46 Agent 8 必须输出的五项</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>输出</th>
                      <th>层级</th>
                      <th>它要回答什么</th>
                      <th>落到哪个存储字段</th>
                      <th>规格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent8Outputs.map((output) => (
                      <tr key={output.key}>
                        <td className="nowrap mono">
                          <strong>{output.key}</strong>
                        </td>
                        <td className="nowrap">
                          <Pill tone={output.layer === "RHETORIC" ? "warn" : "info"}>
                            {output.layer}
                          </Pill>
                        </td>
                        <td>{output.meaning}</td>
                        <td className="muted mono">{output.storage}</td>
                        <td className="nowrap muted">{output.spec_ref}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§57 验收口径</div>
              <p className="muted">{contract.acceptance.question}</p>
              <div className="chip-list">
                <span className="chip">
                  设计逻辑成稿至少需要写实 {contract.acceptance.min_written_components} 个分量
                </span>
                <span className="chip">没有比例时正文里不得出现任何比例字样</span>
              </div>

              <div className="sub-title mt-4">红线（缺一条都不算交付）</div>
              <div className="chip-list">
                <span className="chip">
                  不虚构配方比例：{contract.no_fabricated_ratio ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  不新增原料：{contract.no_new_ingredient ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  无比例也能写设计逻辑：
                  {contract.design_logic_without_ratio ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  事实不足留空写缺口：{contract.gap_stays_empty ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  证据只来自本产品：{contract.evidence_only_from_own_product ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  修辞只说分工：{contract.rhetoric_allowed_for_roles_only ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  允许强势成交口吻但不带新事实：
                  {contract.sales_tone_allowed ? "已开启" : "未开启"}
                </span>
              </div>

              <div className="sub-title mt-4">八条规则</div>
              <ol>
                {contract.rules.map((rule) => (
                  <li key={rule} className="muted">
                    {rule}
                  </li>
                ))}
              </ol>

              <div className="sub-title mt-4">下游交接（§60：本阶段只登记，不得显示为已完成）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Phase</th>
                      <th>交付物</th>
                      <th>规格</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {downstream.map((item) => (
                      <tr key={`${item.phase}-${item.deliverable}`}>
                        <td className="nowrap">Phase {item.phase}</td>
                        <td>{item.deliverable}</td>
                        <td className="nowrap muted">{item.spec_ref}</td>
                        <td className="nowrap">
                          <Pill tone="outline">{item.status}</Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {downstream.length === 0 ? (
                <EmptyState title="暂无下游交接记录" description="合同接口未返回下游 Phase 列表。" />
              ) : null}

              <Alert tone="warn">
                {engine?.note ??
                  "没有比例就不写比例、没有原料就不新增原料；配方哲学只交付设计逻辑，不代写成交文案（§60）。"}
              </Alert>
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}
