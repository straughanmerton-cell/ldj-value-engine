import type { ReactElement } from "react";
import {
  VALUE_STORY_KEYS,
  VALUE_STORY_STATUS_TONES,
  storyStatusLabel,
  type ValueCodeLabels,
  type ValueCodeProfileView,
  type ValueStoryItem,
  type ValueStoryKey
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface ValueStoriesCardProps {
  profile: ValueCodeProfileView | null;
  labels: ValueCodeLabels | null;
}

/**
 * 六类价值故事（规格 §20 / §60）。
 *
 * 六类故事不是六段文案，而是六种「这款茶能不能这么讲」的资格判断：
 * 事实不够就写 GAP 留空；产品结构故事在 Phase 10 交付后直接取产品结构的正文，
 * 配方哲学仍只登记交接（Phase 11 交付）——绝不允许用简化版先把位置填满。
 */
export function ValueStoriesCard({ profile, labels }: ValueStoriesCardProps): ReactElement {
  return (
    <Card
      title="六类价值故事"
      spec="§20"
      subtitle="身份 / 价格上限 / 产品结构 / 配方哲学 / 风味身份 / 时间：只有拿到事实的故事才允许写正文。"
      actions={
        profile ? (
          <Pill tone="neutral">
            可讲 {VALUE_STORY_KEYS.filter((key) => profile.stories[key].status === "READY").length}
            {" / "}
            {VALUE_STORY_KEYS.length}
          </Pill>
        ) : null
      }
    >
      {!profile ? (
        <EmptyState
          title="还没有生成价值映射"
          description="生成一版之后，这里会按 §20 列出六类故事各自能不能讲、缺什么。"
        />
      ) : (
        <div className="grid-2">
          {VALUE_STORY_KEYS.map((key) => (
            <StoryCard
              key={key}
              storyKey={key}
              story={profile.stories[key]}
              labels={labels}
              handoffPhase={labels?.story_handoff_phases[key] ?? null}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function StoryCard({
  storyKey,
  story,
  labels,
  handoffPhase
}: {
  storyKey: ValueStoryKey;
  story: ValueStoryItem;
  labels: ValueCodeLabels | null;
  handoffPhase: number | null;
}): ReactElement {
  const phase = story.handoff_phase ?? handoffPhase;

  return (
    <div className="card">
      <header className="card-head">
        <h3>
          {labels?.story_labels[storyKey] ?? story.label}
          <span className="spec">
            {story.status === "HANDOFF" ? `Phase ${phase ?? "?"}` : story.layer}
          </span>
        </h3>
        <div className="card-actions">
          <Pill tone={VALUE_STORY_STATUS_TONES[story.status]}>
            {storyStatusLabel(story.status, labels)}
          </Pill>
        </div>
      </header>

      {story.text ? (
        <div className="quote">{story.text}</div>
      ) : (
        <p className="muted">
          {story.status === "HANDOFF"
            ? `完整内容由 Phase ${phase ?? "?"} 交付，本阶段只留位置，不用简化版代替。`
            : "事实不足，正文留空：宁可少讲，不得编。"}
        </p>
      )}

      {story.based_on.length > 0 ? (
        <div className="mt-2">
          <span className="muted">引用的 Value Code：</span>
          <div className="chip-list mt-1">
            {story.based_on.map((code) => (
              <span className="chip mono" key={code}>
                {code}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {story.gap ? <p className="muted mt-2">缺口：{story.gap}</p> : null}
      {story.note ? <p className="muted mt-2">{story.note}</p> : null}
    </div>
  );
}
