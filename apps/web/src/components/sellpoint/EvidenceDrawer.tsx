import { useEffect, type ReactElement } from "react";
import { formatDateTime, chatBenchmarkCopyText, type ChatBenchmark } from "../../lib/chat.js";

/**
 * 「依据与备注」抽屉：纸**背面**的东西。
 *
 * 客户嫌界面复杂，所以这些内容一律不进主视区，全部收进这个默认收起的右侧抽屉：
 * 待补硬事实（最要紧）、全网对标来源、可以接着让它改的问题、这一版引用的已录事实。
 * 抽屉只是「换个地方放」，不放宽任何一条纪律 —— 待补硬事实仍然是明写的，不许藏着。
 */

export interface EvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  missingFacts: string[];
  benchmarks: ChatBenchmark[];
  usedFacts: string[];
  followUps: string[];
  onPickFollowUp: (question: string) => void;
  /** 把这一版的对标来源（标题 + 链接）整段复制走：纸上不摆，能力不能丢。 */
  onCopyBenchmarks: () => void;
  providerLabel: string;
  providerDetail: string;
}

function truncate(text: string, limit: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export function EvidenceDrawer({
  open,
  onClose,
  missingFacts,
  benchmarks,
  usedFacts,
  followUps,
  onPickFollowUp,
  onCopyBenchmarks,
  providerLabel,
  providerDetail
}: EvidenceDrawerProps): ReactElement | null {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="drawer-layer no-print">
      <div className="drawer-backdrop" role="presentation" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="依据与备注">
        <header className="drawer-head">
          <div>
            <strong>依据与备注</strong>
            <span className="muted">纸背面的东西：缺口、来源、还能怎么改</span>
          </div>
          <button className="ghost sm" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="drawer-body">
          <section className="drawer-sec">
            <h4>
              还不敢写、需要你补的硬事实
              <span className="drawer-count">{missingFacts.length}</span>
            </h4>
            {missingFacts.length === 0 ? (
              <p className="muted">这一版没有缺口。</p>
            ) : (
              <>
                <ul className="drawer-list">
                  {missingFacts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
                <p className="muted">补齐之后再让它出一版；这些位置现在一律不许对外讲。</p>
              </>
            )}
          </section>

          <section className="drawer-sec">
            <h4>
              全网对标来源
              <span className="drawer-count">{benchmarks.length}</span>
            </h4>
            {benchmarks.length === 0 ? (
              <p className="muted">
                这次没有检索到可用对标（或来源被过滤干净）：按 §62-10 走自建高端标准，不硬凑对标。
              </p>
            ) : (
              <>
                <button className="ghost sm drawer-copy" type="button" onClick={onCopyBenchmarks}>
                  复制 {benchmarks.length} 条来源（带链接）
                </button>
                <ul className="drawer-benchmarks">
                  {benchmarks.map((benchmark) => (
                    <li key={benchmark.url}>
                      <a href={benchmark.url} target="_blank" rel="noreferrer">
                        {benchmark.title}
                      </a>
                      <span className="muted">
                        {benchmark.source_domain} · 检索于 {formatDateTime(benchmark.queried_at)}
                      </span>
                      {benchmark.snippet ? (
                        <span className="muted">{truncate(benchmark.snippet, 160)}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="muted">
                  对标只用来讲价格高度与市场认知；别人的原料 / 树龄 / 山头 / 年份一律不搬成龙德记的事实（§62-5）。
                </p>
              </>
            )}
          </section>

          {followUps.length > 0 ? (
            <section className="drawer-sec">
              <h4>可以接着让它改（点一下填进下面的输入框）</h4>
              <div className="chip-list">
                {followUps.map((question) => (
                  <button
                    className="chip"
                    key={question}
                    type="button"
                    onClick={() => {
                      onPickFollowUp(question);
                      onClose();
                    }}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {usedFacts.length > 0 ? (
            <section className="drawer-sec">
              <h4>
                这一版引用的已录事实
                <span className="drawer-count">{usedFacts.length}</span>
              </h4>
              <ul className="drawer-list">
                {usedFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="drawer-sec">
            <h4>这一页凭什么可信</h4>
            <ul className="drawer-list">
              <li>对标链接是真检索回来的，模型自己编的链接一律被覆盖（§62-1）。</li>
              <li>「吹大」只放大修辞与价值高度，硬事实逐字来自已录记录（§62-5 / §62-9）。</li>
              <li>没录入的硬事实单列在上一节，不补齐不许对外讲（§62-8）。</li>
              <li>成稿永远是草稿，发布前必须过事实审核（§62-14）。</li>
            </ul>
            <p className="muted">
              {providerLabel}：{providerDetail}
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
