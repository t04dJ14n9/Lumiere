/** What a {@link Throttle} needs of time: a clock and a way to be called later. */
export interface ThrottleClock {
  now(): number;
  /** Call `run` in `ms` milliseconds; returns what `cancel` takes. */
  after(ms: number, run: () => void): unknown;
  cancel(handle: unknown): void;
}

/**
 * Runs `run` at most once in `intervalMs`: the first call after a quiet
 * spell runs it at once, and the calls that follow within the interval run
 * it once more when the interval is over, so the last of a burst is never
 * lost. `run` reads what it reports when it runs; calls carry nothing.
 */
export class Throttle {
  private lastRun = Number.NEGATIVE_INFINITY;
  private pending: unknown;
  private isPending = false;

  constructor(
    private readonly run: () => void,
    private readonly intervalMs: number,
    private readonly clock: ThrottleClock,
  ) {}

  call(): void {
    if (this.isPending) {
      return;
    }
    const wait = this.lastRun + this.intervalMs - this.clock.now();
    if (wait <= 0) {
      this.runNow();
      return;
    }
    this.isPending = true;
    this.pending = this.clock.after(wait, () => {
      this.isPending = false;
      this.runNow();
    });
  }

  /** Run what is waiting for the interval now, for a caller that is going away. */
  flush(): void {
    if (!this.isPending) {
      return;
    }
    this.clock.cancel(this.pending);
    this.isPending = false;
    this.runNow();
  }

  private runNow(): void {
    this.lastRun = this.clock.now();
    this.run();
  }
}
