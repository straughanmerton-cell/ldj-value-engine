import type { ReactElement } from "react";
import type {
  ValueCodeContract,
  ValueCodeDownstreamItem,
  ValueCodeEngineInfo
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface ValueCodesContractCardProps {
  contract: ValueCodeContract | null;
  engine: ValueCodeEngineInfo | null;
  downstream: ValueCodeDownstreamItem[];
  loading: boolean;
  error: string | null;
  /** 默认展开：口径是这个模块的必读内容，不是补充说明。 */
  open: boolean;
  onToggle: () => void;
}

/**
 * 价值映射合同卡（规格 §18 / §19 / §20 / §44）。
 *
 * 研究员必须先看懂四件事，才谈得上看结果：
 * 1. 16 个 Code 与顺序是固定的，不允许增删或重排；
 * 2. 状态只有五种：已具备 / 单点事实 / 时间依赖 / 不具备 / 未录入；
 * 3. 时间依赖型的成交表达只有一句安全句式，禁止承诺未来（§19）；
 * 4. 对标只提供「高价值产品的底层条件」这一层标准，竞品事实不得移植（§44）。
 */
export function ValueCodesContractCard({
  contract,
  engine,
  downstream,
  loading,
  error,
  open,
  onToggle
}: ValueCodesContractCardProps): ReactElement {
  const codeCount = contract?.codes.length ?? engine?.code_count ?? 16;

  return (
    <Card
      title="价值映射合同"
      spec="§18 / §19 / §20"
      subtitle="这张表决定「这款茶靠哪些底层条件贵得起」怎么被判定，前端不另写一套口径。"
      actions={
        <>
          <Pill tone="neutral">{codeCount} 个 Value Code</Pill>
          <Pill tone="neutral">{contract?.statuses.length ?? 5} 种状态</Pill>
          <button type="button" className="secondary sm" onClick={onToggle}>
            {open ? "收起合同" : "展开合同"}
          </button>
        </>
      }
    >
      {loading && !contract ? <LoadingState label="正在读取价值映射合同" /> : null}
      {error && !contract ? <ErrorState title="合同读取失败" description={error} /> : null}

      {contract ? (
        <>
          <div className="alert info">
            时间依赖型 Code（陈化 / 收藏 / 流通）的成交层表达只能是固定安全句式
            <strong>「{contract.time_dependent_safe_expression}」</strong>，
            不得写成「{contract.time_dependent_forbidden_expression}」（§19）。
          </div>

          {!open ? (
            <p className="muted mt-2">
              展开后可查看五种状态的判定规则、7 条红线、六类价值故事与下游 Phase 交接关系。
            </p>
          ) : (
            <>
              <div className="sub-title mt-3">五种状态的判定口径（§19）</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>状态</th>
                      <th>含义</th>
                      <th>使用规则</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.statuses.map((item) => (
                      <tr key={item.status}>
                        <td className="nowrap">
                          <Pill tone={item.tone}>{item.label}</Pill>
                          <div className="muted mono mt-1">{item.status}</div>
                        </td>
                        <td>{item.meaning}</td>
                        <td className="muted">{item.rule}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sub-title mt-4">红线（缺一条都不算交付）</div>
              <div className="chip-list">
                <span className="chip">
                  竞品事实不移植：{contract.no_competitor_fact_transplant ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  时间依赖不承诺未来：
                  {contract.time_dependent_not_promise ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  未录入一律 UNKNOWN：
                  {contract.unknown_is_written_as_unknown ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  不具备必须指到事实：
                  {contract.not_have_requires_recorded_fact ? "已开启" : "未开启"}
                </span>
                <span className="chip">
                  证据只来自本产品：
                  {contract.evidence_only_from_own_product ? "已开启" : "未开启"}
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

              <div className="sub-title mt-4">六类价值故事（§20）</div>
              <div className="chip-list">
                {contract.stories.map((story) => (
                  <span className="chip" key={story.key}>
                    {story.label}
                  </span>
                ))}
              </div>

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
                  "没有录入的事实一律 UNKNOWN，不会替它把故事讲圆；本阶段不生成成交文案。"}
              </Alert>
            </>
          )}
        </>
      ) : null}
    </Card>
  );
}
