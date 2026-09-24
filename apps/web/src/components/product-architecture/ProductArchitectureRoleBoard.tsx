import { useState, type ReactElement } from "react";
import {
  PRODUCT_ARCHITECTURE_ROLE_ORDER,
  roleStatusLabel,
  roleStatusTone,
  type ProductArchitectureLabels,
  type ProductArchitectureRecordView,
  type ProductArchitectureRoleKey,
  type ProductArchitectureRoleView
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface ProductArchitectureRoleBoardProps {
  record: ProductArchitectureRecordView | null;
  labels: ProductArchitectureLabels | null;
  loading: boolean;
}

/**
 * 九个角色板（规格 §5 / §45）。
 *
 * 这是本模块的主视图：**每一张卡就是一个角色**，写实了就展示正文与它引用的字段，
 * 没写实就展示缺口与「要写实它至少需要哪些事实」。
 * 界面刻意不提供「补一句形容词」的入口：缺口只能靠补录事实来关掉（§11 / §62-7）。
 */
export function ProductArchitectureRoleBoard({
  record,
  labels,
  loading
}: ProductArchitectureRoleBoardProps): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const roleByKey = new Map<ProductArchitectureRoleKey, ProductArchitectureRoleView>(
    (record?.roles ?? []).map((role) => [role.key, role])
  );
  const ordered = PRODUCT_ARCHITECTURE_ROLE_ORDER.map((key) => roleByKey.get(key)).filter(
    (role): role is ProductArchitectureRoleView => role !== undefined
  );

  function toggle(key: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <Card
      title="九个角色（每一部分各自在干什么）"
      spec="§5 / §45"
      subtitle="骨架 / 身份 / 香气 / 底气 / 第一口 / 中段 / 后半程 / 记忆点 / 价值位——顺序由 §5 固定，缺事实的角色留空。"
      actions={
        record ? (
          <>
            <Pill tone="ok">已写实 {record.role_counts.written}</Pill>
            <Pill tone={record.role_counts.gap > 0 ? "danger" : "ok"}>
              留空 {record.role_counts.gap}
            </Pill>
          </>
        ) : (
          <Pill tone="neutral">尚未生成</Pill>
        )
      }
    >
      {!record ? (
        <EmptyState
          title={loading ? "正在读取产品结构…" : "还没有生成产品结构"}
          description="生成一版之后，这里会按 §5 的九个角色逐个展开：谁负责骨架、谁负责香气身份、谁负责第一口冲击……"
        />
      ) : (
        <div className="grid-3">
          {ordered.map((role) => {
            const isOpen = expanded.has(role.key);
            return (
              <div className="card" key={role.key}>
                <header className="card-head">
                  <h3>
                    {role.label}
                    <span className="spec">{role.spec_ref}</span>
                  </h3>
                  <div className="card-actions">
                    <Pill tone={roleStatusTone(role.status, labels)}>
                      {roleStatusLabel(role.status, labels)}
                    </Pill>
                  </div>
                </header>
                <p className="muted">{role.question}</p>

                {role.status === "WRITTEN" ? (
                  <p className="quote mt-2">{role.text}</p>
                ) : (
                  <>
                    <p className="muted mt-2">
                      这一部分现在还不能写：没有取到可用事实，按 §11 / §62-7 留空，不用形容词补圆。
                    </p>
                    {role.gap ? <div className="alert warn mt-2">{role.gap}</div> : null}
                  </>
                )}

                <p className="muted mt-2">写实它至少需要：{role.requirement}</p>

                {role.status === "WRITTEN" ? (
                  <>
                    <div className="row between mt-2">
                      <span className="muted">
                        引用字段 {role.evidence_refs.length} · 事实原文 {role.citations.length}
                      </span>
                      <button
                        type="button"
                        className="ghost sm"
                        onClick={() => toggle(role.key)}
                      >
                        {isOpen ? "收起引用" : "查看引用"}
                      </button>
                    </div>
                    {isOpen ? (
                      <>
                        <div className="sub-title mt-2">证据字段</div>
                        <div className="chip-list">
                          {role.evidence_refs.map((ref) => (
                            <span className="chip derived mono" key={ref}>
                              {ref}
                            </span>
                          ))}
                        </div>
                        <div className="sub-title mt-3">已录入事实原文（逐字比对）</div>
                        {role.citations.length === 0 ? (
                          <p className="muted">引用了字段但没有可逐字比对的事实原文。</p>
                        ) : (
                          <ul>
                            {role.citations.map((citation) => (
                              <li key={citation} className="muted mono">
                                {citation}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {record ? (
        <>
          <div className="sub-title mt-4">结构叙事（value_role 成稿）</div>
          {record.narrative ? (
            <p className="quote">{record.narrative}</p>
          ) : (
            <p className="muted">
              还没有结构叙事：§11 要求至少 3 个角色写实，才谈得上「为什么这些部分组合起来不像普通茶」。
              当前写实 {record.role_counts.written} 个，不足 3 个时这一栏必须留空——不硬写。
            </p>
          )}
        </>
      ) : null}
    </Card>
  );
}
