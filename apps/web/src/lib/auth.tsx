import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode
} from "react";
import { apiRequest } from "./api.js";
import { getSession, setSession, subscribeSession, type SessionUser } from "./session-store.js";

export type { SessionUser } from "./session-store.js";

interface AuthContextValue {
  user: SessionUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  // 登录态与 apiRequest 的自动刷新共用同一份存储：token 被刷新后这里会自动重渲染。
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiRequest<{ user: SessionUser; tokens: { access_token: string; refresh_token: string } }>(
      "/api/auth/login",
      { method: "POST", body: { email, password } }
    );
    setSession({
      user: result.user,
      accessToken: result.tokens.access_token,
      refreshToken: result.tokens.refresh_token
    });
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const result = await apiRequest<{ user: SessionUser; tokens: { access_token: string; refresh_token: string } }>(
      "/api/auth/register",
      { method: "POST", body: { email, password, name } }
    );
    setSession({
      user: result.user,
      accessToken: result.tokens.access_token,
      refreshToken: result.tokens.refresh_token
    });
  }, []);

  const logout = useCallback(() => {
    const current = getSession();
    if (current?.refreshToken) {
      void apiRequest("/api/auth/logout", {
        method: "POST",
        body: { refresh_token: current.refreshToken }
      }).catch(() => undefined);
    }
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user: session?.user ?? null, token: session?.accessToken ?? null, login, register, logout }),
    [session, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return context;
}
