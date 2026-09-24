import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  useFactReviewContract,
  useFactReviewLabels,
  type FactReviewOverview,
  type FactReviewRecordView,
  type FactReviewVersionSummary,
  type FactReviewVersionsResponse
} from "../../lib/fact-review.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { FactReviewContractCard } from "./FactReviewContractCard.js";
import { FactReviewGapsCard } from "./FactReviewGapsCard.js";
import {
  FactReviewOverviewCard,
  type FactReviewBlockResult,
  type FactReviewDecisionPayload,
  type FactReviewSubmitInput
} from "./FactReviewOverviewCard.js";
import { FactReviewSentenceTable } from "./FactReviewSentenceTable.js";
import { FactReviewVersionList } from "./FactReviewVersionList.js";

export interface FactReviewPanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
}

/**
 * 400 里的阻断结论：审批被拒时把后端的阻断句原样摊给用户，
 * 而不是只弹一句「失败」——哪一句不能讲比失败本身重要得多（§53 / §57）。
 */
function blockResultOf(caught: unknown): FactReviewBlockResult | null {
  if (!(caught instanceof ApiError) || caught.status !== 400) {
    return null;
  }
  const details = caught.details as
    | { blocking_sentences?: unknown; reviewed_version?: unknown }
    | undefined;
  if (!Array.isArray(details?.blocking_sentences)) {
    return null;
  }
  return {
    message: caught.message,
    blockingSentences: details.blocking_sentences.filter(
      (item): item is string => typeof item === "string"
    ),
    reviewedVersion:
      typeof details.reviewed_version === "number" ? details.reviewed_version : null
  };
}

/**
 * Phase 14 事实审核与人工审批面板（规格 §24 / §25 / §36 / §49 / §53 / §57 / §62-14）。
 *
 * 面板只回答一个问题：这一版主播稿里，哪句话不能讲、为什么不能讲、谁批过。
 * 结构固定五块：合同口径、总览与人工决策、§53 逐句标注、缺口与合规自检、审核版本列表。
 *
 * 三条底线在后端，这里只如实呈现：
 * 1. 规则引擎先判、AI 只能加严，判出的 RED 不会被洗白（§62-14）；
 * 2. RED 阻断句禁止审批，必须改写或删除后重新送审（§53 / §57）；
 * 3. 重新审核只新增版本，审批与否决都只留痕、不改写任何判定（§62-15）。
 */
export function FactReviewPanel({ productId, token, canWrite }: FactReviewPanelProps): ReactElement {
  const { notify } = useToast();
  const {
    contract,
    engine,
    downstream,
    limits,
    loading: contractLoading,
    error: contractError
  } = useFactReviewContract(token);
  const { labels } = useFactReviewLabels(token);

  const [overview, setOverview] = useState<FactReviewOverview | null>(null);
  const [record, setRecord] = useState<FactReviewRecordView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generate" | "approve" | "reject" | null>(null);
  const [blockResult, setBlockResult] = useState<FactReviewBlockResult | null>(null);
  const [open, setOpen] = useState(true);
  const [contractOpen, setContractOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<FactReviewVersionSummary[]>([]);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);
  const latestId = overview?.versions[0]?.id ?? null;
  const viewId = selectedId ?? latestId;

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<FactReviewOverview>(`/api/products/${productId}/fact-review`, { token })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setOverview(result);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setOverview(null);
        setError(caught instanceof ApiError ? caught.message : "读取事实审核失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [productId, reloadTick, token]);

  /** 换产品就清掉选中版本与上次的阻断结论，避免把 A 产品的审核结果挂到 B 产品上。 */
  useEffect(() => {
    setSelectedId(null);
    setBlockResult(null);
    setHistory([]);
    setHistoryOpen(false);
  }, [productId]);

  /**
   * 逐句结论按需取：只有 `/fact-review/{reviewId}` 会带 `claim_evidence` 的逐条出处，
   * 总览里的 `review` 只有 `evidence_refs` 字符串（§24 / §46 / §53）。
   */
  useEffect(() => {
    if (!token || !productId || !viewId) {
      setRecord(null);
      return;
    }
    let cancelled = false;
    apiRequest<FactReviewRecordView>(`/api/products/${productId}/fact-review/${viewId}`, { token })
      .then((result) => {
        if (!cancelled) {
          setRecord(result);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setRecord(null);
          notify(caught instanceof ApiError ? caught.message : "读取该审核版本失败", "error");
        }
      });
    return () => {
      cancelled = true;
    };
    // notify 是稳定引用（Toast 上下文），不进依赖以免重复请求。
  }, [productId, reloadTick, token, viewId]);

  const viewReview = record?.review ?? overview?.review ?? null;
  const viewEvidence = record?.evidence ?? [];

  async function generate(input: FactReviewSubmitInput): Promise<void> {
    setBusy("generate");
    try {
      const created = await apiRequest<FactReviewRecordView>(
        `/api/products/${productId}/fact-review/generate`,
        { method: "POST", token, body: input.notes === null ? {} : { notes: input.notes } }
      );
      setBlockResult(null);
      setSelectedId(null);
      notify(
        `已完成事实审核 v${created.review.version}（成稿 v${created.review.copy_version} · 可发布 ${
          created.review.summary.green
        } / 需确认 ${created.review.summary.yellow} / 禁止发布 ${created.review.summary.red} · 引用事实 ${
          created.review.facts_used
        } 条${created.review.publishable ? " · 可以审批" : " · 存在阻断句"}）`,
        created.review.publishable ? "ok" : "warn"
      );
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "事实审核失败", "error");
    } finally {
      setBusy(null);
    }
  }

  /**
   * 人工结论：审批只写状态，不改写任何判定。
   *
   * 存在 RED 阻断句时后端返回 400 并在 details 里带上阻断句，
   * 这里把阻断句原样回显（§53 / §57）。
   */
  async function decide(
    action: "approve" | "reject",
    payload: FactReviewDecisionPayload
  ): Promise<void> {
    setBusy(action);
    setBlockResult(null);
    try {
      const result = await apiRequest<FactReviewRecordView>(
        `/api/products/${productId}/fact-review/${action}`,
        {
          method: "POST",
          token,
          body: payload.note === null ? { version: payload.version } : payload
        }
      );
      notify(
        action === "approve"
          ? `已审批通过事实审核 v${result.review.version}（成稿 v${result.review.copy_version}）`
          : `已否决事实审核 v${result.review.version}（判定结论未改写，留痕保留）`,
        action === "approve" ? "ok" : "warn"
      );
      reload();
    } catch (caught) {
      const blocked = blockResultOf(caught);
      if (blocked) {
        setBlockResult(blocked);
      }
      notify(caught instanceof ApiError ? caught.message : "记录人工结论失败", "error");
    } finally {
      setBusy(null);
    }
  }

  /** 全量历史按需加载：跨成稿版本的审核结论不会被新版覆盖（§62-15）。 */
  async function toggleHistory(): Promise<void> {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (history.length > 0 || !token) {
      return;
    }
    try {
      const result = await apiRequest<FactReviewVersionsResponse>(
        `/api/products/${productId}/fact-review/versions`,
        { token }
      );
      setHistory(result.items ?? []);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "读取全量审核历史失败", "error");
    }
  }

  const approvalStatusText = overview
    ? (labels?.status_labels[overview.approval.status] ?? overview.approval.status)
    : "—";
  const approvedVersion = overview?.approval.reviewed_version ?? null;

  return (
    <div className="stack">
      <Card
        title="事实审核与人工审批（Fact Review & Human Approval）"
        spec="§24 / §25 / §49 / §53 / §57"
        subtitle="主播稿在对外讲之前必须逐句过一遍：哪一句是事实、哪一句是修辞、哪一句没有证据，谁批过、批的是哪一版。"
        actions={
          <>
            {viewReview ? (
              <Pill tone={viewReview.publishable ? "ok" : "danger"}>
                审核 v{viewReview.version}：{viewReview.summary.green} 可发布 / {viewReview.summary.yellow}{" "}
                需确认 / {viewReview.summary.red} 禁止发布
              </Pill>
            ) : (
              <Pill tone="neutral">尚未做过事实审核</Pill>
            )}
            <Pill tone="neutral">成稿 v{overview?.copy_version ?? "—"}</Pill>
            <Pill tone="info">{overview?.versions.length ?? 0} 次审核</Pill>
            <button
              type="button"
              className="secondary sm"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "收起审核面板" : "展开审核面板"}
            </button>
          </>
        }
      >
        <p className="muted">
          {viewReview
            ? `当前查看的是审核 v${viewReview.version}（成稿 v${viewReview.copy_version}）：§24 三层标记 事实 ${
                viewReview.claim_counts.FACT
              } / 解释 ${viewReview.claim_counts.INTERPRETATION} / 修辞 ${
                viewReview.claim_counts.RHETORIC
              } 句，引用已录入事实 ${viewReview.facts_used} 条，合规风险 ${
                viewReview.compliance.risk
              }，${viewReview.publishable ? "没有阻断句，可以进入人工审批" : "存在阻断句，禁止审批"}；人工结论为「${
                approvalStatusText
              }」${approvedVersion === null ? "" : `（落在审核 v${approvedVersion}）`}。`
            : "还没有任何事实审核结论：这一版主播稿不能直接拿去讲。先送审一次，逐句看 Claim Type、Risk、Evidence 与修改建议，再由人决定能不能通过。"}
        </p>
        {!open ? (
          <p className="muted mt-2">
            展开后可查看 §24 / §49 / §53 合同口径、逐句标注表、缺口与合规自检，以及全部审核版本与人工留痕。
          </p>
        ) : null}
      </Card>

      {open ? (
        <>
          <FactReviewContractCard
            contract={contract}
            engine={engine}
            downstream={downstream}
            limits={limits}
            labels={labels}
            loading={contractLoading}
            error={contractError}
            open={contractOpen}
            onToggle={() => setContractOpen((value) => !value)}
          />

          <FactReviewOverviewCard
            overview={overview}
            review={viewReview}
            labels={labels}
            contract={contract}
            canWrite={canWrite}
            busy={busy}
            blockResult={blockResult}
            loading={loading}
            error={error}
            onSubmit={(input) => void generate(input)}
            onApprove={(payload) => void decide("approve", payload)}
            onReject={(payload) => void decide("reject", payload)}
            onRetry={reload}
          />

          <FactReviewSentenceTable review={viewReview} evidence={viewEvidence} labels={labels} />

          <FactReviewGapsCard review={viewReview} labels={labels} />

          <FactReviewVersionList
            overview={overview}
            labels={labels}
            selectedId={selectedId}
            latestId={latestId}
            history={history}
            historyOpen={historyOpen}
            onToggleHistory={() => void toggleHistory()}
            onSelect={(id) => setSelectedId(id === latestId ? null : id)}
          />
        </>
      ) : null}
    </div>
  );
}
