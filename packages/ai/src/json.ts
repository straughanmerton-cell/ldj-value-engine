import type { AiJsonOptions, AiMessage, AiTextResult } from "./types.js";

/**
 * 从第一个 `{` / `[` 开始，按括号配对找到**这一段** JSON 的结尾。
 *
 * 逐字扫描而不是 `lastIndexOf("}")`：模型偶尔会在 JSON 之后再写一句解释、
 * 甚至在字符串里带上 `}` 或多输出一段 JSON，用最后一个括号会把尾巴一起吞掉，
 * 报出的却是「JSON 语法错误」，让人误以为是模型不会写 JSON。
 * 字符串状态（引号 / 转义）必须跟踪，否则话术正文里的 `}` 会把深度算错。
 */
function balancedSnippet(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) {
    return null;
  }
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = fenced?.[1] ? [fenced[1].trim(), trimmed] : [trimmed];
  let parseError: string | undefined;

  for (const candidate of candidates) {
    const snippet = balancedSnippet(candidate);
    if (!snippet) {
      continue;
    }
    try {
      return JSON.parse(snippet);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!candidates.some((candidate) => candidate.search(/[[{]/) !== -1)) {
    throw new Error("AI 输出中未找到 JSON 载荷");
  }
  throw new Error(
    parseError ? `AI 输出不是合法 JSON：${parseError}` : "AI 输出的 JSON 载荷不完整"
  );
}

/**
 * 统一的 JSON 生成 + schema 校验 + 失败重试流程。
 * 任何 Agent 都不得绕过 schema validation 直接把模型输出写入数据库。
 */
export async function generateValidatedJson<T>(
  generate: (messages: AiMessage[]) => Promise<AiTextResult>,
  options: AiJsonOptions<T>
): Promise<{ data: T; attempts: number; lastError?: string; raw: AiTextResult }> {
  const retries = options.retries ?? 1;
  const messages: AiMessage[] = [...options.messages];
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await generate(messages);
    try {
      const payload = extractJsonPayload(result.text);
      const parsed = options.schema.safeParse(payload);
      if (parsed.success) {
        return { data: parsed.data, attempts: attempt + 1, raw: result };
      }
      lastError = JSON.stringify(parsed.error.issues.slice(0, 5));
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    messages.push({
      role: "user",
      content: lastError.includes("不完整")
        ? `上一次输出被截断（JSON 没写完）：${lastError}\n请压缩正文长度、少写几条可选项，确保 JSON 完整闭合，不要多余解释。`
        : `上一次输出未通过校验：${lastError}\n请只输出符合 schema 的 JSON，不要多余解释。`
    });
  }

  throw new Error(`AI 输出未通过 schema 校验：${lastError ?? "未知错误"}`);
}
