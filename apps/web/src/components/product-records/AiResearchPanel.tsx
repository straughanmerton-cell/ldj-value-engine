import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { CandidatesPanel } from "../research/CandidatesPanel.js";
import { ResearchRunCard } from "../research/ResearchRunCard.js";
import { SearchPlanCard } from "../research/SearchPlanCard.js";
import { SourcesPanel } from "../research/SourcesPanel.js";
import { Alert } from "../ui/State.js";
import { apiRequest } from "../../lib/api.js";
import type { PanelProps } from "./ProductFactsPanel.js";

/**
 * 产品详情「AI研究」Tab（规格 §12 / §40 / §41 / §55 / §56）。
 *
 * 与「AI价值研究工作台」共用同一批组件与同一批接口，避免两处各写一套流水线逻辑。
 * Tab 内只呈现与该产品直接相关的动作：跑研究 → 看 22 阶段进度 → 审搜索策略 → 查来源证据；
 * Phase 5 起追加候选池与相似度分档；价格引擎（Phase 6）、锚点（Phase 7）与话术（Phase 12）
 * 之后才会出现在这里，未交付阶段继续只在进度中登记，不用简化实现顶替。
 */
export function AiResearchPanel({ productId, token, canWrite, isAdmin }: PanelProps): ReactElement {
  const [refreshKey, setRefreshKey] = useState(0);
  const [aiProvider, setAiProvider] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const meta = await apiRequest<{ ai_provider: string }>("/api/meta/core-features", { token });
      setAiProvider(meta.ai_provider);
    } catch {
      setAiProvider(null);
    }
  }, [token]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  return (
    <>
      <Alert tone="info">
        本 Tab 与研究流水线共用同一批数据：来源、抓取正文与网页抽取结果都按产品隔离，
        抽取结果只作证据，不会自动写入「事实清单」（规格 §11 / §41）。
        需要完整工作台视图可前往 <Link to={`/research?productId=${productId}`}>AI价值研究工作台</Link>。
      </Alert>

      <ResearchRunCard
        productId={productId}
        token={token}
        canWrite={canWrite}
        aiProvider={aiProvider}
        onFinished={() => setRefreshKey((key) => key + 1)}
      />
      <SearchPlanCard productId={productId} token={token} canWrite={canWrite} refreshKey={refreshKey} />
      <SourcesPanel
        productId={productId}
        token={token}
        canWrite={canWrite}
        isAdmin={isAdmin}
        refreshKey={refreshKey}
        compact
        evidenceLink
      />
      <CandidatesPanel
        productId={productId}
        token={token}
        canWrite={canWrite}
        isAdmin={isAdmin}
        refreshKey={refreshKey}
        compact
      />
    </>
  );
}
