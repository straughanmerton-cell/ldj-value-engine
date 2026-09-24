import type { ReactElement } from "react";
import {
  ANCHOR_RESOLVE_SOURCE_LABELS,
  ANCHOR_RESOLVE_SOURCE_TONES,
  ANCHOR_TYPE_TONES,
  RESOLVED_MODE_TONES,
  anchorDisplayName,
  anchorTypeLabel,
  type AnchorContract,
  type AnchorResolveSource,
  type AnchorType,
  type BenchmarkModeView,
  type ResolvedMode
} from "../../lib/anchors.js";
import { Card } from "../ui/Card.js";
import { Alert, EmptyState, LoadingState, Pill } from "../ui/State.js";

export interface AnchorModeCardProps {
  productId: string;
  mode: BenchmarkModeView | null;
  /** 模式文案以后端合同为唯一准，前端只做兜底。 */
  modeLabels: Record<ResolvedMode, string>;
  typeLabels: Record<AnchorType, string>;
  contract: AnchorContract | null;
  loading: boolean;
  error: string | null;
}

const PREFERENCE_LABELS: Record<string, string> = {
  AUTO: "自动判定",
  BENCHMARK: "指定对标模式",
  CATEGORY_CREATOR: "指定自建标准模式"
};

/**
 * §17 / §55 / §56 对标模式判定卡：产品当前到底走 Benchmark Mode 还是 Category Creator Mode。
 *
 * 这张卡是「产品定位结论」本身，不是说明文字，所以必须同时给出四件事：
 * 结论（哪种模式）、依据（哪种来源判定 / 为什么）、证据量（三类锚点各多少条）、主锚点（拿谁当标杆）。
 * 没有达标候选时必须把「不得硬凑竞品」写出来——沉默会被理解成「可以对标」。
 */
export function AnchorModeCard({
  productId,
  mode,
  modeLabels,
  typeLabels,
  contract,
  loading,
  error
}: AnchorModeCardProps): ReactElement {
  const minSimilarity = contract?.requirements.min_similarity ?? 70;
  const minEvidence = contract?.requirements.min_price_evidence ?? 75;
  const total = mode
    ? mode.highest_value_count + mode.similarity_high_value_count + mode.sales_anchor_count
    : 0;

  if (error) {
    return (
      <Card title="对标模式判定" spec="§17 / §55">
        <Alert tone="warn">{error}</Alert>
      </Card>
    );
  }

  if (!mode) {
    return (
      <Card title="对标模式判定" spec="§17 / §55">
        <LoadingState label={loading ? "正在读取模式判定" : "尚未判定模式"} />
      </Card>
    );
  }

  const resolvedBy = mode.resolved_by as AnchorResolveSource;
  const primary = mode.primary_anchor;

  return (
    <Card
      title="对标模式判定"
      spec="§17 / §55 / §56"
      subtitle="同一款产品只会有一种模式：有达标对标就走 Benchmark Mode，没有就走 Category Creator Mode。两种模式都合法，硬凑竞品不合法。"
      actions={
        <>
          <Pill tone={RESOLVED_MODE_TONES[mode.mode]}>
            {modeLabels[mode.mode] ?? mode.mode}
          </Pill>
          <Pill tone={ANCHOR_RESOLVE_SOURCE_TONES[resolvedBy] ?? "neutral"}>
            {ANCHOR_RESOLVE_SOURCE_LABELS[resolvedBy] ?? mode.resolved_by}
          </Pill>
        </>
      }
    >
      <div className="mode-banner" data-mode={mode.mode}>
        <div className="mode-banner-head">
          <strong>{modeLabels[mode.mode] ?? mode.mode}</strong>
          <span className="muted">
            产品偏好：{PREFERENCE_LABELS[mode.preference] ?? mode.preference}
          </span>
        </div>
        <p className="mode-reason">{mode.reason}</p>
      </div>

      <div className="metric-grid mt-3">
        <div className="metric">
          <div className="metric-label">最高价值锚点</div>
          <div className="metric-value">{mode.highest_value_count}</div>
          <div className="metric-hint">
            相似度 ≥ {minSimilarity} 且价格证据 ≥ {minEvidence}（§16.1）
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">高相似度锚点</div>
          <div className="metric-value">{mode.similarity_high_value_count}</div>
          <div className="metric-hint">
            相似度优先 + 价格进入可靠价格带前 {contract?.similarity_high_value_top_percent ?? 20}%（§16.2）
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">强成交锚点</div>
          <div className="metric-value">{mode.sales_anchor_count}</div>
          <div className="metric-hint">六项加权得分排序（§16.3）</div>
        </div>
        <div className="metric">
          <div className="metric-label">锚点合计</div>
          <div className="metric-value">{total}</div>
          <div className="metric-hint">每种类型 ≤ 10 条 · 单产品 ≤ 60 条</div>
        </div>
      </div>

      <div className="sub-title">主锚点</div>
      {primary ? (
        <>
          <div className="context-meta">
            <Pill tone="brand">{anchorDisplayName(primary)}</Pill>
            <Pill tone={ANCHOR_TYPE_TONES[primary.anchor_type] ?? "neutral"}>
              {anchorTypeLabel(primary.anchor_type, typeLabels)}
            </Pill>
            <Pill tone="neutral">名次 {primary.rank}</Pill>
            <Pill tone="info">相似度 {primary.similarity_score}</Pill>
            <Pill tone="info">价格证据 {primary.price_evidence_score}</Pill>
            {primary.is_manual ? <Pill tone="warn">人工选定</Pill> : null}
          </div>
          <p className="muted">{primary.rationale}</p>
        </>
      ) : (
        <EmptyState
          title="尚未选定主锚点"
          description="主锚点由引擎按名次自动选定，也可以在锚点列表里人工指定；没有达标锚点时不会存在主锚点。"
        />
      )}

      {mode.mode === "CATEGORY_CREATOR" ? (
        <Alert tone="warn">
          当前产品没有同时满足相似度 ≥ {minSimilarity} 与价格证据分 ≥ {minEvidence} 的达标候选：
          必须进入自建高端标准模式（Category Creator Mode）——
          不得硬凑竞品、不得下调阈值、不得编造对标。
          该模式要输出的是自建标准、产品结构、配方哲学、风格身份证、价值逻辑与王者话术（§17）。
        </Alert>
      ) : (
        <Alert tone="info">
          已具备达标对标：锚点只描述「为什么可以对标」，成交价与挂牌价始终分开表述，
          不得因为对标价高就直接宣称本品价格（§16 / §62-2）。
        </Alert>
      )}

      <p className="muted mt-2">
        产品 <code className="mono">{productId}</code> · 判定依据 {mode.spec_ref}
      </p>
    </Card>
  );
}
