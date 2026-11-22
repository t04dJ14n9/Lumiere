import { RecentCache } from "./recent-cache";

/**
 * Recent values by key, for one scope at a time: asking under another scope
 * forgets what was kept for the last. The viewer's quoted text is read from
 * a document's pages, and a reloaded PDF (new bytes, the same page and object
 * numbers) must not show what the old one said.
 */
export class ScopedCache<Value> {
  private scope: unknown;
  private readonly values: RecentCache<string, Value>;

  constructor(limit: number) {
    this.values = new RecentCache(limit);
  }

  get(scope: unknown, key: string): Value | undefined {
    this.enter(scope);
    return this.values.get(key);
  }

  set(scope: unknown, key: string, value: Value): void {
    this.enter(scope);
    this.values.set(key, value);
  }

  private enter(scope: unknown): void {
    if (scope !== this.scope) {
      this.scope = scope;
      this.values.clear();
    }
  }
}
