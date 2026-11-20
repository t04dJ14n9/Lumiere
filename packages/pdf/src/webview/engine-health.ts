/**
 * Whether the PDF engine still works after it started. EmbedPDF 3 does not
 * notice an engine that dies once its worker has booted: its worker
 * transport stops listening for the worker's `error` after the handshake,
 * so the calls in flight never settle and the viewer freezes on the last
 * pictures it drew. The viewer watches for itself: the worker's `error` and
 * `messageerror` events, and the engine's answers (a call rejected because
 * the runtime is gone, or because PDFium trapped, whose WASM state is then
 * not to be trusted). Kept free of browser and EmbedPDF imports so it is
 * unit-tested under Node.
 *
 * Not noticed: a worker stuck inside one call (it is busy, not dead, and a
 * long render looks the same), and a crash that takes the whole webview,
 * which VS Code reports itself.
 */

/** Codes of a rejected call that say the engine, not the file, failed. */
const RUNTIME_CODES = new Set(["RuntimeUnavailable", "WireFormat"]);

/** How a WebAssembly trap or an Emscripten abort reads once serialized. */
const WASM_TRAP =
  /\bunreachable\b|out of bounds|Aborted\(|out of memory|RuntimeError/iu;

export class EngineHealth {
  private died: string | undefined;
  private readonly listeners = new Set<(cause: string) => void>();

  /** Why the engine stopped working; undefined while it works. */
  get cause(): string | undefined {
    return this.died;
  }

  /** The engine's worker raised an error, or sent what cannot be read. */
  workerFailed(message: string): void {
    this.die(message || "The PDF engine's worker stopped.");
  }

  /** One of the engine's answers to a call (a `WorkerResponse`). */
  answered(response: unknown): void {
    if (!isRecord(response) || response.kind !== "reject") {
      return;
    }
    const error = isRecord(response.error) ? response.error : {};
    const code = String(error.code ?? "");
    const message = String(error.message ?? code);
    if (RUNTIME_CODES.has(code) || WASM_TRAP.test(message)) {
      this.die(message);
    }
  }

  /** Calls `listener` once the engine stops working, at once if it has. */
  onDeath(listener: (cause: string) => void): () => void {
    if (this.died !== undefined) {
      listener(this.died);
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private die(cause: string): void {
    if (this.died !== undefined) {
      return;
    }
    this.died = cause;
    for (const listener of [...this.listeners]) {
      listener(cause);
    }
    this.listeners.clear();
  }
}

const healthOfEngine = new WeakMap<object, EngineHealth>();

/** Start keeping the health of `engine`; the environment that makes it reports to the result. */
export function watchEngine(
  engine: object,
  health = new EngineHealth(),
): EngineHealth {
  healthOfEngine.set(engine, health);
  return health;
}

/** The health of an engine made by `watchEngine`'s caller. */
export function engineHealth(engine: object): EngineHealth | undefined {
  return healthOfEngine.get(engine);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
