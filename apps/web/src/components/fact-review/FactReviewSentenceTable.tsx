import type { ReactElement } from "react";
import {
  FACT_REVIEW_SENTENCE_COLUMN_FALLBACK,
  claimTypeLabel,
  claimTypeTone,
  evidenceByRef,
  evidenceKindLabel,
  riskLabel,
  riskTone,
  uniqueSentences,
  type FactEvidenceView,
  type FactReviewLabels,
  type FactReviewView
} from "../../lib/fact-review.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface FactReviewSentenceTableProps {
  review: FactReviewView | null;
  /** `claim_evidence` 的逐条出处；按 `字段路径=逐字值` 挂回对应句子（§24 / §46）。 */
  evidence: FactEvidenceView[];
  labels: FactReviewLabels | null;
}

/**
 * §53 逐句标注页：`句子 / Claim Type / Risk / Evidence / 修改建议`。
 *
 * 这张表是事实审核的正文页，规则很简单但一条都不能省：
 * 1. **一句都不许漏**：成稿切出来的每句话都要有一行结论，顺序与 §26 九种输出一致；
 * 2. **Evidence 是机械回查结果**：出处逐字来自本产品已录入字段 / Value DNA / 上游成稿，AI 不得增删；
 * 3. **RED 行是阻断句**：必须改写或删除，不能靠人工审批跳过（§53 / §57 / §62-14）。
 */
export function FactReviewSentenceTable({
  review,
  evidence,
  labels
}: FactReviewSentenceTableProps): ReactElement {
  if (!review) {
    return (
      <Card title="§53 逐句标注" spec="§24 / §49 / §53">
        <EmptyState
          title="还没有事实审核结论"
          description="送审一版成稿之后，这里会逐句列出 Claim Type、Risk、Evidence 与修改建议；一句话都不会漏。"
        />
      </Card>
    );
  }

  const columns = labels?.sentence_columns ?? FACT_REVIEW_SENTENCE_COLUMN_FALLBACK;
  const grouped = evidenceByRef(evidence);
  const blocking = uniqueSentences(review.blocking_sentences);

  return (
    <Card
      title="§53 逐句标注"
      spec="§24 / §49 / §53"
      subtitle="成稿里每一句话是事实、解释还是修辞，风险几档，出处能不能点回去，一句话一行。"
      actions={
        <>
          <Pill tone="ok">{review.summary.green} 可发布</Pill>
          <Pill tone="warn">{review.summary.yellow} 需确认</Pill>
          <Pill tone={review.summary.red > 0 ? "danger" : "ok"}>{review.summary.red} 禁止发布</Pill>
          <Pill tone="neutral">共 {review.sentences.length} 句</Pill>
        </>
      }
    >
      {review.summary.red > 0 ? (
        <Alert tone="error">
          有 {review.summary.red} 条 RED 阻断句（{blocking.length} 句不重复原句）：必须改写或删除，
          不能靠人工审批跳过；改写后重新送审，旧审核版本仍会保留（§53 / §57 / §62-15）。
        </Alert>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="nowrap">#</th>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {review.sentences.map((sentence) => {
              const refs = sentence.evidence_refs
                .map((ref) => grouped.get(ref)?.[0] ?? null)
                .filter((item): item is FactEvidenceView => item !== null);

              return (
                <tr
                  key={`${sentence.index}-${sentence.text}`}
                  className={sentence.is_blocking ? "row-selected" : undefined}
                >
                  <td className="nowrap mono">{sentence.index}</td>
                  <td>
                    <div className="quote">{sentence.text}</div>
                    {sentence.is_blocking ? (
                      <Pill tone="danger">阻断句：禁止审批</Pill>
                    ) : null}
                  </td>
                  <td className="nowrap">
                    <Pill tone={claimTypeTone(sentence.claim_type)}>
                      {claimTypeLabel(sentence.claim_type, labels)}
                    </Pill>
                    <div className="muted mono">{sentence.claim_type}</div>
                  </td>
                  <td className="nowrap">
                    <Pill tone={riskTone(sentence.risk)}>{riskLabel(sentence.risk, labels)}</Pill>
                    <div className="muted mono">{sentence.risk}</div>
                  </td>
                  <td>
                    {refs.length === 0 ? (
                      <span className="muted">
                        {sentence.claim_type === "RHETORIC"
                          ? "修辞表达：不需要逐字出处，但不得让消费者误以为存在可核验事实（§24）"
                          : "没有机械回查到任何出处：这一句必须改写或先补证据（§49）"}
                      </span>
                    ) : (
                      <ul>
                        {refs.map((item) => (
                          <li key={item.id} className="mono">
                            <Pill tone={item.traceable ? "ok" : "warn"}>
                              {evidenceKindLabel(item.evidence_kind, labels)}
                            </Pill>
                            {` ${item.source_ref}=${item.excerpt}`}
                            {item.traceable ? null : (
                              <span className="muted">（未标注为可回溯，需人工确认）</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    {sentence.suggestion ?? sentence.issue ?? (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted mt-2">
        判定口径：{review.spec_ref}。Evidence 一律以规则引擎的机械逐字回查为准，
        Agent 11 只能把风险判得更严，不会替你补一条出处（§62-14）。
      </p>
    </Card>
  );
}
