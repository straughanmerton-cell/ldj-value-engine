import { useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  PRICE_EVIDENCE_BAND_LABELS,
  type MarketOfferRebuildResult,
  type PriceEngineInfo
} from "../../lib/market-offers.js";
import { Card } from "../ui/Card.js";
import { Alert, Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";

export interface PriceRebuildCardProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  engine: PriceEngineInfo | null;
  /** 重建结果回传给页面：列表与汇总需要立刻刷新，而不是等用户手动刷新。 */
  onRebuilt: (result: MarketOfferRebuildResult) => void;
}

/**
 * 由来源抽取结果重建价格证据（§14）。
 *
 * 重建只做三件事：合并同一身份 / 类型 / 单位 / 规格的同价条目、重算 §15 证据分、重跑异常值检测。
 * 人工登记与人工修正（单位、规格、备注、排除标记）默认不被覆盖——人工结论优先于机器重算。
 */
export function PriceRebuildCard({
  productId,
  token,
  canWrite,
  engine,
  onRebuilt
}: PriceRebuildCardProps): ReactElement | null {
  const { notify } = useToast();
  const [recompute, setRecompute] = useState(true);
  const [keepManual, setKeepManual] = useState(true);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<MarketOfferRebuildResult | null>(null);

  if (!canWrite) {
    return null;
  }

  async function rebuild(): Promise<void> {
    setBusy(true);
    try {
      const result = await apiRequest<MarketOfferRebuildResult>(
        `/api/products/${productId}/market-offers/rebuild`,
        { method: "POST", token, body: { recompute, keep_manual: keepManual } }
      );
      setLast(result);
      notify(
        `价格证据已重建：新增 ${result.created} · 更新 ${result.updated} · 共 ${result.total} 条`,
        "ok"
      );
      onRebuilt(result);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "重建价格证据失败", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="重建价格证据"
      spec="§14 / §15"
      subtitle="把已抽取来源里的价格原话合并成一条条价格证据：同一身份 / 类型 / 单位 / 规格的同价只保留一条，来源多不等于价格更高。"
      actions={
        last ? (
          <Pill tone={last.reached_limit ? "warn" : "ok"}>
            {last.reached_limit ? "已触达单产品上限" : `共 ${last.total} 条`}
          </Pill>
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
          重算已存在条目的 §15 证据分
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={keepManual}
            onChange={(event) => setKeepManual(event.target.checked)}
          />
          保留人工登记与人工修正（推荐）
        </label>
        <button type="button" disabled={busy} onClick={() => void rebuild()}>
          {busy ? "重建中…" : "重建价格证据"}
        </button>
      </div>
      <p className="muted mt-2">
        与候选池重建同构：低于强证据线的价格仍然入库并标记分档，便于审计与复盘，不会被静默丢弃；
        异常值只标记不删除（§62-15）。
      </p>

      {last ? (
        <>
          <div className="metric-grid mt-3">
            <div className="metric">
              <div className="metric-label">新增</div>
              <div className="metric-value">{last.created}</div>
              <div className="metric-hint">来自来源抽取的价格原话</div>
            </div>
            <div className="metric">
              <div className="metric-label">合并更新</div>
              <div className="metric-value">{last.updated}</div>
              <div className="metric-hint">同一身份 + 类型 + 单位 + 规格 + 金额</div>
            </div>
            <div className="metric">
              <div className="metric-label">保留人工结论</div>
              <div className="metric-value">{last.kept_manual}</div>
              <div className="metric-hint">人工登记 / 修正不被覆盖</div>
            </div>
            <div className="metric">
              <div className="metric-label">异常值 / 分组</div>
              <div className="metric-value" style={{ fontSize: 18 }}>
                {last.outliers} · {last.outlier_groups}
              </div>
              <div className="metric-hint">只标记不删除（样本 &lt; 4 不判定）</div>
            </div>
            <div className="metric">
              <div className="metric-label">强 / 可用 / 弱</div>
              <div className="metric-value" style={{ fontSize: 18 }}>
                {last.band_counts.STRONG} · {last.band_counts.USABLE} · {last.band_counts.WEAK}
              </div>
              <div className="metric-hint">
                {PRICE_EVIDENCE_BAND_LABELS.STRONG} 才是可靠价格锚点候选
              </div>
            </div>
          </div>

          <div className="sub-title">本轮处理过程</div>
          <ul className="prov-list">
            <li>参与重建的已抽取来源：{last.stats.sources_considered} 条</li>
            <li>来源里出现的价格条目：{last.stats.prices_considered} 条</li>
            <li>去重后落成的价格证据：{last.stats.drafts} 条</li>
            <li>被多个来源写到同一组价格：{last.stats.merged_multi_source} 条（多来源印证按不同来源计数）</li>
            <li>
              来源未写明产品身份：{last.stats.unattributed} 条（不参与跨来源印证，§62-7）
            </li>
            <li>因触达单产品上限而跳过：{last.stats.skipped_limit} 条</li>
          </ul>
        </>
      ) : null}

      {last?.reached_limit ? (
        <Alert tone="warn">
          已达到单个产品的价格证据上限（{engine?.limits.maxPerProduct ?? 800} 条），
          本轮只更新既有条目，不再新增。
        </Alert>
      ) : null}
    </Card>
  );
}
