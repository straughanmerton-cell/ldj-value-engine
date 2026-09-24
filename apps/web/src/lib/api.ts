import { getSession, setSession, type SessionUser } from "./session-store.js";

export interface ApiErrorShape {
  error: { code: string; message: string; details?: unknown };
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
}

interface AuthTokensPayload {
  access_token: string;
  refresh_token: string;
}

interface AuthResultPayload {
  user: SessionUser;
  tokens: AuthTokensPayload;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // 只有真正带 body 的请求才声明 content-type：
  // 无 body 却声明 application/json 会被 Fastify 判为「空 JSON body」并直接失败。
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const errorShape = payload as ApiErrorShape | undefined;
    throw new ApiError(
      response.status,
      errorShape?.error?.code ?? "UNKNOWN_ERROR",
      errorShape?.error?.message ?? `请求失败（${response.status}）`,
      errorShape?.error?.details
    );
  }

  return payload as T;
}

/**
 * 刷新登录态。
 *
 * refresh_token 在服务端是「一次一换」的轮换令牌（换新后旧的立即作废），
 * 所以并发的 401 必须共用同一次刷新请求，否则后到的那次会把先到的令牌作废。
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const session = getSession();
      if (!session?.refreshToken) {
        return false;
      }
      try {
        const result = await rawRequest<AuthResultPayload>("/api/auth/refresh", {
          method: "POST",
          body: { refresh_token: session.refreshToken }
        });
        setSession({
          user: result.user,
          accessToken: result.tokens.access_token,
          refreshToken: result.tokens.refresh_token
        });
        return true;
      } catch {
        // 连刷新令牌都失效了：清掉登录态，RequireAuth 会把用户送回登录页。
        setSession(null);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

function shouldAttemptRefresh(path: string, error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    path.startsWith("/api/") &&
    // 登录 / 注册 / 刷新 / 登出自身不参与自动刷新，避免递归。
    !path.startsWith("/api/auth/") &&
    Boolean(getSession()?.refreshToken)
  );
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (!shouldAttemptRefresh(path, error)) {
      throw error;
    }
    if (!(await refreshSession())) {
      throw error;
    }
    // 用刷新出来的新令牌重试一次；重试仍失败就如实抛给调用方。
    const nextToken = getSession()?.accessToken ?? null;
    return await rawRequest<T>(path, { ...options, token: nextToken });
  }
}
