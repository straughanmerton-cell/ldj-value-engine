import type { ReactElement } from "react";
import { useDeliveryLabels, useHostCenter } from "../../lib/delivery.js";
import { Card } from "../ui/Card.js";
import { EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";
import { DeliveryExportCard } from "./DeliveryExportCard.js";
import { HostCenterGateBanner } from "./HostCenterGateBanner.js";
import { HostCenterQuickCopy, HOST_QUICK_COPY_PRESETS } from "./HostCenterQuickCopy.js";
import { HostCenterSlots } from "./HostCenterSlots.js";

export interface HostCenterPanelProps {
  productId: string;
  token: string | null;
  /** 产品详情页里「下一步去哪里」直接切 Tab；跨产品页面不传 */
  onGoToTab?: (tab: string) => void;
}

/**
 * §51 主播中心（产品级，挂在产品详情「最终资料」Tab）。
 *
 * 这一屏只服务一个场景：**主播两分钟后要上台**。所以顺序是固定的——
 * 先看到「这一版能不能讲」（闸门），再拿到「马上要念的三段」（快捷复制），
 * 然后才是完整十项，最后才是导出。
 *
 * 六条不许越界的口径（与 `lib/delivery.ts` 同源）：
 * 1. 能不能交付由后端闸门说了算，页面不重算、不给「差不多」；
 * 2. 闸门未通过时十项全空，页面如实显示缺口并指向事实审核，不拼一个「先看着用」的版本；
 * 3. 每一格都给可直接念的原文与一键复制，主播不用自己琢磨（§64）；
 * 4. 导出是派生视图，正文逐字来自这里，且永远标注成稿版本与第几次审核（§62-15）；
 * 5. 导出被拒时把后端的拒绝理由原样摆出来（§53）；
 * 6. 交付永远只认「当前最新一版成稿 + 这一版自己的审核」，上一版通过不算这一版通过（§57）。
 */
export function HostCenterPanel({
  productId,
  token,
  onGoToTab
}: HostCenterPanelProps): ReactElement {
  const { view, loading, error, reload } = useHostCenter(token, productId);
  const { labels } = useDeliveryLabels(token);

  if (loading && !view) {
    return <LoadingState label="正在读取 §51 主播中心" />;
  }

  if (error && !view) {
    return <ErrorState title="主播中心读取失败" description={error} onRetry={reload} />;
  }

  if (!view) {
    return (
      <EmptyState
        title="还没有可读取的交付状态"
        description="主播中心只读取「最新一版成稿 + 这一版自己的审核」，请先确认产品已生成强成交话术。"
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
        title="发布闸门（主播中心）"
        onNextAction={onGoToTab ? () => onGoToTab("fact-review") : undefined}
        nextActionLabel="去事实审核"
      />

      {view.ready ? (
        <HostCenterQuickCopy
          slots={view.slots}
          presets={HOST_QUICK_COPY_PRESETS}
          title="上台前先把这几段复制走"
          subtitle="60 秒稿 / 3 分钟稿 / 5 句金句：复制出来的每个字都来自这一版已审批成稿。"
        />
      ) : null}

      <Card
        title="§51 主播中心十项"
        spec="§51 / §53"
        subtitle="产品身份 / 一句话定位 / 今天必讲 3 点 / 价值赛道 / 产品结构 / 配方哲学 / 5 句金句 / 60 秒稿 / 3 分钟稿 / 异议回答——顺序即上台顺序。"
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
        <HostCenterSlots slots={view.slots} labels={labels} side="host" />
      </Card>

      <DeliveryExportCard
        productId={productId}
        token={token}
        labels={labels}
        gate={view.gate}
        defaultScope="HOST"
      />
    </div>
  );
}
