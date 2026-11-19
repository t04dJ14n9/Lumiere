/**
 * At most `limit` values by key, the least recently used dropped first: a
 * thousand-page PDF read from end to end keeps only the pages read last.
 */
export class RecentCache<Key, Value> {
  private readonly values = new Map<Key, Value>();

  constructor(private readonly limit: number) {}

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
      this.values.delete(oldest);
    }
  }

  delete(key: Key, value?: Value): void {
    // A newer value under the key is not the one being dropped.
    if (value === undefined || this.values.get(key) === value) {
      this.values.delete(key);
    }
  }
}
