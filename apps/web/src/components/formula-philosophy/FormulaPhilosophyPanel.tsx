import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  useFormulaPhilosophyContract,
  useFormulaPhilosophyLabels,
  type FormulaPhilosophyOverview,
  type FormulaPhilosophyRecordView
} from "../../lib/formula-philosophy.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { FormulaPhilosophyAcceptanceCard } from "./FormulaPhilosophyAcceptanceCard.js";
import { FormulaPhilosophyComponentBoard } from "./FormulaPhilosophyComponentBoard.js";
import { FormulaPhilosophyContractCard } from "./FormulaPhilosophyContractCard.js";
import { FormulaPhilosophyGapsCard } from "./FormulaPhilosophyGapsCard.js";
import { FormulaPhilosophyOverviewCard } from "./FormulaPhilosophyOverviewCard.js";
import { FormulaPhilosophyVersionList } from "./FormulaPhilosophyVersionList.js";

export interface FormulaPhilosophyPanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
}

/**
 * Phase 11 配方哲学面板（规格 §6 / §46 / §57 / §6.1）。
 *
 * 面板只回答一个问题：**这款茶为什么这么设计。** 所以它的结构是固定的六块——
 * 合同（口径与红线）、总览与操作（生成 / 人工确认 / 比例登记）、五个分量板（各自写了什么、引用了哪条事实）、
 * §57 验收（五分量写实度与「没有比例也不许出现比例」）、缺口与证据来源、版本列表。
 *
 * 三条交互底线在后端，这里只负责如实呈现：
 * 1. 没有确切比例时，正文里连比例字样都不许出现（§6.1）；
 * 2. 分量正文只能引用本产品已录入字段，缺事实就留空写缺口（§46 / §62-5）；
 * 3. 重新生成只新增版本，人工确认只改确认状态（§62-15）。
 */
export function FormulaPhilosophyPanel({
  productId,
  token,
  canWrite
}: FormulaPhilosophyPanelProps): ReactElement {
  const { notify } = useToast();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useFormulaPhilosophyContract(token);
  const { labels } = useFormulaPhilosophyLabels(token);

  const [overview, setOverview] = useState<FormulaPhilosophyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<FormulaPhilosophyRecordView | null>(null);
  const [busy, setBusy] = useState<"generate" | "confirm" | null>(null);
  const [open, setOpen] = useState(true);
  const [contractOpen, setContractOpen] = useState(true);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<FormulaPhilosophyOverview>(`/api/products/${productId}/formula-philosophy`, {
      token
    })
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
        setError(caught instanceof ApiError ? caught.message : "读取配方哲学失败");
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

  /** 历史版本按需取：最新版直接用总览里的对象，避免多打一次请求。 */
  useEffect(() => {
    if (!token || !productId || !selectedId || selectedId === latestId) {
      setSelectedRecord(null);
      return;
    }
    let cancelled = false;
    apiRequest<FormulaPhilosophyRecordView>(
      `/api/products/${productId}/formula-philosophy/${selectedId}`,
      { token }
    )
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

  async function generate(
    notes: string | null,
    ratioData: Record<string, string> | null
  ): Promise<void> {
    setBusy("generate");
    try {
      const body: Record<string, unknown> = {};
      if (notes !== null) {
        body.notes = notes;
      }
      if (ratioData !== null) {
        body.ratio_data = ratioData;
      }
      const created = await apiRequest<FormulaPhilosophyRecordView>(
        `/api/products/${productId}/formula-philosophy/generate`,
        { method: "POST", token, body }
      );
      notify(
        `已生成配方哲学 v${created.version}（已写实 ${created.component_counts.written} / 5 个分量${
          created.ratio.known_ratio ? "，比例已确认" : "，正文不含比例"
        }）`,
        "ok"
      );
      setSelectedId(null);
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "生成配方哲学失败", "error");
    } finally {
      setBusy(null);
    }
  }

  /** 人工确认只表示「这一版被审过」：不改写正文、不升版本，也不阻止继续派生新版。 */
  async function setConfirmed(
    record: FormulaPhilosophyRecordView,
    nextConfirmed: boolean
  ): Promise<void> {
    setBusy("confirm");
    try {
      await apiRequest<FormulaPhilosophyRecordView>(
        `/api/products/${productId}/formula-philosophy/${record.id}`,
        { method: "PATCH", token, body: { is_confirmed: nextConfirmed } }
      );
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
        title="配方哲学（Formula Philosophy）"
        spec="§6 / §46 / §57"
        subtitle="没有确切比例也能讲清设计逻辑：骨架、香气、回甘、汤感、收口各自承担什么任务。"
        actions={
          <>
            {latest ? (
              <Pill tone={latest.acceptance.passed ? "ok" : "warn"}>
                最新 v{latest.version}：已写实 {latest.component_counts.written} / 5
              </Pill>
            ) : (
              <Pill tone="neutral">尚未生成配方哲学</Pill>
            )}
            <Pill tone={latest?.ratio.known_ratio ? "info" : "outline"}>
              {latest?.ratio.known_ratio ? "比例已确认" : "未确认比例"}
            </Pill>
            <Pill tone="neutral">{overview?.versions.length ?? 0} 版</Pill>
            <button
              type="button"
              className="secondary sm"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "收起配方哲学" : "展开配方哲学"}
            </button>
          </>
        }
      >
        <p className="muted">
          {latest
            ? `当前最新一版 v${latest.version}（${
                latest.mode === "BENCHMARK" ? "Benchmark Mode" : "Category Creator Mode"
              }）：已写实 ${latest.component_counts.written} 个分量、留空 ${
                latest.component_counts.gap
              } 个，${
                latest.ratio.known_ratio
                  ? `比例来自${latest.ratio.ratio_source === "BLEND_DESCRIPTION" ? "已录入的拼配描述" : "产品负责人登记"}`
                  : "比例未确认（正文里一个比例字样都不会出现）"
              }，§57 验收${
                latest.acceptance.passed
                  ? "通过"
                  : `缺 ${
                      latest.component_counts.gap > 0 || !latest.acceptance.design_logic_ready
                        ? `${latest.component_counts.gap} 个分量`
                        : "设计逻辑"
                    }`
              }，缺口 ${latest.evidence_gaps.length} 条。`
            : "尚无配方哲学：先把产地、用料、工艺与品饮事实录进产品，再生成一版；生成不会新增任何原料，也不会替你编一个配比。"}
        </p>
        {!open ? (
          <p className="muted mt-2">
            展开后可查看 §6 合同口径、五个分量板、§57 验收、缺口与证据来源，以及全部历史版本。
          </p>
        ) : null}
      </Card>

      {open ? (
        <>
          <FormulaPhilosophyContractCard
            contract={contract}
            engine={engine}
            downstream={downstream}
            loading={contractLoading}
            error={contractError}
            open={contractOpen}
            onToggle={() => setContractOpen((value) => !value)}
          />

          <FormulaPhilosophyOverviewCard
            overview={overview}
            record={viewRecord}
            labels={labels}
            canWrite={canWrite}
            busy={busy}
            loading={loading}
            error={error}
            onGenerate={(notes, ratioData) => void generate(notes, ratioData)}
            onConfirm={(record, nextConfirmed) => void setConfirmed(record, nextConfirmed)}
            onRetry={reload}
          />

          <FormulaPhilosophyComponentBoard record={viewRecord} labels={labels} loading={loading} />

          <FormulaPhilosophyAcceptanceCard record={viewRecord} labels={labels} />

          <FormulaPhilosophyGapsCard record={viewRecord} />

          <FormulaPhilosophyVersionList
            overview={overview}
            selectedId={selectedId}
            latestId={latestId}
            onSelect={(id) => setSelectedId(id === latestId ? null : id)}
          />
        </>
      ) : null}
    </div>
  );
}
