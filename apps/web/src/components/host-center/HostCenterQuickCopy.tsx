import { useState, type ReactElement } from "react";
import { copyText, slotCopyText } from "../../lib/delivery.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import type { AnyDeliverySlotView } from "./HostCenterSlots.js";

export interface QuickCopyPreset {
  /** 对应的十项 key */
  key: string;
  label: string;
  hint: string;
}

/** §51：主播上台最常用的三段——60 秒稿 / 3 分钟稿 / 金句。 */
export const HOST_QUICK_COPY_PRESETS: QuickCopyPreset[] = [
  { key: "sec60", label: "60 秒稿", hint: "开场到落单的一分钟版本，直播切片与短视频口播都用它" },
  { key: "min3", label: "3 分钟稿", hint: "完整讲一遍茶：身份 / 结构 / 配方 / 价值 / 收口" },
  { key: "core_quotes", label: "5 句金句", hint: "能单独拿出去发的五句话" }
];

/** §52：经销商与终端沟通最常用的三段。 */
export const DEALER_QUICK_COPY_PRESETS: QuickCopyPreset[] = [
  { key: "positioning", label: "产品定位", hint: "这款茶在货架上站在哪个位置" },
  { key: "selling_points", label: "核心卖点", hint: "按重要性排序的卖点清单" },
  { key: "why_this_price", label: "为什么值这个价", hint: "价格高度叙事，不含任何具体金额承诺" }
];

export interface HostCenterQuickCopyProps {
  slots: AnyDeliverySlotView[];
  presets: QuickCopyPreset[];
  title: string;
  subtitle: string;
}

/**
 * 快捷复制条（规格 §51 / §64）。
 *
 * 主播在台上的动作只有两个：**照着念**、**把这段发给别人**。所以这里不做「生成」这种动作，
 * 只把成稿里已经审过的原话原封不动复制出去——复制出来的每一个字都来自同一版已审批成稿（§62-15）。
 */
export function HostCenterQuickCopy({
  slots,
  presets,
  title,
  subtitle
}: HostCenterQuickCopyProps): ReactElement {
  const { notify } = useToast();
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <Card
      title={title}
      spec="§51 / §64"
      subtitle={subtitle}
      actions={<Pill tone="neutral">{presets.length} 个常用段落</Pill>}
    >
      <div className="quick-grid">
        {presets.map((preset) => {
          const slot = slots.find((item) => item.key === preset.key) ?? null;
          const text = slot ? slotCopyText(slot) : null;
          const open = preview === preset.key;
          return (
            <div className="quick-card" key={preset.key} data-present={text !== null}>
              <div className="quick-head">
                <strong>{preset.label}</strong>
                <span className="muted">{text ? `${text.length} 字` : "还没有正文"}</span>
              </div>
              <p className="quick-hint">{preset.hint}</p>
              <div className="row">
                <button
                  type="button"
                  className="secondary sm"
                  disabled={!text}
                  onClick={() => {
                    if (!text) {
                      return;
                    }
                    void copyText(text).then((ok) => {
                      notify(
                        ok ? `已复制「${preset.label}」` : "复制失败：请手动选中复制",
                        ok ? "ok" : "warn"
                      );
                    });
                  }}
                >
                  一键复制
                </button>
                <button
                  type="button"
                  className="secondary sm"
                  disabled={!text}
                  onClick={() => setPreview(open ? null : preset.key)}
                >
                  {open ? "收起全文" : "看全文"}
                </button>
              </div>
              {open && text ? <pre className="code-block quick-preview">{text}</pre> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
