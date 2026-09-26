import { BingSearchProvider } from "./bing.js";
import { MockSearchProvider } from "./mock.js";
import { So360SearchProvider } from "./so360.js";
import { TavilySearchProvider } from "./tavily.js";
import type { SearchProvider } from "./types.js";

export * from "./types.js";
export * from "./mock.js";
export * from "./tavily.js";
export * from "./bing.js";
export * from "./so360.js";
export * from "./html.js";

export interface SearchProviderEnv {
  SEARCH_PROVIDER?: "mock" | "tavily" | "bing" | "so360";
  TAVILY_API_KEY?: string;
}

/**
 * 检索通道选择（§12 Adapter）：
 * - `tavily`：有 Key 时最省心（结构化结果、带 published_date），优先；
 * - `so360`：**不需要任何账号 / Key**，直接读 360 中文结果页；本机实测相关度好、可连续调用，
 *   是客户现场唯一能马上跑通的真实检索通道（默认）；
 * - `bing`：同样免 Key，但本机 Node 侧实测返回与查询词不相关的结果（静默降级），仅作备选；
 * - `mock`：离线与测试用，没有 fixture 时返回 0 条（系统据此如实报「没有找到对标」，不编来源）。
 */
export function createSearchProvider(env: SearchProviderEnv = {}): SearchProvider {
  const requested = env.SEARCH_PROVIDER ?? "mock";
  if (requested === "tavily" && env.TAVILY_API_KEY) {
    return new TavilySearchProvider({ apiKey: env.TAVILY_API_KEY });
  }
  if (requested === "so360") {
    return new So360SearchProvider();
  }
  if (requested === "bing") {
    return new BingSearchProvider();
  }
  return new MockSearchProvider();
}
