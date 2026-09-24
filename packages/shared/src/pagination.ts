export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function normalizePagination(input: Partial<PaginationInput> | undefined): PaginationInput {
  const page = Math.max(1, Math.trunc(input?.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(input?.pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page, pageSize };
}

export function buildPage<T>(items: T[], total: number, input: PaginationInput): Paginated<T> {
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize)
  };
}
