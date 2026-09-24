import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  useProductArchitectureLabels,
  useProductArchitectureContract,
  type ProductArchitectureOverview,
  type ProductArchitectureRecordView
} from "../../lib/product-architecture.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { ProductArchitectureAcceptanceCard } from "./ProductArchitectureAcceptanceCard.js";
import { ProductArchitectureContractCard } from "./ProductArchitectureContractCard.js";
import { ProductArchitectureGapsCard } from "./ProductArchitectureGapsCard.js";
import { ProductArchitectureOverviewCard } from "./ProductArchitectureOverviewCard.js";
import { ProductArchitectureRoleBoard } from "./ProductArchitectureRoleBoard.js";
import { ProductArchitectureVersionList } from "./ProductArchitectureVersionList.js";

export interface ProductArchitecturePanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
}

/**
 * Phase 10 产品结构面板（规格 §5 / §45 / §57）。
 *
 * 面板回答一个问题：**这款茶不是把几个卖点堆在一起，而是每一部分各自在干什么。**
 * 因此五块内容缺一不可——合同（口径怎么定）、总览与操作（生成 / 人工确认）、
 * 九个角色板（现在各自写到什么程度）、§57 验收（五个必答问题）、缺口与证据来源（每一句回到哪个字段）。
 */
export function ProductArchitecturePanel({
  productId,
  token,
  canWrite
}: ProductArchitecturePanelProps): ReactElement {
  const { notify } = useToast();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useProductArchitectureContract(token);
  const { labels } = useProductArchitectureLabels(token);

  const [overview, setOverview] = useState<ProductArchitectureOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ProductArchitectureRecordView | null>(null);
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
    apiRequest<ProductArchitectureOverview>(`/api/products/${productId}/architecture`, { token })
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
        setError(caught instanceof ApiError ? caught.message : "读取产品结构失败");
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
    apiRequest<ProductArchitectureRecordView>(
      `/api/products/${productId}/architecture/${selectedId}`,
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
      : overview?.record ?? null;
  const latest = overview?.record ?? null;

  async function generate(notes: string | null): Promise<void> {
    setBusy("generate");
    try {
      const created = await apiRequest<ProductArchitectureRecordView>(
        `/api/products/${productId}/architecture/generate`,
        {
          method: "POST",
          token,
          body: notes === null ? {} : { notes }
        }
      );
      notify(
        `已生成产品结构 v${created.version}（已写实 ${created.role_counts.written} / 9 个角色）`,
        "ok"
      );
      setSelectedId(null);
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "生成产品结构失败", "error");
    } finally {
      setBusy(null);
    }
  }

  /** 人工确认只表示「这一版被审过」：不改写正文、不升版本，也不阻止继续派生新版。 */
  async function setConfirmed(
    record: ProductArchitectureRecordView,
    nextConfirmed: boolean
  ): Promise<void> {
    setBusy("confirm");
    try {
      await apiRequest<ProductArchitectureRecordView>(
        `/api/products/${productId}/architecture/${record.id}`,
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
        title="产品结构（Product Architecture）"
        spec="§5 / §45 / §57"
        subtitle="把参数解释成设计：谁负责骨架、谁负责香气身份、谁负责第一口冲击、谁负责回甘与记忆点。"
        actions={
          <>
            {latest ? (
              <Pill tone={latest.acceptance.passed ? "ok" : "warn"}>
                最新 v{latest.version}：已写实 {latest.role_counts.written} / 9
              </Pill>
            ) : (
              <Pill tone="neutral">尚未生成产品结构</Pill>
            )}
            <Pill tone="neutral">{overview?.versions.length ?? 0} 版</Pill>
            <button type="button" className="secondary sm" onClick={() => setOpen((value) => !value)}>
              {open ? "收起产品结构" : "展开产品结构"}
            </button>
          </>
        }
      >
        <p className="muted">
          {latest
            ? `当前最新一版 v${latest.version}（${
                latest.mode === "BENCHMARK" ? "Benchmark Mode" : "Category Creator Mode"
              }）：已写实 ${latest.role_counts.written} 个角色、留空 ${latest.role_counts.gap} 个，§57 验收${
                latest.acceptance.passed
                  ? "通过"
                  : `缺 ${latest.acceptance.missing_keys.length} 项（${latest.acceptance.missing_keys.join(
                      " / "
                    )}）`
              }，缺口 ${latest.evidence_gaps.length} 条。`
            : "尚无产品结构：先把产地、用料、工艺与品饮事实录进产品，再生成一版；生成不会自动补全任何未录入内容。"}
        </p>
        {!open ? (
          <p className="muted mt-2">
            展开后可查看 §5 合同口径、九个角色板、§57 验收、缺口清单与全部版本。
          </p>
        ) : null}
      </Card>

      {open ? (
        <>
          <ProductArchitectureContractCard
            contract={contract}
            engine={engine}
            downstream={downstream}
            loading={contractLoading}
            error={contractError}
            open={contractOpen}
            onToggle={() => setContractOpen((value) => !value)}
          />

          <ProductArchitectureOverviewCard
            overview={overview}
            record={viewRecord}
            labels={labels}
            canWrite={canWrite}
            busy={busy}
            loading={loading}
            error={error}
            onGenerate={(notes) => void generate(notes)}
            onConfirm={(record, nextConfirmed) => void setConfirmed(record, nextConfirmed)}
            onRetry={reload}
          />

          <ProductArchitectureRoleBoard record={viewRecord} labels={labels} loading={loading} />

          <ProductArchitectureAcceptanceCard record={viewRecord} labels={labels} />

          <ProductArchitectureGapsCard record={viewRecord} />

          <ProductArchitectureVersionList
            overview={overview}
            labels={labels}
            selectedId={selectedId}
            latestId={latestId}
            onSelect={(id) => setSelectedId(id === latestId ? null : id)}
          />
        </>
      ) : null}
    </div>
  );
}
