import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  useSalesCopyContract,
  useSalesCopyLabels,
  intensifyLevelLabel,
  type IntensifyLevel,
  type SalesCopyOverview,
  type SalesCopyIntensifyResult,
  type SalesCopyRecordView
} from "../../lib/sales-copy.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { SalesCopyContractCard } from "./SalesCopyContractCard.js";
import { SalesCopyGapsCard } from "./SalesCopyGapsCard.js";
import { SalesCopyImpactScoreCard } from "./SalesCopyImpactScoreCard.js";
import { SalesCopyLevel5Board } from "./SalesCopyLevel5Board.js";
import { SalesCopyOutputPanels } from "./SalesCopyOutputPanels.js";
import {
  SalesCopyOverviewCard,
  type SalesCopyGenerateInput
} from "./SalesCopyOverviewCard.js";
import { SalesCopyVersionList } from "./SalesCopyVersionList.js";

export interface SalesCopyPanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
}

/**
 * Phase 12 强成交话术 + Phase 13「再狠一点」面板
 * （规格 §21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §48）。
 *
 * 面板只回答一个问题：**这款茶主播拿起来怎么讲、够不够狠、有没有一个字是编的。**
 * 结构固定七块——合同（五档强度 / 八项评分 / Level 5 七项 / 九种输出 / 红线）、
 * 总览与操作（生成 / 人工确认 / §33 价值重点 / §7 再狠一点四档按钮）、
 * 成交冲击力评分板、Level 5 王者话术看板、九种输出面板、缺口与合规、
 * 版本列表。
 *
 * 三条交互底线在后端，这里只如实呈现：
 * 1. 没有可靠价格锚点时逐字使用 §22 标准句，绝不编一个价格高度（§22 / §62-10）；
 * 2. 评分只按 §23 八项 criteria 机械求和，事实不足直接压分（§23 / §62-5）；
 * 3. 重新生成与「再狠一点」都只新增版本、人工确认只改确认状态（§34 / §62-15）。
 */
export function SalesCopyPanel({ productId, token, canWrite }: SalesCopyPanelProps): ReactElement {
  const { notify } = useToast();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useSalesCopyContract(token);
  const { labels } = useSalesCopyLabels(token);

  const [overview, setOverview] = useState<SalesCopyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<SalesCopyRecordView | null>(null);
  const [busy, setBusy] = useState<"generate" | "confirm" | "intensify" | null>(null);
  /** §34 / §48：最近一次「再狠一点」的结论，生成新版或换产品后清空。 */
  const [intensifyResult, setIntensifyResult] = useState<SalesCopyIntensifyResult | null>(null);
  const [open, setOpen] = useState(true);
  const [contractOpen, setContractOpen] = useState(true);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<SalesCopyOverview>(`/api/products/${productId}/copy`, { token })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setOverview(result);
        setError(null);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setOverview(null);
        setError(caught instanceof ApiError ? caught.message : "读取强成交话术失败");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [productId, reloadTick, token]);

  const latestId = overview?.record?.id ?? null;

  /** 换产品就把上一款茶的强化结论丢掉，避免把 A 产品的「改写了几处」挂到 B 产品上。 */
  useEffect(() => {
    setIntensifyResult(null);
  }, [productId]);

  /** 历史版本按需取：最新版直接用总览里的对象，避免多打一次请求。 */
  useEffect(() => {
    if (!token || !productId || !selectedId || selectedId === latestId) {
      setSelectedRecord(null);
      return;
    }
    let cancelled = false;
    apiRequest<SalesCopyRecordView>(`/api/products/${productId}/copy/${selectedId}`, { token })
      .then((result) => {
        if (!cancelled) {
          setSelectedRecord(result);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setSelectedRecord(null);
          notify(caught instanceof ApiError ? caught.message : "读取该版本失败", "error");
        }
      });
    return () => {
      cancelled = true;
    };
    // notify 是稳定引用（Toast 上下文），不进依赖以免重复请求。
  }, [latestId, productId, selectedId, token]);

  const viewRecord =
    selectedId !== null && selectedId !== latestId
      ? selectedRecord
      : (overview?.record ?? null);
  const latest = overview?.record ?? null;

  async function generate(input: SalesCopyGenerateInput): Promise<void> {
    setBusy("generate");
    try {
      const body: Record<string, unknown> = { intensity: input.intensity };
      if (input.valueFocus.length > 0) {
        body.value_focus = input.valueFocus;
      }
      if (input.notes !== null) {
        body.notes = input.notes;
      }
      const created = await apiRequest<SalesCopyRecordView>(
        `/api/products/${productId}/copy/generate`,
        { method: "POST", token, body }
      );
      notify(
        `已生成强成交话术 v${created.version}（${created.intensity} 档 · 成交冲击力 ${
          created.impact_score.total
        } 分 · ${created.impact_score.band_label}${
          created.level5.satisfied ? " · Level 5 成立" : ""
        }）`,
        "ok"
      );
      setIntensifyResult(null);
      setSelectedId(null);
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "生成强成交话术失败", "error");
    } finally {
      setBusy(null);
    }
  }

  /**
   * §7 / §34「再狠一点」：把当前查看的这一版按更高档位强化成**新版本**。
   *
   * 前端不传任何事实、不传「改哪几句」——强化器只接受「哪一档」与「哪一版」；
   * 结论（改写了几处 / 有没有新增事实 / §48 八项自检）全部如实摊开给人工抽查。
   */
  async function intensify(level: IntensifyLevel): Promise<void> {
    if (!latest) {
      return;
    }
    const source = viewRecord ?? latest;
    setBusy("intensify");
    try {
      const result = await apiRequest<SalesCopyIntensifyResult>(
        `/api/products/${productId}/copy/intensify`,
        { method: "POST", token, body: { level, record_id: source.id } }
      );
      setIntensifyResult(result);
      notify(
        `已生成强化版本 v${result.record.version}（「${intensifyLevelLabel(
          result.level,
          labels
        )}」→ Level ${result.intensity} · 第 ${result.round} / ${result.max_auto_rounds} 轮 · 改写 ${
          result.changed_elements.length
        } 处 · 新增事实 ${result.added_facts.length} 条 · §48 ${
          result.self_check.passed ? "八项自检通过" : "八项自检未达标"
        }）`,
        result.self_check.passed ? "ok" : "warn"
      );
      setSelectedId(null);
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "「再狠一点」失败", "error");
    } finally {
      setBusy(null);
    }
  }

  /** 人工确认只表示「这一版被审过」：不改写正文、不升版本，也不阻止继续派生新版。 */
  async function setConfirmed(
    record: SalesCopyRecordView,
    nextConfirmed: boolean
  ): Promise<void> {
    setBusy("confirm");
    try {
      await apiRequest<SalesCopyRecordView>(`/api/products/${productId}/copy/${record.id}`, {
        method: "PATCH",
        token,
        body: { is_confirmed: nextConfirmed }
      });
      notify(
        nextConfirmed
          ? `已人工确认 v${record.version}（版本仍保留，可继续派生新版）`
          : `已取消 v${record.version} 的人工确认`,
        nextConfirmed ? "ok" : "warn"
      );
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "更新确认状态失败", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <Card
        title="强成交话术（Strong Sales Copy）"
        spec="§21 / §22 / §23 / §26 / §47"
        subtitle="主播拿起来就能讲、够狠、不变成说明书，而且一个字都没有编：五档强度、八项评分、九种输出、Level 5 王者话术一次摊开。"
        actions={
          <>
            {latest ? (
              <Pill tone={latest.acceptance.passed ? "ok" : "warn"}>
                最新 v{latest.version}：成交冲击力 {latest.impact_score.total} 分（
                {latest.impact_score.band_label}）
              </Pill>
            ) : (
              <Pill tone="neutral">尚未生成强成交话术</Pill>
            )}
            <Pill tone={latest?.level5.satisfied ? "brand" : "outline"}>
              {latest?.level5.satisfied ? "Level 5 成立" : "未达 Level 5"}
            </Pill>
            <Pill tone={latest?.acceptance.compliance_passed ? "ok" : "danger"}>
              {latest ? (latest.acceptance.compliance_passed ? "合规通过" : "合规未过") : "合规待检"}
            </Pill>
            <Pill tone="neutral">{overview?.versions.length ?? 0} 版</Pill>
            <button
              type="button"
              className="secondary sm"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "收起话术面板" : "展开话术面板"}
            </button>
          </>
        }
      >
        <p className="muted">
          {latest
            ? `当前最新一版 v${latest.version}（${
                latest.mode_at_generation === "BENCHMARK" ? "Benchmark Mode" : "Category Creator Mode"
              } · ${latest.intensity} 档强度）：成交冲击力 ${latest.impact_score.total} 分（${
                latest.impact_score.band_label
              }），九种输出${
                latest.acceptance.outputs_complete
                  ? "齐备"
                  : `缺 ${latest.acceptance.missing_outputs.length} 种`
              }，Level 5 ${
                latest.level5.satisfied ? "成立" : "未成立"
              }，合规 ${latest.acceptance.compliance_passed ? "通过" : "未通过"}（${latest.compliance.risk}），§57 验收${
                latest.acceptance.passed ? "通过" : "未通过"
              }，缺口 ${latest.evidence_gaps.length} 条，增强轮次 ${latest.intensify_rounds} / ${
                contract?.intensify_button.max_auto_rounds ?? 3
              }。`
            : "尚无强成交话术：先把产地、用料、工艺、品饮与价格锚点录进产品，再生成一版；生成只引用已录入事实，不会替你编一个价格高度或一句功效承诺。"}
        </p>
        {!open ? (
          <p className="muted mt-2">
            展开后可查看 §21–§47 合同口径、成交冲击力评分、Level 5 看板、九种输出、缺口与合规，以及全部历史版本。
          </p>
        ) : null}
      </Card>

      {open ? (
        <>
          <SalesCopyContractCard
            contract={contract}
            engine={engine}
            downstream={downstream}
            loading={contractLoading}
            error={contractError}
            open={contractOpen}
            onToggle={() => setContractOpen((value) => !value)}
          />

          <SalesCopyOverviewCard
            overview={overview}
            record={viewRecord}
            labels={labels}
            contract={contract}
            canWrite={canWrite}
            busy={busy}
            intensifyResult={intensifyResult}
            loading={loading}
            error={error}
            onGenerate={(input) => void generate(input)}
            onConfirm={(record, nextConfirmed) => void setConfirmed(record, nextConfirmed)}
            onIntensify={(level) => void intensify(level)}
            onRetry={reload}
          />

          <SalesCopyImpactScoreCard record={viewRecord} />

          <SalesCopyLevel5Board record={viewRecord} />

          <SalesCopyOutputPanels record={viewRecord} labels={labels} />

          <SalesCopyGapsCard record={viewRecord} labels={labels} />

          <SalesCopyVersionList
            overview={overview}
            labels={labels}
            maxRounds={contract?.intensify_button.max_auto_rounds ?? 3}
            selectedId={selectedId}
            latestId={latestId}
            onSelect={(id) => setSelectedId(id === latestId ? null : id)}
          />
        </>
      ) : null}
    </div>
  );
}
