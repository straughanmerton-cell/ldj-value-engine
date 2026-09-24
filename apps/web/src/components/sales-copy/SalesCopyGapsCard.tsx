import type { ReactElement } from "react";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  intensityLabel,
  valueFocusLabel,
  type SalesCopyComplianceRisk,
  type SalesCopyLabels,
  type SalesCopyRecordView
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface SalesCopyGapsCardProps {
  record: SalesCopyRecordView | null;
  labels: SalesCopyLabels | null;
}

function riskTone(risk: SalesCopyComplianceRisk): "ok" | "warn" | "danger" {
  if (risk === "RED") {
    return "danger";
  }
  return risk === "YELLOW" ? "warn" : "ok";
}

/**
 * 缺口、证据来源与合规自检（规格 §11 / §24 / §25 / §46 / §62-5 / §62-7）。
 *
 * 三块内容缺一不可：
 * 1. **缺口清单**——这一版哪些地方现在还不允许写，以及为什么；
 * 2. **证据来源**——使用的每一条事实字段、Value DNA、上游成稿，以及价格锚点口径；
 * 3. **合规自检**——修辞不判 RED，但凭空价格、虚构硬事实、未确认研发关系与收益承诺一律 RED。
 */
export function SalesCopyGapsCard({ record, labels }: SalesCopyGapsCardProps): ReactElement {
  if (!record) {
    return (
      <Card title="缺口清单与证据来源" spec="§11 / §24">
        <EmptyState
          title="还没有生成强成交话术"
          description="生成之后这里会列出缺口、引用的事实字段、上游成稿与合规自检结果。"
        />
      </Card>
    );
  }

  const compliance = record.compliance;

  return (
    <div className="grid-2">
      <Card
        title="缺口清单"
        spec="§11 / §62-7"
        subtitle="缺口不是可以跳过的提示，而是「这一层现在还不允许写」的清单；正文里不会用简化版顶上去。"
        actions={
          <Pill tone={record.evidence_gaps.length > 0 ? "warn" : "ok"}>
            {record.evidence_gaps.length} 条
          </Pill>
        }
      >
        {record.evidence_gaps.length === 0 ? (
          <p className="muted">
            当前没有缺口：九种输出齐备、八项评分达标、Level 5 与合规自检都已通过。
          </p>
        ) : (
          <ol>
            {record.evidence_gaps.map((gap) => (
              <li key={gap} className="muted">
                {gap}
              </li>
            ))}
          </ol>
        )}

        <div className="sub-title mt-3">§57 验收未通过项</div>
        {record.acceptance.missing.length === 0 ? (
          <p className="muted">
            §57 验收通过：{record.acceptance.question}
          </p>
        ) : (
          <ul>
            {record.acceptance.missing.map((item) => (
              <li key={item} className="muted">
                {item}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="合规自检与证据来源"
        spec="§24 / §25 / §62"
        subtitle="修辞可以极强，事实一个字都不能编：凭空价格、虚构硬事实、未确认研发关系与收益承诺一律 RED。"
        actions={
          <>
            <Pill tone={riskTone(compliance.risk)}>{compliance.risk}</Pill>
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

        <div className="sub-title mt-3">上游成稿引用（{record.upstream_refs.length}）</div>
        {record.upstream_refs.length === 0 ? (
          <p className="muted">没有引用到上游成稿。</p>
        ) : (
          <div className="chip-list">
            {record.upstream_refs.map((ref) => (
              <span className="chip mono" key={ref}>
                {ref}
              </span>
            ))}
          </div>
        )}

        <div className="sub-title mt-3">生成口径</div>
        <div className="row between">
          <span className="muted">生成当时的模式</span>
          <span>
            <Pill tone={RESOLVED_MODE_TONES[record.mode_at_generation]}>
              {RESOLVED_MODE_LABELS[record.mode_at_generation]}
            </Pill>
            <Pill tone={ANCHOR_RESOLVE_SOURCE_TONES[record.resolved_by]}>
              {ANCHOR_RESOLVE_SOURCE_LABELS[record.resolved_by]}
            </Pill>
            <Pill tone="neutral">{intensityLabel(record.intensity, null)}</Pill>
          </span>
        </div>
        <p className="muted mt-1">{record.mode_reason}</p>

        <div className="chip-list mt-2">
          <span className="chip">
            价格锚点：{record.anchor.has_reliable_price_anchor ? "有（可讲价格高度）" : "无（逐字用 §22 标准句）"}
          </span>
          <span className="chip">锚点数量 {record.anchor.anchor_count}</span>
          <span className="chip">
            主锚点：{record.anchor.primary_anchor_name ?? "—"}
          </span>
        </div>

        <div className="sub-title mt-3">§33 价值重点落位</div>
        <div className="chip-list">
          {record.value_focus.map((key) => (
            <span className="chip" key={key}>
              {valueFocusLabel(key, labels)}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
