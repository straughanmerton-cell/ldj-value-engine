import type { ReactElement, ReactNode } from "react";

export type PillTone = "brand" | "ok" | "warn" | "danger" | "info" | "neutral" | "outline";

/** 状态徽标：统一颜色语义，禁止各页面自行拼色值。 */
export function Pill({ tone = "brand", children }: { tone?: PillTone; children: ReactNode }): ReactElement {
  return <span className={`pill ${tone === "brand" ? "" : tone}`}>{children}</span>;
}

/** 加载中：骨架屏，避免「加载中…」白屏。 */
export function LoadingState({ label = "加载中…" }: { label?: string }): ReactElement {
  return (
    <div aria-busy="true" aria-label={label}>
      <div className="skeleton w-40" />
      <div className="skeleton w-70" />
      <div className="skeleton" />
      <div className="skeleton w-70" />
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps): ReactElement {
  return (
    <div className="state">
      <strong>{title}</strong>
      {description ? <div>{description}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
}

export function ErrorState({ title = "加载失败", description, onRetry }: ErrorStateProps): ReactElement {
  return (
    <div className="state error">
      <strong>{title}</strong>
      {description ? <div>{description}</div> : null}
      {onRetry ? (
        <div className="mt-3">
          <button className="secondary sm" type="button" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 提示条：用于规则说明、风险提示与拦截结果。 */
export function Alert({
  tone = "info",
  children
}: {
  tone?: "info" | "warn" | "error";
  children: ReactNode;
}): ReactElement {
  return <div className={`alert ${tone}`}>{children}</div>;
}
