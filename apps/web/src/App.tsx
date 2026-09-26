import type { ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ModulePlaceholder } from "./components/ModulePlaceholder.js";
import { useAuth } from "./lib/auth.js";
import { ChatPage } from "./pages/ChatPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DealerCenterPage } from "./pages/DealerCenterPage.js";
import { EvidencePage } from "./pages/EvidencePage.js";
import { FormulaPhilosophyPage } from "./pages/FormulaPhilosophyPage.js";
import { HighValueDbPage } from "./pages/HighValueDbPage.js";
import { HostCenterPage } from "./pages/HostCenterPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MarketPricesPage } from "./pages/MarketPricesPage.js";
import { ProductArchitecturePage } from "./pages/ProductArchitecturePage.js";
import { ProductDetailPage } from "./pages/ProductDetailPage.js";
import { ProductNewPage } from "./pages/ProductNewPage.js";
import { ProductsPage } from "./pages/ProductsPage.js";
import { ResearchPage } from "./pages/ResearchPage.js";
import { SalesCopyPage } from "./pages/SalesCopyPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { ValueCodesPage } from "./pages/ValueCodesPage.js";
import { VersionsPage } from "./pages/VersionsPage.js";

interface NavItem {
  label: string;
  path: string;
  /** 已交付能力不显示阶段标签；未交付能力必须显式标出计划 Phase，避免被误当成已实现。 */
  phase?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * 一级入口只留一个（§64：老板不用学系统，把需求说清楚就能拿到话术）。
 * 15 个专业模块全部收进侧栏「专业模式」折叠区，能力一个没少，只是不再占着主界面。
 */
const PRIMARY_NAV: NavItem = { label: "AI 对话", path: "/chat" };

/** 侧栏「专业模式」折叠状态：记住用户自己的选择。 */
const PRO_NAV_STORAGE_KEY = "ldj.nav.professional";

const PRO_PATHS = [
  "/dashboard",
  "/products",
  "/research",
  "/high-value-db",
  "/market-prices",
  "/value-codes",
  "/architecture",
  "/formula-philosophy",
  "/copy",
  "/hosts",
  "/dealers",
  "/knowledge",
  "/evidence",
  "/versions",
  "/settings"
];

function isProfessionalPath(pathname: string): boolean {
  return PRO_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** 规格 §31 页面信息架构：15 个模块全部登记并分组，未实现模块以明确 Phase 占位。 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: "概览",
    items: [{ label: "工作台总览", path: "/dashboard" }]
  },
  {
    title: "产品与资产",
    items: [
      { label: "产品中心", path: "/products" },
      { label: "AI价值研究", path: "/research", phase: "Phase 8+" },
      { label: "高价值茶数据库", path: "/high-value-db", phase: "Phase 8+" },
      { label: "市场价格中心", path: "/market-prices" }
    ]
  },
  {
    title: "价值引擎",
    items: [
      { label: "价值密码库", path: "/value-codes" },
      { label: "产品结构", path: "/architecture" },
      { label: "配方哲学", path: "/formula-philosophy" },
      { label: "强成交文案", path: "/copy" }
    ]
  },
  {
    title: "交付中心",
    items: [
      { label: "卖点交付", path: "/hosts" },
      { label: "经销商培训", path: "/dealers" }
    ]
  },
  {
    title: "知识与治理",
    items: [
      { label: "龙德记知识库", path: "/knowledge", phase: "Phase 3+" },
      { label: "证据中心", path: "/evidence" },
      { label: "版本管理", path: "/versions" }
    ]
  },
  {
    title: "系统",
    items: [{ label: "系统设置", path: "/settings" }]
  }
];

/** 全量导航查找表：供面包屑与页面标题使用。 */
const NAV_ITEMS: NavItem[] = [PRIMARY_NAV, ...NAV_GROUPS.flatMap((group) => group.items)];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "管理员",
  RESEARCHER: "研究员",
  COPYWRITER: "文案",
  VIEWER: "只读"
};

function RequireAuth({ children }: { children: ReactNode }): ReactElement {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    // 记下来路，登录成功后回到用户原本要打开的页面（LoginPage 读取 state.from）。
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

function Layout({ children }: { children: ReactNode }): ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [proOpen, setProOpen] = useState(
    () =>
      window.localStorage.getItem(PRO_NAV_STORAGE_KEY) === "1" ||
      isProfessionalPath(window.location.pathname)
  );
  const lastPath = useRef(location.pathname);

  /** 在站内切到专业模块时自动展开，否则当前项会被藏在折叠区里看不见。 */
  useEffect(() => {
    if (lastPath.current === location.pathname) {
      return;
    }
    lastPath.current = location.pathname;
    if (isProfessionalPath(location.pathname)) {
      setProOpen(true);
      window.localStorage.setItem(PRO_NAV_STORAGE_KEY, "1");
    }
  }, [location.pathname]);

  function toggleProNav(): void {
    const next = !proOpen;
    setProOpen(next);
    window.localStorage.setItem(PRO_NAV_STORAGE_KEY, next ? "1" : "0");
  }

  const currentLabel =
    NAV_ITEMS.filter((item) => location.pathname.startsWith(item.path)).sort(
      (left, right) => right.path.length - left.path.length
    )[0]?.label ?? "AI 对话";

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">龙</div>
          <div className="brand-text">
            <strong>龙德记 · Value Engine</strong>
            <span>AI 产品卖点与价值锚点</span>
          </div>
        </div>
        <nav>
          <NavLink className="nav-primary" to={PRIMARY_NAV.path}>
            <span>{PRIMARY_NAV.label}</span>
            <span className="nav-primary-hint">说需求 · 出卖点</span>
          </NavLink>

          <div className="nav-pro">
            <button className="nav-pro-toggle" type="button" onClick={toggleProNav}>
              <span>专业模式</span>
              <span className="nav-pro-state">{proOpen ? "收起" : "展开"}</span>
            </button>
            <p className="nav-pro-note">研究 / 锚点 / 配方 / 审核 / 交付等 15 个模块</p>
          </div>

          {proOpen ? (
            <div className="nav-pro-body">
              {NAV_GROUPS.map((group) => (
                <div className="nav-group" key={group.title}>
                  <div className="nav-group-title">{group.title}</div>
                  {group.items.map((item) => (
                    <NavLink key={item.path} to={item.path}>
                      <span>{item.label}</span>
                      {item.phase ? <span className="nav-phase">{item.phase}</span> : null}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="avatar">{(user?.name ?? "?").slice(0, 1)}</div>
            <div className="who">
              {user?.name}
              <span>
                {ROLE_LABELS[user?.role ?? ""] ?? user?.role}　{user?.email}
              </span>
            </div>
          </div>
          <button
            className="secondary sm block"
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="appbar">
          <span className="crumb">{currentLabel}</span>
          <span className="appbar-hint">数据可追溯 · 事实不虚构 · 版本不丢失</span>
        </div>
        {children}
      </main>
    </div>
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                {/* 默认落地就是对话工作台：其余模块都退到「专业模式」里（§64）。 */}
                <Route path="/" element={<Navigate to="/chat" replace />} />
                <Route path="/chat" element={<ChatPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/products/new" element={<ProductNewPage />} />
                <Route path="/products/:id" element={<ProductDetailPage />} />
                <Route path="/research" element={<ResearchPage />} />
                <Route path="/high-value-db" element={<HighValueDbPage />} />
                <Route path="/market-prices" element={<MarketPricesPage />} />
                <Route path="/value-codes" element={<ValueCodesPage />} />
                <Route path="/architecture" element={<ProductArchitecturePage />} />
                <Route
                  path="/formula-philosophy"
                  element={<FormulaPhilosophyPage />}
                />
                <Route path="/copy" element={<SalesCopyPage />} />
                <Route path="/hosts" element={<HostCenterPage />} />
                <Route path="/dealers" element={<DealerCenterPage />} />
                <Route
                  path="/knowledge"
                  element={
                    <ModulePlaceholder
                      title="龙德记知识库"
                      phase="Phase 3+"
                      specRef="§36、§54"
                      summary="沉淀龙德记产品事实、研发资料与品牌知识的检索底座。"
                      deliverables={["knowledge_documents / knowledge_chunks", "与产品事实、证据关联"]}
                    />
                  }
                />
                <Route path="/evidence" element={<EvidencePage />} />
                <Route path="/versions" element={<VersionsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
