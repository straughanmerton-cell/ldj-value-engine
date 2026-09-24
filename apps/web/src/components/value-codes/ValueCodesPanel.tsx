import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  countOf,
  totalCount,
  useValueCodeLabels,
  useValueCodesContract,
  type ValueCodeOverview,
  type ValueCodeProfileView
} from "../../lib/value-codes.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { ValueCodeDictionaryTable } from "./ValueCodeDictionaryTable.js";
import { ValueCodeMatrixTable } from "./ValueCodeMatrixTable.js";
import { ValueCodeVersionList } from "./ValueCodeVersionList.js";
import { ValueCodesContractCard } from "./ValueCodesContractCard.js";
import { ValueCodesOverviewCard } from "./ValueCodesOverviewCard.js";
import { ValueGapsCard } from "./ValueGapsCard.js";
import { ValueStoriesCard } from "./ValueStoriesCard.js";

export interface ValueCodesPanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
}

/**
 * Phase 9 价值映射面板（规格 §18 / §19 / §20 / §30 / §44）。
 *
 * 面板回答一个问题：**这款茶凭什么贵得起，而且凭什么现在就能这么讲。**
 * 因此四块内容缺一不可——合同（口径怎么定）、16 个 Code 的落位矩阵（现在成立到什么程度）、
 * 六类价值故事（能不能成稿）、缺口与证据来源（讲出去的每一句回到哪个字段）。
 *
 * 产品详情里「价值拆解」与「Value Codes」两个 Tab 指向同一个面板（§32 拆分口径不同、数据源相同），
 * 区别只在入口：一个从「价值拆解」进，一个从「Code 字典」进，避免出现两套互相打架的结论。
 */
export function ValueCodesPanel({ productId, token, canWrite }: ValueCodesPanelProps): ReactElement {
  const { notify } = useToast();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useValueCodesContract(token);
  const { labels } = useValueCodeLabels(token);

  const [overview, setOverview] = useState<ValueCodeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ValueCodeProfileView | null>(null);
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
    apiRequest<ValueCodeOverview>(`/api/products/${productId}/value-codes`, { token })
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
        setError(caught instanceof ApiError ? caught.message : "读取价值映射失败");
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

  const latestId = overview?.profile?.id ?? null;

  /** 历史版本按需取：最新版直接用总览里的对象，避免多打一次请求。 */
  useEffect(() => {
    if (!token || !productId || !selectedId || selectedId === latestId) {
      setSelectedProfile(null);
      return;
    }
    let cancelled = false;
    apiRequest<ValueCodeProfileView>(
      `/api/products/${productId}/value-codes/${selectedId}`,
      { token }
    )
      .then((result) => {
        if (!cancelled) {
          setSelectedProfile(result);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setSelectedProfile(null);
          notify(caught instanceof ApiError ? caught.message : "读取该版本失败", "error");
        }
      });
    return () => {
      cancelled = true;
    };
    // notify 是稳定引用（Toast 上下文），不进依赖以免重复请求。
  }, [latestId, productId, selectedId, token]);

  const viewProfile =
    selectedId !== null && selectedId !== latestId ? selectedProfile : overview?.profile ?? null;
  const latest = overview?.profile ?? null;

  async function generate(notes: string | null): Promise<void> {
    setBusy("generate");
    try {
      const created = await apiRequest<ValueCodeProfileView>(
        `/api/products/${productId}/value-codes/generate`,
        {
          method: "POST",
          token,
          body: notes === null ? {} : { notes }
        }
      );
      notify(
        `已生成价值映射 v${created.version}（已具备 ${countOf(created.code_counts, "ALREADY_HAVE")} / ${totalCount(created.code_counts)} 个 Code）`,
        "ok"
      );
      setSelectedId(null);
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "生成价值映射失败", "error");
    } finally {
      setBusy(null);
    }
  }

  /** 人工确认只表示「这一版被审过」：不改写正文、不升版本，也不阻止继续派生新版。 */
  async function setConfirmed(
    profile: ValueCodeProfileView,
    nextConfirmed: boolean
  ): Promise<void> {
    setBusy("confirm");
    try {
      await apiRequest<ValueCodeProfileView>(
        `/api/products/${productId}/value-codes/${profile.id}`,
        { method: "PATCH", token, body: { is_confirmed: nextConfirmed } }
      );
      notify(
        nextConfirmed
          ? `已人工确认 v${profile.version}（版本仍保留，可继续派生新版）`
          : `已取消 v${profile.version} 的人工确认`,
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
        title="价值映射（Value Codes / Value Mapping）"
        spec="§18 / §19 / §20 / §30"
        subtitle="把「这款茶凭什么贵得起」拆成 16 个可判定的 Code：有事实才成立，没事实就写未录入，竞品事实一律不移植。"
        actions={
          <>
            {latest ? (
              <Pill tone={latest.code_counts.UNKNOWN ? "warn" : "ok"}>
                最新 v{latest.version}：已具备{" "}
                {countOf(latest.code_counts, "ALREADY_HAVE")} / {totalCount(latest.code_counts)}
              </Pill>
            ) : (
              <Pill tone="neutral">尚未生成价值映射</Pill>
            )}
            <Pill tone="neutral">{overview?.versions.length ?? 0} 版</Pill>
            <button type="button" className="secondary sm" onClick={() => setOpen((value) => !value)}>
              {open ? "收起" : "展开价值映射"}
            </button>
          </>
        }
      >
        <p className="muted">
          {latest
            ? `当前最新一版 v${latest.version}（${
                latest.mode_at_generation === "BENCHMARK" ? "Benchmark Mode" : "Category Creator Mode"
              }）：时间依赖 ${countOf(latest.code_counts, "TIME_DEPENDENT")} 个、单点事实 ${countOf(
                latest.code_counts,
                "PARTIAL"
              )} 个、未录入 ${countOf(latest.code_counts, "UNKNOWN")} 个，缺口 ${
                latest.evidence_gaps.length
              } 条。`
            : "尚无价值映射：先补齐事实，再生成一版；生成不会自动补全任何未录入内容。"}
        </p>
        {!open ? (
          <p className="muted mt-2">
            展开后可查看 §18 合同口径、16 个 Code 的落位矩阵、六类价值故事、缺口清单与全部版本。
          </p>
        ) : null}
      </Card>

      {open ? (
        <>
          <ValueCodesContractCard
            contract={contract}
            engine={engine}
            downstream={downstream}
            loading={contractLoading}
            error={contractError}
            open={contractOpen}
            onToggle={() => setContractOpen((value) => !value)}
          />

          <ValueCodesOverviewCard
            overview={overview}
            profile={viewProfile}
            labels={labels}
            canWrite={canWrite}
            busy={busy}
            loading={loading}
            error={error}
            onGenerate={(notes) => void generate(notes)}
            onConfirm={(profile, nextConfirmed) => void setConfirmed(profile, nextConfirmed)}
            onRetry={reload}
          />

          <ValueCodeMatrixTable profile={viewProfile} labels={labels} loading={loading} />

          <ValueStoriesCard profile={viewProfile} labels={labels} />

          <ValueGapsCard profile={viewProfile} />

          <ValueCodeVersionList
            overview={overview}
            labels={labels}
            selectedId={selectedId}
            latestId={latestId}
            onSelect={(id) => setSelectedId(id === latestId ? null : id)}
          />

          <ValueCodeDictionaryTable
            contract={contract}
            labels={labels}
            loading={contractLoading}
            error={contractError}
          />
        </>
      ) : null}
    </div>
  );
}
