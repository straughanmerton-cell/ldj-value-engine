export interface SearchRequest {
  query: string;
  maxResults?: number;
  locale?: string;
  /** 仅返回最近 N 天内的结果（价格类查询使用） */
  recencyDays?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
  publishedAt?: string;
  rawScore?: number;
}

/**
 * 规格 §12：搜索必须通过 Adapter 走真实检索，
 * 绝不允许用模型记忆替代搜索（规格 §62-1）。
 */
export interface SearchProvider {
  readonly name: string;
  search(input: SearchRequest): Promise<SearchResult[]>;
}
