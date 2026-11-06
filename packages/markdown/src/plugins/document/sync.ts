import {
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
} from "@codemirror/collab";
import { ChangeSet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Endpoint } from "../../shared/rpc/endpoint";
import { protocol } from "./protocol";
import { editGroup } from "./input-annotation";

const revisionMismatch =
  "Document revisions differ. Keep this tab open and copy your edits before reopening.";

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
  private readonly waiting: { resolve(): void; reject(error: Error): void }[] =
    [];
  constructor(
    private readonly view: EditorView,
    private readonly rpc: Endpoint,
    private readonly status: (message: string) => void,
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
    const catchUp = { held: [message] };
    this.catchUp = catchUp;
    this.status("Syncing…");
    void this.rpc.call(protocol, "catchUp", { version }).then(
      (log) => this.finishCatchUp(version, log, catchUp.held),
      (error) => this.fail(error),
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
          this.pump();
        },
        (error) => this.fail(error),
      );
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
    this.stopped = true;
    this.error = "Document closed";
    for (const pending of this.waiting.splice(0)) {
      pending.reject(new Error(this.error));
    }
  }
  private fail(error: unknown): void {
    delete this.catchUp;
    this.error = String(error);
    this.sending = false;
    this.status(this.error);
    for (const pending of this.waiting.splice(0)) {
      pending.reject(new Error(this.error));
    }
  }
}
