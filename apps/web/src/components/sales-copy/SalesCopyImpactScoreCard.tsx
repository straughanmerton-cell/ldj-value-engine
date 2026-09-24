import type { ReactElement } from "react";
import {
  IMPACT_SCORE_BAND_FALLBACK_META,
  IMPACT_SCORE_ITEM_ORDER,
  type SalesCopyRecordView
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface SalesCopyImpactScoreCardProps {
  record: SalesCopyRecordView | null;
}

/**
 * §23 成交冲击力评分板。
 *
 * 八项权重合计 100，逐条机械判定——**分数不是印象分**，每一条都能指出成稿里对不上的那句话。
 * 事实不足时评分会被机械压分（< 4 条已录入事实直接封顶），所以「分低」在这块板上一眼能看出是缺事实，
 * 而不是主播不够努力。
 */
export function SalesCopyImpactScoreCard({
  record
}: SalesCopyImpactScoreCardProps): ReactElement {
  if (!record) {
    return (
      <Card title="成交冲击力评分（§23）" spec="§23">
        <EmptyState
          title="还没有生成强成交话术"
          description="生成之后这里会按八个评分项逐条给出得分依据：哪一条过了、哪一条没过、分是怎么丢的。"
        />
      </Card>
    );
  }

  const impact = record.impact_score;
  /** 只用于色条宽度：分数永远来自 §23 八项机械求和（§13 / §23）。 */
  const bandMeta = IMPACT_SCORE_BAND_FALLBACK_META[impact.band];
  const percent = impact.max > 0 ? Math.round((impact.total / impact.max) * 100) : 0;

  /** 按 §23 固定顺序展示，缺项交给后端返回的 items 兜底。 */
  const items = IMPACT_SCORE_ITEM_ORDER.map((key) =>
    impact.items.find((item) => item.key === key)
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <Card
      title="成交冲击力评分（§23）"
      spec="§23 / §57"
      subtitle="八项权重合计 100 分，逐条机械判定：开场抓不抓人、身份立没立住、价值感够不够、价格或标准有没有锚、差异与画面感、记忆点、收口。"
      actions={
        <>
          <Pill tone={bandMeta.tone}>{impact.band_label}</Pill>
          <Pill tone={impact.passed ? "ok" : "danger"}>
            {impact.passed ? "已达本档门槛" : "未达本档门槛"}
          </Pill>
        </>
      }
    >
      <div className="grid-3">
        <div className="metric">
          <div className="metric-label">总分</div>
          <div className="metric-value">
            {impact.total} / {impact.max}
          </div>
          <div className="metric-hint">
            本档要求：
            {impact.required === null ? "无硬性门槛" : `≥ ${impact.required}`}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">分档</div>
          <div className="metric-value">{impact.band_label}</div>
          <div className="metric-hint">{bandMeta.note}</div>
        </div>
        <div className="metric">
          <div className="metric-label">引用已录入事实</div>
          <div className="metric-value">{impact.facts_used}</div>
          <div className="metric-hint">少于 4 条会被机械压分</div>
        </div>
      </div>

      <div className="progress-bar mt-3">
        <div className="progress-bar-fill" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="muted">
        得分率 {percent}%（{impact.total} / {impact.max}）。{impact.note}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>评分项</th>
              <th>权重</th>
              <th>得分</th>
              <th>逐条判定</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.key}>
                <td className="nowrap">
                  <strong>{item.label}</strong>
                  <div className="muted mono mt-1">{item.key}</div>
                  <div className="muted">{item.criterion}</div>
                </td>
                <td className="nowrap">{item.weight} 分</td>
                <td className="nowrap">
                  <Pill tone={item.points === item.weight ? "ok" : item.points === 0 ? "danger" : "warn"}>
                    {item.points} 分
                  </Pill>
                </td>
                <td>
                  <ul>
                    {item.criteria.map((criterion) => (
                      <li key={`${item.key}-${criterion.key}`}>
                        <Pill tone={criterion.passed ? "ok" : "danger"}>
                          {criterion.passed ? "通过" : "未过"}
                        </Pill>{" "}
                        <span className="muted">
                          {criterion.check}（{criterion.points} 分）
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Alert tone={impact.total < 70 ? "error" : impact.passed ? "info" : "warn"}>
        {impact.total < 70
          ? "< 70 分属于「自动重写」档：不得发布，必须补事实或重写，不允许靠加大修辞把分数说上去（§23 / §24）。"
          : impact.passed
            ? "已达本档门槛；分数只说明「八项机械条件都满足了」，是否发布仍要过合规自检与人工确认（§24 / §57）。"
            : "未达本档门槛：Level 4 需 ≥ 85、Level 5 需 ≥ 90；缺的是事实与结构，不是修辞强度（§21 / §23）。"}
      </Alert>
    </Card>
  );
}
