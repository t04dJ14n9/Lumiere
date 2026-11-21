import { saveDocument } from "./save";
import { Authority } from "../../shared/document/authority";
import { textDocument } from "../../shared/document/wire";
import type { Prepared } from "../../shared/document/authority";
import type { Text } from "@codemirror/state";
import type { HostDocument, HostServices, TextEdit } from "../../shared/host";
import { RpcError, type Endpoint } from "../../shared/rpc/endpoint";
import { UndoGroups } from "./undo-groups";
import { protocol } from "./protocol";
import type { DocumentSession } from "./api";
export class Session implements DocumentSession {
  readonly authority: Authority;
  private readonly clients = new Map<string, { rpc: Endpoint; sent: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private actions: Promise<unknown> = Promise.resolve();
  private expected?: Prepared;
  /**
   * Undo checkpoints name the note's text by its immutable `Text`, compared
   * by content only when Undo or Redo runs: typing hashes nothing. The
   * authority's successive texts share their unchanged parts, so a
   * checkpoint keeps little more than what its step changed, and comparing
   * two of them skips what they share.
   */
  private readonly groups = new UndoGroups<Text>((left, right) =>
    left.eq(right),
  );
  private historyAction = false;
  private saveEcho?: string;
  constructor(
    readonly document: HostDocument,
    private readonly host: HostServices,
  ) {
    this.authority = new Authority(document.getText());
  }
  markSaved(text: string): void {
    this.saveEcho = text;
  }
  async save(): Promise<boolean> {
    const ok = await saveDocument(this.document, this.host);
    if (ok) {
      this.markSaved(this.document.getText());
    }
    return ok;
  }
  withAction<T>(action: () => Promise<T>): Promise<T> {
    const result = this.actions.then(action);
    this.actions = result.catch(() => {});
    return result;
  }
  get text(): string {
    return this.authority.doc.toString();
  }
  get version(): number {
    return this.authority.version;
  }
  mapOffsets(version: number, offsets: readonly number[]): readonly number[] {
    return this.authority.mapOffsets(version, offsets);
  }
  attach(id: string, rpc: Endpoint) {
    if (this.clients.has(id)) {
      throw new Error("Duplicate panel");
    }
    const client = { rpc, sent: this.version };
    this.clients.set(id, client);
    const stop = rpc.handle(protocol, "push", (params) => {
      const request = this.queue.then(async () => {
        const prepared = this.authority.prepare(
          params.version,
          params.changes,
          id,
        );
        if (!prepared) {
          return true;
        }
        const before = this.authority.doc;
        if (prepared.text.eq(this.authority.doc)) {
          this.authority.record(this.document.getText(), prepared);
          this.broadcast();
          return true;
        }
        const edits = this.hostEdits(prepared);
        this.expected = prepared;
        try {
          if (!(await this.host.hostDocuments.apply(this.document, edits))) {
            // The panel keeps the edit and sends it again (sync.ts).
            throw new RpcError(
              "ApplyRefused",
              "The host could not apply the edit.",
            );
          }
          // Real workbenches fire change before apply resolves. Fakes may not.
          if (this.expected) {
            this.changed();
          }
          this.groups.record(
            before,
            this.authority.doc,
            params.group === undefined ? undefined : `${id}/${params.group}`,
          );
        } finally {
          delete this.expected;
        }
        return true;
      });
      this.queue = request.catch(() => {});
      return request;
    });
    const stopCatchUp = this.serveCatchUp(client);
    return async () => {
      this.clients.delete(id);
      await stopCatchUp();
      await stop();
    };
  }
  /** The prepared changes as edits to the host document, in its line endings. */
  private hostEdits(prepared: Prepared): TextEdit[] {
    const edits: TextEdit[] = [];
    prepared.changes.iterChanges((...change) => {
      const [from, to, , , insert] = change;
      edits.push({
        from,
        to,
        insert: insert.sliceString(0, insert.length, this.document.eol),
      });
    });
    return edits;
  }
  /**
   * A panel whose version differs from `client.sent` missed a broadcast, and
   * only the revision log can tell which of its unsent edits the host already
   * has. The answer covers everything up to now, so broadcasts resume from there.
   */
  private serveCatchUp(client: { rpc: Endpoint; sent: number }) {
    return client.rpc.handle(protocol, "catchUp", ({ version }) => {
      const updates = this.authority.since(version);
      client.sent = this.version;
      return { version, updates };
    });
  }
  changed(): void {
    const hostText = this.document.getText();
    // Built once: on a large note each build is a pass over the whole text.
    const hostDocument = textDocument(hostText);
    // A change event with no new text (a dirty-state change; Cursor can send
    // one before an edit lands) must not consume the expected panel edit.
    if (hostDocument.eq(this.authority.doc)) {
      if (this.saveEcho !== undefined && hostText === this.saveEcho) {
        delete this.saveEcho;
      }
      return;
    }
    // Own save can echo as a host rewrite of the same bytes. Record without
    // wiping undo grouping.
    if (this.saveEcho !== undefined && hostText === this.saveEcho) {
      delete this.saveEcho;
      this.authority.record(hostDocument, this.expected);
      delete this.expected;
      this.broadcast();
      return;
    }
    if (this.expected || this.historyAction) {
      this.authority.record(hostDocument, this.expected);
      delete this.expected;
      this.broadcast();
      return;
    }
    // Real host rewrite (agent / git / reload). Drop any armed saveEcho so a
    // later identical echo cannot false-match after this external rewrite.
    if (!this.document.isDirty) {
      delete this.saveEcho;
      this.authority.record(hostDocument);
      this.broadcast();
      return; // keep UndoGroups
    }
    // The document changed under unsaved edits, and its text is the whole
    // truth: a formatter, an agent or another extension edited the live buffer
    // (VS Code), or a host that owns its files merged an outside rewrite of
    // the file into the unsaved text (`mergeDiskChange`). Either way the
    // unsaved text is already in it, so merging here again would undo the
    // other change wherever the two overlap. VS Code never reloads a dirty
    // note from disk (it reports a conflict on save), so a rewrite of the file
    // never reaches this branch there. The groups do not know this edit, so grouping starts afresh.
    delete this.saveEcho;
    this.groups.clear();
    this.authority.record(hostDocument);
    this.broadcast();
  }
  private broadcast(): void {
    for (const client of this.clients.values()) {
      if (client.sent === this.version) {
        continue;
      }
      client.rpc.notify(protocol, "updates", {
        version: client.sent,
        updates: this.authority.since(client.sent),
      });
      client.sent = this.version;
    }
  }
  /**
   * Bring in every panel's unsent typing. Only the failure of `origin`, the
   * panel asking, rejects: another panel of the note that cannot answer (busy,
   * or stopped syncing) must not make Save, Undo or Redo fail in this one.
   */
  async flush(origin?: string): Promise<void> {
    await Promise.all(
      [...this.clients].map(([id, client]) => {
        const flushed = client.rpc.call(
          protocol,
          "flush",
          {},
          { timeout: 1200 },
        );
        return id === origin ? flushed : flushed.catch(() => false);
      }),
    );
    await this.queue;
  }
  async history(action: "undo" | "redo"): Promise<void> {
    this.historyAction = true;
    try {
      await this.groups.run(
        action,
        () => this.authority.doc,
        () => this.host.hostCommands.execute(action),
      );
    } finally {
      this.historyAction = false;
    }
  }
}
