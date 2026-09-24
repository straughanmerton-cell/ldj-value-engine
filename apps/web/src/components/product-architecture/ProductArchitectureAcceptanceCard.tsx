import type { ReactElement } from "react";
import {
  PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS,
  PRODUCT_ARCHITECTURE_ROLE_ORDER,
  roleLabel,
  roleStatusLabel,
  type ProductArchitectureLabels,
  type ProductArchitectureRecordView
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { EmptyState, Pill } from "../ui/State.js";

export interface ProductArchitectureAcceptanceCardProps {
  record: ProductArchitectureRecordView | null;
  labels: ProductArchitectureLabels | null;
}

/**
 * §57 验收卡：产品结构必须能回答「谁负责骨架／香气／汤感／回甘／记忆点」。
 *
 * 这五项不是可选项——它们决定这款茶的说明能不能上成交前线。
 * 缺哪一项就写缺哪一项，不允许用「整体感觉很好」这类话糊过去。
 */
export function ProductArchitectureAcceptanceCard({
  record,
  labels
}: ProductArchitectureAcceptanceCardProps): ReactElement {
  const acceptance = record?.acceptance ?? null;
  const writtenKeys = acceptance?.written_keys ?? [];

  return (
    <Card
      title="§57 验收：五个必答问题"
      spec="§57"
      subtitle="产品结构必须能回答谁负责骨架／谁负责香气／谁负责汤感／谁负责回甘／谁负责记忆点。"
      actions={
        acceptance ? (
          <Pill tone={acceptance.passed ? "ok" : "danger"}>
            {acceptance.passed ? "验收通过" : `缺 ${acceptance.missing_keys.length} 项`}
          </Pill>
        ) : (
          <Pill tone="neutral">尚未生成</Pill>
        )
      }
    >
      {!acceptance ? (
        <EmptyState
          title="还没有生成产品结构"
          description="生成之后这里会逐项标出五个必答问题各自落到哪个角色、有没有取到事实。"
        />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>必答问题</th>
                  <th>对应角色</th>
                  <th>状态</th>
                  <th>这一版说了什么</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS.map((key) => {
                  const role = record?.roles.find((item) => item.key === key) ?? null;
                  const wrote = writtenKeys.includes(key);
                  return (
                    <tr key={key}>
                      <td className="nowrap">{role?.question ?? key}</td>
                      <td className="nowrap">{roleLabel(key, labels)}</td>
                      <td className="nowrap">
                        <Pill tone={wrote ? "ok" : "danger"}>{wrote ? "已写实" : "留空"}</Pill>
                      </td>
                      <td>{wrote ? role?.text ?? "—" : <span className="muted">事实不足，留空</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="sub-title mt-3">九个角色的整体落位</div>
          <div className="chip-list">
            {PRODUCT_ARCHITECTURE_ROLE_ORDER.map((key) => {
              const role = record?.roles.find((item) => item.key === key) ?? null;
              return (
                <span
                  className="chip"
                  key={key}
                  title={role ? roleStatusLabel(role.status, labels) : "未生成"}
                >
                  {role?.label ?? key}
                  <span className="muted">
                    {" "}
                    {role ? roleStatusLabel(role.status, labels) : "未生成"}
                  </span>
                </span>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
