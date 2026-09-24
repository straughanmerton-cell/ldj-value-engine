import type { SearchProvider, SearchRequest, SearchResult } from "./types.js";
import { safeDomain } from "./mock.js";

export interface TavilyProviderConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
    published_date?: string;
  }>;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: TavilyProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.tavily.com";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async search(input: SearchRequest): Promise<SearchResult[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query: input.query,
        max_results: input.maxResults ?? 10,
        search_depth: "advanced",
        days: input.recencyDays
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`搜索请求失败：${response.status} ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as TavilyResponse;
    return (payload.results ?? []).map((item) => {
      const url = item.url ?? "";
      return {
        title: item.title ?? url,
        url,
        snippet: item.content ?? "",
        sourceDomain: safeDomain(url),
        publishedAt: item.published_date,
        rawScore: item.score
      };
    });
  }
}
