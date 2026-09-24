import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ApiError, apiRequest } from "../../lib/api.js";
import {
  useAnchorContract,
  type AnchorListResponse,
  type AnchorRebuildResult,
  type AnchorView,
  type BenchmarkModeView
} from "../../lib/anchors.js";
import { Card } from "../ui/Card.js";
import { Pill } from "../ui/State.js";
import { useToast } from "../ui/Toast.js";
import { CategoryCreatorPanel } from "../category-creator/CategoryCreatorPanel.js";
import { AnchorContractCard } from "./AnchorContractCard.js";
import { AnchorDetailPanel } from "./AnchorDetailPanel.js";
import { AnchorModeCard } from "./AnchorModeCard.js";
import { AnchorRebuildCard } from "./AnchorRebuildCard.js";
import { AnchorTable } from "./AnchorTable.js";

export interface AnchorsPanelProps {
  productId: string;
  token: string | null;
  canWrite: boolean;
  isAdmin: boolean;
}

const PAGE_SIZE = 60;

/**
 * 产品详情「高价值锚点」Tab（规格 §16 三种锚点 / §17 无锚点强制逻辑 / §55 / §56）。
 *
 * 编排顺序与判定顺序一致：先看合同口径 → 再看本产品落在哪种模式 → 需要时重建 →
 * 列表核对每一条 → 明细复核依据。产品级锚点上限 60 条，所以列表与明细同屏展示。
 */
export function AnchorsPanel({
  productId,
  token,
  canWrite,
  isAdmin
}: AnchorsPanelProps): ReactElement {
  const { notify } = useToast();
  const {
    contract,
    engine,
    typeLabels,
    modeLabels,
    loading: contractLoading,
    error: contractError
  } = useAnchorContract(token);

  const [mode, setMode] = useState<BenchmarkModeView | null>(null);
  const [modeLoading, setModeLoading] = useState(true);
  const [modeError, setModeError] = useState<string | null>(null);
  const [listData, setListData] = useState<AnchorListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((value) => value + 1), []);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    setModeLoading(true);
    apiRequest<BenchmarkModeView>(`/api/products/${productId}/benchmark-mode`, { token })
      .then((result) => {
        setMode(result);
        setModeError(null);
      })
      .catch((caught) => {
        setMode(null);
        setModeError(caught instanceof ApiError ? caught.message : "读取对标模式失败");
      })
      .finally(() => setModeLoading(false));
  }, [productId, reloadTick, token]);

  useEffect(() => {
    if (!token || !productId) {
      return;
    }
    setListLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort: "rank"
    });
    apiRequest<AnchorListResponse>(`/api/products/${productId}/anchors?${params.toString()}`, {
      token
    })
      .then((result) => {
        setListData(result);
        setListError(null);
      })
      .catch((caught) => {
        setListData(null);
        setListError(caught instanceof ApiError ? caught.message : "读取锚点失败");
      })
      .finally(() => setListLoading(false));
  }, [page, productId, reloadTick, token]);

  const items = useMemo(() => listData?.items ?? [], [listData]);

  /** 明细始终跟着最新数据走：重建或人工修改后，选中的锚点内容不会停在旧快照上。 */
  const selected = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    const fromList = items.find((anchor) => anchor.id === selectedId);
    if (fromList) {
      return fromList;
    }
    return mode?.anchors.find((anchor) => anchor.id === selectedId) ?? null;
  }, [items, mode, selectedId]);

  async function setPrimary(anchor: AnchorView): Promise<void> {
    setBusyId(anchor.id);
    try {
      await apiRequest<AnchorView>(`/api/products/${productId}/anchors/${anchor.id}`, {
        method: "PATCH",
        token,
        body: { is_primary: true }
      });
      notify("已设为主锚点（该锚点标记为人工锚点，重建时默认保留）", "ok");
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "设为主锚点失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function saveRationale(anchor: AnchorView, rationale: string): Promise<void> {
    setBusyId(anchor.id);
    try {
      await apiRequest<AnchorView>(`/api/products/${productId}/anchors/${anchor.id}`, {
        method: "PATCH",
        token,
        body: { rationale }
      });
      notify("判定理由已保存（原锚点数据保留，版本可审计）", "ok");
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "保存判定理由失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeAnchor(anchor: AnchorView): Promise<void> {
    setBusyId(anchor.id);
    try {
      await apiRequest(`/api/products/${productId}/anchors/${anchor.id}`, {
        method: "DELETE",
        token
      });
      notify("锚点已删除", "warn");
      if (selectedId === anchor.id) {
        setSelectedId(null);
      }
      reload();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : "删除锚点失败", "error");
    } finally {
      setBusyId(null);
    }
  }

  function handleRebuilt(result: AnchorRebuildResult): void {
    setPage(1);
    setSelectedId((current) =>
      current && result.anchors.some((anchor) => anchor.id === current) ? current : null
    );
    reload();
  }

  return (
    <div className="stack">
      <AnchorContractCard
        contract={contract}
        engine={engine}
        loading={contractLoading}
        error={contractError}
      />

      <AnchorModeCard
        productId={productId}
        mode={mode}
        modeLabels={modeLabels}
        typeLabels={typeLabels}
        contract={contract}
        loading={modeLoading}
        error={modeError}
      />

      <CategoryCreatorPanel
        productId={productId}
        token={token}
        canWrite={canWrite}
        mode={mode?.mode ?? null}
      />

      <AnchorRebuildCard
        productId={productId}
        token={token}
        canWrite={canWrite}
        engine={engine}
        onRebuilt={handleRebuilt}
      />

      <div className="anchor-layout">
        <AnchorTable
          items={items}
          total={listData?.total ?? items.length}
          page={listData?.page ?? page}
          pageSize={listData?.pageSize ?? PAGE_SIZE}
          totalPages={listData?.totalPages ?? 1}
          loading={listLoading}
          error={listError}
          selectedId={selectedId}
          canWrite={canWrite}
          isAdmin={isAdmin}
          busyId={busyId}
          typeLabels={typeLabels}
          onSelect={(anchor) => setSelectedId(anchor.id)}
          onPageChange={setPage}
          onSetPrimary={canWrite ? (anchor) => void setPrimary(anchor) : undefined}
          onRemove={isAdmin ? (anchor) => void removeAnchor(anchor) : undefined}
          onRetry={reload}
        />
        <AnchorDetailPanel
          anchor={selected}
          canWrite={canWrite}
          isAdmin={isAdmin}
          busy={busyId !== null && busyId === selected?.id}
          typeLabels={typeLabels}
          onSetPrimary={setPrimary}
          onSaveRationale={saveRationale}
          onRemove={removeAnchor}
          onClose={() => setSelectedId(null)}
        />
      </div>

      {listData && listData.total > PAGE_SIZE ? (
        <Card title="分页说明" spec="§16">
          <p className="muted">
            当前产品共有 {listData.total} 条锚点，超过单页 {PAGE_SIZE} 条：请用列表下方分页翻页，
            不要用「只看前几条」的方式判断产品能不能对标。
          </p>
        </Card>
      ) : null}

      {!canWrite ? (
        <Card title="只读说明" spec="§16 / §17">
          <div className="chip-list">
            <Pill tone="neutral">当前角色：只读</Pill>
          </div>
          <p className="muted mt-2">
            重建锚点、设为主锚点、追加理由与删除需要 ADMIN / RESEARCHER 权限：
            锚点直接决定产品进入 Benchmark Mode 还是 Category Creator Mode。
          </p>
        </Card>
      ) : null}
    </div>
  );
}
