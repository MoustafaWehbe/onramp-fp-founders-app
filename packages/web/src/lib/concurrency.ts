/** Runs `worker` over `items` with at most `limit` in flight at once. */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;
    try {
      results[index] = { status: "fulfilled", value: await worker(items[index]) };
    } catch (error) {
      results[index] = { status: "rejected", reason: error };
    }
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}
