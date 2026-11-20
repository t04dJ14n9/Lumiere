/**
 * The `setContext` values VS Code already holds. The plugins set their keys
 * on every settings change, panel switch and selection, mostly to the value
 * they already have; each call is a round trip through the workbench, so an
 * unchanged one is not sent again. Only Lumiere sets its keys, so the last
 * value sent is the value VS Code has.
 */
export class ContextKeys {
  private readonly values = new Map<string, unknown>();

  /** Whether setting `key` to `value` changes it; if so, it is recorded. */
  changes(key: string, value: unknown): boolean {
    // An object or array may have been changed in place since it was sent.
    if (typeof value === "object" && value !== null) {
      this.values.delete(key);
      return true;
    }
    if (this.values.has(key) && Object.is(this.values.get(key), value)) {
      return false;
    }
    this.values.set(key, value);
    return true;
  }

  /** A set that failed leaves the value unknown. */
  forget(key: string): void {
    this.values.delete(key);
  }
}
