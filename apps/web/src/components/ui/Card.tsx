import type { ReactElement, ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  /** 需求基线条款编号，例如「§9」 */
  spec?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** 统一卡片容器：标题 / 规格标签 / 说明 / 操作区 / 内容。 */
export function Card({
  title,
  spec,
  subtitle,
  actions,
  className,
  children
}: CardProps): ReactElement {
  return (
    <section className={className ? `card ${className}` : "card"}>
      {title || actions ? (
        <header className="card-head">
          <h3>
            {title}
            {spec ? <span className="spec">{spec}</span> : null}
          </h3>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      {subtitle ? <p className="card-sub">{subtitle}</p> : null}
      {children}
    </section>
  );
}

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/** 页面级标题区：标题 + 说明 + 右侧操作。 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps): ReactElement {
  return (
    <header className="page-head">
      <div>
        <h2>{title}</h2>
        {subtitle ? <div className="page-sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
