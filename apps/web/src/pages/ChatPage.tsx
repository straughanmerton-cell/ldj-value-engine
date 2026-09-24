import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { PageHeader } from "../components/ui/Card.js";
import { Alert, EmptyState, LoadingState, Pill } from "../components/ui/State.js";
import { useToast } from "../components/ui/Toast.js";
import { ApiError, apiRequest } from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import {
  chatBlockCopyText,
  chatIntensityLabel,
  chatIntensityShortLabel,
  chatProviderNote,
  chatReplyCopyText,
  chatValueFocusLabel,
  createChatSession,
  deleteChatSession,
  sendChatMessage,
  updateChatSession,
  useChatContract,
  useChatLabels,
  useChatSessions,
  type ChatLabels,
  type ChatMessageListResponse,
  type ChatMessageView,
  type ChatReply,
  type ChatRole,
  type ChatSessionView
} from "../lib/chat.js";
import { copyText } from "../lib/delivery.js";
import { COPY_INTENSITY_ORDER, type CopyIntensity } from "../lib/sales-copy.js";

/**
 * AI 对话工作台（规格 §0 总执行说明 / §21–§27 / §31 / §33 / §62 / §64）。
 *
 * 这一页只干一件事（§64）：**老板把需求说清楚，系统把话术整理出来**。
 * 全部专业模块退到侧栏「专业模式」里，日常入口就是这一个对话框。
 *
 * 界面上四条不可退让的产品纪律：
 *
 * 1. **草稿就是草稿**：AI 出的是草稿，正式发布必须走事实审核（页面上必须看得见这句话）；
 * 2. **缺口比修辞显眼**：`missing_facts` 用警示色常驻展示，不允许折叠、不允许弱化；
 * 3. **等待要说清楚**：真实模型单次约 1–2 分钟，必须给出等待时长与「不要重复点」；
 * 4. **Provider 不许含糊**：没配 Key 时是 Mock 占位稿，必须在页面顶部警示（§62-13）。
 */

const DEFAULT_INTENSITY: CopyIntensity = 4;
const SESSION_PAGE_SIZE = 30;

const ROLE_FALLBACK_LABELS: Record<ChatRole, string> = {
  USER: "我的需求",
  ASSISTANT: "AI 话术"
};

function roleLabel(role: ChatRole, labels: ChatLabels | null): string {
  return labels?.role_labels[role] ?? ROLE_FALLBACK_LABELS[role];
}

/** 等待时长按「分 秒」说，避免运营盯着一个不动的转圈。 */
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

/**
 * 按 id 去重追加：新会话的第一句发出去时，页面还会从服务端拉一次消息，
 * 两边可能同时拿到「那条需求」——不去重就会渲染出两条一样的消息（React 也会报重复 key）。
 */
function appendUnique(list: ChatMessageView[], incoming: ChatMessageView[]): ChatMessageView[] {
  const seen = new Set(list.map((message) => message.id));
  return [...list, ...incoming.filter((message) => !seen.has(message.id))];
}

/** 输入防抖：搜索会话不该每敲一个字就打一次接口。 */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ------------------------------------------------------------ AI 成稿渲染 */

interface ReplyViewProps {
  payload: ChatReply;
  labels: ChatLabels | null;
  busy: boolean;
  onCopy: (text: string, what: string) => void;
  onFollowUp: (question: string) => void;
}

/**
 * AI 成稿：先给「可念的话」（话术块），再给「敢不敢念的依据」（用到的已录事实），
 * 最后单列「还不许念的部分」（待补硬事实）——顺序反了运营就会先看成稿。
 */
function ReplyView({ payload, labels, busy, onCopy, onFollowUp }: ReplyViewProps): ReactElement {
  const hasCopy = payload.copy_blocks.length > 0;

  return (
    <div className="chat-reply">
      {payload.headline ? <p className="chat-headline">{payload.headline}</p> : null}

      <div className="row between chat-reply-bar">
        <div className="row">
          <Pill tone="brand">{chatIntensityShortLabel(payload.intensity, labels)}</Pill>
          {payload.value_focus.map((key) => (
            <Pill key={key} tone="outline">
              {chatValueFocusLabel(key, labels)}
            </Pill>
          ))}
        </div>
        <div className="row">
          <button
            className="secondary sm"
            type="button"
            disabled={busy}
            onClick={() => onCopy(chatReplyCopyText(payload), "整版话术")}
          >
            整版复制
          </button>
        </div>
      </div>

      <p className="chat-reply-text">{payload.reply}</p>

      {payload.missing_facts.length > 0 ? (
        <div className="alert warn chat-missing">
          <strong>这几条还没录入，本次没有写进话术（补了才能对外讲）</strong>
          <ul>
            {payload.missing_facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted mt-2">本次没有发现未录入却必需的硬事实；仍然不许新增任何未列出的硬事实。</p>
      )}

      {hasCopy ? (
        <div className="chat-blocks">
          {payload.copy_blocks.map((block, index) => (
            <article className="chat-block" key={`${block.label}-${index}`}>
              <header className="chat-block-head">
                <div className="row">
                  <strong>{block.label}</strong>
                  <Pill tone="neutral">{chatIntensityLabel(block.level, labels)}</Pill>
                </div>
                <button
                  className="ghost sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onCopy(chatBlockCopyText(block), block.label)}
                >
                  复制这段
                </button>
              </header>
              <p className="chat-block-text">{block.text}</p>
            </article>
          ))}
        </div>
      ) : null}

      {payload.quotes.length > 0 ? (
        <div className="chat-section">
          <div className="sub-title">金句（可以单独发）</div>
          <ul className="chat-quotes">
            {payload.quotes.map((quote) => (
              <li key={quote}>
                <span>{quote}</span>
                <button
                  className="ghost sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onCopy(quote, "金句")}
                >
                  复制
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {payload.objections.length > 0 ? (
        <div className="chat-section">
          <div className="sub-title">异议回答（客户当场问，当场答）</div>
          <div className="obj-grid">
            {payload.objections.map((objection) => (
              <div className="obj-card" key={objection.question}>
                <div className="obj-q">{objection.question}</div>
                <div className="obj-a">{objection.answer}</div>
                <button
                  className="ghost sm"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onCopy(`问：${objection.question}\n答：${objection.answer}`, "异议回答")
                  }
                >
                  复制这组
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {payload.used_facts.length > 0 ? (
        <details className="chat-details">
          <summary>这一段用到的已录事实（{payload.used_facts.length} 条，可追溯）</summary>
          <ul className="chat-used-facts">
            {payload.used_facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {payload.follow_up_questions.length > 0 ? (
        <div className="chat-section">
          <div className="sub-title">继续追问（点一下填进输入框）</div>
          <div className="chat-followups">
            {payload.follow_up_questions.map((question) => (
              <button
                className="chip chat-followup"
                key={question}
                type="button"
                disabled={busy}
                onClick={() => onFollowUp(question)}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {payload.next_actions.length > 0 ? (
        <div className="chat-section">
          <div className="sub-title">建议下一步</div>
          <ul className="chat-next-actions">
            {payload.next_actions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

interface MessageViewProps {
  message: ChatMessageView;
  labels: ChatLabels | null;
  busy: boolean;
  onCopy: (text: string, what: string) => void;
  onFollowUp: (question: string) => void;
}

function MessageView({
  message,
  labels,
  busy,
  onCopy,
  onFollowUp
}: MessageViewProps): ReactElement {
  const isUser = message.role === "USER";
  return (
    <div className={isUser ? "chat-msg chat-msg-user" : "chat-msg chat-msg-ai"}>
      <div className="chat-msg-meta">
        <span>{roleLabel(message.role, labels)}</span>
        <span>{new Date(message.created_at).toLocaleString("zh-CN")}</span>
        {!isUser && message.provider ? (
          <span className="mono">
            {message.provider}
            {message.model ? ` · ${message.model}` : ""}
          </span>
        ) : null}
        {!isUser && !message.schema_valid ? <Pill tone="danger">未通过校验</Pill> : null}
      </div>
      <div className="chat-msg-body">
        {isUser || !message.payload ? (
          <p className="chat-plain">{message.content}</p>
        ) : (
          <ReplyView
            payload={message.payload}
            labels={labels}
            busy={busy}
            onCopy={onCopy}
            onFollowUp={onFollowUp}
          />
        )}
      </div>
    </div>
  );
}

interface SessionRowProps {
  session: ChatSessionView;
  active: boolean;
  onSelect: (session: ChatSessionView) => void;
  onDelete: (session: ChatSessionView) => void;
}

function SessionRow({ session, active, onSelect, onDelete }: SessionRowProps): ReactElement {
  return (
    <div className={active ? "chat-session active" : "chat-session"}>
      <button className="chat-session-main" type="button" onClick={() => onSelect(session)}>
        <span className="chat-session-title">{session.title}</span>
        <span className="chat-session-meta">
          {session.product_name ?? "未绑定产品"} · {session.message_count} 条
        </span>
        <span className="chat-session-time">
          {session.last_message_at
            ? new Date(session.last_message_at).toLocaleString("zh-CN")
            : "还没有说话"}
        </span>
      </button>
      <button
        className="ghost sm chat-session-del"
        type="button"
        title="删除这段对话"
        onClick={() => onDelete(session)}
      >
        删除
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- 页面 */

export function ChatPage(): ReactElement {
  const { token, user } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const { labels, loading: labelsLoading, error: labelsError } = useChatLabels(token);
  const { data: contractData, loading: contractLoading } = useChatContract(token);
  const { products } = useProductOptions(token);

  const readOnly = user?.role === "VIEWER";
  const maxMessageChars = labels?.limits.maxMessageChars ?? 4000;

  /* ---------------------------------------------------------- 对话列表 */

  const [keyword, setKeyword] = useState("");
  const debouncedKeyword = useDebounced(keyword, 300);
  const [boundFilter, setBoundFilter] = useState<"all" | "bound" | "unbound">("all");
  const [sessionPage, setSessionPage] = useState(1);
  const {
    data: sessionData,
    loading: sessionsLoading,
    error: sessionsError,
    reload: reloadSessions
  } = useChatSessions(token, {
    q: debouncedKeyword,
    bound: boundFilter,
    page: sessionPage,
    pageSize: SESSION_PAGE_SIZE
  });
  const sessions = sessionData?.items ?? [];

  const activeId = searchParams.get("s");
  /** 服务端刚返回的会话快照：列表还没刷新时，标题 / 产品 / 强度也必须是新的。 */
  const [sessionPatch, setSessionPatch] = useState<ChatSessionView | null>(null);

  const activeSession = useMemo(() => {
    if (!activeId) {
      return null;
    }
    const fromList = sessions.find((item) => item.id === activeId);
    if (fromList) {
      return fromList;
    }
    return sessionPatch && sessionPatch.id === activeId ? sessionPatch : null;
  }, [activeId, sessionPatch, sessions]);

  const selectSession = useCallback(
    (session: ChatSessionView | null) => {
      const params = new URLSearchParams(searchParams);
      if (session) {
        params.set("s", session.id);
      } else {
        params.delete("s");
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  /** 首次进来自动打开最近一段对话：不要让人对着空白页面猜下一步。 */
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || activeId || sessionsLoading) {
      return;
    }
    const first = sessions[0];
    if (first) {
      autoSelected.current = true;
      selectSession(first);
    }
  }, [activeId, selectSession, sessions, sessionsLoading]);

  /* -------------------------------------------------- 产品 / 强度 / 草稿 */

  const [productId, setProductId] = useState("");
  const [intensity, setIntensity] = useState<CopyIntensity>(DEFAULT_INTENSITY);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!activeSession) {
      // 新对话：保留用户刚选好的产品与档位，不要清空重来。
      return;
    }
    setProductId(activeSession.product_id ?? "");
    setIntensity(activeSession.intensity);
  }, [activeSession]);

  const labelsApplied = useRef(false);
  useEffect(() => {
    if (labelsApplied.current || !labels) {
      return;
    }
    labelsApplied.current = true;
    setIntensity((current) => (current === DEFAULT_INTENSITY ? labels.default_intensity : current));
  }, [labels]);

  /* ------------------------------------------------------------ 消息流 */

  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [olderPage, setOlderPage] = useState(1);
  const [olderTotalPages, setOlderTotalPages] = useState(1);
  const [olderLoading, setOlderLoading] = useState(false);

  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);

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
        setOlderPage(result.page);
        setOlderTotalPages(result.totalPages);
        setMessagesError(null);
      } catch (caught) {
        setMessages([]);
        setMessagesError(errorMessage(caught, "读取这段对话失败，可能已经被删除了"));
      } finally {
        setMessagesLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setOlderPage(1);
      setOlderTotalPages(1);
      setMessagesError(null);
      return;
    }
    void loadMessages(activeId);
  }, [activeId, loadMessages]);

  /** 真实模型单次约 1–2 分钟：等待时长必须让用户看得见。 */
  useEffect(() => {
    if (!sending) {
      return;
    }
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [sending]);

  const streamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = streamRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, sending]);

  /* -------------------------------------------------------------- 写操作 */

  async function ensureSession(): Promise<ChatSessionView | null> {
    if (!token) {
      return null;
    }
    try {
      const session = await createChatSession(token, {
        product_id: productId ? productId : null,
        intensity
      });
      setSessionPatch(session);
      selectSession(session);
      reloadSessions();
      return session;
    } catch (caught) {
      notify(errorMessage(caught, "新建对话失败"), "error");
      return null;
    }
  }

  function startNewSession(): void {
    setSessionPatch(null);
    selectSession(null);
    setMessages([]);
    setMessagesError(null);
    setDraft("");
    composerRef.current?.focus();
  }

  async function patchSession(input: {
    product_id?: string | null;
    intensity?: CopyIntensity;
  }): Promise<void> {
    if (!token || !activeSession) {
      return;
    }
    try {
      const updated = await updateChatSession(token, activeSession.id, input);
      setSessionPatch(updated);
      reloadSessions();
    } catch (caught) {
      notify(errorMessage(caught, "这段对话的设置没保存成功"), "error");
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
    setSending(true);
    setElapsed(0);
    try {
      const result = await sendChatMessage(token, session.id, {
        content,
        product_id: productId ? productId : null,
        intensity
      });
      setMessages((current) =>
        appendUnique(current, [result.user_message, result.assistant_message])
      );
      setSessionPatch(result.session);
      setDraft("");
      reloadSessions();
      notify("话术已生成：可以整版复制，也可以继续追问", "ok");
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

  async function loadOlder(): Promise<void> {
    if (!token || !activeId || olderLoading || olderPage >= olderTotalPages) {
      return;
    }
    setOlderLoading(true);
    try {
      const result = await apiRequest<ChatMessageListResponse>(
        `/api/chat/sessions/${activeId}/messages?page=${olderPage + 1}`,
        { token }
      );
      setMessages((current) => [...result.items, ...current]);
      setOlderPage(result.page);
      setOlderTotalPages(result.totalPages);
    } catch (caught) {
      notify(errorMessage(caught, "读取更早的对话失败"), "error");
    } finally {
      setOlderLoading(false);
    }
  }

  async function renameSession(): Promise<void> {
    if (!token || !activeSession) {
      return;
    }
    const next = window.prompt("给这段对话改个名字，方便回头找", activeSession.title);
    if (next === null) {
      return;
    }
    const title = next.trim();
    if (!title || title === activeSession.title) {
      return;
    }
    try {
      const updated = await updateChatSession(token, activeSession.id, { title });
      setSessionPatch(updated);
      reloadSessions();
      notify("已改名", "ok");
    } catch (caught) {
      notify(errorMessage(caught, "改名失败"), "error");
    }
  }

  async function handleDelete(session: ChatSessionView): Promise<void> {
    if (!token) {
      return;
    }
    const confirmed = window.confirm(
      `删除「${session.title}」？这段对话和里面的消息会一起删掉，删了找不回来。`
    );
    if (!confirmed) {
      return;
    }
    try {
      await deleteChatSession(token, session.id);
      notify("已删除", "ok");
      if (session.id === activeId) {
        setSessionPatch(null);
        selectSession(null);
      }
      reloadSessions();
    } catch (caught) {
      notify(errorMessage(caught, "删除失败"), "error");
    }
  }

  /* ------------------------------------------------------------ 复制动作 */

  const handleCopy = useCallback(
    async (text: string, what: string): Promise<void> => {
      const ok = await copyText(text);
      notify(ok ? `${what}已复制` : "复制失败，请手动选中后复制", ok ? "ok" : "warn");
    },
    [notify]
  );

  const handleFollowUp = useCallback((question: string): void => {
    setDraft(question);
    composerRef.current?.focus();
  }, []);

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handleSend();
  }

  /* ---------------------------------------------------------------- 渲染 */

  const provider = chatProviderNote(labels?.ai_provider ?? "");
  const presets = labels?.presets ?? contractData?.presets ?? [];
  const canSend = !readOnly && !sending && draft.trim().length > 0;

  return (
    <section>
      <PageHeader
        title="AI 对话工作台"
        subtitle="把你要什么直接说出来：直播稿、王者话术、为什么值这个价、客户异议。系统把需求整理成能直接念的话术，并告诉你哪几句有已录事实撑着、哪几句还不能对外讲。"
        actions={
          <>
            <Pill tone={provider.online ? "ok" : "warn"}>{provider.label}</Pill>
            <Pill tone="outline">工作台出的是草稿</Pill>
          </>
        }
      />

      <Alert tone={provider.online ? "info" : "warn"}>
        {provider.detail}
        {provider.online ? null : "　请让管理员在服务端配好 AI Key 再用它出稿。"}
      </Alert>

      <div className="chat-layout">
        <aside className="card chat-rail">
          <div className="row between">
            <strong>我的对话</strong>
            <button className="secondary sm" type="button" onClick={startNewSession}>
              新对话
            </button>
          </div>

          <label className="mt-3">
            搜索
            <input
              placeholder="按标题或产品名找"
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setSessionPage(1);
              }}
            />
          </label>
          <label className="mt-2">
            范围
            <select
              value={boundFilter}
              onChange={(event) => {
                setBoundFilter(event.target.value as "all" | "bound" | "unbound");
                setSessionPage(1);
              }}
            >
              <option value="all">全部对话</option>
              <option value="bound">只看指定了产品的</option>
              <option value="unbound">只看还没指定产品的</option>
            </select>
          </label>

          {sessionsError ? <p className="error mt-3">{sessionsError}</p> : null}
          {sessionsLoading ? <LoadingState label="正在读取对话列表" /> : null}

          {!sessionsLoading && sessions.length === 0 ? (
            <p className="muted mt-3">还没有对话。右边写一句需求，就开始了。</p>
          ) : null}

          <div className="chat-session-list">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === activeId}
                onSelect={(target) => {
                  setSessionPatch(null);
                  selectSession(target);
                }}
                onDelete={(target) => void handleDelete(target)}
              />
            ))}
          </div>

          {(sessionData?.totalPages ?? 1) > 1 ? (
            <div className="row between mt-3">
              <button
                className="ghost sm"
                type="button"
                disabled={sessionPage <= 1}
                onClick={() => setSessionPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </button>
              <span className="muted">
                第 {sessionData?.page ?? sessionPage} / {sessionData?.totalPages ?? 1} 页
              </span>
              <button
                className="ghost sm"
                type="button"
                disabled={sessionPage >= (sessionData?.totalPages ?? 1)}
                onClick={() => setSessionPage((current) => current + 1)}
              >
                下一页
              </button>
            </div>
          ) : null}
        </aside>

        <div className="chat-main">
          <div className="card chat-toolbar">
            <div className="chat-toolbar-row">
              <ProductSelect
                products={products}
                value={productId}
                onChange={(next) => {
                  setProductId(next);
                  if (activeSession) {
                    void patchSession({ product_id: next ? next : null });
                  }
                }}
                label="这次讲哪款茶"
              />
              <label>
                说多狠
                <select
                  value={String(intensity)}
                  onChange={(event) => {
                    const next = Number(event.target.value) as CopyIntensity;
                    setIntensity(next);
                    if (activeSession) {
                      void patchSession({ intensity: next });
                    }
                  }}
                >
                  {COPY_INTENSITY_ORDER.map((level) => (
                    <option key={level} value={String(level)}>
                      {chatIntensityLabel(level, labels)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="chat-toolbar-actions">
                {activeSession ? (
                  <button className="ghost sm" type="button" onClick={() => void renameSession()}>
                    重命名
                  </button>
                ) : null}
                <Link to="/copy">
                  <button className="secondary sm" type="button">
                    去正式流程
                  </button>
                </Link>
              </div>
            </div>
            <p className="muted chat-toolbar-hint">
              选定产品后，系统只会把这款茶「已经录入」的事实送进模型：没录入的树龄、山头、年份、获奖、大师、
              配方比例、成交价一律不许编，缺的会直接列在成稿里让你补。
            </p>
            {products.length === 0 ? (
              <p className="muted">
                还没有产品档案：
                <Link to="/products/new">先建一款产品</Link>
                ，或者不选产品先让 AI 给你一版带占位符的模板话术。
              </p>
            ) : null}
          </div>

          <div className="card chat-stream-card">
            <div className="chat-stream" ref={streamRef}>
              {messagesError ? <p className="error">{messagesError}</p> : null}
              {messagesLoading ? <LoadingState label="正在读取对话" /> : null}

              {olderPage < olderTotalPages ? (
                <div className="row chat-older">
                  <button
                    className="ghost sm"
                    type="button"
                    disabled={olderLoading}
                    onClick={() => void loadOlder()}
                  >
                    {olderLoading ? "正在读取…" : "加载更早的对话"}
                  </button>
                </div>
              ) : null}

              {!activeId && messages.length === 0 ? (
                <EmptyState
                  title="把你要什么说出来就行"
                  description="不用学系统：选中要讲的那款茶，用一句话说清用途，剩下的交给 AI。下面这些是运营最常用的六种说法，点一下就能改。"
                />
              ) : null}

              {activeId && !messagesLoading && messages.length === 0 ? (
                <EmptyState
                  title="这段对话还是空的"
                  description="在下面写第一句需求，AI 会先把话术整理出来，再告诉你还缺哪些事实。"
                />
              ) : null}

              {messages.map((message) => (
                <MessageView
                  key={message.id}
                  message={message}
                  labels={labels}
                  busy={sending}
                  onCopy={(text, what) => void handleCopy(text, what)}
                  onFollowUp={handleFollowUp}
                />
              ))}

              {sending ? (
                <div className="chat-msg chat-msg-ai">
                  <div className="chat-msg-meta">
                    <span>{roleLabel("ASSISTANT", labels)}</span>
                    <span className="mono">正在出稿</span>
                  </div>
                  <div className="chat-msg-body">
                    <div className="chat-waiting">
                      <div className="progress-head">
                        <strong>正在按你的需求写话术…</strong>
                        <span className="mono">已等待 {formatDuration(elapsed)}</span>
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${Math.min(95, 8 + elapsed * 1.2)}%` }}
                        />
                      </div>
                      <p className="muted mt-2">
                        真实模型单次大约 1–2 分钟：请不要重复点「发送」，也不用刷新页面，成稿会自动出现在这里。
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {!activeId && presets.length > 0 && messages.length === 0 && !sending ? (
              <div className="chat-presets">
                <div className="sub-title">常用需求（点一下填进输入框）</div>
                <div className="chat-preset-grid">
                  {presets.map((preset) => (
                    <button
                      className="chip chat-preset"
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setDraft(preset.prompt);
                        setIntensity(preset.intensity);
                        composerRef.current?.focus();
                      }}
                    >
                      <strong>{preset.label}</strong>
                      <span>{preset.hint}</span>
                      <span className="mono">
                        {preset.spec_ref} · {chatIntensityShortLabel(preset.intensity, labels)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="chat-composer">
              {readOnly ? (
                <Alert tone="warn">
                  当前账号是只读权限：可以查看对话，不能发需求。请让管理员开通「文案 / 研究员 / 管理员」权限。
                </Alert>
              ) : null}
              {!productId && !readOnly ? (
                <p className="muted">
                  还没选产品：AI 会给一版结构完整、但具体事实位置写成【待补充：xxx】的模板话术。
                </p>
              ) : null}
              <textarea
                ref={composerRef}
                placeholder="例如：把这款茶整理成 60 秒直播稿，开场 3 秒要抓人，结尾要有成交收口。"
                value={draft}
                rows={4}
                maxLength={maxMessageChars}
                disabled={readOnly || sending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
              />
              <div className="row between chat-composer-foot">
                <span className="muted">
                  Enter 发送 · Shift + Enter 换行 · {draft.length}/{maxMessageChars} 字
                  {sending ? "　·　正在生成，请等这一版出来" : ""}
                </span>
                <button type="button" disabled={!canSend} onClick={() => void handleSend()}>
                  {sending ? "正在生成…" : "发送"}
                </button>
              </div>
            </div>
          </div>

          <div className="card chat-rules">
            <details>
              <summary>这个工作台凭什么可信（合同 / 铁律 / 输出字段）</summary>
              {contractLoading ? <p className="muted mt-3">正在读取合同…</p> : null}
              {labelsError ? <p className="error mt-3">{labelsError}</p> : null}
              {contractData ? (
                <>
                  <p className="muted mt-3">
                    {contractData.contract.purpose}（规格 {contractData.contract.spec_ref}）
                  </p>
                  <div className="grid-2">
                    <div>
                      <div className="sub-title">这个工作台答应你的事</div>
                      <ul className="muted">
                        {contractData.contract.rules.map((rule) => (
                          <li key={rule}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="sub-title">§62 十五条铁律</div>
                      <ul className="muted">
                        {contractData.iron_rules.map((rule) => (
                          <li key={rule}>{rule}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {labels && labels.forbidden_facts.length > 0 ? (
                    <div className="mt-3">
                      <div className="sub-title">没录入就不许写的硬事实</div>
                      <div className="chip-list">
                        {labels.forbidden_facts.map((fact) => (
                          <Pill key={fact} tone="danger">
                            {fact}
                          </Pill>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <p className="muted mt-3">
                    单条需求上限 {contractData.limits.maxMessageChars} 字 · 每个账号最多{" "}
                    {contractData.limits.maxSessionsPerUser} 段对话 · 每次带上最近{" "}
                    {contractData.limits.historyMessages} 条上下文
                    {labelsLoading ? "（正在读取文案…）" : ""}
                  </p>
                </>
              ) : null}
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}
