import type { ReactElement } from "react";
import {
  LEVEL5_REQUIREMENT_ORDER,
  intensityLabel,
  type Level5RequirementStatus,
  type SalesCopyRecordView
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface SalesCopyLevel5BoardProps {
  record: SalesCopyRecordView | null;
}

/**
 * §22 Level 5 王者话术看板。
 *
 * 王者档不是「修辞更花」，而是**七个关键位置一个都不留给平庸**：强反问、身份定义、
 * 价格高度叙事（或 §22 标准句）、产品结构叙事、风格身份证、≥ 3 句金句、成交收口。
 *
 * 这里逐项给出状态与证据句，缺哪一项就直接显示缺哪一项——缺了就不叫 Level 5。
 */
export function SalesCopyLevel5Board({ record }: SalesCopyLevel5BoardProps): ReactElement {
  if (!record) {
    return (
      <Card title="Level 5 王者话术（§22）" spec="§22 / §30">
        <EmptyState
          title="还没有生成强成交话术"
          description="生成之后这里会逐项显示七项强制的落地情况与证据句。"
        />
      </Card>
    );
  }

  const level5 = record.level5;
  /** 按 §22 固定顺序展示，缺项交给后端返回的 requirements 兜底。 */
  const requirements: Level5RequirementStatus[] = LEVEL5_REQUIREMENT_ORDER.map((key) =>
    level5.requirements.find((item) => item.key === key)
  ).filter((item): item is Level5RequirementStatus => Boolean(item));
  const priceRequirement = requirements.find((item) => item.key === "price_height_story") ?? null;

  return (
    <Card
      title="Level 5 王者话术（§22）"
      spec="§22 / §30 / §57"
      subtitle="王者话术：身份拉满、价值感拉满、结构感拉满，每一个关键位置都不留给平庸。七项缺一项，就不是 Level 5。"
      actions={
        <>
          <Pill tone="neutral">{intensityLabel(record.intensity, null)}</Pill>
          <Pill tone={level5.required ? "ok" : "outline"}>
            {level5.required ? "触发七项强制" : "本档未触发"}
          </Pill>
          <Pill tone={level5.satisfied ? "ok" : "danger"}>
            {level5.satisfied ? "七项已全部落地" : `缺 ${level5.missing.length} 项`}
          </Pill>
        </>
      }
    >
      {!level5.required ? (
        <Alert tone="info">
          本版强度为 {intensityLabel(record.intensity, null)}，§22 的七项强制只在 Level 5 生效；
          下面仍然逐项列出当前成稿的实际落位，方便升到王者档前先看清差在哪。
        </Alert>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>强制项</th>
              <th>要求</th>
              <th>判定</th>
              <th>状态</th>
              <th>成稿里的证据句</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((requirement, index) => (
              <tr key={requirement.key}>
                <td className="nowrap muted">{index + 1}</td>
                <td className="nowrap">
                  <strong>{requirement.label}</strong>
                  <div className="muted mono mt-1">{requirement.key}</div>
                </td>
                <td>{requirement.requirement}</td>
                <td className="muted">{requirement.check}</td>
                <td className="nowrap">
                  <Pill tone={requirement.status === "DONE" ? "ok" : "danger"}>
                    {requirement.status === "DONE" ? "已落地" : "缺"}
                  </Pill>
                </td>
                <td>
                  {requirement.evidence ? (
                    <span className="quote">{requirement.evidence}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sub-title mt-4">价格高度叙事口径（§22 / §25）</div>
      {record.anchor.has_reliable_price_anchor ? (
        <div className="chip-list">
          <span className="chip">可靠价格锚点：有</span>
          <span className="chip">主锚点：{record.anchor.primary_anchor_name ?? "—"}</span>
          <span className="chip">允许讲价格高度叙事</span>
          <span className="chip">不得出现「复刻 / 同款配方 / 按 X 配方做」等表述</span>
        </div>
      ) : (
        <>
          <div className="chip-list">
            <span className="chip">可靠价格锚点：无</span>
            <span className="chip">价格高度叙事逐字使用 §22 标准句</span>
            <span className="chip">不得写任何具体价格故事</span>
          </div>
          <div className="alert warn mt-2">
            §22 原文标准句（逐字，不得改写）：
            <div className="quote mt-1">{level5.no_anchor_standard_sentence}</div>
          </div>
          <p className="muted">
            本版价格高度叙事实际写成：
            {priceRequirement?.evidence ? (
              <span className="quote">{priceRequirement.evidence}</span>
            ) : (
              <span className="muted">—（本项未落地）</span>
            )}
          </p>
        </>
      )}

      <Alert tone={level5.satisfied ? "info" : "warn"}>
        {level5.satisfied
          ? "七项强制全部落地；文案上「每个关键位置都不留给平庸」的要求已经满足，剩下的判断在合规自检与人工确认（§24 / §57）。"
          : `尚有 ${level5.missing.length} 项未落地：${
              level5.missing
                .map((key) => requirements.find((item) => item.key === key)?.label ?? key)
                .join(" / ")
            }。补法只有一条——先把缺的事实与上游成稿补上，再用更狠的说法讲同一批事实（§24 / §34）。`}
      </Alert>
    </Card>
  );
}
