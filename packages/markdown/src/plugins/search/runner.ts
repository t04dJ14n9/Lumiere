import type { SearchDocument } from "../../markdown/search/evaluate";
import type { Cancellation } from "../../shared/rpc/lifecycle";
import { RpcError } from "../../shared/rpc/lifecycle";
import { startup, submission, workerReply } from "./worker-protocol";
import { errorMessage } from "../../shared/errors";
import type { Disposer } from "@workshop/core";
import type { WorkerChannel, WorkerLauncher } from "../../shared/workers";
import type { MatchLine } from "./match-lines";
/** Whether a document matched, and a hit's content lines. */
export interface SearchVerdict {
  matched: boolean;
  matches?: MatchLine[];
}
interface Pending {
  resolve(value: SearchVerdict): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
/** A document whose evaluation ran past its deadline: the search skips it. */
export class SearchTimeoutError extends Error {
  constructor(readonly path: string) {
    super(`Search evaluation timed out for ${path}`);
    this.name = "SearchTimeoutError";
  }
}
export interface SearchEvaluator {
  ready: Promise<void>;
  includesFiles: boolean;
  requiresText: boolean;
  requiresMetadata: boolean;
  stopped: boolean;
  matches(document: SearchDocument): Promise<SearchVerdict>;
  dispose(): Promise<void>;
}
/** A channel's start-up: settled by its `ready` message, or by its failure. */
interface Startup {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}
function createStartup(): Startup {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
/**
 * One query per worker. A stuck regex cannot be stopped inside its worker, so
 * an evaluation that runs past its deadline gets a fresh channel: that
 * document is skipped (`SearchTimeoutError`) and the search goes on. Only a
 * failure of the channel itself closes the worker.
 */
export class SearchWorker implements SearchEvaluator {
  private startup!: Startup;
  private channel!: WorkerChannel;
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private closed?: Error;
  private readonly terminations: Promise<unknown>[] = [];
  private startupTimer?: ReturnType<typeof setTimeout>;
  private stopCancellation: Disposer = () => {};
  includesFiles = false;
  requiresText = true;
  requiresMetadata = true;
  constructor(
    private readonly workers: WorkerLauncher,
    private readonly query: string,
    private readonly options: {
      token?: Cancellation;
      timeoutMs?: number;
      startupMs?: number;
    } = {},
  ) {
    if (options.token?.cancelled) {
      throw new RpcError("Cancelled", "Search cancelled");
    }
    this.launch();
    this.stopCancellation =
      options.token?.onCancel(
        () => void this.fail(new RpcError("Cancelled", "Search cancelled")),
      ) ?? (() => {});
  }
  get ready(): Promise<void> {
    return this.startup.promise;
  }
  get stopped(): boolean {
    return this.closed !== undefined;
  }
  async matches(document: SearchDocument): Promise<SearchVerdict> {
    await this.ready;
    if (this.closed) {
      throw this.closed;
    }
    const request = submission.parse({ id: ++this.sequence, document });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.timeOut(request.id, document.path),
        this.options.timeoutMs ?? 5000,
      );
      this.pending.set(request.id, { resolve, reject, timer });
      try {
        this.channel.post(request);
      } catch (error) {
        this.fail(new Error(errorMessage(error)));
      }
    });
  }
  /** Starts a channel with its own start-up; only the current channel's messages count. */
  private launch(): void {
    this.startup = createStartup();
    const channel = this.workers.start("search", {
      data: startup.parse({ query: this.query }),
      memoryLimitMb: 256,
    });
    this.channel = channel;
    this.startupTimer = setTimeout(
      () => this.fail(new Error("Search worker startup timed out")),
      this.options.startupMs ?? 15000,
    );
    channel.onMessage((message) => {
      if (channel === this.channel) {
        this.receive(message);
      }
    });
    channel.onError((error) => {
      if (channel === this.channel) {
        this.fail(error);
      }
    });
    channel.onExit((code) => {
      if (channel === this.channel) {
        this.fail(new Error(`Search worker exited (${code})`));
      }
    });
  }
  private receive(value: unknown): void {
    if (this.closed) {
      return;
    }
    try {
      const reply = workerReply(value);
      if (reply.type === "error") {
        this.fail(new Error(reply.message));
        return;
      }
      if (reply.type === "ready") {
        this.includesFiles = reply.files;
        this.requiresText = reply.content;
        this.requiresMetadata = reply.metadata;
        clearTimeout(this.startupTimer);
        this.startup.resolve();
        return;
      }
      const request = this.pending.get(reply.id);
      if (!request) {
        return;
      }
      this.pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.type === "result") {
        request.resolve({
          matched: reply.matched,
          ...(reply.matches ? { matches: reply.matches } : {}),
        });
      } else {
        request.reject(new Error(reply.message));
      }
    } catch (error) {
      this.fail(new Error(errorMessage(error)));
    }
  }
  /** Ends the evaluation of `path` at its deadline, and moves on in a fresh channel. */
  private timeOut(id: number, path: string): void {
    if (this.closed) {
      return;
    }
    clearTimeout(this.startupTimer);
    for (const [pendingId, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(
        pendingId === id
          ? new SearchTimeoutError(path)
          : new Error("Search evaluation was interrupted"),
      );
    }
    this.pending.clear();
    this.terminate();
    try {
      this.launch();
    } catch (error) {
      this.fail(new Error(errorMessage(error)));
    }
  }
  private fail(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = error;
    clearTimeout(this.startupTimer);
    void this.stopCancellation();
    this.startup.reject(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.terminate();
  }
  private terminate(): void {
    const termination = this.channel.terminate();
    void termination.catch(() => {});
    this.terminations.push(termination);
  }
  async dispose(): Promise<void> {
    this.fail(new RpcError("Cancelled", "Search cancelled"));
    await Promise.all(this.terminations);
  }
}
