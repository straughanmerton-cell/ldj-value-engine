import { generateValidatedJson } from "./json.js";
import type { AiGenerateOptions, AiJsonOptions, AiProvider, AiMessage, AiTextResult } from "./types.js";

export interface OpenAiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  /** Provider 标识：DeepSeek 等同协议服务复用本实现，只换名字与默认值。 */
  name?: string;
  /** 便于测试注入 */
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiProvider implements AiProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAiProviderConfig) {
    this.name = config.name ?? "openai";
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultModel = config.defaultModel ?? "gpt-4.1";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async generateText(options: AiGenerateOptions): Promise<AiTextResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model ?? this.defaultModel,
        messages: options.messages.map((message: AiMessage) => ({
          role: message.role,
          content: message.content
        })),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        ...(options.responseFormat ? { response_format: { type: options.responseFormat } } : {})
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI 请求失败：${response.status} ${body.slice(0, 500)}`);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const text = payload.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model: payload.model ?? options.model ?? this.defaultModel,
      provider: this.name,
      usage: {
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens
      }
    };
  }

  async generateJson<T>(options: AiJsonOptions<T>): Promise<{ data: T; raw: AiTextResult }> {
    /**
     * 强制 JSON 模式 + **只调用一次**：`generateValidatedJson` 已经把成功那一次的结果带回来了，
     * 以前再补一次 `generateText` 等于把同一个 Prompt 交给模型写两遍
     * （长稿上一来一回可能多花几十秒，且第二次的正文没人看）。
     */
    const validated = await generateValidatedJson(
      (messages) => this.generateText({ ...options, messages, responseFormat: "json_object" }),
      options
    );
    return { data: validated.data, raw: validated.raw };
  }
}
