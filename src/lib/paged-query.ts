// Supabase returns at most 1000 rows per request (the API's max_rows), and anything past that is
// cut off silently. Reads that can grow past it go through here and are fetched page by page.
// The query must have a stable order (end with a unique column such as id), or rows can be
// skipped or repeated between pages.

export const PAGE_SIZE = 1000;

type PageResult<Row> = PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}>;

export async function fetchAllPages<Row>(
  fetchPage: (from: number, to: number) => PageResult<Row>,
  maxPages = 50,
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const rows: Row[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}
