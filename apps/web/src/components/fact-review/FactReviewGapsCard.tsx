import type { ReactElement } from "react";
import {
  claimTypeLabel,
  riskLabel,
  uniqueSentences,
  type FactReviewLabels,
  type FactReviewView
} from "../../lib/fact-review.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface FactReviewGapsCardProps {
  review: FactReviewView | null;
  labels: FactReviewLabels | null;
}

function riskTone(risk: FactReviewView["compliance"]["risk"]): "ok" | "warn" | "danger" {
  if (risk === "RED") {
    return "danger";
  }
  return risk === "YELLOW" ? "warn" : "ok";
}

/**
 * 缺口清单与合规自检（规格 §24 / §25 / §49 / §46 / §57）。
 *
 * 两块内容缺一不可：
 * 1. **缺口清单**——这一版哪些地方现在还不允许写、为什么；缺口不是提示，而是硬边界；
 * 2. **合规自检**——凭空价格、虚构硬事实、未确认研发关系与收益承诺一律 RED，
 *    而修辞（比喻 / 反问 / 排比 / 身份塑造）不判 RED（§24 / §49）。
 */
export function FactReviewGapsCard({ review, labels }: FactReviewGapsCardProps): ReactElement {
  if (!review) {
    return (
      <Card title="缺口与合规自检" spec="§24 / §25 / §49">
        <EmptyState
          title="还没有事实审核结论"
          description="送审之后这里会列出这一版的缺口、合规命中项与研发证据口径。"
        />
      </Card>
    );
  }

  const compliance = review.compliance;
  const blocking = uniqueSentences(review.blocking_sentences);

  return (
    <div className="grid-2">
      <Card
        title="缺口清单"
        spec="§11 / §49 / §57"
        subtitle="缺口不是可以跳过的提示，而是「这一层现在还不允许写」的清单；正文里不会用简化版顶上去。"
        actions={
          <Pill tone={review.evidence_gaps.length > 0 ? "warn" : "ok"}>
            {review.evidence_gaps.length} 条
          </Pill>
        }
      >
        {review.evidence_gaps.length === 0 ? (
          <p className="muted">
            当前没有缺口：这一版引用的每一条事实都机械回查到了出处，逐句风险与合规自检都没有 RED。
          </p>
        ) : (
          <ol>
            {review.evidence_gaps.map((gap) => (
              <li key={gap} className="muted">
                {gap}
              </li>
            ))}
          </ol>
        )}

        <div className="sub-title mt-3">阻断句（{blocking.length}）</div>
        {blocking.length === 0 ? (
          <p className="muted">这一版没有 RED 阻断句。</p>
        ) : (
          <ol>
            {blocking.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ol>
        )}

        <div className="sub-title mt-3">引用已录入事实（{review.facts_used} 条）</div>
        <div className="chip-list">
          <span className="chip">
            价格锚点：{review.has_reliable_price_anchor ? "有（可讲价格高度）" : "无（逐字用 §22 标准句）"}
          </span>
          <span className="chip">
            价格高度叙事：{review.price_high_story_ready ? "就绪" : "不允许"}
          </span>
          <span className="chip">
            §25 研发证据：{review.rnd_confirmed ? "RND_CONFIRMED 已确认" : "未确认"}
          </span>
        </div>
      </Card>

      <Card
        title="合规自检与三层标记"
        spec="§24 / §25 / §62"
        subtitle="修辞可以极强，事实一个字都不能编：凭空价格、虚构硬事实、未确认研发关系与收益承诺一律 RED。"
        actions={
          <>
            <Pill tone={riskTone(compliance.risk)}>{riskLabel(compliance.risk, labels)}</Pill>
            <Pill tone={compliance.rnd_confirmed ? "ok" : "outline"}>
              研发关系{compliance.rnd_confirmed ? "已确认" : "未确认"}
            </Pill>
          </>
        }
      >
        <p className="muted">{compliance.note}</p>

        <div className="chip-list mt-2">
          <span className="chip">命中禁止承诺 {compliance.forbidden_promises.length} 处</span>
          <span className="chip">命中受限表述 {compliance.restricted_phrases.length} 处</span>
          <span className="chip">虚构硬事实 {compliance.fabricated_categories.length} 类</span>
          <span className="chip">研发关系暗示：{compliance.rnd_claimed ? "有" : "无"}</span>
        </div>

        {compliance.forbidden_promises.length > 0 ? (
          <div className="alert error mt-2">
            §47 禁止的收益承诺：{compliance.forbidden_promises.join(" / ")}
          </div>
        ) : null}
        {compliance.restricted_phrases.length > 0 ? (
          <div className="alert warn mt-2">
            §25 受限表述：{compliance.restricted_phrases.join(" / ")}
          </div>
        ) : null}
        {compliance.fabricated_categories.length > 0 ? (
          <div className="alert error mt-2">
            虚构硬事实类别：{compliance.fabricated_categories.join(" / ")}
          </div>
        ) : null}

        <div className="sub-title mt-3">§24 三层标记分布</div>
        <div className="chip-list">
          <span className="chip">事实 {review.claim_counts.FACT} 句</span>
          <span className="chip">解释 {review.claim_counts.INTERPRETATION} 句</span>
          <span className="chip">修辞 {review.claim_counts.RHETORIC} 句</span>
        </div>
        <p className="muted mt-1">
          {claimTypeLabel("RHETORIC", labels)}句不必为了「显得保守」全部删掉：
          比喻、反问、排比与身份塑造本身不是事实造假，只要不让人误以为存在可核验事实，就可以保留（§24 / §49）。
        </p>

        {review.warnings.length > 0 ? (
          <>
            <div className="sub-title mt-3">本次审核记录（{review.warnings.length}）</div>
            <ol>
              {review.warnings.map((item) => (
                <li key={item} className="muted">
                  {item}
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </Card>
    </div>
  );
}
