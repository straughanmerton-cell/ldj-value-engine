import type { ReactElement } from "react";
import type { DeliverySlotView } from "../../lib/delivery.js";
import { EmptyState } from "../ui/State.js";

export interface Min3TimelineProps {
  slot: DeliverySlotView;
}

/**
 * §27 / §51「3 分钟稿」八段：不是清单，而是一条**按时间轴排好的上台路径**。
 *
 * 每一段都给出「这一段要干什么（`detail`）+ 照着念的原话（`text`）」，
 * 主播看时间就知道讲到哪儿了；文案本身一个字都不在这里改（§62-15）。
 */
export function Min3Timeline({ slot }: Min3TimelineProps): ReactElement {
  if (!slot.present || slot.items.length === 0) {
    return (
      <EmptyState
        title="这一格还没有内容"
        description={slot.requirement}
      />
    );
  }

  return (
    <ol className="timeline">
      {slot.items.map((item) => (
        <li key={`${item.index}-${item.label ?? ""}`} className="timeline-item">
          <div className="timeline-mark">
            <span className="timeline-index">{item.index}</span>
          </div>
          <div className="timeline-body">
            {item.label ? <div className="timeline-label">{item.label}</div> : null}
            <p className="timeline-text">{item.text}</p>
            {item.detail ? <p className="timeline-hint">{item.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
