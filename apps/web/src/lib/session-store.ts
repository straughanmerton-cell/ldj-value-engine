/**
 * 登录会话的唯一存储层。
 *
 * 为什么要单独一层：`AuthProvider`（React）与 `apiRequest`（纯函数）都要读写同一份登录态。
 * access token 只有 30 分钟有效期（ACCESS_TOKEN_TTL_MINUTES），收到 401 时必须能就地换成
 * 新 token 并重试，否则用户会卡在「访问令牌无效或已过期」而页面又不会退回登录页。
 */
export type UserRole = "ADMIN" | "RESEARCHER" | "COPYWRITER" | "VIEWER";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

const STORAGE_KEY = "ldj.session";

let cached: StoredSession | null | undefined;
const listeners = new Set<() => void>();

function readFromStorage(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredSession> | null;
    if (!parsed?.accessToken || !parsed.refreshToken || !parsed.user) {
      return null;
    }
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

/** useSyncExternalStore 要求快照引用稳定，因此读到内存后不再重复反序列化。 */
export function getSession(): StoredSession | null {
  if (cached === undefined) {
    cached = readFromStorage();
  }
  return cached;
}

export function setSession(next: StoredSession | null): void {
  cached = next;
  try {
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // 隐私模式 / 存储被禁用时只保留内存态，不影响本次会话使用。
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
