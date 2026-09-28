import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from "react";
import { useSearchParams } from "react-router-dom";
import { ProductSelect, useProductOptions } from "../components/research/ProductPicker.js";
import { EvidenceDrawer } from "../components/sellpoint/EvidenceDrawer.js";
import { SlideCard } from "../components/sellpoint/SlideCard.js";
import { SellpointPicks } from "../components/sellpoint/SellpointPicks.js";
import { SlideStage } from "../components/sellpoint/SlideStage.js";
import { Alert, LoadingState, Pill } from "../components/ui/State.js";
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
import type { CopyIntensity } from "../lib/sales-copy.js";
import { buildSellpointSheet, sellpointSheetCopyText } from "../lib/sellpoint.js";
import { exportSellpointPptx } from "../lib/slide-pptx.js";
import {
  MAX_SLIDE_IMAGES,
  fileToSlideImage,
  readSlideImages,
  writeSlideImages
} from "../lib/slide.js";
import { composeRequirement, toggleTeaPick } from "../lib/tea-knowledge.js";

/**
 * 产品卖点一页纸（客户 2026-09-26：「太复杂，我就要做到 PPT 这种效果」）。
 *
 * 整个界面只剩三块东西，其余全部退进抽屉：
 *   1. 一块 16:9 的**放映纸**（左边产品图 / 右边 01–04 四段，一屏一页，永不滚动）；
 *   2. 底部一条**继续说**的输入（写完就走，不用管别的控件）；
 *   3. 右上角「依据与备注」抽屉（待补硬事实 / 对标来源 / 已录事实，默认收起）。
 *
 * 四条不退让的纪律（与出稿链路同源，收进抽屉不等于放宽）：
 * 1. **对标必须真**：全网来源由服务端真实检索回写，模型编的链接一律被覆盖（§62-1）；
 * 2. **吹大的是修辞**：价值高度可以拉满，硬事实一条都不许新造（§62-5 / §62-8 / §62-9）；
 * 3. **缺口看得见**：待补硬事实的条数直接挂在「依据与备注」上，一眼可见；
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
  /** 卖点知识库里勾中的方向（产区 / 香型 / 生茶 / 熟茶 / 价值角度）：发送时才拼进需求 */
  const [picks, setPicks] = useState<string[]>([]);
  /** 产品方自报的规格（年份 / 克数）：可选，填了就当作事实原样带进需求，不填不拼 */
  const [productYear, setProductYear] = useState("");
  const [productWeight, setProductWeight] = useState("");
  /** 底部输入条里的知识库面板开合（出稿后默认收起，别占地方） */
  const [picksOpen, setPicksOpen] = useState(false);
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
  const [exporting, setExporting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* ----------------------------------------------------- 产品图（只在本机） */

  const [images, setImages] = useState<string[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** 这一次选图是替换第几格；null = 往后加 */
  const pickSlotRef = useRef<number | null>(null);

  useEffect(() => {
    setImages(readSlideImages(activeId));
  }, [activeId]);

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
    setDrawerOpen(false);
    setPicks([]);
    setPicksOpen(false);
    setProductYear("");
    setProductWeight("");
    if (!activeId) {
      setProductId("");
      setProductName("");
      setDraft("");
      setMessages([]);
      setMessagesError(null);
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

  /**
   * 纸面大标题：产品名优先，其次用户在输入框里写的名字，再次这条会话自己的标题
   * （历史会话可能没有 product_name，用会话标题也好过退成一句「产品卖点」）。
   */
  const paperTitle = sheet?.product_name || paperName.trim() || activeSession?.title.trim() || "产品卖点";

  const benchmarks = payload?.benchmarks ?? [];
  const usedFacts = payload?.used_facts ?? [];
  const missingFacts = payload?.missing_facts ?? [];
  const followUps = payload?.follow_up_questions ?? [];
  const providerNote = chatProviderNote(labels?.ai_provider ?? "");

  const slideMeta = useMemo(
    () => [
      chatIntensityLabel(sheet?.intensity ?? intensity, labels),
      benchmarks.length > 0
        ? `全网对标 ${benchmarks.length} 条真实来源`
        : "本次无对标 · 按自建高端标准讲"
    ],
    [benchmarks.length, intensity, labels, sheet?.intensity]
  );

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
    const content = composeRequirement(draft, picks, {
      year: productYear,
      weight: productWeight
    });
    if (!content || sending || !token || readOnly) {
      return;
    }
    if (content.length > maxChars) {
      notify(
        `需求和勾选的卖点加起来 ${content.length} 字，超过单条上限 ${maxChars} 字：请少勾几项，或把需求写短一点`,
        "warn"
      );
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
      // 方向已经跟着这条需求带进去了：清掉勾选，免得下一版又重复拼一遍。
      setPicks([]);
      setPicksOpen(false);
      reloadSessions();
      bumpSessionRevision();
      notify("这一页已更新：可以整页带走，也可以继续提要求", "ok");
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

  async function handleExportPptx(): Promise<void> {
    if (!sheet || exporting) {
      return;
    }
    setExporting(true);
    try {
      const fileName = await exportSellpointPptx({
        sheet,
        title: paperTitle,
        meta: slideMeta.join("\n"),
        images
      });
      notify(`已导出 ${fileName}：打开就是这一页`, "ok");
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "导出 PPTX 失败，也可以先用「打印 / 存 PDF」",
        "error"
      );
    } finally {
      setExporting(false);
    }
  }

  /** 把选好 / 拖进来 / 粘贴进来的图放到左栏：点第几格就换第几格，多余的空位往后补。 */
  function placeImages(previous: readonly string[], converted: readonly string[]): string[] {
    const slot = pickSlotRef.current;
    pickSlotRef.current = null;
    if (slot === null || slot >= previous.length || converted.length === 0) {
      return [...previous, ...converted].slice(0, MAX_SLIDE_IMAGES);
    }
    const next = previous.slice();
    next[slot] = converted[0] as string;
    for (const extra of converted.slice(1)) {
      if (next.length < MAX_SLIDE_IMAGES) {
        next.push(extra);
      }
    }
    return next.slice(0, MAX_SLIDE_IMAGES);
  }

  async function handleImageFiles(files: File[]): Promise<void> {
    if (!activeId) {
      notify("先让它出一版，再把产品图放上来", "warn");
      return;
    }
    const wanted = files.slice(0, MAX_SLIDE_IMAGES);
    if (wanted.length === 0) {
      return;
    }
    setImageBusy(true);
    try {
      const converted: string[] = [];
      for (const file of wanted) {
        converted.push(await fileToSlideImage(file));
      }
      const next = placeImages(images, converted);
      setImages(next);
      writeSlideImages(activeId, next);
      notify(
        next.length > 1
          ? `产品图已放上这一页（${next.length} 张，只存在你这台机器上，不会上传）`
          : "产品图已放上这一页（只存在你这台机器上，不会上传）",
        "ok"
      );
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "这张图放不进来，换一张试试", "error");
    } finally {
      setImageBusy(false);
    }
  }

  function handleImagePicked(event: ReactChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) {
      void handleImageFiles(files);
    }
  }

  /** 点左栏某一格：先记住要替换的位置，再打开系统选图框。 */
  function handlePickImage(slot: number): void {
    pickSlotRef.current = slot;
    fileInputRef.current?.click();
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handleSend();
  }

  /** 只勾了卖点方向、一个字都没写，也算有需求（客户要的正是「快捷选项」）。 */
  const composedRequirement = composeRequirement(draft, picks, {
    year: productYear,
    weight: productWeight
  });
  const canSend =
    !readOnly &&
    !sending &&
    composedRequirement.length > 0 &&
    composedRequirement.length <= maxChars &&
    (Boolean(productId) || productName.trim().length > 0 || drafts.length > 0);

  const currentVersionNo = drafts.length - version;

  return (
    <section className="deck">
      <header className="deck-bar no-print">
        <div className="deck-bar-left">
          <Pill tone={providerNote.tone}>{providerNote.label}</Pill>
          {drafts.length > 1 ? (
            <div className="deck-pager">
              <button
                className="ghost sm"
                type="button"
                disabled={version >= drafts.length - 1}
                title="看更早的一版"
                onClick={() => setVersion((current) => Math.min(drafts.length - 1, current + 1))}
              >
                ‹
              </button>
              <span>
                第 {currentVersionNo} 版 / 共 {drafts.length} 版
                {currentDraft ? ` · ${formatDateTime(currentDraft.created_at)}` : ""}
              </span>
              <button
                className="ghost sm"
                type="button"
                disabled={version <= 0}
                title="回到更新的一版"
                onClick={() => setVersion((current) => Math.max(0, current - 1))}
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
        <div className="deck-bar-right">
          {sheet ? (
            <>
              <button className="ghost sm" type="button" onClick={() => void handleCopySheet()}>
                复制整页
              </button>
              <button className="ghost sm" type="button" onClick={() => window.print()}>
                打印 / 存 PDF
              </button>
              <button
                className="secondary sm"
                type="button"
                disabled={exporting}
                onClick={() => void handleExportPptx()}
              >
                {exporting ? "正在生成 PPT…" : "导出 PPTX"}
              </button>
            </>
          ) : null}
          {payload ? (
            <button className="ghost sm" type="button" onClick={() => setDrawerOpen(true)}>
              依据与备注
              {missingFacts.length > 0 ? ` · 待补 ${missingFacts.length}` : ""}
            </button>
          ) : null}
          <button className="ghost sm" type="button" onClick={() => selectSession(null)}>
            ＋ 换一款
          </button>
        </div>
      </header>

      <div className="deck-main">
        <SlideStage>
          {sheet ? (
            <SlideCard
              sheet={sheet}
              title={paperTitle}
              meta={slideMeta}
              imageBusy={imageBusy}
              images={images}
              onRemoveImage={(slot) => {
                const next = images.filter((_, index) => index !== slot);
                setImages(next);
                writeSlideImages(activeId, next);
              }}
              onDropImages={(files) => void handleImageFiles(files)}
              onPickImage={handlePickImage}
            />
          ) : (
            <div className="slide slide-start">
              <header className="slide-top">
                <div className="slide-brand">龙德记 · 产品卖点一页纸</div>
                <h1 className="slide-title">{readOnly ? "只读账号" : "新的一张卖点页"}</h1>
                <div className="slide-meta">
                  <span className="slide-meta-item">
                    {readOnly
                      ? "可以看别人出的稿，不能提新需求"
                      : "写产品名 + 说你要什么 · 真实模型出稿约 1–2 分钟"}
                  </span>
                </div>
              </header>

              <div className="slide-body slide-body-start">
                <div className="slide-start-col">
                  <label className="slide-field">
                    <span>产品名（必填，≤ 80 字）</span>
                    <input
                      maxLength={80}
                      placeholder="例如：龙德记 六星孔雀 2023"
                      value={productName}
                      disabled={readOnly || sending}
                      onChange={(event) => setProductName(event.target.value)}
                    />
                  </label>
                  <p className="slide-tip">
                    名字只当全网检索词，不是事实来源：年份 / 山头 / 树龄 / 价格这些没录入的，AI 一律写成
                    【待补充：xxx】，不许编。
                  </p>
                  <div className="slide-spec-row">
                    <label className="slide-field">
                      <span>年份（可选）</span>
                      <input
                        maxLength={20}
                        placeholder="例如：2023"
                        value={productYear}
                        disabled={readOnly || sending}
                        onChange={(event) => setProductYear(event.target.value)}
                      />
                    </label>
                    <label className="slide-field">
                      <span>克数 / 规格（可选）</span>
                      <input
                        maxLength={30}
                        placeholder="例如：357克/饼"
                        value={productWeight}
                        disabled={readOnly || sending}
                        onChange={(event) => setProductWeight(event.target.value)}
                      />
                    </label>
                  </div>
                  {products.length > 0 ? (
                    <ProductSelect
                      products={products}
                      value={productId}
                      onChange={setProductId}
                      loading={productsLoading}
                      label="已建档产品（可选，绑上就用它已录的事实）"
                    />
                  ) : (
                    <p className="slide-tip">还没有产品档案：不建也能用，产品名写对就行。</p>
                  )}
                </div>

                <div className="slide-start-col">
                  {readOnly ? (
                    <Alert tone="warn">
                      当前账号是只读权限：可以看这一页，不能提新需求。请让管理员开通「文案 / 研究员 / 管理员」权限。
                    </Alert>
                  ) : null}
                  <label className="slide-field">
                    <span>你要什么</span>
                    <textarea
                      ref={composerRef}
                      rows={4}
                      maxLength={maxChars}
                      value={draft}
                      disabled={readOnly || sending}
                      placeholder="例如：六星孔雀，帮我写一页卖点，往高了讲——一句话定位、3–5 条核心卖点、价值高度，别只罗列参数。"
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                    />
                  </label>
                  <SellpointPicks
                    disabled={readOnly || sending}
                    picks={picks}
                    onClear={() => setPicks([])}
                    onToggle={(key) => setPicks((current) => toggleTeaPick(current, key))}
                  />
                  <div className="slide-start-actions">
                    <button
                      className="lg"
                      type="button"
                      disabled={!canSend}
                      onClick={() => void handleSend()}
                    >
                      {sending ? "正在出稿…" : "生成卖点"}
                    </button>
                  </div>
                  <p className="slide-tip">
                    Enter 发送 · Shift + Enter 换行 · {draft.length}/{maxChars} 字 ·
                    勾中的卖点会跟着需求一起发出去，没录入的硬事实仍然写【待补充】
                  </p>
                </div>
              </div>
            </div>
          )}
        </SlideStage>

        {sending ? (
          <div className="deck-waiting no-print">
            <div className="deck-waiting-card">
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
                真实模型单次大约 1–2 分钟：不用重复点，也不用刷新，稿子会自动换到纸上。
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {messagesError ? <Alert tone="error">{messagesError}</Alert> : null}
      {messagesLoading && !sheet ? <LoadingState label="正在翻开这一页" /> : null}

      {sheet || drafts.length > 0 ? (
        <footer className={picksOpen ? "deck-composer deck-composer-stack no-print" : "deck-composer no-print"}>
          {readOnly ? (
            <span className="muted">只读账号：可以复制、打印、导出，不能继续提要求。</span>
          ) : (
            <>
              {picksOpen ? (
                <SellpointPicks
                  compact
                  disabled={sending}
                  picks={picks}
                  onClear={() => setPicks([])}
                  onToggle={(key) => setPicks((current) => toggleTeaPick(current, key))}
                />
              ) : null}
              <div className="deck-composer-row">
                <textarea
                  className="deck-input"
                  rows={1}
                  maxLength={maxChars}
                  value={draft}
                  disabled={sending}
                  placeholder="接着说：把第 2 条再狠一点 / 补上规格和年份 / 换一版更克制的说法…"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                />
                <button
                  className={picksOpen ? "ghost sm is-on" : "ghost sm"}
                  type="button"
                  disabled={sending}
                  title="从卖点知识库勾产区 / 香型 / 生茶 / 熟茶 / 价值角度"
                  onClick={() => setPicksOpen((current) => !current)}
                >
                  {picks.length > 0 ? `卖点方向 ${picks.length}` : "卖点库"}
                </button>
                <button type="button" disabled={!canSend} onClick={() => void handleSend()}>
                  {sending ? "正在出稿…" : "再改一版"}
                </button>
              </div>
            </>
          )}
        </footer>
      ) : null}

      <input
        ref={fileInputRef}
        accept="image/*"
        className="hidden-input"
        multiple
        type="file"
        onChange={handleImagePicked}
      />

      <EvidenceDrawer
        benchmarks={benchmarks}
        followUps={followUps}
        missingFacts={missingFacts}
        open={drawerOpen}
        providerDetail={providerNote.detail}
        providerLabel={providerNote.label}
        usedFacts={usedFacts}
        onClose={() => setDrawerOpen(false)}
        onCopyBenchmarks={() => void handleCopyBenchmarks()}
        onPickFollowUp={(question) => {
          setDraft(question);
          composerRef.current?.focus();
        }}
      />
    </section>
  );
}
