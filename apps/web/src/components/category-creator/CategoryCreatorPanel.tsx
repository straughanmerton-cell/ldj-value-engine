import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  CATEGORY_READINESS_LABELS,
  CATEGORY_READINESS_TONES,
  useCategoryCreatorContract,
  type CategoryCreatorOverview,
  type CategoryCreatorProfileView,
  type CategoryCreatorTrigger
} from "../../lib/category-creator.js";
import type { ResolvedMode } from "../../lib/anchors.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { CategoryCreatorContractCard } from "./CategoryCreatorContractCard.js";
import { CategoryCreatorIdentityCard } from "./CategoryCreatorIdentityCard.js";
import { CategoryCreatorOverviewCard } from "./CategoryCreatorOverviewCard.js";
import { CategoryCreatorStandardCard } from "./CategoryCreatorStandardCard.js";
import { CategoryCreatorValueLogicCard } from "./CategoryCreatorValueLogicCard.js";
import { CategoryCreatorVersionList } from "./CategoryCreatorVersionList.js";

export interface CategoryCreatorPanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  /** 产品当前的模式判定（来自 §17 锚点引擎），用于决定面板是否默认展开。 */
  mode: ResolvedMode | null;
}

/**
 * Phase 8 自建高端标准模式面板（规格 §4.2 / §17 / §29 / §24）。
 *
 * 为什么不做成独立 Tab：§32 的 13 个产品详情 Tab 里没有「Category Creator」这一项——
 * 它是模式分支，不是一份独立资料。所以面板挂在「高价值锚点」Tab 内、紧跟模式判定之后：
 * 先看「有没有对标」，再决定「没有对标记怎么讲」。
 *
 * 默认展开条件与产品结论一致：只要模式判定落到 CATEGORY_CREATOR，这一块就是必读内容；
 * Benchmark 模式下仍然可生成（代表产品负责人主动选择不使用对标，§4.2 的 USER_OPT_OUT）。
 */
export function CategoryCreatorPanel({
  productId,
  token,
  canWrite,
  mode
}: CategoryCreatorPanelProps): ReactElement {
  const { notify } = useToast();
  const { contract, engine, downstream, loading: contractLoading, error: contractError } =
    useCategoryCreatorContract(token);

  const [overview, setOverview] = useState<CategoryCreatorOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<CategoryCreatorProfileView | null>(null);
  const [busy, setBusy] = useState<"generate" | "confirm" | null>(null);
  const [open, setOpen] = useState(false);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  /** 模式判定一落到自建标准就必须展开：这是产品结论，不是可选的补充资料。 */
  useEffect(() => {
    if (mode === "CATEGORY_CREATOR") {
      setOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<CategoryCreatorOverview>(`/api/products/${productId}/category-creator`, { token })
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
        setError(caught instanceof ApiError ? caught.message : "读取自建标准失败");
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
    apiRequest<CategoryCreatorProfileView>(
      `/api/products/${productId}/category-creator/${selectedId}`,
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

  const viewProfile = selectedId !== null && selectedId !== latestId ? selectedProfile : overview?.profile ?? null;

  async function generate(input: { trigger: CategoryCreatorTrigger; notes: string | null }): Promise<void> {
    setBusy("generate");
    try {
      const created = await apiRequest<CategoryCreatorProfileView>(
        `/api/products/${productId}/category-creator/generate`,
        {
          method: "POST",
          token,
          body: input.notes === null ? { trigger: input.trigger } : { trigger: input.trigger, notes: input.notes }
        }
      );
      notify(
        `已生成自建标准 v${created.version}（${CATEGORY_READINESS_LABELS[created.readiness]}）`,
        "ok"
      );
      setSelectedId(null);
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "生成自建标准失败", "error");
    } finally {
      setBusy(null);
    }
  }

  async function setConfirmed(profile: CategoryCreatorProfileView, nextConfirmed: boolean): Promise<void> {
    setBusy("confirm");
    try {
      await apiRequest<CategoryCreatorProfileView>(
        `/api/products/${productId}/category-creator/${profile.id}`,
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

  const latest = overview?.profile ?? null;

  return (
    <div className="stack">
      <Card
        title="自建高端标准（Category Creator Mode）"
        spec="§4.2 / §17 / §29"
        subtitle="模式分支，不是独立资料：有达标对标就走 Benchmark Mode，没有就走自建标准，两种都合法，硬凑竞品不合法。"
        actions={
          <>
            {latest ? (
              <Pill tone={CATEGORY_READINESS_TONES[latest.readiness]}>
                最新 v{latest.version}：{CATEGORY_READINESS_LABELS[latest.readiness]}
              </Pill>
            ) : (
              <Pill tone={mode === "CATEGORY_CREATOR" ? "warn" : "neutral"}>
                {mode === "CATEGORY_CREATOR" ? "尚未生成自建标准" : "尚未生成（可选）"}
              </Pill>
            )}
            <Pill tone="neutral">{overview?.versions.length ?? 0} 版</Pill>
            <button type="button" className="secondary sm" onClick={() => setOpen((value) => !value)}>
              {open ? "收起" : "展开自建标准"}
            </button>
          </>
        }
      >
        <p className="muted">
          {latest
            ? `当前最新一版 v${latest.version}：${latest.supported_axes} / ${latest.total_axes} 个标准轴拿到事实，缺口 ${latest.evidence_gaps.length} 条，成交表达${
                latest.value_logic.sales_line_ready ? "已具备" : "尚未具备"
              }。`
            : "暂无自建标准：没有对标时这一步是必做项；有对标时，生成它代表主动选择不使用对标。"}
        </p>
        {!open ? (
          <p className="muted mt-2">
            展开后可查看六标准轴、风格身份证、价值逻辑、缺口清单与全部版本；生成新版不会改写历史版本。
          </p>
        ) : null}
      </Card>

      {open ? (
        <>
          <CategoryCreatorContractCard
            contract={contract}
            engine={engine}
            downstream={downstream}
            loading={contractLoading}
            error={contractError}
          />

          <CategoryCreatorOverviewCard
            overview={overview}
            profile={viewProfile}
            contract={contract}
            loading={loading}
            error={error}
            canWrite={canWrite}
            busy={busy}
            onGenerate={(input) => void generate(input)}
            onConfirm={(profile, nextConfirmed) => void setConfirmed(profile, nextConfirmed)}
            onRetry={reload}
          />

          <CategoryCreatorStandardCard profile={viewProfile} loading={loading} />

          <CategoryCreatorIdentityCard profile={viewProfile} />

          <CategoryCreatorValueLogicCard profile={viewProfile} />

          <CategoryCreatorVersionList
            versions={overview?.versions ?? []}
            selectedId={selectedId}
            latestId={latestId}
            onSelect={(id) => setSelectedId(id === latestId ? null : id)}
          />
        </>
      ) : null}
    </div>
  );
}
