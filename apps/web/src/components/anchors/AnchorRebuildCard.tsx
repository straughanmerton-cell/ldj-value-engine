import { useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  ANCHOR_TYPE_SHORT_LABELS,
  ANCHOR_TYPE_TONES,
  RESOLVED_MODE_LABELS,
  RESOLVED_MODE_TONES,
  type AnchorEngineInfo,
  type AnchorRebuildResult,
  type AnchorType
} from "../../lib/anchors.js";
import { Card } from "../ui/Card.js";
import { Alert, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

export interface AnchorRebuildCardProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  engine: AnchorEngineInfo | null;
  /** 重建结果回传给页面：模式判定与锚点列表需要立刻刷新。 */
  onRebuilt: (result: AnchorRebuildResult) => void;
}

/**
 * §55 Build Anchors：由候选池 + 价格证据重算三种锚点。
 *
 * 重建只做三件事：按 §16 三种口径重新挑锚点、重算强成交六项得分、重选主锚点。
 * 人工锚点（人工设为主锚点 / 追加理由）默认保留——人工结论优先于机器重算。
 * 没有达标候选时不写入任何 Highest Value 锚点，模式自然落到 Category Creator Mode。
 */
export function AnchorRebuildCard({
  productId,
  token,
  canWrite,
  engine,
  onRebuilt
}: AnchorRebuildCardProps): ReactElement | null {
  const { notify } = useToast();
  const [recompute, setRecompute] = useState(true);
  const [keepManual, setKeepManual] = useState(true);
  const [maxPerType, setMaxPerType] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<AnchorRebuildResult | null>(null);

  if (!canWrite) {
    return null;
  }

  const limit = engine?.limits.maxPerType ?? 10;

  async function rebuild(): Promise<void> {
    const parsed = Number(maxPerType.trim());
    const body: { recompute: boolean; keep_manual: boolean; max_per_type?: number } = {
      recompute,
      keep_manual: keepManual
    };
    if (maxPerType.trim().length > 0 && Number.isFinite(parsed)) {
      body.max_per_type = Math.max(1, Math.min(limit, Math.round(parsed)));
    }
    setBusy(true);
    try {
      const result = await apiRequest<AnchorRebuildResult>(
        `/api/products/${productId}/anchors/rebuild`,
        { method: "POST", token, body }
      );
      setLast(result);
      notify(
        `锚点已重建：新增 ${result.created} · 移除 ${result.removed} · 共 ${result.total} 条`,
        "ok"
      );
      onRebuilt(result);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "重建锚点失败", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="重建锚点"
      spec="§16 / §55"
      subtitle="由候选池与价格证据重算三种锚点：只有同时满足相似度与价格证据双线的候选，才有资格成为最高价值锚点。"
      actions={
        last ? (
          <Pill tone={RESOLVED_MODE_TONES[last.mode]}>{RESOLVED_MODE_LABELS[last.mode]}</Pill>
        ) : null
      }
    >
      <div className="filter-bar">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={recompute}
            onChange={(event) => setRecompute(event.target.checked)}
          />
          重算自动锚点（按 §16 三种口径重新挑选）
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={keepManual}
            onChange={(event) => setKeepManual(event.target.checked)}
          />
          保留人工锚点与人工理由（推荐）
        </label>
        <label>
          每种锚点上限
          <input
            type="number"
            min={1}
            max={limit}
            placeholder={`默认 ${limit}`}
            value={maxPerType}
            onChange={(event) => setMaxPerType(event.target.value)}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void rebuild()}>
          {busy ? "重建中…" : "重建锚点"}
        </button>
      </div>
      <p className="muted mt-2">
        重建只动自动锚点：人工设为主锚点、人工追加理由的条目会标记为人工锚点并默认保留。
        低于双线的候选不会入库，也不会被「凑」成锚点（§17 / §62-10）。
      </p>

      {last ? (
        <>
          <div className="metric-grid mt-3">
            <div className="metric">
              <div className="metric-label">新增</div>
              <div className="metric-value">{last.created}</div>
              <div className="metric-hint">本轮写入的自动锚点</div>
            </div>
            <div className="metric">
              <div className="metric-label">移除</div>
              <div className="metric-value">{last.removed}</div>
              <div className="metric-hint">被重算替换掉的旧自动锚点</div>
            </div>
            <div className="metric">
              <div className="metric-label">保留人工结论</div>
              <div className="metric-value">{last.kept_manual}</div>
              <div className="metric-hint">人工锚点不被覆盖</div>
            </div>
            <div className="metric">
              <div className="metric-label">锚点合计</div>
              <div className="metric-value">{last.total}</div>
              <div className="metric-hint">当前产品全部锚点</div>
            </div>
            <div className="metric">
              <div className="metric-label">三类分布</div>
              <div className="metric-value" style={{ fontSize: 18 }}>
                {last.anchor_types.HIGHEST_VALUE} · {last.anchor_types.SIMILARITY_HIGH_VALUE} ·{" "}
                {last.anchor_types.SALES_ANCHOR}
              </div>
              <div className="metric-hint">
                {ANCHOR_TYPE_SHORT_LABELS.HIGHEST_VALUE} ·{" "}
                {ANCHOR_TYPE_SHORT_LABELS.SIMILARITY_HIGH_VALUE} ·{" "}
                {ANCHOR_TYPE_SHORT_LABELS.SALES_ANCHOR}
              </div>
            </div>
          </div>

          <Alert tone={RESOLVED_MODE_TONES[last.mode] === "ok" ? "info" : "warn"}>
            判定结果：<strong>{RESOLVED_MODE_LABELS[last.mode]}</strong>｜{last.reason}
          </Alert>

          <div className="sub-title">本轮判定口径</div>
          <ul className="prov-list">
            <li>参与判定的候选：{last.stats.candidates_considered} 条</li>
            <li>其中带可靠价格证据的候选：{last.stats.reliable_price_candidates} 条</li>
            <li>
              写明产品身份的价格证据：{last.stats.attributed_price_offers} 条（{ANCHOR_TYPE_SHORT_LABELS.SALES_ANCHOR}
              的价格证据分从这里取）
            </li>
            <li>
              未写明产品身份的价格证据：{last.stats.unattributed_price_offers} 条
              （不参与锚点判断，§62-7）
            </li>
            <li>
              三类落选明细：最高价值 {last.stats.highest_value} · 高相似度{" "}
              {last.stats.similarity_high_value} · 强成交 {last.stats.sales_anchor}
            </li>
          </ul>
        </>
      ) : null}

      {last && last.total === 0 ? (
        <Alert tone="warn">
          本轮没有生成任何锚点：该产品没有同时满足双线条件的候选，已进入自建高端标准模式。
          请补齐高端产品资料（产品结构 / 配方哲学 / 风格身份证），不要用不合格竞品凑对标（§17）。
        </Alert>
      ) : null}

      <div className="chip-list mt-3">
        {(["HIGHEST_VALUE", "SIMILARITY_HIGH_VALUE", "SALES_ANCHOR"] as AnchorType[]).map((type) => (
          <Pill key={type} tone={ANCHOR_TYPE_TONES[type]}>
            {ANCHOR_TYPE_SHORT_LABELS[type]}
          </Pill>
        ))}
      </div>
    </Card>
  );
}
