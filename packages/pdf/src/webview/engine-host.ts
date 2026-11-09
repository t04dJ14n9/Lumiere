/**
 * The PDF engine of one webview, owned in one place so it is let go in one
 * place. Kept free of browser and EmbedPDF imports so it is unit-tested under
 * Node against fake engines.
 *
 * Invariants:
 *
 * - At most one engine exists. Asking for the other mode (the worker failed,
 *   or the next load tries the worker again) stops the live engine first, and
 *   the new one starts only after that stop has settled, so two PDFium heaps
 *   never overlap.
 * - The engine outlives a reload: the same mode answers with the same engine,
 *   so the next PDF does not pay for a second worker and WASM compile. The
 *   viewer closes the old document itself.
 * - An engine given up on (another mode asked for, or `dispose()`) while it
 *   is still starting is stopped as soon as it arrives, never handed out.
 * - An engine that fails to start is forgotten: the next ask starts again.
 * - A stop settles within `stopDeadlineMs` whatever the engine does: a worker
 *   that never answered cannot be stopped (EmbedPDF's `destroy()` waits for
 *   its boot), and must not keep the next engine from starting. A late or
 *   failed stop is reported, not waited for.
 * - `dispose()` resolves once every engine has stopped, and never rejects:
 *   stop failures go to `reportError`.
 */
export type EngineMode = "worker" | "main-thread";

/** What the host needs from the outside world; tests pass fakes. */
export interface EngineEnvironment<Engine> {
  /** Make the engine for `mode`. It may wait for what it needs, such as the WASM. */
  create(mode: EngineMode): Promise<Engine>;
  /** Stop the engine, and its worker. */
  destroy(engine: Engine): Promise<void>;
  /** Where failures of detached work (stopping engines) are reported. */
  reportError(message: string, error: unknown): void;
}

/** How long an engine gets to stop before the next one starts anyway. */
export const ENGINE_STOP_DEADLINE_MS = 2000;

export class EngineHostDisposedError extends Error {
  constructor() {
    super("The PDF engine was stopped");
    this.name = "EngineHostDisposedError";
  }
}

interface Entry<Engine> {
  readonly mode: EngineMode;
  readonly engine: Promise<Engine>;
}

export class EngineHost<Engine> {
  private current: Entry<Engine> | undefined;
  private live = true;
  /** Settles once every engine stopped so far has stopped; a new engine waits for it. */
  private stopped: Promise<void> = Promise.resolve();

  constructor(
    private readonly environment: EngineEnvironment<Engine>,
    private readonly stopDeadlineMs = ENGINE_STOP_DEADLINE_MS,
  ) {}

  /** The engine for `mode`, started on first use. Rejects once disposed. */
  engine(mode: EngineMode): Promise<Engine> {
    if (!this.live) {
      return Promise.reject(new EngineHostDisposedError());
    }
    if (this.current?.mode === mode) {
      return this.current.engine;
    }
    if (this.current) {
      this.stop(this.current);
    }
    const entry: Entry<Engine> = {
      mode,
      engine: this.stopped.then(() => this.start(entry)),
    };
    this.current = entry;
    return entry.engine;
  }

  /** Let go of the engine; resolves when it has stopped. Never rejects. */
  dispose(): Promise<void> {
    this.live = false;
    const entry = this.current;
    this.current = undefined;
    if (entry) {
      this.stop(entry);
    }
    return this.stopped;
  }

  private async start(entry: Entry<Engine>): Promise<Engine> {
    // Given up before its turn: nothing was made.
    if (this.current !== entry) {
      throw new EngineHostDisposedError();
    }
    let engine: Engine;
    try {
      engine = await this.environment.create(entry.mode);
    } catch (error) {
      // The host outlives reloads: the next ask must try again, not get this failure.
      if (this.current === entry) {
        this.current = undefined;
      }
      throw error;
    }
    // Given up while starting.
    if (this.current !== entry) {
      this.track(this.destroy(engine));
      throw new EngineHostDisposedError();
    }
    return engine;
  }

  /** Stop an entry's engine once it exists (an entry given up on rejects, and has none). */
  private stop(entry: Entry<Engine>): void {
    this.track(
      entry.engine.then(
        (engine) => this.destroy(engine),
        () => undefined,
      ),
    );
  }

  private destroy(engine: Engine): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer in ${this.stopDeadlineMs} ms`)),
        this.stopDeadlineMs,
      );
    });
    return Promise.race([
      Promise.resolve().then(() => this.environment.destroy(engine)),
      late,
    ])
      .catch((error: unknown) =>
        this.environment.reportError("Could not stop the PDF engine", error),
      )
      .finally(() => clearTimeout(timer));
  }

  private track(stopping: Promise<void>): void {
    this.stopped = Promise.all([this.stopped, stopping]).then(() => undefined);
  }
}
