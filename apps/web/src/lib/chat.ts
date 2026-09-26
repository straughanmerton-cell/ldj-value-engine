import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api.js";
import { formatDateTime } from "./category-creator.js";
import { COPY_INTENSITY_FALLBACK_LABELS, VALUE_FOCUS_FALLBACK_LABELS, type CopyIntensity, type CopyIntensityMeta, type ValueFocusKey } from "./sales-copy.js";

/**
 * AI 对话工作台（规格 §0 总执行说明 / §21–§27 / §31 / §33 / §62 / §64）。
 *
 * 前端在这一层只做三件事：**把需求发出去**、**把结构化成稿摊开给人用**、**把纪律说清楚**。
 * 五条不许越界的口径：
 *
 * 1. **后端是唯一事实来源**：五档强度、八项价值重点、六条预设、禁用事实清单全部读
 *    `/api/chat/labels` / `/api/chat/contract`，前端不另写一套文案（§62-12）；
 * 2. **AI 输出是草稿**（§62-14 / §62-15）：工作台不写 `copy_outputs`，页面上永远标明
 *    「正式发布必须走事实审核」，不做「一键发布」这种不存在的动作；
 * 3. **缺口比修辞重要**（§62-1 / §62-8）：`missing_facts` 醒目展示，且不允许前端把它折叠掉；
 * 4. **单次出稿可能要 1–2 分钟**：调用方必须自己维护等待态，本层只负责把错误原样抛出；
 * 5. **失败不吞**：502 `AI_UNAVAILABLE` 带上「需求已保存」，前端如实提示可以直接重发。
 */

export { formatDateTime };

export type ChatRole = "USER" | "ASSISTANT";

/** 一条可直接念的话术块：`label` 是它的作用，`level` 是 §21 强度档。 */
export interface ChatCopyBlock {
  label: string;
  level: CopyIntensity;
  text: string;
}

export interface ChatObjection {
  question: string;
  answer: string;
}

/**
 * 一条全网对标来源（客户 2026-09-26 追加需求）。
 *
 * **只由服务端写入**：来自真实检索通道返回的 title / url / domain / snippet，
 * 模型输出里的同名字段一律被覆盖——「人人可点开自查的链接」是这个功能唯一的可信度来源（§62-1）。
 */
export interface ChatBenchmark {
  title: string;
  url: string;
  source_domain: string;
  /** 检索命中的原文摘录，可能为空串 */
  snippet: string;
  /** 检索时刻（ISO 字符串）：对标行情会变，页面上要能看见「这是什么时候查的」 */
  queried_at: string;
}

/** Agent 回答：与后端 `chatReplySchema` 一一对应（§62-13）。 */
export interface ChatReply {
  reply: string;
  headline: string | null;
  copy_blocks: ChatCopyBlock[];
  quotes: string[];
  objections: ChatObjection[];
  /** 本次不敢写、需要产品方补的硬事实（§62-8） */
  missing_facts: string[];
  follow_up_questions: string[];
  /** 本次用到的已录事实（可追溯） */
  used_facts: string[];
  value_focus: ValueFocusKey[];
  intensity: CopyIntensity;
  /** 本次价值高度总纲（没有对标支撑时为 null） */
  value_height: string | null;
  /** 本次真实检索到的全网对标来源；老消息没有这个字段，读的时候按空数组兜底 */
  benchmarks: ChatBenchmark[];
  next_actions: string[];
}

export interface ChatSessionView {
  id: string;
  title: string;
  product_id: string | null;
  product_name: string | null;
  intensity: CopyIntensity;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageView {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  payload: ChatReply | null;
  provider: string | null;
  model: string | null;
  product_id: string | null;
  product_name: string | null;
  schema_valid: boolean;
  created_at: string;
}

export interface ChatSendResult {
  session: ChatSessionView;
  user_message: ChatMessageView;
  assistant_message: ChatMessageView;
}

export interface ChatPreset {
  key: string;
  label: string;
  hint: string;
  prompt: string;
  intensity: CopyIntensity;
  spec_ref: string;
}

export interface ChatLimits {
  defaultPageSize: number;
  maxPageSize: number;
  maxMessageChars: number;
  maxTitleChars: number;
  maxSessionsPerUser: number;
  historyMessages: number;
  maxProductFactsInPrompt: number;
  maxCopyBlocks: number;
  maxQuotes: number;
  maxObjections: number;
  maxMissingFacts: number;
  maxFollowUps: number;
  maxUsedFacts: number;
  maxNextActions: number;
}

export interface ChatContract {
  spec_ref: string;
  purpose: string;
  input: Record<string, string>;
  output: { schema: string; fields: string[] };
  rules: string[];
  guarantees: Record<string, boolean>;
  limits: ChatLimits;
  iron_rules: string[];
}

export interface ChatContractResponse {
  contract: ChatContract;
  presets: ChatPreset[];
  limits: ChatLimits;
  iron_rules: string[];
}

export interface ChatLabels {
  role_labels: Record<ChatRole, string>;
  presets: ChatPreset[];
  onboarding_questions: string[];
  intensity_meta: CopyIntensityMeta[];
  value_focus_labels: Record<ValueFocusKey, string>;
  output_meta: { key: string; label: string; requirement: string; source: string; spec_ref: string }[];
  /** 未录入就不许写的硬事实（§62-8），与 Prompt 读同一份 */
  forbidden_facts: string[];
  limits: ChatLimits;
  default_intensity: CopyIntensity;
  /** 当前 AI Provider：真实 Key 未配置时是 `mock`，界面上必须显式警示 */
  ai_provider: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type ChatSessionListResponse = Paginated<ChatSessionView>;
export type ChatMessageListResponse = Paginated<ChatMessageView>;

/* ------------------------------------------------------------ 口径与文案 */

/**
 * Provider 提示：Mock 出稿必须被明确警告，不能让运营误当成品（§62-13 / §64）。
 */
export function chatProviderNote(provider: string): {
  label: string;
  tone: "ok" | "warn";
  detail: string;
  online: boolean;
} {
  if (provider === "mock") {
    return {
      label: "本地 Mock",
      tone: "warn",
      detail: "当前没有配好 AI Key：下面的卖点是模板占位，不能当成品用。",
      online: false
    };
  }
  return {
    label: provider === "deepseek" ? "DeepSeek 在线出稿" : `${provider} 在线出稿`,
    tone: "ok",
    detail:
      "每次都由真实模型完成：先按产品名去全网找对标，再写卖点。单次大约 1–2 分钟；只有录入过的硬事实才讲得实。",
    online: true
  };
}

export function chatIntensityLabel(level: CopyIntensity, labels: ChatLabels | null): string {
  const meta = labels?.intensity_meta.find((item) => item.level === level);
  return meta?.label ?? COPY_INTENSITY_FALLBACK_LABELS[level];
}

export function chatIntensityShortLabel(level: CopyIntensity, labels: ChatLabels | null): string {
  const meta = labels?.intensity_meta.find((item) => item.level === level);
  return meta?.short_label ?? COPY_INTENSITY_FALLBACK_LABELS[level];
}

export function chatValueFocusLabel(key: ValueFocusKey, labels: ChatLabels | null): string {
  return labels?.value_focus_labels[key] ?? VALUE_FOCUS_FALLBACK_LABELS[key];
}

/** 一块话术的复制文本：带作用与档位，贴到群里也说得清这是什么。 */
export function chatBlockCopyText(block: ChatCopyBlock): string {
  return `【${block.label}】${block.text}`;
}

/** 一条对标的复制文本：标题 + 链接 + 检索时间，别人拿到就能自己点开复核。 */
export function chatBenchmarkCopyText(benchmark: ChatBenchmark): string {
  const lines = [`· ${benchmark.title}（${benchmark.source_domain}）`, `  ${benchmark.url}`];
  if (benchmark.snippet) {
    lines.push(`  ${benchmark.snippet}`);
  }
  return lines.join("\n");
}

/** 整版复制：把可念的正文按固定顺序拼成一份纯文本（不含内部字段名）。 */
export function chatReplyCopyText(payload: ChatReply): string {
  const parts: string[] = [];
  if (payload.headline) {
    parts.push(payload.headline);
  }
  parts.push(payload.reply);
  for (const block of payload.copy_blocks) {
    parts.push("", `【${block.label}】`, block.text);
  }
  if (payload.value_height) {
    parts.push("", "【价值高度】", payload.value_height);
  }
  const benchmarks = payload.benchmarks ?? [];
  if (benchmarks.length > 0) {
    parts.push("", "【全网对标（检索来源，可点开自查）】");
    for (const benchmark of benchmarks) {
      parts.push(chatBenchmarkCopyText(benchmark));
    }
  }
  if (payload.quotes.length > 0) {
    parts.push("", "【金句】", ...payload.quotes.map((quote) => `· ${quote}`));
  }
  if (payload.objections.length > 0) {
    parts.push("", "【异议回答】");
    for (const objection of payload.objections) {
      parts.push(`问：${objection.question}`, `答：${objection.answer}`);
    }
  }
  if (payload.missing_facts.length > 0) {
    parts.push("", `【待补事实（不补齐不许对外讲）】${payload.missing_facts.join(" / ")}`);
  }
  return parts.join("\n");
}

/* -------------------------------------------------------------- 请求封装 */

export interface ChatSessionQuery {
  q?: string;
  /** 三态：`all` 不传参、`bound` 只看绑了产品的、`unbound` 反之 */
  bound?: "all" | "bound" | "unbound";
  page?: number;
  pageSize?: number;
}

function sessionQueryString(query: ChatSessionQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) {
    params.set("q", query.q.trim());
  }
  if (query.bound === "bound") {
    params.set("bound", "true");
  } else if (query.bound === "unbound") {
    params.set("bound", "false");
  }
  if (query.page && query.page > 1) {
    params.set("page", String(query.page));
  }
  if (query.pageSize) {
    params.set("pageSize", String(query.pageSize));
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

export async function createChatSession(
  token: string | null,
  input: { title?: string; product_id?: string | null; intensity?: CopyIntensity } = {}
): Promise<ChatSessionView> {
  return apiRequest<ChatSessionView>("/api/chat/sessions", { method: "POST", body: input, token });
}

export async function updateChatSession(
  token: string | null,
  sessionId: string,
  input: { title?: string; product_id?: string | null; intensity?: CopyIntensity }
): Promise<ChatSessionView> {
  return apiRequest<ChatSessionView>(`/api/chat/sessions/${sessionId}`, {
    method: "PATCH",
    body: input,
    token
  });
}

export async function deleteChatSession(token: string | null, sessionId: string): Promise<void> {
  await apiRequest<void>(`/api/chat/sessions/${sessionId}`, { method: "DELETE", token });
}

/**
 * 发一条需求。真实模型单次约 1–2 分钟，调用方必须自己撑住等待态。
 * 失败时后端已把用户需求落库并返回 502 `AI_UNAVAILABLE`，前端提示「可以直接重发」。
 */
export async function sendChatMessage(
  token: string | null,
  sessionId: string,
  input: {
    content: string;
    product_id?: string | null;
    /** 未绑定产品时直接写产品名：只当检索词，服务端按它去全网找对标 */
    product_name?: string | null;
    intensity?: CopyIntensity;
  }
): Promise<ChatSendResult> {
  return apiRequest<ChatSendResult>(`/api/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    body: input,
    token
  });
}

/* ---------------------------------------------------------------- 数据钩子 */

export function useChatContract(token: string | null): {
  data: ChatContractResponse | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<ChatContractResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<ChatContractResponse>("/api/chat/contract", { token })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取对话工作台合同失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { data, loading, error };
}

export function useChatLabels(token: string | null): {
  labels: ChatLabels | null;
  loading: boolean;
  error: string | null;
} {
  const [labels, setLabels] = useState<ChatLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<ChatLabels>("/api/chat/labels", { token })
      .then((result) => {
        if (!cancelled) {
          setLabels(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取对话工作台文案失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { labels, loading, error };
}

/** 会话列表：搜索与筛选条件进 URL，刷新后保持一致。 */
export function useChatSessions(
  token: string | null,
  query: ChatSessionQuery
): {
  data: ChatSessionListResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<ChatSessionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const queryString = sessionQueryString(query);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<ChatSessionListResponse>(`/api/chat/sessions${queryString}`, { token })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取会话列表失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, queryString, tick]);

  const reload = useCallback(() => setTick((current) => current + 1), []);
  return { data, loading, error, reload };
}

/** 会话消息：第 1 页就是最新一段对话，服务端已按时间升序返回。 */
export function useChatMessages(
  token: string | null,
  sessionId: string | null
): {
  data: ChatMessageListResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<ChatMessageListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token || !sessionId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiRequest<ChatMessageListResponse>(`/api/chat/sessions/${sessionId}/messages`, { token })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("读取这段对话失败，可能已被删除");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, sessionId, tick]);

  const reload = useCallback(() => setTick((current) => current + 1), []);
  return { data, loading, error, reload };
}
