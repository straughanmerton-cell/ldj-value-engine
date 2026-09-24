import type { SearchProvider, SearchRequest, SearchResult } from "./types.js";

export interface MockSearchFixture {
  match: RegExp;
  results: Omit<SearchResult, "sourceDomain">[];
}

/** 离线/测试用搜索 Provider：不联网，返回固定 fixture，结果带 MOCK 标记。 */
export class MockSearchProvider implements SearchProvider {
  readonly name = "mock";
  private readonly fixtures: MockSearchFixture[];

  constructor(fixtures: MockSearchFixture[] = []) {
    this.fixtures = fixtures;
  }

  async search(input: SearchRequest): Promise<SearchResult[]> {
    const limit = input.maxResults ?? 10;
    const fixture = this.fixtures.find((item) => item.match.test(input.query));
    if (!fixture) {
      return [];
    }
    return fixture.results.slice(0, limit).map((result) => ({
      ...result,
      sourceDomain: safeDomain(result.url)
    }));
  }
}

export function safeDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
