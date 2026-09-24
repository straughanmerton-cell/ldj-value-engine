import type { ReactElement } from "react";
import { useDealerCenter, useDeliveryLabels } from "../../lib/delivery.js";
import { DeliveryExportCard } from "../host-center/DeliveryExportCard.js";
import { HostCenterGateBanner } from "../host-center/HostCenterGateBanner.js";
import { DEALER_QUICK_COPY_PRESETS, HostCenterQuickCopy } from "../host-center/HostCenterQuickCopy.js";
import { HostCenterSlots } from "../host-center/HostCenterSlots.js";
import { Card } from "../ui/Card.js";
import { EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface DealerCenterPanelProps {
  productId: string;
  token: string | null;
  /** 产品详情页里「下一步去哪里」直接切 Tab；跨产品页面不传 */
  onGoToTab?: (tab: string) => void;
}

/**
 * §52 经销商中心（产品级，挂在产品详情「最终资料」Tab）。
 *
 * 主播关心「怎么讲」，经销商关心的是**怎么解释价格、怎么应对终端**。所以这里复用的是同一版成稿，
 * 但十项按 §52 原文重排：产品定位 / 核心卖点 / 为什么值这个价 / 同赛道市场认知 / 主要锚点 /
 * 产品结构 / 配方哲学 / 消费人群 / 如何介绍 / 常见问题。
 *
 * 两条必须说清的边界：
 * 1. 「同赛道市场认知 / 主要锚点」由后端从锚点与成稿派生，**只引用价格高度标准**，
 *    绝不引用对标产品的原料 / 树龄 / 山头 / 配方（§62-5：不移植竞品事实）；
 * 2. 与主播中心共用同一个发布闸门：闸门未通过时十项全空，导出返回 409 并给出阻断句（§53 / §57）。
 */
export function DealerCenterPanel({
  productId,
  token,
  onGoToTab
}: DealerCenterPanelProps): ReactElement {
  const { view, loading, error, reload } = useDealerCenter(token, productId);
  const { labels } = useDeliveryLabels(token);

  if (loading && !view) {
    return <LoadingState label="正在读取 §52 经销商中心" />;
  }

  if (error && !view) {
    return <ErrorState title="经销商中心读取失败" description={error} onRetry={reload} />;
  }

  if (!view) {
    return (
      <EmptyState
        title="还没有可读取的交付状态"
        description="经销商中心与主播中心共用同一版成稿与同一套审核结论，请先确认产品已生成强成交话术。"
      />
    );
  }

  const presentCount = view.slots.filter((slot) => slot.present).length;

  return (
    <div className="stack">
      <HostCenterGateBanner
        gate={view.gate}
        labels={labels}
        summary={view}
        title="发布闸门（经销商中心）"
        onNextAction={onGoToTab ? () => onGoToTab("fact-review") : undefined}
        nextActionLabel="去事实审核"
      />

      {view.ready ? (
        <HostCenterQuickCopy
          slots={view.slots}
          presets={DEALER_QUICK_COPY_PRESETS}
          title="发给经销商的三段标准话"
          subtitle="定位 / 卖点 / 为什么值这个价：终端问什么，直接把这一段发过去。"
        />
      ) : null}

      <Card
        title="§52 经销商中心十项"
        spec="§52 / §53"
        subtitle="产品定位 / 核心卖点 / 为什么值这个价 / 同赛道市场认知 / 主要锚点 / 产品结构 / 配方哲学 / 消费人群 / 如何介绍 / 常见问题。"
        actions={
          <>
            <Pill tone={presentCount === view.slots.length ? "ok" : "warn"}>
              已具备 {presentCount} / {view.slots.length} 项
            </Pill>
            <button type="button" className="secondary sm" onClick={reload}>
              刷新
            </button>
          </>
        }
      >
        <HostCenterSlots slots={view.slots} labels={labels} side="dealer" />
      </Card>

      <DeliveryExportCard
        productId={productId}
        token={token}
        labels={labels}
        gate={view.gate}
        defaultScope="DEALER"
      />
    </div>
  );
}
