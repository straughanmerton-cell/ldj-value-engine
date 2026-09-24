import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@ldj/schemas";
import { AppError } from "@ldj/shared";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  payload: AccessTokenPayload,
  secret: string,
  ttlMinutes: number
): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer("ldj-value-engine")
    .setAudience("ldj-web")
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(secretKey(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: "ldj-value-engine",
      audience: "ldj-web"
    });
    if (!payload.sub || typeof payload.email !== "string" || typeof payload.role !== "string") {
      throw new Error("token payload incomplete");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role as UserRole
    };
  } catch {
    throw AppError.unauthorized("访问令牌无效或已过期");
  }
}
