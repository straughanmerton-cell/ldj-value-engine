import type { ReactElement } from "react";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  type ProductArchitectureRecordView
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface ProductArchitectureGapsCardProps {
  record: ProductArchitectureRecordView | null;
}

/**
 * 缺口清单与证据来源（规格 §11 / §45 / §62-5）。
 *
 * 这一块是产品结构里最容易被跳过的部分，也是它存在的理由：
 * 哪些角色因为缺事实而留空、证据引用的是哪些字段、有没有参考对标——
 * 全部写清楚，才能保证「讲出来的每一句都能回到自己产品的字段」。
 */
export function ProductArchitectureGapsCard({
  record
}: ProductArchitectureGapsCardProps): ReactElement {
  if (!record) {
    return (
      <Card title="缺口清单与证据来源" spec="§11 / §45">
        <EmptyState
          title="还没有生成产品结构"
          description="生成之后这里会列出需要补录的事实，以及九个角色各自引用了哪些字段。"
        />
      </Card>
    );
  }

  return (
    <div className="grid-2">
      <Card
        title="缺口清单"
        spec="§11 / §62-7"
        subtitle="缺口不是可以跳过的提示，而是「这一部分现在还不允许写」的清单。"
        actions={
          <Pill tone={record.evidence_gaps.length > 0 ? "warn" : "ok"}>
            {record.evidence_gaps.length} 条
          </Pill>
        }
      >
        {record.evidence_gaps.length === 0 ? (
          <p className="muted">当前没有缺口：九个角色都取到了可用事实。</p>
        ) : (
          <ol>
            {record.evidence_gaps.map((gap) => (
              <li key={gap} className="muted">
                {gap}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card
        title="证据来源"
        spec="§45 / §62-5"
        subtitle="证据只允许引用本产品的已录入字段与自身 Value DNA；对标只提供「底层条件」这一层标准。"
      >
        <div className="row between">
          <span className="muted">生成当时的模式</span>
          <span>
            <Pill tone={RESOLVED_MODE_TONES[record.mode]}>
              {RESOLVED_MODE_LABELS[record.mode]}
            </Pill>
            <Pill tone={ANCHOR_RESOLVE_SOURCE_TONES[record.resolved_by]}>
              {ANCHOR_RESOLVE_SOURCE_LABELS[record.resolved_by]}
            </Pill>
          </span>
        </div>
        <p className="muted mt-1">{record.mode_reason}</p>

        <div className="sub-title mt-3">本产品事实字段（{record.fact_refs.length}）</div>
        {record.fact_refs.length === 0 ? (
          <p className="muted">没有引用到任何事实字段。</p>
        ) : (
          <div className="chip-list">
            {record.fact_refs.map((ref) => (
              <span className="chip derived mono" key={ref}>
                {ref}
              </span>
            ))}
          </div>
        )}

        <div className="sub-title mt-3">Value DNA 引用（{record.value_dna_refs.length}）</div>
        {record.value_dna_refs.length === 0 ? (
          <p className="muted">没有引用到 Value DNA（未生成或未参与判定）。</p>
        ) : (
          <div className="chip-list">
            {record.value_dna_refs.map((ref) => (
              <span className="chip ai mono" key={ref}>
                {ref}
              </span>
            ))}
          </div>
        )}

        <div className="sub-title mt-3">下游交接（只登记，不代写）</div>
        <div className="chip-list">
          {record.downstream.map((item) => (
            <span className="chip" key={`${item.phase}-${item.deliverable}`}>
              Phase {item.phase} · {item.deliverable} · {item.status}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
