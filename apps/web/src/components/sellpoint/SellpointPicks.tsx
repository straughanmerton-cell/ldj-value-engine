import { useState, type ReactElement } from "react";
import {
  TEA_KNOWLEDGE_GROUPS,
  teaPickedKeys,
  type TeaKnowledgeGroupKey
} from "../../lib/tea-knowledge.js";

/**
 * 卖点知识库选项卡（客户 2026-09-28：「改成一个卖点选择…每一个茶区的卖点、香型直接弄成知识库，
 * 然后做成一个选项卡，有这种快捷的选项」；随后追加：「包括生茶的卖点、熟茶的卖点」）。
 *
 * 五个页签：产区风格 / 香型倾向 / 生茶卖点 / 熟茶卖点 / 价值角度。
 * 点一下就选中（再点取消），选中的项会拼成一段「我勾的卖点方向」跟着需求一起发出去。
 *
 * 三件事刻意做成这样：
 * 1. **可多选但不设上限**：茶可以同时是「易武 + 蜜香 + 回甘生津 + 干仓」，硬拦反而难用；
 * 2. **勾选不等于事实**：每一组都写着这一组是「方向」，选项文案不出现价格、不出现收益承诺（§62-8 / §62-9）；
 * 3. **不写回输入框**：方向只在发送那一刻拼进去（`composeRequirement`），
 *    免得把用户自己那句「帮我写一页卖点」改得面目全非。
 */

export interface SellpointPicksProps {
  picks: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  disabled?: boolean;
  /** 塞在底部输入条里时更矮（行数更少、选项区更短） */
  compact?: boolean;
}

export function SellpointPicks({
  picks,
  onToggle,
  onClear,
  disabled = false,
  compact = false
}: SellpointPicksProps): ReactElement {
  const [tabKey, setTabKey] = useState<TeaKnowledgeGroupKey>("region");
  const activeGroup =
    TEA_KNOWLEDGE_GROUPS.find((group) => group.key === tabKey) ?? TEA_KNOWLEDGE_GROUPS[0];

  if (!activeGroup) {
    return <></>;
  }

  return (
    <section className={compact ? "slide-picks is-compact" : "slide-picks"}>
      <header className="slide-picks-head">
        <strong className="slide-picks-title">卖点知识库</strong>
        <span className="slide-picks-count">
          {picks.length > 0 ? `已选 ${picks.length} 项` : "点一下就是方向 · 也可以不选"}
        </span>
        {picks.length > 0 ? (
          <button className="ghost sm" type="button" disabled={disabled} onClick={onClear}>
            清空
          </button>
        ) : null}
      </header>

      <div className="slide-picks-tabs" role="tablist">
        {TEA_KNOWLEDGE_GROUPS.map((group) => {
          const count = teaPickedKeys(group, picks).length;
          const active = group.key === activeGroup.key;
          return (
            <button
              key={group.key}
              aria-selected={active}
              className={active ? "slide-picks-tab is-active" : "slide-picks-tab"}
              disabled={disabled}
              role="tab"
              type="button"
              onClick={() => setTabKey(group.key)}
            >
              {group.label}
              {count > 0 ? <span className="slide-picks-badge">{count}</span> : null}
            </button>
          );
        })}
      </div>

      <p className="slide-picks-hint">{activeGroup.hint}</p>

      <div className="slide-picks-body" role="tabpanel">
        {activeGroup.items.map((item) => {
          const selected = picks.includes(item.key);
          return (
            <button
              key={item.key}
              aria-pressed={selected}
              className={selected ? "slide-pick is-on" : "slide-pick"}
              disabled={disabled}
              type="button"
              onClick={() => onToggle(item.key)}
            >
              <strong>{item.label}</strong>
              <span>{item.note}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
