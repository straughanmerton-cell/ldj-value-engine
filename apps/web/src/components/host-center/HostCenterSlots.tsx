import type { ReactElement } from "react";
import {
  copyText,
  slotCopyText,
  type DealerCenterSlotView,
  type DeliveryLabels,
  type DeliverySlotView,
  type HostCenterSlotView
} from "../../lib/delivery.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { Min3Timeline } from "./Min3Timeline.js";
import { ObjectionCards } from "./ObjectionCards.js";

export type AnyDeliverySlotView = HostCenterSlotView | DealerCenterSlotView;

export interface HostCenterSlotsProps {
  slots: AnyDeliverySlotView[];
  labels: DeliveryLabels | null;
  side: "host" | "dealer";
}

function slotStatusLabel(slot: DeliverySlotView): { text: string; tone: DeliverySlotView["tone"] } {
  if (!slot.present) {
    return slot.tone === "outline"
      ? { text: "闸门未通过", tone: "outline" }
      : { text: "缺口", tone: "warn" };
  }
  return { text: "已具备", tone: "ok" };
}

/**
 * §51 / §52 十项卡片（顺序与后端一致，不做任何重排）。
 *
 * 每一格都回答同一个问题：**主播 / 经销商现在该张口说什么**。所以能直接念的原文永远在最显眼的位置，
 * 「这一格要什么（`requirement`）」「内容来自成稿哪个字段（`source`）」放在次要位置，
 * 并配一个一键复制——主播不需要为了几句话去翻上游页面（§64）。
 */
export function HostCenterSlots({ slots, labels, side }: HostCenterSlotsProps): ReactElement {
  const { notify } = useToast();

  return (
    <div className="slot-grid">
      {slots.map((slot, index) => {
        const status = slotStatusLabel(slot);
        const copyable = slotCopyText(slot);
        return (
          <article className="slot-card" key={slot.key} data-present={slot.present}>
            <header className="slot-head">
              <span className="slot-index">{index + 1}</span>
              <div className="slot-title">
                <h4>{slot.label}</h4>
                <div className="slot-meta">
                  <Pill tone={status.tone}>{status.text}</Pill>
                  {slot.present ? (
                    <span className="muted">{slot.chars} 字</span>
                  ) : (
                    <span className="muted">无正文</span>
                  )}
                  <span className="muted">来源 {slot.source}</span>
                  {labels ? null : <span className="muted">文案兜底（字典未就绪）</span>}
                </div>
              </div>
              <button
                type="button"
                className="secondary sm"
                disabled={!copyable}
                onClick={() => {
                  if (!copyable) {
                    return;
                  }
                  void copyText(copyable).then((ok) => {
                    notify(
                      ok ? `已复制「${slot.label}」` : "复制失败：请手动选中复制",
                      ok ? "ok" : "warn"
                    );
                  });
                }}
              >
                复制
              </button>
            </header>

            <p className="slot-requirement">这一格要拿到：{slot.requirement}</p>

            {!slot.present ? (
              <div className="slot-empty">
                还没有可交付的正文。上方状态条已说明卡在哪一步——补齐上游之后，
                {side === "host" ? "主播中心" : "经销商中心"}会自动出现在这里（§53 / §64）。
              </div>
            ) : slot.key === "min3" ? (
              <Min3Timeline slot={slot} />
            ) : slot.key === "objections" ? (
              <ObjectionCards slot={slot} />
            ) : slot.text && slot.items.length === 0 ? (
              <p className="quote slot-text">{slot.text}</p>
            ) : (
              <ol className="slot-items">
                {slot.items.map((item) => (
                  <li key={`${item.index}-${item.label ?? ""}`}>
                    {item.label ? <span className="slot-item-label">{item.label}</span> : null}
                    <span className="slot-item-text">{item.text}</span>
                    {item.detail ? <span className="slot-item-detail muted">{item.detail}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </article>
        );
      })}
    </div>
  );
}
