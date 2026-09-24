import { OpenAiProvider, type OpenAiProviderConfig } from "./openai.js";

/**
 * DeepSeek Provider（用户需求扩展，2026-09-24 接入）。
 *
 * DeepSeek 官方 API 与 OpenAI Chat Completions 协议兼容（`POST /chat/completions`），
 * 因此复用 `OpenAiProvider` 的请求实现，只收敛名字与默认值；
 * 不在业务代码里出现任何「OpenAI 的 key 指向 DeepSeek」这类隐式替换。
 */
export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-pro";

export type DeepSeekProviderConfig = Omit<OpenAiProviderConfig, "name">;

export class DeepSeekProvider extends OpenAiProvider {
  constructor(config: DeepSeekProviderConfig) {
    super({
      ...config,
      name: "deepseek",
      baseUrl: config.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
      defaultModel: config.defaultModel ?? DEEPSEEK_DEFAULT_MODEL
    });
  }
}
