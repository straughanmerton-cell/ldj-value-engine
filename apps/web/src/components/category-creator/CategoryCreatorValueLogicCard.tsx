import type { ReactElement } from "react";
import {
  COPY_LAYER_LABELS,
  COPY_LAYER_TONES,
  VALUE_LOGIC_STAGE_LABELS,
  type CategoryCreatorProfileView,
  type ValueLogicStage
} from "../../lib/category-creator.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface CategoryCreatorValueLogicCardProps {
  profile: CategoryCreatorProfileView | null;
}

const STAGE_ORDER: ValueLogicStage[] = ["FACT", "INTERPRETATION", "VALUE", "SALES_LINE"];

const STAGE_DUTY: Record<ValueLogicStage, string> = {
  FACT: "只写已录入事实，不加工、不解释",
  INTERPRETATION: "说明这些事实各承担什么任务（结构分工）",
  VALUE: "由结构完整度推出价值，不说具体价格",
  SALES_LINE: "对外表达段：可以修辞，但不得新增事实断言"
};

/**
 * 价值逻辑链（§4.2 / §24 / §29）。
 *
 * 四段链条 FACT → INTERPRETATION → VALUE → SALES_LINE 必须逐段标层：
 * 哪句是事实、哪句是解释、哪句是修辞，都要能当场指出来。
 * 事实不足时引擎**不会输出 SALES_LINE 段**——界面上应当看到缺失，而不是补一句安慰话。
 */
export function CategoryCreatorValueLogicCard({
  profile
}: CategoryCreatorValueLogicCardProps): ReactElement {
  if (!profile) {
    return (
      <Card title="价值逻辑（FACT → 价值 → 成交表达）" spec="§4.2 / §24">
        <EmptyState
          title="还没有价值逻辑链"
          description="生成自建标准后，这里会按四段链条展示事实、解释、价值与成交表达。"
        />
      </Card>
    );
  }

  const logic = profile.value_logic;
  const byStage = new Map(logic.items.map((item) => [item.stage, item]));

  return (
    <Card
      title="价值逻辑（FACT → 价值 → 成交表达）"
      spec="§4.2 / §24 / §29"
      subtitle="每一段都必须能说清它属于事实、解释还是修辞；说不清归属的句子不许进成交层。"
      actions={
        <>
          <Pill tone={logic.sales_line_ready ? "ok" : "warn"}>
            {logic.sales_line_ready ? "已具备成交表达" : "暂无成交表达"}
          </Pill>
          <Pill tone="neutral">段落 {logic.items.length} / 4</Pill>
        </>
      }
    >
      <Alert tone="info">{logic.mode_switch_note}</Alert>

      <div className="table-wrap mt-3">
        <table>
          <thead>
            <tr>
              <th>段落</th>
              <th>层级标记（§24）</th>
              <th>内容</th>
              <th>引用来源</th>
            </tr>
          </thead>
          <tbody>
            {STAGE_ORDER.map((stage) => {
              const item = byStage.get(stage);
              if (!item) {
                return (
                  <tr key={stage}>
                    <td className="nowrap">
                      {VALUE_LOGIC_STAGE_LABELS[stage]}
                      <div className="muted">{STAGE_DUTY[stage]}</div>
                    </td>
                    <td className="nowrap">
                      <Pill tone="outline">未输出</Pill>
                    </td>
                    <td className="muted">
                      当前事实不足，这一轮不输出该段：不写弱化版，也不编内容（§4.2 / §11）。
                    </td>
                    <td className="muted">—</td>
                  </tr>
                );
              }
              return (
                <tr key={stage}>
                  <td className="nowrap">
                    {item.label}
                    <div className="muted">{STAGE_DUTY[stage]}</div>
                  </td>
                  <td className="nowrap">
                    <Pill tone={COPY_LAYER_TONES[item.layer]}>{COPY_LAYER_LABELS[item.layer]}</Pill>
                  </td>
                  <td>
                    <div className="quote">{item.text}</div>
                  </td>
                  <td>
                    {item.source_refs.length > 0 ? (
                      <div className="chip-list">
                        {item.source_refs.map((ref) => (
                          <span className="chip muted" key={ref}>
                            <code className="mono">{ref}</code>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Alert tone={logic.sales_line_ready ? "info" : "warn"}>
        {logic.sales_line_ready
          ? "成交表达段只使用已录入事实与标准本身；上线前仍需走 Phase 14 的事实审核（FACT / INTERPRETATION / RHETORIC 与 RED 拦截）。"
          : "事实不足，本版不出成交表达：先补齐事实；产品结构（Phase 10）面对不足的事实同样只会留空写缺口，配方哲学（Phase 11）与王者话术（Phase 12）也都建立在这一层之上。"}
      </Alert>
    </Card>
  );
}
