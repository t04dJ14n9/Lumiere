/**
 * At most `limit` values by key, the least recently used dropped first: a
 * thousand-page PDF read from end to end keeps only the pages read last.
 */
export class RecentCache<Key, Value> {
  private readonly values = new Map<Key, Value>();

  constructor(
    private readonly limit: number,
    /** Told of each value dropped for room, or by `clear`: a value that holds a resource lets it go. */
    private readonly onDrop?: (key: Key, value: Value) => void,
  ) {}

  get size(): number {
    return this.values.size;
  }

  get(key: Key): Value | undefined {
    if (!this.values.has(key)) {
      return undefined;
    }
    const value = this.values.get(key) as Value;
    // Map keeps insertion order: moving it to the end marks it as recent.
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.limit) {
      const oldest = this.values.keys().next().value as Key;
      const dropped = this.values.get(oldest) as Value;
      this.values.delete(oldest);
      this.onDrop?.(oldest, dropped);
    }
  }

  clear(): void {
    const all = [...this.values];
    this.values.clear();
    for (const [key, value] of all) {
      this.onDrop?.(key, value);
    }
  }

  delete(key: Key, value?: Value): void {
    // A newer value under the key is not the one being dropped.
    if (value === undefined || this.values.get(key) === value) {
      this.values.delete(key);
    }
  }
}
