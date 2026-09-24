import type { ReactElement } from "react";
import {
  CATEGORY_STANDARD_AXIS_LABELS,
  type CategoryCreatorContract,
  type CategoryCreatorEngineInfo,
  type CategoryDownstreamItem
} from "../../lib/category-creator.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface CategoryCreatorContractCardProps {
  contract: CategoryCreatorContract | null;
  engine: CategoryCreatorEngineInfo | null;
  downstream: CategoryDownstreamItem[];
  loading: boolean;
  error: string | null;
}

/**
 * §4.2 / §17 自建标准合同自检卡。
 *
 * 这张卡回答的是「没有对标之后，系统到底按什么规矩写」：
 * 两个触发条件、六个标准轴、三层表达标记、以及「哪些事必须交给后面的 Phase」。
 * 它不是说明文档，而是引擎口径的自检结果，所以全部读后端合同。
 */
export function CategoryCreatorContractCard({
  contract,
  engine,
  downstream,
  loading,
  error
}: CategoryCreatorContractCardProps): ReactElement {
  const minSupported = contract?.min_supported_axes ?? engine?.min_supported_axes ?? 2;
  const axes = contract?.axes ?? engine?.axes ?? [];
  const triggers = contract?.triggers ?? [];
  const layers = contract?.layers ?? ["FACT", "INTERPRETATION", "RHETORIC"];
  const phases = downstream.length > 0 ? downstream : (contract?.downstream_phases ?? []);

  return (
    <Card
      title="自建标准合同"
      spec="§4.2 / §17"
      subtitle="没有现成对标 ≠ 没有价值可讲：这一模式只把已录入事实摆正成标准，不补事实、不编对标、也不写弱化版文案。"
      actions={
        <>
          <Pill tone={contract?.not_weak_copy === false ? "danger" : "ok"}>不写弱化文案</Pill>
          <Pill tone={contract?.no_fake_benchmark === false ? "danger" : "ok"}>不硬凑竞品</Pill>
          <Pill tone={contract?.unknown_is_written_as_unknown === false ? "danger" : "ok"}>
            未录入即写未录入
          </Pill>
        </>
      }
    >
      {error ? <Alert tone="warn">{error}</Alert> : null}

      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">标准轴数量</div>
          <div className="metric-value">{loading && axes.length === 0 ? "—" : axes.length || 6}</div>
          <div className="metric-hint">骨架 / 底气 / 身份 / 第一口 / 后半程 / 工艺</div>
        </div>
        <div className="metric">
          <div className="metric-label">成交表达最低门槛</div>
          <div className="metric-value" style={{ fontSize: 18 }}>
            ≥ {minSupported} 轴有事实
          </div>
          <div className="metric-hint">不达标则不出成交表达（§4.2）</div>
        </div>
        <div className="metric">
          <div className="metric-label">标准成立线</div>
          <div className="metric-value" style={{ fontSize: 18 }}>
            ≥ 4 轴 SUPPORTED
          </div>
          <div className="metric-hint">READY / PARTIAL / INSUFFICIENT 三档（§29）</div>
        </div>
        <div className="metric">
          <div className="metric-label">表达分层</div>
          <div className="metric-value" style={{ fontSize: 18 }}>
            {layers.length || 3} 层
          </div>
          <div className="metric-hint">FACT / INTERPRETATION / RHETORIC（§24）</div>
        </div>
      </div>

      <div className="sub-title">两个触发条件（§4.2）</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>触发条件</th>
              <th>判定口径</th>
              <th>规格</th>
            </tr>
          </thead>
          <tbody>
            {triggers.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  正在读取合同…
                </td>
              </tr>
            ) : (
              triggers.map((item) => (
                <tr key={item.trigger}>
                  <td>
                    <Pill tone={item.trigger === "NO_RELIABLE_ANCHOR" ? "warn" : "info"}>{item.label}</Pill>
                    <div className="muted">
                      <code className="mono">{item.trigger}</code>
                    </div>
                  </td>
                  <td>{item.condition}</td>
                  <td className="nowrap muted">{item.spec_ref}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="sub-title">六个标准轴（§4.2 / §5 统一口径）</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>标准轴</th>
              <th>这一轴负责什么</th>
            </tr>
          </thead>
          <tbody>
            {axes.length === 0 ? (
              <tr>
                <td colSpan={2} className="muted">
                  正在读取合同…
                </td>
              </tr>
            ) : (
              axes.map((item) => (
                <tr key={item.axis}>
                  <td>
                    {item.label}
                    <div className="muted">
                      <code className="mono">{item.axis}</code>
                    </div>
                  </td>
                  <td className="muted">{AXIS_DUTY[item.axis] ?? CATEGORY_STANDARD_AXIS_LABELS[item.axis]}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="sub-title">下游交接：本阶段只登记，不用简化版代替（§60）</div>
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
            {phases.map((item) => (
              <tr key={item.phase}>
                <td className="nowrap">Phase {item.phase}</td>
                <td>{item.deliverable}</td>
                <td className="nowrap muted">{item.spec_ref}</td>
                <td className="nowrap">
                  <Pill tone="neutral">待交付（PENDING）</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {phases.length === 0 ? (
        <EmptyState
          title="下游交接已全部交付"
          description="产品结构（Phase 10）与配方哲学（Phase 11）都已交付并回到本页直接调用，合同不再保留 PENDING 占位条目。"
        />
      ) : null}

      <div className="sub-title">六条规则</div>
      <ul className="prov-list">
        {(contract?.rules ?? []).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>

      <Alert tone="info">
        {engine?.note ??
          "没有现成对标 ≠ 没有价值可讲：找不到完全相同的产品，说明这款茶不能拿普通模板去理解（§4.2）。"}
      </Alert>
    </Card>
  );
}

/** 每一轴「负责什么」的兜底口径，与 §4.2 / §5 的角色分工一致。 */
const AXIS_DUTY: Record<string, string> = {
  FRAME: "确定这饼茶站在什么产区结构上，而不是只报产地名",
  DEPTH: "说明原料底气来自哪一层：树型 / 季节 / 等级 / 拼配逻辑",
  IDENTITY: "一入口就能被记住的辨识度：香气、命名体系与系列身份",
  FIRST_IMPRESSION: "第一口必须有的存在感：入口滋味与汤感厚度",
  FINISH: "后半程能不能接得住：回甘、生津、茶气与耐泡度",
  CRAFT: "工艺是否可控：杀青 / 揉捻 / 干燥 / 压制有没有明确做法"
};
