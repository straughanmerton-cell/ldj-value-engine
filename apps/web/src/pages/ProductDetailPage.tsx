import { useEffect, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { AnchorsPanel } from "../components/anchors/AnchorsPanel.js";
import { DealerCenterPanel } from "../components/dealer-center/DealerCenterPanel.js";
import { VersionHistoryPanel } from "../components/delivery/VersionHistoryPanel.js";
import { HostCenterPanel } from "../components/host-center/HostCenterPanel.js";
import { ProductArchitecturePanel } from "../components/product-architecture/ProductArchitecturePanel.js";
import { FormulaPhilosophyPanel } from "../components/formula-philosophy/FormulaPhilosophyPanel.js";
import { SalesCopyPanel } from "../components/sales-copy/SalesCopyPanel.js";
import { FactReviewPanel } from "../components/fact-review/FactReviewPanel.js";
import { AiResearchPanel } from "../components/product-records/AiResearchPanel.js";
import { ProductFactsPanel } from "../components/product-records/ProductFactsPanel.js";
import { RndReferencesPanel } from "../components/product-records/RndReferencesPanel.js";
import { TastingProfilesPanel } from "../components/product-records/TastingProfilesPanel.js";
import { ValueDnaPanel } from "../components/product-records/ValueDnaPanel.js";
import { Card, PageHeader } from "../components/ui/Card.js";
import { ErrorState, LoadingState, Pill } from "../components/ui/State.js";
import { ValueCodesPanel } from "../components/value-codes/ValueCodesPanel.js";
import { apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

interface ProductDetail {
  id: string;
  product_name: string;
  year: number;
  tea_type: string;
  tea_subtype: string | null;
  origin_region: string | null;
  mountain: string | null;
  village: string | null;
  weight_g: number;
  raw_material: string | null;
  tree_type: string | null;
  tree_age: string | null;
  season: string | null;
  dry_leaf_aroma: string | null;
  entry_taste: string | null;
  huigan: string | null;
  salivation: string | null;
  cha_qi: string | null;
  benchmark_mode_preference: string;
  copy_intensity_default: number;
  r_and_d_reference_enabled: boolean;
  r_and_d_reference_notes: string | null;
  product_architecture: unknown;
  formula_philosophy: unknown;
  version: number;
  updated_at: string;
}

interface DetailTab {
  key: string;
  label: string;
  phase: number;
  note: string;
}

/**
 * 规格 §32 的产品详情 Tabs（顺序与基线一致），
 * 其中 Phase 2 交付的「品饮档案」「事实清单」「研发资料」已可用，其余 Tab 保留明确 Phase 占位。
 */
const DETAIL_TABS: DetailTab[] = [
  { key: "profile", label: "产品资料", phase: 1, note: "§10 产品录入基础资料 / 原料 / 工艺 / 感官" },
  { key: "tasting", label: "品饮档案", phase: 2, note: "§10.4 二十项感官的可版本化品饮记录" },
  { key: "facts", label: "事实清单", phase: 2, note: "§11 六态事实状态，含 RND_CONFIRMED" },
  { key: "rnd", label: "研发资料", phase: 2, note: "§35.2 研发参考与 §25 声明规则" },
  { key: "dna", label: "价值DNA", phase: 3, note: "自动生成 product value DNA" },
  { key: "ai-research", label: "AI研究", phase: 4, note: "搜索、抓取、抽取流水线" },
  { key: "anchors", label: "高价值锚点", phase: 7, note: "Highest / Similarity / Sales Anchor" },
  { key: "value-mapping", label: "价值拆解", phase: 9, note: "Value Codes 与龙德记映射" },
  { key: "value-codes", label: "Value Codes", phase: 9, note: "16 个 Value Code 的证据与贡献度" },
  { key: "architecture", label: "产品结构", phase: 10, note: "Product Architecture 九个角色" },
  { key: "formula", label: "配方哲学", phase: 11, note: "无比例时只写设计逻辑" },
  { key: "copy", label: "强成交话术", phase: 12, note: "包含 Level 5 王者话术" },
  { key: "fact-review", label: "事实审核", phase: 14, note: "FACT / INTERPRETATION / RHETORIC 与 RED 拦截" },
  { key: "versions", label: "历史版本", phase: 15, note: "所有版本必须保留" },
  { key: "final", label: "最终资料", phase: 15, note: "主播 / 经销商 / 导出最终资料包" }
];

export function ProductDetailPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("profile");
  const [finalSide, setFinalSide] = useState<"host" | "dealer">("host");

  const canWrite = user?.role === "ADMIN" || user?.role === "RESEARCHER";
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (!token || !id) {
      return;
    }
    apiRequest<ProductDetail>(`/api/products/${id}`, { token })
      .then(setProduct)
      .catch(() => setError("读取产品失败"));
  }, [id, token]);

  if (error) {
    return (
      <section>
        <Card title="产品详情">
          <ErrorState description={error} />
        </Card>
        <Link to="/products">← 返回产品中心</Link>
      </section>
    );
  }
  if (!product) {
    return (
      <Card title="产品详情">
        <LoadingState label="正在读取产品" />
      </Card>
    );
  }

  const currentTab = DETAIL_TABS.find((tab) => tab.key === activeTab) ?? DETAIL_TABS[0]!;
  const IMPLEMENTED_TABS = new Set([
    "profile",
    "tasting",
    "facts",
    "rnd",
    "dna",
    "ai-research",
    "anchors",
    "value-mapping",
    "value-codes",
    "architecture",
    "formula",
    "copy",
    "fact-review",
    "versions",
    "final"
  ]);

  return (
    <section>
      <PageHeader
        title={product.product_name}
        subtitle={
          <>
            {product.year} 年 · {product.tea_type}
            {product.tea_subtype ? ` / ${product.tea_subtype}` : ""} · {product.weight_g}g
            {product.mountain ? ` · ${product.mountain}` : ""}
          </>
        }
        actions={
          <>
            <Pill tone="neutral">产品版本 v{product.version}</Pill>
            <Pill tone="info">默认文案强度 Level {product.copy_intensity_default}</Pill>
            <Pill tone="outline">
              {product.benchmark_mode_preference === "AUTO"
                ? "对标模式：自动"
                : product.benchmark_mode_preference}
            </Pill>
          </>
        }
      />

      <nav className="tabs">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            title={IMPLEMENTED_TABS.has(tab.key) ? `${tab.note}` : `计划交付：Phase ${tab.phase}｜${tab.note}`}
            className={[
              "tab",
              tab.key === activeTab ? "active" : "",
              IMPLEMENTED_TABS.has(tab.key) ? "" : "locked"
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "profile" ? (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: 15 }}>产品资料（规格 §10）</h3>
            <table>
              <tbody>
                <tr>
                  <th>年份</th>
                  <td>{product.year}</td>
                  <th>茶类</th>
                  <td>
                    {product.tea_type}
                    {product.tea_subtype ? ` / ${product.tea_subtype}` : ""}
                  </td>
                </tr>
                <tr>
                  <th>产区</th>
                  <td>{product.origin_region ?? "—"}</td>
                  <th>山头 / 村寨</th>
                  <td>{[product.mountain, product.village].filter(Boolean).join(" / ") || "—"}</td>
                </tr>
                <tr>
                  <th>规格</th>
                  <td>{product.weight_g}g</td>
                  <th>原料 / 树型 / 树龄</th>
                  <td>{[product.raw_material, product.tree_type, product.tree_age].filter(Boolean).join(" / ") || "—"}</td>
                </tr>
                <tr>
                  <th>香气</th>
                  <td>{product.dry_leaf_aroma ?? "—"}</td>
                  <th>滋味</th>
                  <td>
                    {[product.entry_taste, product.huigan && `回甘${product.huigan}`, product.salivation && `生津${product.salivation}`, product.cha_qi && `茶气${product.cha_qi}`]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </td>
                </tr>
                <tr>
                  <th>对标模式偏好</th>
                  <td>{product.benchmark_mode_preference}</td>
                  <th>默认文案强度</th>
                  <td>Level {product.copy_intensity_default}</td>
                </tr>
                <tr>
                  <th>研发参考</th>
                  <td>{product.r_and_d_reference_enabled ? "已声明（证据见「研发资料」Tab）" : "未声明"}</td>
                  <th>最后更新</th>
                  <td>{new Date(product.updated_at).toLocaleString("zh-CN")}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0, fontSize: 15 }}>产品结构 / 配方哲学</h3>
            <p className="muted">
              产品结构：{product.product_architecture ? "已保存" : "尚未生成"}　｜　配方哲学：
              {product.formula_philosophy ? "已保存" : "尚未生成"}
            </p>
          </div>
        </>
      ) : null}

      {activeTab === "architecture" ? (
        <ProductArchitecturePanel productId={product.id} token={token} canWrite={canWrite} />
      ) : null}

      {activeTab === "formula" ? (
        <FormulaPhilosophyPanel productId={product.id} token={token} canWrite={canWrite} />
      ) : null}

      {activeTab === "copy" ? (
        <SalesCopyPanel productId={product.id} token={token} canWrite={canWrite} />
      ) : null}

      {activeTab === "fact-review" ? (
        <FactReviewPanel productId={product.id} token={token} canWrite={canWrite} />
      ) : null}

      {activeTab === "versions" ? (
        <VersionHistoryPanel
          productId={product.id}
          token={token}
          onGoToTab={setActiveTab}
        />
      ) : null}

      {activeTab === "final" ? (
        <>
          <div className="tab-strip" role="tablist" aria-label="最终资料">
            <button
              type="button"
              role="tab"
              aria-selected={finalSide === "host"}
              className={finalSide === "host" ? "segment active" : "segment"}
              onClick={() => setFinalSide("host")}
            >
              主播中心（§51）
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={finalSide === "dealer"}
              className={finalSide === "dealer" ? "segment active" : "segment"}
              onClick={() => setFinalSide("dealer")}
            >
              经销商中心（§52）
            </button>
          </div>

          {finalSide === "host" ? (
            <HostCenterPanel productId={product.id} token={token} onGoToTab={setActiveTab} />
          ) : (
            <DealerCenterPanel productId={product.id} token={token} onGoToTab={setActiveTab} />
          )}
        </>
      ) : null}

      {activeTab === "tasting" ? (
        <TastingProfilesPanel productId={product.id} token={token} canWrite={canWrite} isAdmin={isAdmin} />
      ) : null}

      {activeTab === "facts" ? (
        <ProductFactsPanel productId={product.id} token={token} canWrite={canWrite} isAdmin={isAdmin} />
      ) : null}

      {activeTab === "rnd" ? (
        <RndReferencesPanel productId={product.id} token={token} canWrite={canWrite} isAdmin={isAdmin} />
      ) : null}

      {activeTab === "dna" ? (
        <ValueDnaPanel productId={product.id} token={token} canWrite={canWrite} isAdmin={isAdmin} />
      ) : null}

      {activeTab === "ai-research" ? (
        <AiResearchPanel productId={product.id} token={token} canWrite={canWrite} isAdmin={isAdmin} />
      ) : null}

      {activeTab === "anchors" ? (
        <AnchorsPanel productId={product.id} token={token} canWrite={canWrite} isAdmin={isAdmin} />
      ) : null}

      {activeTab === "value-mapping" || activeTab === "value-codes" ? (
        <ValueCodesPanel productId={product.id} token={token} canWrite={canWrite} />
      ) : null}

      {!IMPLEMENTED_TABS.has(activeTab) ? (
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>
            {currentTab.label}（Phase {currentTab.phase}）
          </h3>
          <p className="muted">{currentTab.note}</p>
          <p className="muted">
            该 Tab 属于需求基线 §32 的组成部分，将在 Phase {currentTab.phase} 交付，当前不会以任何简化形式替代。
          </p>
        </div>
      ) : null}

      <Link to="/products">← 返回产品中心</Link>
    </section>
  );
}
