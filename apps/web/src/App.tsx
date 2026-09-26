import type { ReactElement, ReactNode } from "react";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "./components/ui/Toast.js";
import { useAuth } from "./lib/auth.js";
import {
  bumpSessionRevision,
  deleteChatSession,
  formatDateTime,
  useChatSessions,
  useSessionRevision
} from "./lib/chat.js";
import { LoginPage } from "./pages/LoginPage.js";
import { SellpointPage } from "./pages/SellpointPage.js";

/**
 * 应用外壳（客户 2026-09-26 追加需求：把界面砍到一个入口）。
 *
 * 现在整个系统只有一件事：**写下产品名和你要什么 → 拿到一张卖点一页纸**。
 * 侧栏只留「新建卖点页 + 我的卖点页 + 账号」三块，15 个专业模块从界面上下掉
 * （页面文件都还在仓库里，后端接口一个没删，随时可以再接回来）。
 *
 * 旧链接（`/products`、`/copy`、`/hosts`…）不再 404，一律回到卖点页。
 */

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
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  return <>{children}</>;
}

function Layout({ children }: { children: ReactNode }): ReactElement {
  const { token, user, logout } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeId = searchParams.get("s");
  const revision = useSessionRevision();
  const { data, reload } = useChatSessions(token, { pageSize: 50 });

  /** 页面里新建 / 发送 / 删除后广播一次版本号，侧栏据此刷新（见 lib/chat.ts）。 */
  useEffect(() => {
    reload();
  }, [revision, reload]);

  const sessions = data?.items ?? [];

  async function handleDelete(sessionId: string, title: string): Promise<void> {
    if (!token) {
      return;
    }
    const confirmed = window.confirm(
      `删除「${title}」？这张卖点页和里面生成的稿子会一起删掉，删了找不回来。`
    );
    if (!confirmed) {
      return;
    }
    try {
      await deleteChatSession(token, sessionId);
      notify("已删除", "ok");
      if (sessionId === activeId) {
        navigate("/chat", { replace: true });
      }
      bumpSessionRevision();
    } catch {
      notify("删除失败，请稍后重试", "error");
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">龙</div>
          <div className="brand-text">
            <strong>龙德记 · 卖点手册</strong>
            <span>说产品名 · 出一页卖点</span>
          </div>
        </div>

        <button
          className="side-new"
          type="button"
          onClick={() => navigate("/chat")}
        >
          ＋ 新建卖点页
        </button>

        <div className="side-list-head">
          <span>我的卖点页</span>
          <span className="side-count">{sessions.length}</span>
        </div>
        <nav className="side-list">
          {sessions.length === 0 ? (
            <p className="side-empty">还没有卖点页。写下产品名，就出第一版。</p>
          ) : null}
          {sessions.map((session) => (
            <div
              className={session.id === activeId ? "side-item active" : "side-item"}
              key={session.id}
            >
              <button
                className="side-item-main"
                type="button"
                onClick={() => navigate(`/chat?s=${session.id}`)}
              >
                <span className="side-item-title">{session.title}</span>
                <span className="side-item-meta">
                  {session.product_name ? `${session.product_name} · ` : ""}
                  {formatDateTime(session.updated_at)}
                </span>
              </button>
              <button
                className="side-item-del"
                type="button"
                title="删除这张卖点页"
                onClick={() => void handleDelete(session.id, session.title)}
              >
                ×
              </button>
            </div>
          ))}
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
      <main className="content">{children}</main>
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
                {/* 整个系统只有一个页面：卖点一页纸。旧链接一律回到这里。 */}
                <Route path="/" element={<Navigate to="/chat" replace />} />
                <Route path="/chat" element={<SellpointPage />} />
                <Route path="*" element={<Navigate to="/chat" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
