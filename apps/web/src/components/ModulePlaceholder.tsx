import type { ReactElement } from "react";
import { Card, PageHeader } from "./ui/Card.js";
import { Pill } from "./ui/State.js";

export interface ModulePlaceholderProps {
  title: string;
  phase: string;
  specRef: string;
  summary: string;
  deliverables: string[];
}

/**
 * 未交付模块的占位页：明确写出所属 Phase 与基线交付内容，
 * 让核心功能在信息架构中保持可见，同时避免被误当成已实现功能。
 */
export function ModulePlaceholder({
  title,
  phase,
  specRef,
  summary,
  deliverables
}: ModulePlaceholderProps): ReactElement {
  return (
    <section>
      <PageHeader
        title={title}
        subtitle={summary}
        actions={<Pill tone="warn">计划交付：{phase}</Pill>}
      />
      <Card title="该模块交付内容" spec={specRef}>
        <ul>
          {deliverables.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Card>
      <Card title="当前状态">
        <p className="muted">
          本页仅登记需求基线的计划交付内容，功能尚未实现，因此不参与任何事实、价格与话术判断。
          对应的产品详情 Tab 与接口同样保持显式占位，不会以简化形态替代。
        </p>
      </Card>
    </section>
  );
}
