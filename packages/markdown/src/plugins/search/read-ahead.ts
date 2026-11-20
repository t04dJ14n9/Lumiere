/**
 * Prepares items in order, at most `depth` ahead of the one taken, so slow
 * reads overlap while their results are still used one at a time.
 *
 * `prepare` must not reject: a preparation left untaken when the caller
 * stops early (a cancelled search) would otherwise be an unhandled rejection.
 */
export function readAhead<T, R>(
  items: readonly T[],
  prepare: (item: T) => Promise<R>,
  depth: number,
): { next(): Promise<R> | undefined } {
  const queue: Promise<R>[] = [];
  let started = 0;
  return {
    next() {
      while (queue.length < depth && started < items.length) {
        queue.push(prepare(items[started++]!));
      }
      return queue.shift();
    },
  };
}
