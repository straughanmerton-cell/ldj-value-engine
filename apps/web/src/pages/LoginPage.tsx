import { useState, type FormEvent, type ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ApiError } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";

export function LoginPage(): ReactElement {
  const { user, login, register } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 登录 / 注册成功后 user 立刻有值，必须主动离开 /login：
  // /login 不在 RequireAuth 之内，否则接口返回 200 但页面看起来毫无反应。
  if (user) {
    const requested = (location.state as { from?: string } | null)?.from;
    const from = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/";
    return <Navigate to={from} replace />;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">龙</div>
          <div className="brand-text">
            <strong className="dark">龙德记 · Value Engine</strong>
            <span className="muted">AI 高价值锚点与强成交话术系统</span>
          </div>
        </div>
        <h1>{mode === "login" ? "登录" : "注册首个管理员"}</h1>
        <p className="muted">
          {mode === "login"
            ? "后台像分析师一样严谨，前台像顶级主播一样有压迫感。"
            : "系统内还没有用户时，注册的第一个账号自动成为 ADMIN。"}
        </p>
        <form className="stack mt-4" onSubmit={submit}>
        <label>
          邮箱
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>
        {mode === "register" ? (
          <label>
            姓名
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
        ) : null}
        <label>
          密码
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <div className="btn-row">
          <button type="submit" disabled={busy}>
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "首次使用？注册" : "返回登录"}
          </button>
        </div>
        </form>
        <p className="muted mt-4">
          默认管理员：949412546@qq.com　·　事实不虚构 · 价格可追溯 · 版本不丢失
        </p>
      </div>
    </div>
  );
}
