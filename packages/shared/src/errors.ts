/**
 * 统一错误模型：所有业务错误都带稳定的 code，前端与测试依赖 code 而不是文案。
 */
export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "AI_UNAVAILABLE"
  | "NOT_IMPLEMENTED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, httpStatus?: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus ?? defaultStatusFor(code);
    this.details = details;
  }

  static notFound(message = "资源不存在"): AppError {
    return new AppError("NOT_FOUND", message);
  }

  static validation(message = "请求参数不合法", details?: unknown): AppError {
    return new AppError("VALIDATION_ERROR", message, 400, details);
  }

  static unauthorized(message = "未登录或凭证已失效"): AppError {
    return new AppError("UNAUTHORIZED", message);
  }

  static forbidden(message = "没有权限执行该操作"): AppError {
    return new AppError("FORBIDDEN", message);
  }

  static conflict(message = "资源冲突"): AppError {
    return new AppError("CONFLICT", message);
  }

  static notImplemented(message = "该能力尚未在当前开发阶段实现", details?: unknown): AppError {
    return new AppError("NOT_IMPLEMENTED", message, 501, details);
  }
}

function defaultStatusFor(code: AppErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "AI_UNAVAILABLE":
      return 502;
    case "NOT_IMPLEMENTED":
      return 501;
    default:
      return 500;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
