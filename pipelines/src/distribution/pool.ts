/**
 * Run `fn` over `items`, at most `limit` at a time, with results in input
 * order. A failure starts nothing new, lets what already started finish, then
 * rejects with the first error, so a caller can mark the run failed knowing
 * nothing is still writing. `stopped` is checked before each item starts;
 * items it skips have no result.
 */
export async function mapInPool<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>,
    stopped?: () => boolean
): Promise<R[]> {
    const results: Array<{ value: R }> = [];
    let next = 0;
    let failure: { error: unknown } | null = null;
    const worker = async () => {
        while (next < items.length && !failure && !stopped?.()) {
            const index = next++;
            try {
                results[index] = { value: await fn(items[index]!) };
            } catch (error) {
                failure ??= { error };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
    if (failure) throw (failure as { error: unknown }).error;
    return results.flatMap(result => (result ? [result.value] : []));
}
