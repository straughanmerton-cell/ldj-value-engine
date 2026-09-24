import { useEffect, useState, type ReactElement } from "react";
import {
  CLAIM_TYPE_ORDER,
  FACT_REVIEW_MAX_VERSIONS_FALLBACK,
  RISK_LEVEL_ORDER,
  approveBlockReason,
  approvalMismatch,
  claimTypeHint,
  claimTypeLabel,
  formatDateTime,
  riskHint,
  riskLabel,
  riskTone,
  statusLabel,
  statusTone,
  uniqueSentences,
  type FactReviewApproval,
  type FactReviewContract,
  type FactReviewLabels,
  type FactReviewOverview,
  type FactReviewView
} from "../../lib/fact-review.js";
import { Card } from "../ui/Card.js";
import { Alert, ErrorState, LoadingState, Pill } from "../ui/State.js";

/** 送审输入：事实审核只接受备注，不接受任何「这一句算不算事实」的人工输入（§53）。 */
export interface FactReviewSubmitInput {
  notes: string | null;
}

/** 审批 / 否决输入：人工结论记在**被审批的那一版**上，不会被新版继承（§53 / §62-15）。 */
export interface FactReviewDecisionPayload {
  version: number;
  note: string | null;
}

/** 审批被后端 400 拦下时带回来的阻断结论（§53 / §57）。 */
export interface FactReviewBlockResult {
  message: string;
  blockingSentences: string[];
  reviewedVersion: number | null;
}

export interface FactReviewOverviewCardProps {
  overview: FactReviewOverview | null;
  review: FactReviewView | null;
  labels: FactReviewLabels | null;
  contract: FactReviewContract | null;
  canWrite: boolean;
  busy: "generate" | "approve" | "reject" | null;
  blockResult: FactReviewBlockResult | null;
  loading: boolean;
  error: string | null;
  onSubmit: (input: FactReviewSubmitInput) => void;
  onApprove: (payload: FactReviewDecisionPayload) => void;
  onReject: (payload: FactReviewDecisionPayload) => void;
  onRetry: () => void;
}

const EMPTY_APPROVAL: FactReviewApproval = {
  status: "PENDING",
  reviewed_version: null,
  note: null,
  reviewed_by: null,
  reviewed_at: null
};

const READ_ONLY_REASON = "当前账号为只读：事实审核与人工审批限 ADMIN / RESEARCHER（§53）";

/**
 * 事实审核总览与人工决策（规格 §24 / §25 / §49 / §53 / §57）。
 *
 * 这张卡只回答两件事：
 * 1. **这一版话术现在能不能对外讲**——§49 三档风险、§24 三层标记、阻断句清单、
 *    §24 合规自检与 §25 研发证据全部摊在同一屏上；
 * 2. **谁在什么时候批了哪一版**——人工结论记在被审批的那一版上，
 *    重新生成话术不会继承上一次的「已通过」（§57 / §62-15）。
 *
 * 界面上的两个按钮与后端同一套口径：有 RED 阻断句时「审批通过」直接禁用并给出理由，
 * 不让用户点完才吃 400；「否决」只记录结论，不改写任何判定。
 */
export function FactReviewOverviewCard({
  overview,
  review,
  labels,
  contract,
  canWrite,
  busy,
  blockResult,
  loading,
  error,
  onSubmit,
  onApprove,
  onReject,
  onRetry
}: FactReviewOverviewCardProps): ReactElement {
  const [notes, setNotes] = useState("");
  const [decisionNote, setDecisionNote] = useState("");

  const approval = overview?.approval ?? EMPTY_APPROVAL;
  /** 最新一次事实审核（同版成稿里版本号最大的那一次）。 */
  const latestReviewVersion = overview?.versions[0]?.version ?? null;
  /**
   * 当前查看的审核结论是否属于**最新一版成稿**。
   *
   * 打开历史成稿的审核记录时，审批按钮必须失效：审批只对「当前要对外讲的那一版」有意义（§57）。
   */
  const belongsToCurrentCopy =
    review !== null && overview !== null && review.copy_output_id === overview.copy_record_id;
  const targetVersion = belongsToCurrentCopy && review ? review.version : latestReviewVersion;
  const mismatch = approvalMismatch(approval, latestReviewVersion, labels);

  /** 换产品就清空输入：不把上一款茶的送审备注带过来。 */
  useEffect(() => {
    setNotes("");
    setDecisionNote("");
  }, [overview?.product_id]);

  /** 换审核版本也要清空审批备注：备注是写给**这一版**的，不能跟着视图漂移（§62-15）。 */
  useEffect(() => {
    setDecisionNote("");
  }, [targetVersion]);

  if (!overview) {
    return (
      <Card title="事实审核与人工审批" spec="§24 / §49 / §53">
        {loading ? <LoadingState label="正在读取事实审核结论" /> : null}
        {!loading && error ? (
          <ErrorState title="事实审核读取失败" description={error} onRetry={onRetry} />
        ) : null}
        {!loading && error === null ? (
          <ErrorState title="没有读到事实审核总览" description="请重试。" onRetry={onRetry} />
        ) : null}
      </Card>
    );
  }

  if (!overview.can_review) {
    return (
      <Card
        title="事实审核与人工审批"
        spec="§24 / §49 / §53 / §57"
        subtitle="逐句把这一版主播稿摊开：每一句是事实 / 解释 / 修辞、风险几档、出处在哪里，再由人决定能不能对外讲。"
        actions={<Pill tone="warn">等待成稿</Pill>}
      >
        <Alert tone="warn">{overview.block_reason ?? "还没有可审核的强成交话术（§53）"}</Alert>
        <p className="muted mt-2">
          事实审核的对象永远是已落库的强成交话术：先去「强成交话术」Tab 生成一版主播稿，回到这里就能逐句看到
          Claim Type、Risk、Evidence 与修改建议（§24 / §49 / §53）。
          在成稿出现之前，这个 Tab 不会用任何简化版顶上去。
        </p>
        {error ? <p className="error mt-2">{error}</p> : null}
      </Card>
    );
  }

  const approvalReason = approveBlockReason(review, canWrite);
  const approveReason = belongsToCurrentCopy
    ? approvalReason
    : "当前查看的这一版不属于最新成稿：审批只对当前要对外讲的那一版生效，请切回最新审核版本（§57）";
  const rejectReason = !canWrite
    ? READ_ONLY_REASON
    : belongsToCurrentCopy
      ? null
      : "当前查看的这一版不属于最新成稿：请先切回最新审核版本再记录人工结论（§57）";
  const blocking = review ? uniqueSentences(review.blocking_sentences) : [];
  const maxVersionsPerCopy =
    labels?.limits.maxVersionsPerCopy ?? FACT_REVIEW_MAX_VERSIONS_FALLBACK;
  const canSubmit = canWrite && busy === null;

  return (
    <div className="stack">
      <Card
        title="事实审核与人工审批"
        spec="§24 / §49 / §53 / §57"
        subtitle="逐句把这一版主播稿摊开：每一句是事实 / 解释 / 修辞、风险几档、出处在哪里，再由人决定能不能对外讲。"
        actions={
          <>
            <Pill tone={statusTone(approval.status)}>{statusLabel(approval.status, labels)}</Pill>
            <Pill tone={review ? riskTone(review.overall_risk) : "neutral"}>
              {review ? `总体风险 ${riskLabel(review.overall_risk, labels)}` : "尚未审核"}
            </Pill>
            <Pill tone={review ? (review.publishable ? "ok" : "danger") : "outline"}>
              {review ? (review.publishable ? "可审批" : "禁止审批") : "待送审"}
            </Pill>
            <Pill tone="neutral">{overview.versions.length} 次审核</Pill>
          </>
        }
      >
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">审核对象（成稿）</div>
            <div className="metric-value">
              {overview.copy_version === null ? "—" : `v${overview.copy_version}`}
            </div>
            <div className="metric-hint">
              事实审核永远针对最新一版主播稿：生成新版话术之后必须重新审（§57）
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">当前审核版本</div>
            <div className="metric-value">{review ? `v${review.version}` : "—"}</div>
            <div className="metric-hint">
              同一版成稿的第 {review?.version ?? 0} 次事实审核
              {maxVersionsPerCopy === null ? "" : `（最多 ${maxVersionsPerCopy} 次）`}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">§49 三档风险</div>
            <div className="metric-value">
              {review ? `${review.summary.green} / ${review.summary.yellow} / ${review.summary.red}` : "—"}
            </div>
            <div className="metric-hint">
              可发布 / 需人工确认 / 禁止发布；RED 是阻断句，出现即禁止审批
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">§24 三层标记</div>
            <div className="metric-value">
              {review
                ? `${review.claim_counts.FACT} / ${review.claim_counts.INTERPRETATION} / ${review.claim_counts.RHETORIC}`
                : "—"}
            </div>
            <div className="metric-hint">事实 / 解释 / 修辞：修辞本身不是事实造假，不判 RED</div>
          </div>
          <div className="metric">
            <div className="metric-label">引用已录入事实</div>
            <div className="metric-value">{review ? `${review.facts_used} 条` : "—"}</div>
            <div className="metric-hint">机械逐字回查到出处的引用条数；查不到出处的说法不进这一列</div>
          </div>
          <div className="metric">
            <div className="metric-label">§24 合规自检</div>
            <div className="metric-value">
              {review ? riskLabel(review.compliance.risk, labels) : "—"}
            </div>
            <div className="metric-hint">
              凭空价格、虚构硬事实、未确认研发关系与收益承诺一律 RED（§24 / §25 / §62）
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">§25 研发证据</div>
            <div className="metric-value">
              {review ? (review.rnd_confirmed ? "RND_CONFIRMED" : "未确认") : "—"}
            </div>
            <div className="metric-hint">
              只有 RND_CONFIRMED 才允许出现真实研发关系暗示；「复刻 X / 同款配方」一律 RED
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">价格锚点</div>
            <div className="metric-value">
              {review ? (review.has_reliable_price_anchor ? "有可靠锚点" : "无锚点") : "—"}
            </div>
            <div className="metric-hint">
              无锚点时价格高度叙事必须逐字改成 §22 标准句，不得自己编一个高度（§22 / §62-10）
            </div>
          </div>
        </div>

        <div className="chip-list mt-3">
          <span className="chip">
            价格高度叙事：{review?.price_high_story_ready ? "就绪" : "不允许"}
          </span>
          <span className="chip">
            人工结论：
            {statusLabel(approval.status, labels)}
            {approval.reviewed_version === null ? "" : `（落在 v${approval.reviewed_version}）`}
          </span>
          <span className="chip">审批时间：{formatDateTime(approval.reviewed_at)}</span>
          <span className="chip">
            {contract?.rules.length ?? 0} 条红线规则 · 口径 {contract?.spec_ref ?? "§24 / §25 / §49 / §53"}
          </span>
        </div>

        {review && !review.publishable ? (
          <Alert tone="error">
            <strong>这一版禁止发布、禁止审批。</strong>
            共 {review.summary.red} 条 RED 阻断句、{blocking.length} 句不重复原句：
            {blocking.length === 0 ? null : (
              <ol>
                {blocking.map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ol>
            )}
            RED 必须改写或删除，不能靠人工审批跳过（§53 / §57 / §62-14）。
          </Alert>
        ) : null}

        {review && review.publishable && review.summary.yellow > 0 ? (
          <Alert tone="warn">
            这一版没有 RED 阻断句，但有 {review.summary.yellow} 条中风险句：发布前请人工确认出处，
            缺出处同样要改写或删除（§49 / §57）。
          </Alert>
        ) : null}

        {review === null ? (
          <Alert tone="info">
            这一版成稿还没有做过事实审核：点下面的「送审最新一版成稿」跑一次逐句标注，
            审核结果会被完整保留，不会被下一次审核覆盖（§53 / §62-15）。
          </Alert>
        ) : null}

        {mismatch ? <Alert tone="warn">{mismatch}</Alert> : null}

        {approval.note ? (
          <p className="muted mt-2">人工备注：{approval.note}</p>
        ) : null}
      </Card>

      <Card
        title="送审与人工决策"
        spec="§53 / §57"
        subtitle="审核是机械逐字回查、AI 只能加严；审批是人对「这一版能不能对外讲」负责——两件事都不会改写稿子原文。"
        actions={
          <>
            <Pill tone={canWrite ? "info" : "outline"}>{canWrite ? "可送审 / 可审批" : "只读"}</Pill>
            <Pill tone="neutral">审核对象 v{overview.copy_version ?? "—"} 成稿</Pill>
          </>
        }
      >
        {blockResult ? (
          <Alert tone="error">
            <strong>{blockResult.message}</strong>
            {blockResult.blockingSentences.length > 0 ? (
              <ol>
                {blockResult.blockingSentences.map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ol>
            ) : null}
            未写入任何「已通过」记录
            {blockResult.reviewedVersion === null ? "" : `（针对事实审核 v${blockResult.reviewedVersion}）`}
            ：RED 阻断句必须改写或删除后才允许审批（§53 / §57）。
          </Alert>
        ) : null}

        <div className="grid-2">
          <div>
            <div className="sub-title">① 送审一版成稿</div>
            <p className="muted">
              送审先跑纯规则引擎，Agent 11 只能把风险判得更严，不会把规则引擎判出的 RED 洗白（§62-14）；
              每送审一次就多一条审核版本，旧结论原样保留（§62-15）。
            </p>
            <label className="checkbox-label" htmlFor="fact-review-notes">
              送审备注（可选）：写给这一版审核的上下文
            </label>
            <input
              id="fact-review-notes"
              className="w-full"
              type="text"
              value={notes}
              placeholder="例如：本版按 §22 标准句处理价格高度"
              onChange={(event) => setNotes(event.target.value)}
              disabled={!canSubmit}
            />
            <div className="btn-row mt-2">
              <button
                type="button"
                className="primary sm"
                disabled={!canSubmit}
                onClick={() => {
                  onSubmit({ notes: notes.trim() === "" ? null : notes.trim() });
                }}
              >
                {busy === "generate" ? "正在审核…" : "送审最新一版成稿"}
              </button>
            </div>
            <p className="muted mt-1">
              {canWrite
                ? `审核对象永远是最新一版成稿；同一版成稿最多保留 ${maxVersionsPerCopy} 次审核。`
                : READ_ONLY_REASON}
            </p>
          </div>

          <div>
            <div className="sub-title">② 人工结论</div>
            <p className="muted">
              审批只改状态、不改正文、不升版本，也不会被下一版继承：新生成一版话术后必须重新审、重新批（§53 / §57）。
            </p>
            <label className="checkbox-label" htmlFor="fact-review-decision-note">
              审批 / 否决备注（可选）：写清依据
            </label>
            <input
              id="fact-review-decision-note"
              className="w-full"
              type="text"
              value={decisionNote}
              placeholder="例如：已人工核对研发记录与原料批次"
              onChange={(event) => setDecisionNote(event.target.value)}
              disabled={busy !== null || !canWrite}
            />
            <div className="btn-row mt-2">
              <button
                type="button"
                className="primary sm"
                disabled={busy !== null || approveReason !== null || targetVersion === null}
                title={approveReason ?? undefined}
                onClick={() => {
                  if (targetVersion === null) {
                    return;
                  }
                  onApprove({
                    version: targetVersion,
                    note: decisionNote.trim() === "" ? null : decisionNote.trim()
                  });
                }}
              >
                {busy === "approve"
                  ? "正在记录…"
                  : `审批通过${targetVersion === null ? "" : ` v${targetVersion}`}`}
              </button>
              <button
                type="button"
                className="secondary sm"
                disabled={busy !== null || rejectReason !== null || targetVersion === null}
                title={rejectReason ?? undefined}
                onClick={() => {
                  if (targetVersion === null) {
                    return;
                  }
                  onReject({
                    version: targetVersion,
                    note: decisionNote.trim() === "" ? null : decisionNote.trim()
                  });
                }}
              >
                {busy === "reject"
                  ? "正在记录…"
                  : `否决这一版${targetVersion === null ? "" : ` v${targetVersion}`}`}
              </button>
            </div>
            {approveReason ? <p className="muted mt-1">{approveReason}</p> : null}
            {rejectReason && rejectReason !== approveReason ? (
              <p className="muted mt-1">{rejectReason}</p>
            ) : null}
          </div>
        </div>

        <div className="sub-title mt-3">§24 三层标记口径（修辞不必删）</div>
        <div className="chip-list">
          {CLAIM_TYPE_ORDER.map((type) => (
            <span className="chip" key={type}>
              {claimTypeLabel(type, labels)}：{claimTypeHint(type, labels)}
            </span>
          ))}
        </div>
        <div className="chip-list mt-2">
          {RISK_LEVEL_ORDER.map((risk) => (
            <span className="chip" key={risk}>
              {riskLabel(risk, labels)}：{riskHint(risk, labels)}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
