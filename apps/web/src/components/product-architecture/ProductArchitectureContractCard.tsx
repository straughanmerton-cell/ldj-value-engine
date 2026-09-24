import type { ReactElement } from "react";
import type {
  ProductArchitectureContract,
  ProductArchitectureDownstreamItem,
  ProductArchitectureEngineInfo
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface ProductArchitectureContractCardProps {
  contract: ProductArchitectureContract | null;
  engine: ProductArchitectureEngineInfo | null;
  downstream: ProductArchitectureDownstreamItem[];
  loading: boolean;
  error: string | null;
  /** 默认展开：口径是这个模块的必读内容，不是补充说明。 */
  open: boolean;
  onToggle: () => void;
}

/**
 * 产品结构合同卡（规格 §5 / §45 / §57）。
 *
 * 研究员必须先看懂四件事，才谈得上看结果：
 * 1. 九个角色与顺序是固定的，不允许增删或重排；
 * 2. §45 的 8 个问题必须逐条落到角色上（尾韵是后半程的延伸，不单独设字段）；
 * 3. §57 验收要求结构能回答「谁负责骨架／香气／汤感／回甘／记忆点」；
 * 4. §45 明文不允许增加任何原料或配方事实——角色文案只能引用本产品已录入字段。
 */
export function ProductArchitectureContractCard({
  contract,
  engine,
  downstream,
  loading,
  error,
  open,
  onToggle
}: ProductArchitectureContractCardProps): ReactElement {
  const roleCount = contract?.roles.length ?? engine?.role_count ?? 9;
  const acceptanceKeys = contract?.acceptance.required_keys ?? engine?.acceptance_required_keys ?? [];

  return (
    <Card
      title="产品结构合同"
      spec="§5 / §45"
      subtitle="这张表决定「这款茶的每一部分各自在干什么」怎么被写出来，前端不另写一套口径。"
      actions={
        <>
          <Pill tone="neutral">{roleCount} 个角色</Pill>
          <Pill tone="neutral">§45 {contract?.agent7_questions.length ?? 8} 问</Pill>
          <button type="button" className="secondary sm" onClick={onToggle}>
            {open ? "收起合同" : "展开合同"}
          </button>
        </>
      }
    >
      {loading && !contract ? <LoadingState label="正在读取产品结构合同" /> : null}
      {error && !contract ? <ErrorState title="合同读取失败" description={error} /> : null}

      {contract ? (
        <>
          <div className="alert info">
            §45 明文：<strong>不允许增加任何原料或配方事实</strong>。角色文案只能引用本产品已录入字段与
            Value DNA；没录入的部分留空并写缺口，不允许用形容词把结构补圆（§11 / §62-7）。
          </div>

          {!open ? (
            <p className="muted mt-2">
              展开后可查看九个角色的定义与所需事实、§45 八问映射、§57 验收口径、7 条规则与下游 Phase 交接关系。
            </p>
          ) : (
            <>
              <div className="sub-title mt-3">九个角色与所需事实（§5 顺序固定）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>角色</th>
                      <th>它要回答什么</th>
                      <th>这个角色在说什么</th>
                      <th>至少要有哪些已录入事实</th>
                      <th>允许引用的字段</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.roles.map((role) => (
                      <tr key={role.key}>
                        <td className="nowrap">
                          <strong>{role.label}</strong>
                          <div className="muted mono mt-1">{role.key}</div>
                          {role.acceptance_required ? <Pill tone="brand">§57 必答</Pill> : null}
                        </td>
                        <td>{role.question}</td>
                        <td className="muted">{role.definition}</td>
                        <td>{role.requirement}</td>
                        <td>
                          {role.evidence_refs.length === 0 ? (
                            <span className="muted">由其它角色推导</span>
                          ) : (
                            <div className="chip-list">
                              {role.evidence_refs.map((ref) => (
                                <span className="chip derived mono" key={ref}>
                                  {ref}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">§45 Agent 7 的 8 个问题</div>
              <ol>
                {contract.agent7_questions.map((item) => (
                  <li key={`${item.order}-${item.question}`} className="muted">
                    {item.question}
                    <span className="muted">（落到 {item.role}）</span>
                    {item.note ? <span className="muted">｜{item.note}</span> : null}
                  </li>
                ))}
              </ol>

              <div className="sub-title mt-4">§57 验收口径</div>
              <p className="muted">{contract.acceptance.question}</p>
              <div className="chip-list">
                {acceptanceKeys.map((key) => (
                  <span className="chip" key={key}>
                    {contract.roles.find((role) => role.key === key)?.short_label ?? key}
                  </span>
                ))}
              </div>

              <div className="sub-title mt-4">红线（缺一条都不算交付）</div>
              <div className="chip-list">
                <span className="chip">
                  不新增原料或配方事实：{contract.no_new_facts ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  不虚构研发关系 / 比例 / 树龄山头年份 / 获奖大师：
                  {contract.no_fabricated_relation ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  事实不足留空写缺口：{contract.gap_stays_empty ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  证据只来自本产品：{contract.evidence_only_from_own_product ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  修辞只说结构分工：
                  {contract.rhetoric_allowed_for_structure_only ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  输出是结构叙事而非参数罗列：
                  {contract.structure_not_parameter_list ? "已开启" : "未开启"}
                </span>
              </div>

              <div className="sub-title mt-4">七条规则</div>
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
                  "没有录入的部分一律留空并写缺口；产品结构不代写配方哲学与成交文案（§60）。"}
              </Alert>
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}
