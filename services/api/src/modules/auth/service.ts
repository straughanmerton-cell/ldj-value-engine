import { and, count, eq, isNull } from "drizzle-orm";
import type { Database, Session, User } from "@ldj/database";
import { hashPassword, sessions, users, verifyPassword } from "@ldj/database";
import type { LoginInput, RegisterInput, UserRole } from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import { randomToken, sha256 } from "../../lib/hash.js";
import { signAccessToken } from "../../lib/tokens.js";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface AuthUserView {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: string;
}

export interface AuthResult {
  user: AuthUserView;
  tokens: AuthTokens;
}

export interface AuthServiceOptions {
  jwtSecret: string;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly options: AuthServiceOptions
  ) {}

  async userCount(): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(users);
    return Number(rows[0]?.value ?? 0);
  }

  /**
   * 注册规则：
   * - 系统内还没有用户时，允许自助注册并直接成为 ADMIN（bootstrap）；
   * - 之后只有 ADMIN 可以创建用户（规格 Phase 1 Auth / RBAC）。
   */
  async register(input: RegisterInput, actor?: { role: UserRole }): Promise<AuthResult> {
    const total = await this.userCount();
    const isBootstrap = total === 0;
    if (!isBootstrap && actor?.role !== "ADMIN") {
      throw AppError.forbidden("只有管理员可以创建新用户");
    }

    const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing.length > 0) {
      throw AppError.conflict("该邮箱已注册");
    }

    const role: UserRole = isBootstrap ? "ADMIN" : (input.role ?? "RESEARCHER");
    const inserted = await this.db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        role,
        passwordHash: hashPassword(input.password)
      })
      .returning();
    const user = inserted[0]!;
    const tokens = await this.issueTokens(user);
    return { user: toUserView(user), tokens };
  }

  async login(input: LoginInput, meta?: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const rows = await this.db.select().from(users).where(eq(users.email, input.email)).limit(1);
    const user = rows[0];
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw AppError.unauthorized("邮箱或密码不正确");
    }
    if (user.status !== "ACTIVE") {
      throw AppError.forbidden("该账号已被停用");
    }

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    const tokens = await this.issueTokens(user, meta);
    return { user: toUserView(user), tokens };
  }

  async refresh(refreshToken: string, meta?: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const session = await this.findActiveSession(refreshToken);
    if (!session) {
      throw AppError.unauthorized("刷新令牌无效或已过期");
    }
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, session.id));
    const userRows = await this.db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    const user = userRows[0];
    if (!user || user.status !== "ACTIVE") {
      throw AppError.unauthorized("账号不可用");
    }
    const tokens = await this.issueTokens(user, meta);
    return { user: toUserView(user), tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = sha256(refreshToken);
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.refreshTokenHash, hash));
  }

  async findUserById(id: string): Promise<AuthUserView | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    const user = rows[0];
    return user ? toUserView(user) : null;
  }

  private async findActiveSession(refreshToken: string): Promise<Session | null> {
    const hash = sha256(refreshToken);
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.refreshTokenHash, hash), isNull(sessions.revokedAt)))
      .limit(1);
    const session = rows[0];
    if (!session) {
      return null;
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return session;
  }

  private async issueTokens(user: User, meta?: { userAgent?: string; ip?: string }): Promise<AuthTokens> {
    const accessToken = await signAccessToken(
      { sub: user.id, email: user.email, role: user.role },
      this.options.jwtSecret,
      this.options.accessTokenTtlMinutes
    );
    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + this.options.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    await this.db.insert(sessions).values({
      userId: user.id,
      refreshTokenHash: sha256(refreshToken),
      userAgent: meta?.userAgent,
      ip: meta?.ip,
      expiresAt
    });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: this.options.accessTokenTtlMinutes * 60
    };
  }
}

export function toUserView(user: User): AuthUserView {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status
  };
}
