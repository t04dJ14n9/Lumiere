import {
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { ChangeSet, EditorState, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { RpcError, type Endpoint } from "../../shared/rpc/endpoint";
import { protocol } from "./protocol";
import { editGroup } from "./input-annotation";

const revisionMismatch =
  "Document revisions differ. Keep this tab open and copy your edits before reopening.";

/**
 * Failures that say nothing about the two documents: the host did not answer
 * in time (a busy extension host) or the workbench refused one edit. The
 * unconfirmed updates are still in the editor's collab state, and the host
 * drops any it already took (by client id), so sending again is safe.
 * Anything else (a revision the host does not know, an edit that does not fit
 * its revision) means the two have diverged, and retrying cannot fix that.
 */
function isTransient(error: unknown): boolean {
  return (
    error instanceof RpcError &&
    (error.code === "Timeout" || error.code === "ApplyRefused")
  );
}

/** Wait before the next try: 0.5 s, doubling up to 8 s. */
function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8_000);
}

type UpdatesMessage = {
  version: number;
  updates: { clientID: string; changes: unknown }[];
};

export class Synchronizer {
  private sending = false;
  private stopped = false;
  /**
   * Set while the host's revision log is being fetched after a version skew.
   * Updates that arrive meanwhile wait in `held`: the fetched log may or may
   * not already contain them, and `receive` sorts that out once it lands.
   */
  private catchUp?: { held: UpdatesMessage[] };
  error?: string;
  /** Pending while a transient failure waits for its retry. */
  private retry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private readonly waiting: { resolve(): void; reject(error: Error): void }[] =
    [];
  constructor(
    private readonly view: EditorView,
    private readonly rpc: Endpoint,
    private readonly status: (message: string) => void,
    private readonly retryDelay: (attempt: number) => number = backoff,
  ) {}
  receive(message: UpdatesMessage): void {
    if (this.catchUp) {
      this.catchUp.held.push(message);
      return;
    }
    const synced = getSyncedVersion(this.view.state);
    if (message.version === synced) {
      this.applyUpdates(message);
      queueMicrotask(() => this.pump());
      return;
    }
    // A catch-up already replayed this message's revisions.
    if (message.version + message.updates.length <= synced || this.error) {
      return;
    }
    this.startCatchUp(synced, message);
  }
  /**
   * This panel's version differs from the one the host broadcast against, so
   * revisions in between were never applied here (a notification sent before
   * the webview was listening). Never replace the document: ask the host for
   * its log from our synced version and let the collab rules rebase the unsent
   * local edits over it. Replaying the log also confirms any edit the host
   * already took (matched by client id), where a full-text reset could not tell
   * an echo from a new edit and either dropped or duplicated typing.
   */
  private startCatchUp(version: number, message: UpdatesMessage): void {
    this.catchUp = { held: [message] };
    this.status("Syncing…");
    this.requestCatchUp(version);
  }
  private requestCatchUp(version: number): void {
    const held = this.catchUp!.held;
    void this.rpc.call(protocol, "catchUp", { version }).then(
      (log) => this.finishCatchUp(version, log, held),
      (error) => this.retryOrFail(error, () => this.requestCatchUp(version)),
    );
  }
  private finishCatchUp(
    requested: number,
    log: UpdatesMessage,
    held: UpdatesMessage[],
  ): void {
    if (this.stopped || this.error) {
      return;
    }
    delete this.catchUp;
    this.failures = 0;
    // An empty log cannot explain the skew that triggered the request.
    if (log.version !== requested || !log.updates.length) {
      this.fail(new Error(revisionMismatch));
      return;
    }
    if (!this.applyUpdates(log)) {
      return;
    }
    this.status("");
    for (const message of held) {
      this.receive(message);
    }
    queueMicrotask(() => this.pump());
  }
  private applyUpdates(message: UpdatesMessage): boolean {
    try {
      this.view.dispatch(
        receiveUpdates(
          this.view.state,
          message.updates.map((update) => ({
            clientID: update.clientID,
            changes: ChangeSet.fromJSON(update.changes),
          })),
        ),
      );
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }
  pump(): void {
    if (
      this.stopped ||
      this.error ||
      this.catchUp ||
      this.retry ||
      this.view.composing ||
      this.sending
    ) {
      return;
    }
    const updates = sendableUpdates(this.view.state);
    if (!updates.length) {
      this.status("");
      for (const pending of this.waiting.splice(0)) {
        pending.resolve();
      }
      return;
    }
    this.sending = true;
    this.status("Syncing…");
    const group = updates[0]!.origin.annotation(editGroup);
    const end = updates.findIndex(
      (update) => update.origin.annotation(editGroup) !== group,
    );
    const batch = updates.slice(
      0,
      Math.min(512, end < 0 ? updates.length : end),
    );
    void this.rpc
      .call(protocol, "push", {
        version: getSyncedVersion(this.view.state),
        changes: batch.map((update) => update.changes.toJSON() as unknown[]),
        ...(group === undefined ? {} : { group }),
      })
      .then(
        () => {
          this.sending = false;
          this.failures = 0;
          this.pump();
        },
        (error) => {
          this.sending = false;
          this.retryOrFail(error, () => this.pump());
        },
      );
  }
  /**
   * Keep the typing and try again later after a transient failure; stop for
   * good after any other. Waiting flushes fail now with the reason, so a save
   * reports it instead of timing out, while the retry goes on behind it.
   */
  private retryOrFail(error: unknown, again: () => void): void {
    if (this.stopped || this.error) {
      return;
    }
    if (!isTransient(error)) {
      this.fail(error);
      return;
    }
    const reason = `Not synced yet (${String(error)}). Retrying…`;
    this.status(reason);
    for (const pending of this.waiting.splice(0)) {
      pending.reject(new Error(reason));
    }
    this.retry = setTimeout(() => {
      delete this.retry;
      if (!this.stopped && !this.error) {
        again();
      }
    }, this.retryDelay(this.failures++));
  }
  flush(): Promise<void> {
    if (this.error || this.stopped) {
      return Promise.reject(new Error(this.error ?? "Document closed"));
    }
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.pump();
    });
  }
  dispose(): void {
    clearTimeout(this.retry);
    delete this.retry;
    this.stopped = true;
    this.error = "Document closed";
    for (const pending of this.waiting.splice(0)) {
      pending.reject(new Error(this.error));
    }
  }
  /**
   * Stop for good. The editor turns read-only: typing here would never reach
   * the note, and the status line already says to copy the unsent edits.
   */
  private fail(error: unknown): void {
    delete this.catchUp;
    this.error = String(error);
    this.sending = false;
    this.status(this.error);
    for (const pending of this.waiting.splice(0)) {
      pending.reject(new Error(this.error));
    }
    // Not inside the dispatch whose failure may have brought us here.
    queueMicrotask(() =>
      this.view.dispatch({
        effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
      }),
    );
  }
}
