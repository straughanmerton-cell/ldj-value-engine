import { DeepSeekProvider } from "./deepseek.js";
import { MockAiProvider } from "./mock.js";
import { OpenAiProvider } from "./openai.js";
import type { AiProvider } from "./types.js";

export * from "./types.js";
export * from "./json.js";
export * from "./mock.js";
export * from "./openai.js";
export * from "./deepseek.js";

export interface AiProviderEnv {
  AI_PROVIDER?: "mock" | "openai" | "deepseek";
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
}

/**
 * 缺失第三方 Key 时回退 Mock，不阻塞主系统开发（规格 §63-7）。
 */
export function createAiProvider(env: AiProviderEnv = {}): AiProvider {
  const requested = env.AI_PROVIDER ?? "mock";
  if (requested === "openai") {
    if (!env.OPENAI_API_KEY) {
      return new MockAiProvider();
    }
    return new OpenAiProvider({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL,
      defaultModel: env.OPENAI_MODEL
    });
  }
  if (requested === "deepseek") {
    if (!env.DEEPSEEK_API_KEY) {
      return new MockAiProvider();
    }
    return new DeepSeekProvider({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL,
      defaultModel: env.DEEPSEEK_MODEL
    });
  }
  return new MockAiProvider();
}
