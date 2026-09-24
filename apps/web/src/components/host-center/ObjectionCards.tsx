import type { ReactElement } from "react";
import type { DeliverySlotView } from "../../lib/delivery.js";
import { EmptyState } from "../ui/State.js";

export interface ObjectionCardsProps {
  slot: DeliverySlotView;
}

/**
 * §51「异议回答」：一问一答的应对卡。
 *
 * 现场最常卡住的是「太贵了 / 为什么不做某产区 / 你这个跟别人有什么不一样」，
 * 所以这里按卡片摊开——上面是问句，下面是可直接念的标准回答（`text`）。
 */
export function ObjectionCards({ slot }: ObjectionCardsProps): ReactElement {
  if (!slot.present || slot.items.length === 0) {
    return (
      <EmptyState
        title="这一格还没有内容"
        description={slot.requirement}
      />
    );
  }

  return (
    <div className="obj-grid">
      {slot.items.map((item) => (
        <div className="obj-card" key={`${item.index}-${item.label ?? ""}`}>
          <div className="obj-q">
            <span className="obj-index">Q{item.index}</span>
            <strong>{item.label ?? "常见异议"}</strong>
          </div>
          <p className="obj-a">{item.text}</p>
          {item.detail ? <p className="obj-hint">{item.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}
