import type { ReactElement } from "react";
import {
  ANCHOR_TYPE_HINTS,
  ANCHOR_TYPE_TONES,
  SALES_ANCHOR_COMPONENT_LABELS,
  type AnchorContract,
  type AnchorEngineInfo,
  type AnchorType
} from "../../lib/anchors.js";
import { Card } from "../ui/Card.js";
import { Alert, Pill } from "../ui/State.js";

export interface AnchorContractCardProps {
  contract: AnchorContract | null;
  engine: AnchorEngineInfo | null;
  loading: boolean;
  error: string | null;
}

/**
 * §16 / §17 锚点合同自检卡：把三种锚点、70 / 75 双线与三条红线原样摊开。
 *
 * 这张卡不是说明文档，而是「引擎到底按什么口径判定对标资格」的自检结果：
 * 阈值、权重、上限都读后端合同，前端不写死 70 / 75，避免界面与引擎漂移。
 */
export function AnchorContractCard({
  contract,
  engine,
  loading,
  error
}: AnchorContractCardProps): ReactElement {
  const requirements = contract?.requirements;
  const minSimilarity = requirements?.min_similarity ?? engine?.min_similarity ?? 70;
  const minEvidence = requirements?.min_price_evidence ?? engine?.min_price_evidence ?? 75;
  const topPercent = contract?.similarity_high_value_top_percent ?? 20;
  const weights = Object.entries(contract?.sales_anchor_weights ?? {});
  const weightTotal = weights.reduce((sum, [, value]) => sum + value, 0);

  return (
    <Card
      title="锚点合同"
      spec="§16 / §17"
      subtitle="锚点引擎只回答一件事：这个产品有没有资格进入 Benchmark Mode。两种模式都合法，硬凑竞品不合法。"
      actions={
        <>
          <Pill tone={contract?.price_in_similarity ? "danger" : "ok"}>价格不参与相似度</Pill>
          <Pill tone={contract?.excludes_source_unattributed === false ? "danger" : "ok"}>
            未写明身份的价格不参与
          </Pill>
          <Pill tone={contract?.no_fake_benchmark === false ? "danger" : "ok"}>不硬凑竞品</Pill>
        </>
      }
    >
      {error ? <Alert tone="warn">{error}</Alert> : null}

      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">相似度门槛（Similarity）</div>
          <div className="metric-value">≥ {loading && !contract ? "—" : minSimilarity}</div>
          <div className="metric-hint">与价格证据分必须同时满足（§16.1）</div>
        </div>
        <div className="metric">
          <div className="metric-label">价格证据门槛（PriceEvidence）</div>
          <div className="metric-value">≥ {loading && !contract ? "—" : minEvidence}</div>
          <div className="metric-hint">可靠锚点硬门槛，不可降级（§17）</div>
        </div>
        <div className="metric">
          <div className="metric-label">高相似锚点价格带</div>
          <div className="metric-value">前 {topPercent}%</div>
          <div className="metric-hint">同产品可靠价格带内的高位区间（§16.2）</div>
        </div>
        <div className="metric">
          <div className="metric-label">每种锚点上限</div>
          <div className="metric-value" style={{ fontSize: 18 }}>
            {engine?.limits.maxPerType ?? 10} · {engine?.limits.maxPerProduct ?? 60}
          </div>
          <div className="metric-hint">每种上限 / 单产品总量上限</div>
        </div>
        <div className="metric">
          <div className="metric-label">强成交锚点权重合计</div>
          <div className="metric-value">{weights.length > 0 ? weightTotal : 100}</div>
          <div className="metric-hint">相似度 30 · 价格水平 25 · 市场认知 15 · 故事价值 15 · 概念 10 · 证据 5</div>
        </div>
      </div>

      <div className="table-wrap mt-3">
        <table>
          <thead>
            <tr>
              <th>锚点类型</th>
              <th>门槛</th>
              <th>排序口径</th>
            </tr>
          </thead>
          <tbody>
            {(contract?.types ?? []).length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  正在读取合同…
                </td>
              </tr>
            ) : (
              (contract?.types ?? []).map((item) => (
                <tr key={item.type}>
                  <td>
                    <Pill tone={ANCHOR_TYPE_TONES[item.type as AnchorType] ?? "neutral"}>{item.label}</Pill>
                    <div className="muted">{ANCHOR_TYPE_HINTS[item.type as AnchorType] ?? ""}</div>
                  </td>
                  <td>{item.requirement}</td>
                  <td className="muted">{item.sort}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="sub-title">强成交锚点六项加权（§16.3）</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>分项</th>
              <th>权重</th>
            </tr>
          </thead>
          <tbody>
            {weights.map(([component, weight]) => (
              <tr key={component}>
                <td>
                  {SALES_ANCHOR_COMPONENT_LABELS[component] ?? component}{" "}
                  <code className="mono">{component}</code>
                </td>
                <td className="nowrap">
                  {weight}%（× {(weight / 100).toFixed(2)}）
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-2">{contract?.sales_anchor_formula ?? "Similarity × 0.30 + PriceLevel × 0.25 + MarketRecognition × 0.15 + StoryValue × 0.15 + ConceptRelevance × 0.10 + Evidence × 0.05"}</p>

      <div className="sub-title">六条红线</div>
      <ul className="prov-list">
        {(contract?.rules ?? []).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <Alert tone="info">
        {engine?.note ??
          "锚点只描述「为什么可以对标」；没有达标候选时进入 Category Creator Mode，不硬凑竞品。"}
      </Alert>
    </Card>
  );
}
