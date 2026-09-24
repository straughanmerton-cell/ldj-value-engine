import type { ReactElement } from "react";
import { type CategoryCreatorProfileView } from "../../lib/category-creator.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, Pill } from "../ui/State.js";

export interface CategoryCreatorIdentityCardProps {
  profile: CategoryCreatorProfileView | null;
}

/**
 * 风格身份证（§4.2 / §29）。
 *
 * 这一块回答「这款茶自己给自己定的风格是什么」：定位、第一口、中段、收尾、最不能丢的一项，
 * 以及**明确不声称什么**。不声称的部分必须写在身份证上，而不是藏在备注里：
 * 自建标准最容易出的错，是为了显得高端而顺手借来别人的故事（§25 / §62-5）。
 */
export function CategoryCreatorIdentityCard({
  profile
}: CategoryCreatorIdentityCardProps): ReactElement {
  if (!profile) {
    return (
      <Card title="风格身份证" spec="§4.2 / §29">
        <EmptyState
          title="还没有风格身份证"
          description="生成自建标准后，这一块会给出这款茶自己的风格定义与不可丢失项。"
        />
      </Card>
    );
  }

  const identity = profile.style_identity;

  return (
    <Card
      title="风格身份证"
      spec="§4.2 / §29"
      subtitle="不照抄现成模板：先说清这款茶自己按什么标准成立，再谈它像不像谁。"
      actions={<Pill tone="brand">{identity.identity_name}</Pill>}
    >
      <p className="mode-reason">{identity.category_positioning}</p>

      <div className="table-wrap mt-3">
        <table>
          <thead>
            <tr>
              <th>段落</th>
              <th>风格定义</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="nowrap">第一口</th>
              <td>{identity.first_impression ?? <span className="muted">未录入（不得书写）</span>}</td>
            </tr>
            <tr>
              <th className="nowrap">中段（骨架）</th>
              <td>{identity.mid_palate ?? <span className="muted">未录入（不得书写）</span>}</td>
            </tr>
            <tr>
              <th className="nowrap">收尾（后半程）</th>
              <td>{identity.finish ?? <span className="muted">未录入（不得书写）</span>}</td>
            </tr>
            <tr>
              <th className="nowrap">最不能丢的一项</th>
              <td>{identity.signature_trait ?? <span className="muted">结构尚未成立，暂不指定</span>}</td>
            </tr>
            <tr>
              <th className="nowrap">时间维度（§19）</th>
              <td>
                {identity.time_story ?? (
                  <span className="muted">留位：TIME_DEPENDENT 表达由 Phase 9 Value Codes 交付</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="sub-title">结构层面的差异（不点名竞品）</div>
      {identity.differentiators.length > 0 ? (
        <ul className="prov-list">
          {identity.differentiators.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">尚未形成结构差异描述：先补事实，再谈差异。</p>
      )}

      <div className="sub-title">明确不声称</div>
      <ul className="prov-list">
        {identity.not_claiming.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <Alert tone="info">
        身份证上的每一句都来自已录入事实或标准本身；没有事实支撑的位置留空，
        不借用「复刻」「同源」「大师配方」这类无法证明的说法（§25 / §62-5 / §62-7）。
      </Alert>
    </Card>
  );
}
