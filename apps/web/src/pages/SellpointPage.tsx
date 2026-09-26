import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from "react";
import { useSearchParams } from "react-router-dom";
import { ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { Alert, EmptyState, LoadingState, Pill } from "../components/ui/State.js";
import { useToast } from "../components/ui/Toast.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import {
  bumpSessionRevision,
  chatBenchmarkCopyText,
  chatIntensityLabel,
  chatProviderNote,
  createChatSession,
  formatDateTime,
  sendChatMessage,
  useChatLabels,
  useChatSessions,
  type ChatLabels,
  type ChatMessageListResponse,
  type ChatMessageView,
  type ChatReply,
  type ChatSessionView
} from "../lib/chat.js";
import { copyText } from "../lib/delivery.js";
import { COPY_INTENSITY_ORDER, type CopyIntensity } from "../lib/sales-copy.js";
import {
  SELLPOINT_SECTIONS,
  buildSellpointSheet,
  sellpointSheetCopyText,
  type SellpointSheet
} from "../lib/sellpoint.js";

/**
 * 产品卖点一页纸（客户 2026-09-26 追加需求：整个界面只留这一件事）。
 *
 * 一页只干三件事：**写产品名与需求** → **等它出稿** → **拿走一张纸**。
 * 纸的形状对齐客户给的《八角亭卖点手卡》：01 产品介绍 / 02 核心卖点 / 03 口感特点 / 04 补充清单。
 *
 * 界面上四条不退让的纪律（与出稿链路同源）：
 * 1. **对标必须真**：全网来源由服务端真实检索回写，模型编的链接一律被覆盖（§62-1）；
 * 2. **吹大的是修辞**：价值高度可以拉满，硬事实一条都不许新造（§62-5 / §62-8 / §62-9）；
 * 3. **缺口比修辞显眼**：待补硬事实单列在纸下方，不允许折叠隐藏；
 * 4. **草稿就是草稿**：纸上永远印着「发布前须过事实审核」，不做假的一键发布（§62-14）。
 */

const DEFAULT_INTENSITY: CopyIntensity = 4;

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

function truncate(text: string, limit: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/* ------------------------------------------------------------ 一页纸本体 */

interface SellpointCardProps {
  sheet: SellpointSheet;
  productName: string;
  labels: ChatLabels | null;
}

/** 屏幕上那张「纸」：白底、四段、编号 01–04，与打印出来的样子一致。 */
function SellpointCard({ sheet, productName, labels }: SellpointCardProps): ReactElement {
  const title = sheet.product_name || productName.trim() || "产品卖点";
  return (
    <article className="sheet" id="sellpoint-sheet">
      <header className="sheet-head">
        <div className="sheet-brand">龙德记 · 产品卖点一页纸</div>
        <h2 className="sheet-title">{title}</h2>
        <div className="sheet-meta">
          <span className="sheet-meta-item">{chatIntensityLabel(sheet.intensity, labels)}</span>
          <span className="sheet-meta-item">
            {sheet.benchmarks.length > 0
              ? `全网对标 ${sheet.benchmarks.length} 条真实来源`
              : "本次无对标 · 按自建高端标准讲"}
          </span>
        </div>
      </header>

      <div className="sheet-grid">
        {SELLPOINT_SECTIONS.map((section) => {
          const items = sheet[section.key];
          return (
            <section className={`sheet-sec sheet-sec-${section.key}`} key={section.key}>
              <header className="sheet-sec-head">
                <span className="sheet-no">{String(section.index).padStart(2, "0")}</span>
                <span className="sheet-sec-label">{section.label}</span>
              </header>
              {items.length === 0 ? (
                <p className="sheet-blank">这一版没有足够依据，先留白（不许编）。</p>
              ) : section.key === "intro" ? (
                items.map((item, index) => (
                  <p className="sheet-lead" key={`${item.label}-${index}`}>
                    {item.text}
                  </p>
                ))
              ) : (
                <ul className="sheet-list">
                  {items.map((item, index) => (
                    <li
                      className={item.highlight ? "sheet-line highlight" : "sheet-line"}
                      key={`${item.label}-${index}`}
                    >
                      <span className="sheet-line-label">{item.label}</span>
                      <span className="sheet-line-text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="sheet-foot">
        {sheet.closing ? <p className="sheet-closing">“{sheet.closing}”</p> : null}
        <p className="sheet-note">
          草稿：发布前必须过事实审核。标了占位符的硬事实一律不能对外讲；对标只用来讲价格高度与市场认知。
        </p>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------ 页面主体 */

/** 发送成功后本地补上新消息：同一条不会重复插两次。 */
function appendUnique(list: ChatMessageView[], incoming: ChatMessageView[]): ChatMessageView[] {
  const seen = new Set(list.map((message) => message.id));
  return [...list, ...incoming.filter((message) => !seen.has(message.id))];
}

export function SellpointPage(): ReactElement {
  const { token, user } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get("s");
  const readOnly = user?.role === "VIEWER";

  const { labels } = useChatLabels(token);
  const { products, loading: productsLoading } = useProductOptions(token);
  const { data: sessionsData, reload: reloadSessions } = useChatSessions(token, { pageSize: 50 });
  const sessions = sessionsData?.items ?? [];

  /** 服务端刚返回的会话快照：列表还没刷新时，标题 / 产品 / 强度也必须是新的。 */
  const [sessionPatch, setSessionPatch] = useState<ChatSessionView | null>(null);
  const activeSession = useMemo(() => {
    if (!activeId) {
      return null;
    }
    return (
      sessions.find((item) => item.id === activeId) ??
      (sessionPatch && sessionPatch.id === activeId ? sessionPatch : null)
    );
  }, [activeId, sessionPatch, sessions]);

  /* ------------------------------------------------------------- 输入态 */

  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [intensity, setIntensity] = useState<CopyIntensity>(DEFAULT_INTENSITY);
  const [draft, setDraft] = useState("");
  /** 往回翻第几版（0 = 最新一版）：客户经常要「把上一版那句话改回去」。 */
  const [version, setVersion] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const labelsApplied = useRef(false);
  useEffect(() => {
    if (labelsApplied.current || !labels) {
      return;
    }
    labelsApplied.current = true;
    setIntensity((current) => (current === DEFAULT_INTENSITY ? labels.default_intensity : current));
  }, [labels]);

  /* ------------------------------------------------------------- 消息流 */

  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const maxChars = labels?.limits.maxMessageChars ?? 4000;

  const loadMessages = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!token) {
        return;
      }
      setMessagesLoading(true);
      try {
        const result = await apiRequest<ChatMessageListResponse>(
          `/api/chat/sessions/${sessionId}/messages`,
          { token }
        );
        setMessages(result.items);
        setMessagesError(null);
      } catch (caught) {
        setMessages([]);
        setMessagesError(errorMessage(caught, "读取这一页失败，可能已经被删除了"));
      } finally {
        setMessagesLoading(false);
      }
    },
    [token]
  );

  /**
   * 换页 = 换一张纸：打开已有页面就把稿子读回来；点「＋ 新建卖点页」则清空输入，
   * 连上一款产品名一起清掉，免得新的一页顶着上一款茶的名字出去检索。
   */
  const openedId = useRef<string | null>(null);
  useEffect(() => {
    if (openedId.current === activeId) {
      return;
    }
    openedId.current = activeId;
    setVersion(0);
    if (!activeId) {
      setProductId("");
      setProductName("");
      setDraft("");
      setMessages([]);
      setMessagesError(null);
      composerRef.current?.focus();
      return;
    }
    void loadMessages(activeId);
  }, [activeId, loadMessages]);

  /** 打开已有页面时把它的产品绑定与强度恢复回来；同一次打开只做一次。 */
  const syncedId = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSession || syncedId.current === activeSession.id) {
      return;
    }
    syncedId.current = activeSession.id;
    setProductId(activeSession.product_id ?? "");
    setIntensity(activeSession.intensity);
    setProductName(activeSession.product_name ?? "");
  }, [activeSession]);

  /** 直接打开 /chat 时自动翻开最近一页：不要让人对着白屏猜下一步（只自动一次）。 */
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || activeId || sessions.length === 0) {
      return;
    }
    const first = sessions[0];
    if (!first) {
      return;
    }
    autoSelected.current = true;
    setSearchParams({ s: first.id }, { replace: true });
  }, [activeId, sessions, setSearchParams]);

  /** 真实模型单次约 1–2 分钟：等待时长必须让用户看得见。 */
  useEffect(() => {
    if (!sending) {
      return;
    }
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [sending]);

  /* ------------------------------------------------------------- 这一版 */

  const drafts = useMemo(
    () => messages.filter((message) => message.role === "ASSISTANT" && message.payload),
    [messages]
  );
  const currentDraft =
    drafts.length === 0 ? null : (drafts[Math.max(0, drafts.length - 1 - version)] ?? null);
  const payload: ChatReply | null = currentDraft?.payload ?? null;

  /** 纸面标题：优先会话绑定的产品名，其次用户刚写的检索名（两个都只用于标题）。 */
  const paperName = activeSession?.product_name ?? productName;

  const sheet = useMemo(
    () => (payload ? buildSellpointSheet({ reply: payload, product_name: paperName }) : null),
    [payload, paperName]
  );

  const benchmarks = payload?.benchmarks ?? [];
  const usedFacts = payload?.used_facts ?? [];
  const missingFacts = payload?.missing_facts ?? [];
  const followUps = payload?.follow_up_questions ?? [];
  const providerNote = chatProviderNote(labels?.ai_provider ?? "");

  /* -------------------------------------------------------------- 写操作 */

  function selectSession(session: ChatSessionView | null): void {
    const params = new URLSearchParams(searchParams);
    if (session) {
      params.set("s", session.id);
    } else {
      params.delete("s");
    }
    setSearchParams(params, { replace: true });
  }

  async function ensureSession(): Promise<ChatSessionView | null> {
    if (!token) {
      return null;
    }
    try {
      const session = await createChatSession(token, {
        product_id: productId ? productId : null,
        intensity
      });
      // 先认下这个 id：页面切过去时不要让「同步会话设置」把刚写的产品名清掉。
      syncedId.current = session.id;
      setSessionPatch(session);
      selectSession(session);
      reloadSessions();
      bumpSessionRevision();
      return session;
    } catch (caught) {
      notify(errorMessage(caught, "新建卖点页失败"), "error");
      return null;
    }
  }

  async function handleSend(): Promise<void> {
    const content = draft.trim();
    if (!content || sending || !token || readOnly) {
      return;
    }
    const session = activeSession ?? (await ensureSession());
    if (!session) {
      return;
    }
    const nameHint = productName.trim();
    setSending(true);
    setElapsed(0);
    try {
      const result = await sendChatMessage(token, session.id, {
        content,
        product_id: productId ? productId : null,
        product_name: !productId && nameHint ? nameHint : null,
        intensity
      });
      setMessages((current) => appendUnique(current, [result.user_message, result.assistant_message]));
      setSessionPatch(result.session);
      setDraft("");
      setVersion(0);
      reloadSessions();
      bumpSessionRevision();
      notify("卖点页已更新：可以整页带走，也可以继续提要求", "ok");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "AI_UNAVAILABLE") {
        notify("AI 这次没有出稿。你的需求已经存下来了：直接再点一次「发送」就行。", "warn");
        await loadMessages(session.id);
      } else {
        notify(errorMessage(caught, "发送失败，请稍后重试"), "error");
      }
    } finally {
      setSending(false);
    }
  }

  async function handleCopySheet(): Promise<void> {
    if (!sheet) {
      return;
    }
    const ok = await copyText(sellpointSheetCopyText(sheet));
    notify(
      ok ? "整页卖点已复制：可以直接贴进微信" : "复制失败：请手动选中纸面内容",
      ok ? "ok" : "warn"
    );
  }

  async function handleCopyBenchmarks(): Promise<void> {
    if (benchmarks.length === 0) {
      return;
    }
    const ok = await copyText(benchmarks.map(chatBenchmarkCopyText).join("\n\n"));
    notify(
      ok ? `已复制 ${benchmarks.length} 条对标来源（带链接）` : "复制失败，请手动复制",
      ok ? "ok" : "warn"
    );
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handleSend();
  }

  const canSend =
    !readOnly && !sending && draft.trim().length > 0 && (Boolean(productId) || productName.trim().length > 0 || drafts.length > 0);

  return (
    <section className="sellpoint">
      <header className="page-head no-print">
        <div>
          <h2>产品卖点一页纸</h2>
          <div className="page-sub">
            只干一件事：写下产品名和你要什么 → 它先去全网找高价值对标 → 给你一张能直接用的纸。
          </div>
        </div>
        <div className="page-actions">
          <Pill tone={providerNote.tone}>{providerNote.label}</Pill>
        </div>
      </header>
      <p className="muted sellpoint-note no-print">{providerNote.detail}</p>

      <div className="sellpoint-layout">
        <div className="sellpoint-left no-print">
          <div className="card">
            <div className="sub-title">1 · 说清是哪款茶</div>
            <label>
              产品名（必填，≤ 80 字）
              <input
                value={productName}
                maxLength={80}
                placeholder="例如：龙德记 六星孔雀 2023"
                disabled={readOnly || sending}
                onChange={(event) => setProductName(event.target.value)}
              />
            </label>
            <p className="muted">
              名字只当全网检索词，不是事实来源：年份、山头、树龄、价格这些没录入的，AI 一律写成【待补充：xxx】。
            </p>
            {products.length > 0 ? (
              <ProductSelect
                products={products}
                value={productId}
                onChange={setProductId}
                loading={productsLoading}
                label="已建档产品（可选，绑上就用它已录的事实）"
              />
            ) : (
              <p className="muted">
                还没有产品档案：不建也能用——产品名写对就行，系统照样去全网找对标。
              </p>
            )}

            <div className="sub-title mt-3">2 · 要它写成什么样</div>
            <label>
              成交强度
              <select
                value={intensity}
                disabled={readOnly || sending}
                onChange={(event) => setIntensity(Number(event.target.value) as CopyIntensity)}
              >
                {COPY_INTENSITY_ORDER.map((level) => (
                  <option key={level} value={level}>
                    Level {level} · {chatIntensityLabel(level, labels)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              默认 Level 4；要最狠那一档（王者话术）选 Level 5。强度只放大修辞，事实一条都不放宽。
            </p>

            <div className="sub-title mt-3">3 · 你要什么</div>
            {readOnly ? (
              <Alert tone="warn">
                当前账号是只读权限：可以看这一页，不能提新需求。请让管理员开通「文案 / 研究员 / 管理员」权限。
              </Alert>
            ) : null}
            <textarea
              ref={composerRef}
              value={draft}
              rows={5}
              maxLength={maxChars}
              disabled={readOnly || sending}
              placeholder="例如：六星孔雀，帮我写一页卖点，往高了讲——一句话定位、3–5 条核心卖点、价值高度，别只罗列参数。"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="row between mt-2">
              <span className="muted">
                Enter 发送 · Shift + Enter 换行 · {draft.length}/{maxChars} 字
              </span>
              <button type="button" disabled={!canSend} onClick={() => void handleSend()}>
                {sending ? "正在出稿…" : drafts.length > 0 ? "再改一版" : "生成卖点"}
              </button>
            </div>
            {!readOnly && !sending && draft.trim().length > 0 && !productId && !productName.trim() && drafts.length === 0 ? (
              <p className="muted mt-2">第一版要先写产品名：它决定去全网搜什么。</p>
            ) : null}
          </div>

          <div className="card sellpoint-help">
            <div className="sub-title">这一页凭什么可信</div>
            <ul className="muted">
              <li>对标链接是真检索回来的，模型自己编的链接一律被覆盖（§62-1）。</li>
              <li>「吹大」只放大修辞与价值高度，硬事实逐字来自已录记录（§62-5 / §62-9）。</li>
              <li>没录入的硬事实单列在纸下方，不补齐不许对外讲（§62-8）。</li>
              <li>成稿永远是草稿，发布前必须过事实审核（§62-14）。</li>
            </ul>
          </div>
        </div>

        <div className="sellpoint-right">
          {sending ? (
            <div className="chat-waiting no-print">
              <div className="progress-head">
                <strong>正在全网找对标、写卖点…</strong>
                <span className="mono">已等待 {formatDuration(elapsed)}</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(95, 8 + elapsed * 1.2)}%` }}
                />
              </div>
              <p className="muted mt-2">
                真实模型单次大约 1–2 分钟：不要重复点「发送」，也不用刷新页面，成稿会自动出现在下面。
              </p>
            </div>
          ) : null}

          {messagesError ? (
            <Alert tone="error">{messagesError}</Alert>
          ) : null}
          {messagesLoading && !sheet ? <LoadingState label="正在翻开这一页" /> : null}

          {drafts.length > 1 ? (
            <div className="chip-list no-print">
              {drafts.map((item, index) => {
                const offset = drafts.length - 1 - index;
                return (
                  <button
                    className={offset === version ? "chip ai" : "chip"}
                    key={item.id}
                    type="button"
                    onClick={() => setVersion(offset)}
                  >
                    第 {index + 1} 版<span className="mono">{formatDateTime(item.created_at)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {sheet ? (
            <>
              <SellpointCard sheet={sheet} productName={paperName} labels={labels} />
              <div className="btn-row no-print">
                <button type="button" onClick={() => void handleCopySheet()}>
                  复制整页
                </button>
                {benchmarks.length > 0 ? (
                  <button className="secondary" type="button" onClick={() => void handleCopyBenchmarks()}>
                    复制对标来源
                  </button>
                ) : null}
                <button className="ghost" type="button" onClick={() => window.print()}>
                  打印 / 存 PDF
                </button>
              </div>
            </>
          ) : null}

          {!sheet && !sending && !messagesLoading ? (
            <EmptyState
              title="左边写下产品名，右边就出一页卖点"
              description="不用先建档案、也不用学系统：AI 先按产品名去全网找同类高价值对标，再把卖点整理成 01 产品介绍 / 02 核心卖点 / 03 口感特点 / 04 补充清单。"
            />
          ) : null}

          {payload ? (
            <div className="sellpoint-support no-print">
              {missingFacts.length > 0 ? (
                <Alert tone="warn">
                  <strong>还不敢写、需要你补的硬事实（{missingFacts.length} 条）</strong>
                  <ul>
                    {missingFacts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                  <p className="muted">补齐之后再让它出一版；这些位置现在一律不许对外讲。</p>
                </Alert>
              ) : null}

              {benchmarks.length > 0 ? (
                <div className="card">
                  <div className="sub-title">
                    全网对标来源（{benchmarks.length} 条，可点开自查）
                  </div>
                  <ul className="sellpoint-benchmarks">
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
                </div>
              ) : (
                <p className="muted">
                  这次没有检索到可用对标（或来源被过滤干净）：按 §62-10 走自建高端标准，不硬凑对标。
                </p>
              )}

              {followUps.length > 0 ? (
                <div>
                  <div className="sub-title">可以接着让它改（点一下填进左边输入框）</div>
                  <div className="chip-list">
                    {followUps.map((question) => (
                      <button
                        className="chip"
                        key={question}
                        type="button"
                        onClick={() => {
                          setDraft(question);
                          composerRef.current?.focus();
                        }}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {usedFacts.length > 0 ? (
                <details className="card sellpoint-facts">
                  <summary>这一版引用的已录事实（{usedFacts.length} 条）</summary>
                  <ul className="muted">
                    {usedFacts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
