const MAX_PAGE_LIMIT = 10;

type Page<T> = { data: T[]; meta: { totalPages: number } };

/**
 * Walks every page of a paginated endpoint and flattens the results, so
 * callers that need "everything" never have to ask the API for more than
 * MAX_PAGE_LIMIT rows in a single request.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<Page<T>>,
  limit: number = MAX_PAGE_LIMIT,
): Promise<T[]> {
  const first = await fetchPage(1, limit);
  if (first.meta.totalPages <= 1) return first.data;

  const rest = await Promise.all(
    Array.from({ length: first.meta.totalPages - 1 }, (_, index) => fetchPage(index + 2, limit)),
  );

  return [first.data, ...rest.map((page) => page.data)].flat();
}
