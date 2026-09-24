import type { ReactElement } from "react";
import type {
  DeliveryContract,
  DeliveryDownstreamItem,
  DeliveryLimits,
  DeliverySlotMeta
} from "../../lib/delivery.js";
import { Card } from "../ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface DeliveryContractCardProps {
  contract: DeliveryContract | null;
  downstream: DeliveryDownstreamItem[];
  limits: DeliveryLimits | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  onToggle: () => void;
}

function SlotList({
  title,
  spec,
  slots
}: {
  title: string;
  spec: string;
  slots: DeliverySlotMeta[];
}): ReactElement {
  return (
    <div>
      <div className="sub-title">
        {title}　<span className="spec">{spec}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>项目</th>
              <th>主播 / 经销商必须拿到什么</th>
              <th>派生来源</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, index) => (
              <tr key={slot.key}>
                <td className="nowrap">{index + 1}</td>
                <td className="nowrap">
                  {slot.label}
                  <div className="muted mono">{slot.key}</div>
                </td>
                <td>{slot.requirement}</td>
                <td className="mono muted">
                  {slot.source}
                  <div>{slot.spec_ref}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 交付层合同卡（规格 §51 / §52 / §53 / §57 / §60）。
 *
 * 这张卡要在动手之前讲清四件事：
 * 1. §51 / §52 两个中心各十项，一项都不能少、顺序不能改，且**每一项都有唯一派生来源**；
 * 2. §53 / §57 发布闸门只有一条：属于当前最新一版成稿 + 这一版已人工审批通过 + 逐句无 RED；
 * 3. §62-15 派生视图：两个中心与导出都不新增表、不改写正文，重新生成只新增版本；
 * 4. §62-5 不移植竞品事实：市场认知与主要锚点只引用价格高度标准。
 */
export function DeliveryContractCard({
  contract,
  downstream,
  limits,
  loading,
  error,
  open,
  onToggle
}: DeliveryContractCardProps): ReactElement {
  const hostSlots = contract?.host_center.slots ?? [];
  const dealerSlots = contract?.dealer_center.slots ?? [];
  const formats = contract?.export.formats ?? [];
  const scopes = contract?.export.scopes ?? [];

  return (
    <Card
      title="交付层合同"
      spec="§51 / §52 / §53 / §57 / §60"
      subtitle="这张表决定「哪一款茶今天能上播、能交到谁手里、交付文件长什么样」，前端不另写一套口径。"
      actions={
        <>
          <Pill tone="neutral">主播 {hostSlots.length || 10} 项</Pill>
          <Pill tone="neutral">经销商 {dealerSlots.length || 10} 项</Pill>
          <Pill tone="neutral">导出 {formats.length || 2} 种格式</Pill>
          <button type="button" className="secondary sm" onClick={onToggle}>
            {open ? "收起合同" : "展开合同"}
          </button>
        </>
      }
    >
      {loading && !contract ? <LoadingState label="正在读取交付层合同" /> : null}
      {error && !contract ? <ErrorState title="合同读取失败" description={error} /> : null}

      {contract ? (
        <>
          <div className="alert info">
            §62-14 / §62-15：交付只有<strong>一条</strong>发布口径——当前最新一版成稿、这一版已人工审批通过、逐句无 RED。
            上一版审批通过不算这一版通过；闸门未通过时十项全空、导出一律拒绝，绝不产出「看起来能用其实没审过」的文件。
          </div>

          {!open ? (
            <p className="muted mt-2">
              展开后可查看 §51 / §52 两个中心的十项与派生来源、§53 发布闸门四条硬条件与五种阻断状态、
              §60 导出格式与范围、七条铁律、上限与下游 Phase 交接。
            </p>
          ) : null}

          {open ? (
            <>
              <div className="grid-2 mt-2">
                <div className="card">
                  <h3 style={{ marginTop: 0, fontSize: 15 }}>
                    §53 发布闸门
                    <span className="spec">{contract.publish_gate.spec_ref}</span>
                  </h3>
                  <ul className="chip-list">
                    <li className="chip">
                      {contract.publish_gate.requires_approved ? "必须已人工审批通过" : "不要求审批"}
                    </li>
                    <li className="chip">
                      {contract.publish_gate.requires_latest_copy
                        ? "必须属于当前最新一版成稿"
                        : "不要求最新版"}
                    </li>
                    <li className="chip">RED 阻断句一律不得发布</li>
                    <li className="chip">没有成稿就没有资料</li>
                  </ul>
                  <div className="sub-title">五种阻断状态（依次对应页面上的状态条）</div>
                  <ol className="rule-list">
                    {contract.publish_gate.blocking_states.map((state) => (
                      <li key={state}>{state}</li>
                    ))}
                  </ol>
                </div>

                <div className="card">
                  <h3 style={{ marginTop: 0, fontSize: 15 }}>
                    §60 导出
                    <span className="spec">{contract.export.spec_ref}</span>
                  </h3>
                  <div className="sub-title">格式</div>
                  <ul className="rule-list">
                    {formats.map((item) => (
                      <li key={item.key}>
                        <strong>{item.label}</strong>（{item.extension}）——{item.hint}
                      </li>
                    ))}
                  </ul>
                  <div className="sub-title">范围</div>
                  <ul className="rule-list">
                    {scopes.map((item) => (
                      <li key={item.key}>
                        <strong>{item.label}</strong>——{item.hint}
                      </li>
                    ))}
                  </ul>
                  <p className="muted">
                    导出是<strong>派生视图</strong>：正文逐字来自两个中心，并永远标注成稿版本与第几次审核（§62-15）。
                  </p>
                </div>
              </div>

              <div className="grid-2 mt-2">
                <SlotList title="§51 主播中心十项" spec={contract.host_center.spec_ref} slots={hostSlots} />
                <SlotList
                  title="§52 经销商中心十项"
                  spec={contract.dealer_center.spec_ref}
                  slots={dealerSlots}
                />
              </div>

              <div className="sub-title">铁律</div>
              <ol className="rule-list">
                {contract.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>

              <p className="muted">
                上限：列表每页默认 {limits?.defaultPageSize ?? contract.limits.defaultPageSize} 条、最多{" "}
                {limits?.maxPageSize ?? contract.limits.maxPageSize} 条；单次导出正文上限{" "}
                {limits?.maxExportChars ?? contract.limits.maxExportChars} 字；搜索词上限{" "}
                {limits?.maxQueryLength ?? contract.limits.maxQueryLength} 字。
              </p>

              <Alert tone="info">
                下游 Phase 交接：
                {downstream.length === 0
                  ? "无。Phase 15 是交付链路的最后一环，交付层不再登记下游阶段。"
                  : downstream.map((item) => `Phase ${item.phase}（${item.status}）`).join("、")}
              </Alert>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
