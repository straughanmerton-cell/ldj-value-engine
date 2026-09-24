import type { ReactElement } from "react";
import {
  CATEGORY_AXIS_STATUS_LABELS,
  CATEGORY_AXIS_STATUS_TONES,
  CATEGORY_READINESS_LABELS,
  CATEGORY_READINESS_TONES,
  type CategoryCreatorProfileView
} from "../../lib/category-creator.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, LoadingState, Pill } from "../ui/State.js";

export interface CategoryCreatorStandardCardProps {
  profile: CategoryCreatorProfileView | null;
  loading: boolean;
}

/**
 * 六标准轴对照表（§4.2 / §29）。
 *
 * 每一轴都必须同时给出四件事，否则这张表会退化成文案预览：
 * 这一轴「必须成立什么」（标准）、「拿到了哪些事实」（证据）、「现在能不能写」（状态）、
 * 「还缺什么」（缺口）。UNKNOWN 轴的 statement 必须为空，界面显示「未录入（不得书写）」。
 */
export function CategoryCreatorStandardCard({
  profile,
  loading
}: CategoryCreatorStandardCardProps): ReactElement {
  if (!profile) {
    return (
      <Card title="自建产品标准（六个标准轴）" spec="§4.2 / §29">
        {loading ? (
          <LoadingState label="正在读取自建标准" />
        ) : (
          <EmptyState
            title="还没有可查看的自建标准"
            description="先在上方生成一版：标准由已录入事实推出来，不会凭空补全任何字段。"
          />
        )}
      </Card>
    );
  }

  const standard = profile.standard;

  return (
    <Card
      title={`自建产品标准 v${profile.version}（六个标准轴）`}
      spec="§4.2 / §29"
      subtitle="六个位置各自负责一件事：先把结构说清，再谈它为什么值钱。空白的位置不会用形容词补上。"
      actions={
        <>
          <Pill tone={CATEGORY_READINESS_TONES[profile.readiness]}>
            {CATEGORY_READINESS_LABELS[profile.readiness]}
          </Pill>
          <Pill tone="ok">有事实 {standard.supported_count}</Pill>
          <Pill tone="warn">单点事实 {standard.partial_count}</Pill>
          <Pill tone="danger">未录入 {standard.unknown_count}</Pill>
        </>
      }
    >
      <Alert tone={profile.readiness === "INSUFFICIENT" ? "warn" : "info"}>{standard.summary}</Alert>

      <div className="table-wrap mt-3">
        <table>
          <thead>
            <tr>
              <th>标准轴</th>
              <th>这一轴必须成立什么</th>
              <th>已录入事实</th>
              <th>前台标准表达</th>
              <th>缺口</th>
            </tr>
          </thead>
          <tbody>
            {standard.items.map((item) => (
              <tr key={item.axis}>
                <td>
                  <div className="anchor-name">{item.label}</div>
                  <Pill tone={CATEGORY_AXIS_STATUS_TONES[item.status]}>
                    {CATEGORY_AXIS_STATUS_LABELS[item.status]}
                  </Pill>
                  <div className="muted">
                    <code className="mono">{item.axis}</code>
                  </div>
                </td>
                <td>
                  {item.requirement}
                  <div className="muted mt-1">{item.why_it_matters}</div>
                </td>
                <td>
                  <div>{item.evidence_summary}</div>
                  {item.evidence_refs.length > 0 ? (
                    <div className="chip-list mt-2">
                      {item.evidence_refs.map((ref) => (
                        <span className="chip muted" key={ref}>
                          <code className="mono">{ref}</code>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td>
                  {item.statement ? (
                    <span>{item.statement}</span>
                  ) : (
                    <span className="muted">未录入（不得书写）</span>
                  )}
                  <div className="muted mt-1">标记：INTERPRETATION（§24）</div>
                </td>
                <td className="muted">{item.gap ?? "无缺口"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sub-title">缺口清单（这套标准的组成部分）</div>
      {profile.evidence_gaps.length > 0 ? (
        <ul className="prov-list">
          {profile.evidence_gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">当前事实已覆盖六个标准轴，没有登记缺口。</p>
      )}

      <div className="sub-title">证据引用</div>
      <div className="grid-2">
        <div>
          <div className="muted">产品事实（{profile.fact_refs.length} 项）</div>
          <div className="chip-list mt-2">
            {profile.fact_refs.length > 0 ? (
              profile.fact_refs.map((ref) => (
                <span className="chip" key={ref}>
                  <code className="mono">{ref}</code>
                </span>
              ))
            ) : (
              <span className="muted">未引用任何已录入事实</span>
            )}
          </div>
        </div>
        <div>
          <div className="muted">价值 DNA（{profile.value_dna_refs.length} 项）</div>
          <div className="chip-list mt-2">
            {profile.value_dna_refs.length > 0 ? (
              profile.value_dna_refs.map((ref) => (
                <span className="chip ai" key={ref}>
                  <code className="mono">{ref}</code>
                </span>
              ))
            ) : (
              <span className="muted">尚未生成价值 DNA（§9），身份与价值逻辑的证据面偏窄</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
