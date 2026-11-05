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

export class Synchronizer {
  private sending = false;
  private stopped = false;
  error?: string;
  private readonly waiting: { resolve(): void; reject(error: Error): void }[] =
    [];
  constructor(
    private readonly view: EditorView,
    private readonly rpc: Endpoint,
    private readonly status: (message: string) => void,
  ) {}
  receive(message: {
    version: number;
    updates: { clientID: string; changes: unknown }[];
  }): void {
    const synced = getSyncedVersion(this.view.state);
    if (message.version !== synced) {
      if (
        !message.updates.length ||
        message.updates.some((update) => update.clientID !== "host")
      ) {
        this.fail(new Error(revisionMismatch));
        return;
      }
      this.applyHostReset(message);
      return;
    }
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
    } catch (error) {
      this.fail(error);
    }
    queueMicrotask(() => this.pump());
  }
  /**
   * Host-only updates arrived against a different collab version than this
   * panel's. Replace the doc in one `userEvent: "set"` and jump the collab
   * synced version to `message.version + updates.length` so the panel stays
   * usable instead of dying with the reopen/copy error.
   */
  private applyHostReset(message: {
    version: number;
    updates: { clientID: string; changes: unknown }[];
  }): void {
    try {
      const parsed = message.updates.map((update) => ({
        clientID: update.clientID,
        changes: ChangeSet.fromJSON(update.changes),
      }));
      let doc = this.view.state.doc;
      for (const update of parsed) {
        doc = update.changes.apply(doc);
      }
      const target = doc.toString();
      const synced = getSyncedVersion(this.view.state);
      const nextVersion = message.version + parsed.length;

      // One full-document replace; single undoable set on the view.
      this.view.dispatch({
        changes: {
          from: 0,
          to: this.view.state.doc.length,
          insert: target,
        },
        userEvent: "set",
      });

      // Confirm the local set (and any prior unconfirmed) via matching
      // clientIDs, then pad with host no-ops so synced version == nextVersion.
      const pending = sendableUpdates(this.view.state).map((update) => ({
        clientID: update.clientID,
        changes: update.changes,
      }));
      const afterConfirm = synced + pending.length;
      const fillers: { clientID: string; changes: ChangeSet }[] = [];
      if (nextVersion > afterConfirm) {
        const noop = ChangeSet.empty(this.view.state.doc.length);
        for (let i = afterConfirm; i < nextVersion; i++) {
          fillers.push({ clientID: "host", changes: noop });
        }
      }
      const batch = [...pending, ...fillers];
      if (batch.length) {
        this.view.dispatch(receiveUpdates(this.view.state, batch));
      }

      this.error = undefined;
      this.status("");
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(revisionMismatch));
      return;
    }
    queueMicrotask(() => this.pump());
  }
  pump(): void {
    if (this.stopped || this.error || this.view.composing || this.sending) {
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
    this.error = String(error);
    this.sending = false;
    this.status(this.error);
    for (const pending of this.waiting.splice(0)) {
      pending.reject(new Error(this.error));
    }
  }
}
