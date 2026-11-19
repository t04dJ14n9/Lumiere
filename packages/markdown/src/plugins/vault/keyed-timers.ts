/** Timers by name, each restarted when it is set again before it fires. */
export class KeyedTimers {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  has(key: string): boolean {
    return this.timers.has(key);
  }

  /** Run `run` after `delay`, unless `key` is set again or cancelled first. */
  debounce(key: string, delay: number, run: () => void): void {
    this.cancel(key);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        run();
      }, delay),
    );
  }

  cancel(key: string): void {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  cancelAll(): void {
    for (const key of [...this.timers.keys()]) {
      this.cancel(key);
    }
  }
}
