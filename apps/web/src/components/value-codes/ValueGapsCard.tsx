import type { ReactElement } from "react";
import {
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  type ValueCodeProfileView
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface ValueGapsCardProps {
  profile: ValueCodeProfileView | null;
}

/**
 * 缺口清单与证据来源（规格 §11 / §44 / §62-5）。
 *
 * 这一块是价值映射里最容易被跳过的部分，也是它存在的理由：
 * 缺哪些事实、证据引用的是哪些字段、有没有参考对标——
 * 全部写清楚，才能保证「讲出来的每一句都能回到自己产品的字段」。
 */
export function ValueGapsCard({ profile }: ValueGapsCardProps): ReactElement {
  if (!profile) {
    return (
      <Card title="缺口清单与证据来源" spec="§11 / §44">
        <EmptyState
          title="还没有生成价值映射"
          description="生成之后这里会列出需要补录的事实，以及每类证据引用了哪些字段。"
        />
      </Card>
    );
  }

  const anchor = profile.anchor_context;

  return (
    <div className="grid-2">
      <Card
        title="缺口清单"
        spec="§11 / §62-7"
        subtitle="缺口不是可以跳过的提示，而是「这句话现在还不允许说」的清单。"
        actions={<Pill tone={profile.evidence_gaps.length > 0 ? "warn" : "ok"}>
          {profile.evidence_gaps.length} 条
        </Pill>}
      >
        {profile.evidence_gaps.length === 0 ? (
          <p className="muted">当前没有缺口：每个 Code 都拿到了至少一条可用事实。</p>
        ) : (
          <ol>
            {profile.evidence_gaps.map((gap) => (
              <li key={gap} className="muted">
                {gap}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card
        title="证据来源"
        spec="§44 / §62-5"
        subtitle="证据只允许引用本产品的已录入事实与自身 Value DNA；对标只提供「底层条件」这一层标准。"
      >
        <div className="row between">
          <span className="muted">模式判定</span>
          <span>
            <Pill tone={RESOLVED_MODE_TONES[profile.mode_at_generation]}>
              {RESOLVED_MODE_LABELS[profile.mode_at_generation]}
            </Pill>
            <Pill tone={ANCHOR_RESOLVE_SOURCE_TONES[profile.resolved_by]}>
              {ANCHOR_RESOLVE_SOURCE_LABELS[profile.resolved_by]}
            </Pill>
          </span>
        </div>
        <p className="muted mt-1">{profile.mode_reason}</p>

        <div className="sub-title mt-3">本产品事实字段（{profile.fact_refs.length}）</div>
        {profile.fact_refs.length === 0 ? (
          <p className="muted">没有引用到任何事实字段。</p>
        ) : (
          <div className="chip-list">
            {profile.fact_refs.map((ref) => (
              <span className="chip derived mono" key={ref}>
                {ref}
              </span>
            ))}
          </div>
        )}

        <div className="sub-title mt-3">Value DNA 引用（{profile.value_dna_refs.length}）</div>
        {profile.value_dna_refs.length === 0 ? (
          <p className="muted">没有引用到 Value DNA（未生成或未参与判定）。</p>
        ) : (
          <div className="chip-list">
            {profile.value_dna_refs.map((ref) => (
              <span className="chip ai mono" key={ref}>
                {ref}
              </span>
            ))}
          </div>
        )}

        <div className="sub-title mt-3">对标上下文（只作为标准，不作为本产品事实）</div>
        {anchor ? (
          <p className="muted">
            {anchor.name ?? "未命名锚点"} · 相似度 {anchor.similarity_score ?? "—"} · 价格证据{" "}
            {anchor.price_evidence_score ?? "—"} · 用途 {anchor.usage}
          </p>
        ) : (
          <p className="muted">
            当前没有对标上下文（自建高端标准模式）：这不是缺陷，硬凑竞品才是。
          </p>
        )}
      </Card>
    </div>
  );
}
