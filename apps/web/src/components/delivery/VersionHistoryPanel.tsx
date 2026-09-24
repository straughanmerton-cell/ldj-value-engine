import type { ReactElement } from "react";
import { useDeliveryLabels, useProductVersions } from "../../lib/delivery.js";
import { useFactReviewLabels, engineLabel, riskLabel, riskTone } from "../../lib/fact-review.js";
import { impactBandMeta, intensityLabel, intensityTone, useSalesCopyLabels } from "../../lib/sales-copy.js";
import { formatDateTime } from "../../lib/delivery.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, ErrorState, LoadingState, Pill } from "../ui/State.js";

export interface VersionHistoryPanelProps {
  productId: string;
  token: string | null;
  /** 产品详情页里直接切到对应 Tab；跨产品页面不传 */
  onGoToTab?: (tab: string) => void;
}

/**
 * §34 / §50 / §57 / §62-15 历史版本（产品级，挂在产品详情「历史版本」Tab）。
 *
 * 「所有版本必须保留」在界面上要能被验证，所以这里把两条线一次摊开：
 * **成稿版本**（第几版、几档强度、自动强化过几轮、分数与分带、九种输出齐不齐、§57 验收过没过）
 * 与**审核版本**（这一版被审过几次、每次的总风险与绿黄红计数、用了多少条事实）。
 *
 * 交付中心只交付「最新一版 + 这一版自己的审核」，历史版本在这里只读不改（§62-15）。
 */
export function VersionHistoryPanel({
  productId,
  token,
  onGoToTab
}: VersionHistoryPanelProps): ReactElement {
  const { copyVersions, reviewVersions, loading, error, reload } = useProductVersions(token, productId);
  const { labels: copyLabels } = useSalesCopyLabels(token);
  const { labels: reviewLabels } = useFactReviewLabels(token);
  const { labels: deliveryLabels } = useDeliveryLabels(token);

  if (loading && copyVersions.length === 0 && reviewVersions.length === 0) {
    return <LoadingState label="正在读取历史版本" />;
  }

  if (error) {
    return <ErrorState title="历史版本读取失败" description={error} onRetry={reload} />;
  }

  const latestCopy = copyVersions[0]?.version ?? null;
  const latestReview = reviewVersions[0]?.version ?? null;

  return (
    <div className="stack">
      <Card
        title="强成交话术成稿版本"
        spec="§34 / §48 / §57 / §62-15"
        subtitle="重新生成与「再狠一点」都只新增版本：旧版本原样保留，交付只认最新一版。"
        actions={
          <>
            <Pill tone="neutral">{copyVersions.length} 个成稿版本</Pill>
            <button type="button" className="secondary sm" onClick={reload}>
              刷新
            </button>
            {onGoToTab ? (
              <button type="button" className="secondary sm" onClick={() => onGoToTab("copy")}>
                去强成交话术
              </button>
            ) : null}
          </>
        }
      >
        {copyVersions.length === 0 ? (
          <EmptyState
            title="还没有任何成稿版本"
            description="在「强成交话术」Tab 生成一版之后，这里会记录它的强度、强化轮次、分数与验收结论。"
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>版本</th>
                  <th>强度</th>
                  <th>再狠一点</th>
                  <th>成交冲击力</th>
                  <th>九种输出</th>
                  <th>Level 5</th>
                  <th>合规</th>
                  <th>§57 验收</th>
                  <th>人工确认</th>
                  <th>生成时间</th>
                </tr>
              </thead>
              <tbody>
                {copyVersions.map((version) => (
                  <tr key={version.id}>
                    <td className="nowrap">
                      <Pill tone={version.version === latestCopy ? "brand" : "neutral"}>
                        v{version.version}
                      </Pill>
                      {version.version === latestCopy ? (
                        <div className="muted mt-1">当前交付版本</div>
                      ) : null}
                    </td>
                    <td className="nowrap">
                      <Pill tone={intensityTone(version.intensity, copyLabels)}>
                        {intensityLabel(version.intensity, copyLabels)}
                      </Pill>
                    </td>
                    <td className="nowrap">
                      {version.intensify_rounds === 0 ? (
                        <span className="muted">未强化</span>
                      ) : (
                        <Pill tone="info">第 {version.intensify_rounds} 轮</Pill>
                      )}
                    </td>
                    <td className="nowrap">
                      <Pill tone={version.score_passed ? "ok" : "warn"}>{version.impact_score} 分</Pill>
                      <div className="muted mt-1">{impactBandMeta(version.band, copyLabels).label}</div>
                    </td>
                    <td className="nowrap">
                      {version.outputs_complete ? (
                        <Pill tone="ok">齐备</Pill>
                      ) : (
                        <Pill tone="danger">有缺项</Pill>
                      )}
                    </td>
                    <td className="nowrap">
                      {version.level5_passed ? (
                        <Pill tone="ok">成立</Pill>
                      ) : (
                        <Pill tone="outline">未成立</Pill>
                      )}
                    </td>
                    <td className="nowrap">
                      {version.compliance_passed ? (
                        <Pill tone="ok">通过</Pill>
                      ) : (
                        <Pill tone="danger">未通过</Pill>
                      )}
                    </td>
                    <td className="nowrap">
                      {version.acceptance_passed ? (
                        <Pill tone="ok">通过</Pill>
                      ) : (
                        <Pill tone="danger">未通过</Pill>
                      )}
                    </td>
                    <td className="nowrap">
                      {version.is_confirmed ? (
                        <Pill tone="ok">已确认</Pill>
                      ) : (
                        <Pill tone="neutral">未确认</Pill>
                      )}
                    </td>
                    <td className="nowrap">{formatDateTime(version.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="事实审核版本"
        spec="§53 / §57 / §62-15"
        subtitle="同一版成稿可以审多次：每一次都是一条新记录，绿黄红计数与「这一版当时能不能发布」都原样留痕。"
        actions={
          <>
            <Pill tone="neutral">{reviewVersions.length} 次审核</Pill>
            {latestReview !== null ? <Pill tone="info">最新第 {latestReview} 次</Pill> : null}
            {onGoToTab ? (
              <button type="button" className="secondary sm" onClick={() => onGoToTab("fact-review")}>
                去事实审核
              </button>
            ) : null}
          </>
        }
      >
        {reviewVersions.length === 0 ? (
          <EmptyState
            title="还没有任何事实审核记录"
            description="审核只认已生成的成稿：先在「事实审核」Tab 送审一版，这里会记录绿黄红计数与可发布结论。"
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>审核序号</th>
                  <th>对应成稿</th>
                  <th>引擎</th>
                  <th>总风险</th>
                  <th>可发布</th>
                  <th>GREEN / YELLOW / RED</th>
                  <th>引用事实</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {reviewVersions.map((review) => (
                  <tr key={review.id}>
                    <td className="nowrap">
                      <Pill tone={review.version === latestReview ? "brand" : "neutral"}>
                        第 {review.version} 次
                      </Pill>
                    </td>
                    <td className="nowrap">成稿 v{review.copy_version}</td>
                    <td className="nowrap">{engineLabel(review.engine)}</td>
                    <td className="nowrap">
                      <Pill tone={riskTone(review.overall_risk)}>
                        {riskLabel(review.overall_risk, reviewLabels)}
                      </Pill>
                    </td>
                    <td className="nowrap">
                      {review.publishable ? (
                        <Pill tone="ok">可发布</Pill>
                      ) : (
                        <Pill tone="danger">禁止发布</Pill>
                      )}
                    </td>
                    <td className="nowrap">
                      {review.green} / {review.yellow} / {review.red}
                    </td>
                    <td className="nowrap">{review.facts_used}</td>
                    <td className="nowrap">{formatDateTime(review.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Alert tone="info">
        版本永不删除：重新生成话术只新增成稿版本，重新审核只新增审核版本，审批与否决都留痕（§62-15）。
        交付层只交付
        <strong>最新一版成稿 + 这一版自己的审核</strong>
        ——上一版已通过、这一版刚生成还没审，是假绿灯最常见的来源（§53 / §57）。
        {deliveryLabels ? `（交付层字典已加载：${deliveryLabels.rules.length} 条铁律）` : ""}
      </Alert>
    </div>
  );
}
