import type { ReactElement } from "react";
import {
  approvalStatusLabel,
  approvalStatusTone,
  formatDateTime,
  gateStateMetaOf,
  type DeliveryGate,
  type DeliveryLabels,
  type DeliverySummary
} from "../../lib/delivery.js";
import { impactBandMeta, intensityLabel, intensityTone } from "../../lib/sales-copy.js";
import { Alert, Pill } from "../ui/State.js";

export interface HostCenterGateBannerProps {
  gate: DeliveryGate;
  labels: DeliveryLabels | null;
  /** 成稿摘要（可交付时才带强度 / 分数 / 合规风险）；列表页没有详情时可省略 */
  summary?: DeliverySummary | null;
  title?: string;
  /** 「下一步去哪里」按钮：产品内切 Tab 用；跨产品页不传就只显示文字 */
  onNextAction?: () => void;
  nextActionLabel?: string;
}

/**
 * 交付层顶部状态条（规格 §53 / §57 / §62-14）。
 *
 * 这是整个交付中心唯一一处「能不能交」的结论：六态由后端 `gate` 现场推出，
 * 页面只把状态、原因、阻断句与下一步摊开。**不可交付时不给任何正文**，
 * 因此看到红色状态条就不会同时看到一篇「先看着用」的稿子。
 */
export function HostCenterGateBanner({
  gate,
  labels,
  summary,
  title = "发布闸门",
  onNextAction,
  nextActionLabel
}: HostCenterGateBannerProps): ReactElement {
  const meta = gateStateMetaOf(gate, labels);
  const complianceTone =
    summary?.compliance_risk === "RED"
      ? "danger"
      : summary?.compliance_risk === "YELLOW"
        ? "warn"
        : "ok";

  return (
    <section className="gate-banner" data-state={meta.key}>
      <div className="gate-banner-head">
        <div className="gate-banner-title">
          <Pill tone={meta.tone}>{meta.label}</Pill>
          <strong>{title}</strong>
          <span className="muted">
            §53 / §57：只有「当前最新一版成稿 + 这一版已人工审批通过 + 逐句无 RED」才允许出最终资料
          </span>
        </div>
        <div className="gate-meta">
          {gate.copy_version === null ? (
            <Pill tone="outline">尚无成稿</Pill>
          ) : (
            <Pill tone="neutral">成稿 v{gate.copy_version}</Pill>
          )}
          {gate.review_version === null ? (
            <Pill tone="outline">未送审</Pill>
          ) : (
            <Pill tone="neutral">第 {gate.review_version} 次审核</Pill>
          )}
          <Pill tone={approvalStatusTone(gate.approval_status)}>
            {approvalStatusLabel(gate.approval_status)}
          </Pill>
          {summary?.intensity != null ? (
            <Pill tone={intensityTone(summary.intensity, null)}>
              {intensityLabel(summary.intensity, null)}
            </Pill>
          ) : null}
          {summary?.impact_score != null ? (
            <Pill tone={summary.impact_band === "CORE" ? "ok" : "neutral"}>
              成交冲击力 {summary.impact_score} 分
              {summary.impact_band ? `（${impactBandMeta(summary.impact_band, null).label}）` : ""}
            </Pill>
          ) : null}
          {summary ? (
            <>
              <Pill tone={summary.level5_passed ? "ok" : "outline"}>
                Level 5 {summary.level5_passed ? "成立" : "未成立"}
              </Pill>
              <Pill tone={summary.compliance_risk ? complianceTone : "outline"}>
                合规 {summary.compliance_risk ?? "—"}
              </Pill>
            </>
          ) : null}
          {summary?.copy_created_at ? (
            <span className="muted">生成于 {formatDateTime(summary.copy_created_at)}</span>
          ) : null}
        </div>
      </div>

      {gate.ready ? (
        <Alert tone="info">
          这一版已经通过逐句事实审核与人工审批（第 {gate.review_version ?? 1} 次审核），可以直接交给主播 /
          经销商使用。导出文件会逐字标注它是哪一版成稿、第几次审核（§62-15）。
        </Alert>
      ) : (
        <Alert tone={meta.tone === "danger" ? "error" : "warn"}>
          <div>
            <strong>{meta.reason}</strong>
          </div>

          {gate.blocking_sentences.length > 0 ? (
            <div className="mt-2">
              <div>
                禁止发布的句子（{gate.blocking_sentences.length} 条，§53 / §57）——改写或删除后重新送审：
              </div>
              <ul className="blocking-list">
                {gate.blocking_sentences.map((sentence) => (
                  <li key={sentence}>
                    <span className="quote">{sentence}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {meta.next_action ? (
            <div className="row between mt-2">
              <span>下一步：{meta.next_action}</span>
              {onNextAction ? (
                <button type="button" className="secondary sm" onClick={onNextAction}>
                  {nextActionLabel ?? meta.next_action}
                </button>
              ) : null}
            </div>
          ) : null}
        </Alert>
      )}
    </section>
  );
}
