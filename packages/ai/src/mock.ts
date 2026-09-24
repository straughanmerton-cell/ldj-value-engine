import { generateValidatedJson } from "./json.js";
import type { AiGenerateOptions, AiJsonOptions, AiProvider, AiTextResult } from "./types.js";

export interface MockAiRule {
  match: RegExp;
  text: string;
}

/**
 * Mock Provider：无 API Key 时用于打通链路与自动化测试。
 * 返回内容明确标记为 MOCK，避免被误当作真实 AI 产出。
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  private readonly rules: MockAiRule[];

  constructor(rules: MockAiRule[] = []) {
    this.rules = rules;
  }

  async generateText(options: AiGenerateOptions): Promise<AiTextResult> {
    const prompt = options.messages.map((message) => message.content).join("\n");
    const matched = this.rules.find((rule) => rule.match.test(prompt));
    const text = matched?.text ?? `[MOCK] 未配置 AI Provider，占位响应。prompt_hash=${hash(prompt)}`;
    return {
      text,
      model: options.model ?? "mock-model",
      provider: this.name,
      usage: { promptTokens: prompt.length, completionTokens: text.length }
    };
  }

  async generateJson<T>(options: AiJsonOptions<T>): Promise<{ data: T; raw: AiTextResult }> {
    const result = await generateValidatedJson(
      (messages) => this.generateText({ ...options, messages }),
      options
    );
    return { data: result.data, raw: result.raw };
  }
}

function hash(input: string): string {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) % 1_000_000_007;
  }
  return value.toString(16);
}
