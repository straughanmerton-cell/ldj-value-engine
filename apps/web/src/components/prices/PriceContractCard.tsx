import type { ReactElement } from "react";
import {
  PRICE_BASIS_LABELS,
  type PriceContract,
  type PriceEngineInfo
} from "../../lib/market-offers.js";
import { Card } from "../ui/Card.js";
import { Alert, Pill } from "../ui/State.js";

export interface PriceContractCardProps {
  contract: PriceContract | null;
  engine: PriceEngineInfo | null;
  loading: boolean;
  error: string | null;
}

/**
 * §14 / §15 价格合同自检卡：把权重、分档与四条红线原样摊开。
 *
 * 这张卡不是说明文档，而是「引擎到底按什么口径算分」的自检结果：
 * 权重和分档读后端合同，硬约束（价格不参与相似度、整件不折算单饼）读引擎自检，
 * 前端不写死阈值，避免界面与引擎漂移。
 */
export function PriceContractCard({
  contract,
  engine,
  loading,
  error
}: PriceContractCardProps): ReactElement {
  const weights = contract?.evidence_components ?? [];
  const bands = Object.entries(contract?.evidence_bands ?? {});

  return (
    <Card
      title="价格证据合同"
      spec="§14 / §15 / §16.1"
      subtitle="价格证据分只回答一件事：这条价格能不能用。五项加权合计 100 分，分档与红线由后端合同下发。"
      actions={
        <>
          <Pill tone={contract?.price_in_similarity ? "danger" : "ok"}>价格不参与相似度</Pill>
          <Pill tone={engine?.case_piece_equivalent_allowed ? "danger" : "ok"}>整件不折算单饼</Pill>
        </>
      }
    >
      {error ? <Alert tone="warn">{error}</Alert> : null}

      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">证据分权重合计</div>
          <div className="metric-value">{loading && !contract ? "—" : (contract?.evidence_weight_total ?? 100)}</div>
          <div className="metric-hint">性质 25 · 来源 25 · 身份 20 · 新鲜度 15 · 多来源 15</div>
        </div>
        <div className="metric">
          <div className="metric-label">强证据线</div>
          <div className="metric-value">{engine?.min_reliable_evidence ?? 75}</div>
          <div className="metric-hint">≥ 该分数才是可靠价格锚点（§16.1）</div>
        </div>
        <div className="metric">
          <div className="metric-label">异常值最小样本</div>
          <div className="metric-value">{contract?.outlier_min_sample ?? 4}</div>
          <div className="metric-hint">不足 4 条不判定，宁可不下结论</div>
        </div>
        <div className="metric">
          <div className="metric-label">价格水平基准优先级</div>
          <div className="metric-value" style={{ fontSize: 13 }}>
            {(engine?.basis_priority ?? ["VERIFIED_TRANSACTION", "LISTING"])
              .slice(0, 3)
              .map((basis) => PRICE_BASIS_LABELS[basis] ?? basis)
              .join(" → ")}
          </div>
          <div className="metric-hint">成交优先，挂牌只能作价格带参考</div>
        </div>
      </div>

      <div className="table-wrap mt-3">
        <table>
          <thead>
            <tr>
              <th>证据维度</th>
              <th>权重</th>
              <th>怎么给分</th>
            </tr>
          </thead>
          <tbody>
            {weights.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  正在读取合同…
                </td>
              </tr>
            ) : (
              weights.map((item) => (
                <tr key={item.component}>
                  <td>
                    {item.label} <code className="mono">{item.component}</code>
                  </td>
                  <td className="nowrap">{item.weight}</td>
                  <td className="muted">{COMPONENT_RULES[item.component] ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="sub-title">三档分档（证据分）</div>
      <div className="row">
        {bands.map(([band, label]) => (
          <Pill key={band} tone={band === "STRONG" ? "ok" : band === "USABLE" ? "info" : "warn"}>
            {label}
          </Pill>
        ))}
      </div>

      <div className="sub-title">四条红线</div>
      <ul className="prov-list">
        {(contract?.rules ?? []).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <p className="muted">
        没有写明规格重量时系统不做任何 357g / 1kg 等价换算，也不会拿产品主档的规格倒算
        {engine?.requires_weight_for_equivalence === false ? "（注意：当前引擎自检未要求规格重量）" : ""}。
      </p>
    </Card>
  );
}

/** 五项权重各自在算什么：只解释口径，不解释阈值（阈值永远来自合同）。 */
const COMPONENT_RULES: Record<string, string> = {
  nature_clarity: "按来源原文判定成交 / 拍卖 / 官方 / 挂牌 / 历史；单位未写明扣 8 分，引文无法逐字回溯再扣 6 分",
  source_credibility: "按来源类型给分（产品页 / 拍卖页 / 价格页高于论坛、社交与搜索结果）",
  product_identity: "产品名、品牌、年份、规格逐项累加；来源没写的一律不加分",
  freshness: "没有写明时间按 4 分（未知 ≠ 新鲜），近半年 15 分，三年以上 3 分",
  cross_source: "只数不同来源：2 个 10 分、3 个 13 分、4 个及以上 15 分；同一页面重复登记不算"
};
