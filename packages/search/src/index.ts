import { MockSearchProvider } from "./mock.js";
import { TavilySearchProvider } from "./tavily.js";
import type { SearchProvider } from "./types.js";

export * from "./types.js";
export * from "./mock.js";
export * from "./tavily.js";

export interface SearchProviderEnv {
  SEARCH_PROVIDER?: "mock" | "tavily";
  TAVILY_API_KEY?: string;
}

export function createSearchProvider(env: SearchProviderEnv = {}): SearchProvider {
  const requested = env.SEARCH_PROVIDER ?? "mock";
  if (requested === "tavily" && env.TAVILY_API_KEY) {
    return new TavilySearchProvider({ apiKey: env.TAVILY_API_KEY });
  }
  return new MockSearchProvider();
}
