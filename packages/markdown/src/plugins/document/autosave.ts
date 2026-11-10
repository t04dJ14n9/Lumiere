/**
 * Obsidian autosaves an open note roughly every two seconds. The scheduler is
 * pure: the host injects the clock and the document predicates, so a unit test
 * can drive it without real timers or a VS Code TextDocument. No saving happens
 * for a clean or untitled document, and a save already in flight is not
 * overlapped by the next tick.
 */
export const AUTOSAVE_INTERVAL_MS = 2000;

export interface AutosaveClock {
  /** Schedule `run` after `delayMs`; return a function that cancels it. */
  schedule(delayMs: number, run: () => void): () => void;
}

export interface AutosaveOptions {
  intervalMs?: number;
  isDirty(): boolean;
  isUntitled(): boolean;
  save(): Promise<boolean>;
  clock: AutosaveClock;
}

/** The clock used by the real extension host. */
export function hostAutosaveClock(): AutosaveClock {
  return {
    schedule(delayMs, run) {
      const handle = setTimeout(run, delayMs);
      return () => clearTimeout(handle);
    },
  };
}

export class AutosaveScheduler {
  private cancel: (() => void) | undefined;
  private disposed = false;
  private saving = false;

  constructor(private readonly options: AutosaveOptions) {}

  start(): void {
    if (this.disposed || this.cancel) {
      return;
    }
    this.arm();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel?.();
    this.cancel = undefined;
  }

  private arm(): void {
    this.cancel = this.options.clock.schedule(
      this.options.intervalMs ?? AUTOSAVE_INTERVAL_MS,
      () => void this.fire(),
    );
  }

  private async fire(): Promise<void> {
    this.cancel = undefined;
    if (this.disposed || this.saving) {
      return;
    }
    this.saving = true;
    try {
      if (this.options.isDirty() && !this.options.isUntitled()) {
        await this.options.save();
      }
    } finally {
      this.saving = false;
      if (!this.disposed) {
        this.arm();
      }
    }
  }
}
