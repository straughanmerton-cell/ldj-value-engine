import type { ZodType } from "zod";

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiGenerateOptions {
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  /**
   * 走 Provider 的「强制 JSON」开关（OpenAI 兼容协议：`response_format: { type: "json_object" }`）。
   *
   * 只影响支持该参数的 Provider（OpenAI / DeepSeek）；不支持的实现直接忽略。
   * schema 校验（规格 §62-13）不因此放松——它只是让模型少犯语法错误，少浪费一次重试。
   */
  responseFormat?: "json_object";
}

export interface AiJsonOptions<T> extends AiGenerateOptions {
  schema: ZodType<T>;
  /** schema 校验失败时的重试次数（默认 1 次），用于满足规格 §62-13「AI 输出必须经过 schema validation」 */
  retries?: number;
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiTextResult {
  text: string;
  model: string;
  usage?: AiUsage;
  provider: string;
}

/**
 * 所有 AI Agent（规格 §38 的 11 个 Agent）都通过该接口调用模型。
 * 缺失 API Key 时回退到 MockAiProvider，主系统开发不被阻塞（规格 §63-7）。
 */
export interface AiProvider {
  readonly name: string;
  generateText(options: AiGenerateOptions): Promise<AiTextResult>;
  generateJson<T>(options: AiJsonOptions<T>): Promise<{ data: T; raw: AiTextResult }>;
}
