import { saveDocument } from "./save";
import { Authority } from "../../shared/document/authority";
import { textDocument } from "../../shared/document/wire";
import type { Prepared } from "../../shared/document/authority";
import type { HostDocument, HostServices, TextEdit } from "../../shared/host";
import type { Endpoint } from "../../shared/rpc/endpoint";
import { UndoGroups } from "./undo-groups";
import { protocol, updatesFullTextMax } from "./protocol";
import type { DocumentSession } from "./api";
export class Session implements DocumentSession {
  readonly authority: Authority;
  private readonly clients = new Map<string, { rpc: Endpoint; sent: number }>();
  private queue: Promise<unknown> = Promise.resolve();
  private actions: Promise<unknown> = Promise.resolve();
  private expected?: Prepared;
  private readonly groups = new UndoGroups();
  private historyAction = false;
  private lastSaved: string;
  private saveEcho?: string;
  constructor(
    readonly document: HostDocument,
    private readonly host: HostServices,
  ) {
    this.authority = new Authority(document.getText());
    this.lastSaved = document.getText();
  }
  private fingerprint(): string {
    return this.host.hostDocuments.fingerprint(this.text);
  }
  markSaved(text: string): void {
    this.lastSaved = text;
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
        const before = this.fingerprint();
        if (prepared.text.eq(this.authority.doc)) {
          this.authority.record(this.document.getText(), prepared);
          this.broadcast();
          return true;
        }
        const edits: TextEdit[] = [];
        prepared.changes.iterChanges((...change) => {
          const [from, to, , , insert] = change;
          edits.push({
            from,
            to,
            insert: insert.sliceString(0, insert.length, this.document.eol),
          });
        });
        this.expected = prepared;
        try {
          if (!(await this.host.hostDocuments.apply(this.document, edits))) {
            throw new Error("The host could not apply the edit.");
          }
          // Real workbenches fire change before apply resolves. Fakes may not.
          if (this.expected) {
            this.changed();
          }
          this.groups.record(
            before,
            this.fingerprint(),
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
    // A change event with no new text (a dirty-state change; Cursor can send
    // one before an edit lands) must not consume the expected panel edit.
    if (textDocument(hostText).eq(this.authority.doc)) {
      if (this.saveEcho !== undefined && hostText === this.saveEcho) {
        delete this.saveEcho;
      }
      return;
    }
    // Own save can echo as a host rewrite of the same bytes. Record without
    // wiping undo grouping.
    if (this.saveEcho !== undefined && hostText === this.saveEcho) {
      delete this.saveEcho;
      this.authority.record(hostText, this.expected);
      delete this.expected;
      this.broadcast();
      return;
    }
    if (this.expected || this.historyAction) {
      this.authority.record(hostText, this.expected);
      delete this.expected;
      this.broadcast();
      return;
    }
    // Real host rewrite (agent / git / reload). Drop any armed saveEcho so a
    // later identical echo cannot false-match after this external rewrite.
    if (!this.document.isDirty) {
      delete this.saveEcho;
      this.authority.record(hostText);
      this.lastSaved = hostText;
      this.broadcast();
      return; // keep UndoGroups
    }
    // Dirty unexpected host rewrite: keep today's clear + record (slim: no merge).
    delete this.saveEcho;
    this.groups.clear();
    this.authority.record(hostText);
    this.broadcast();
  }
  private broadcast(): void {
    for (const client of this.clients.values()) {
      if (client.sent === this.version) {
        continue;
      }
      const text = this.authority.doc.toString();
      const params = {
        version: client.sent,
        updates: this.authority.since(client.sent),
        ...(text.length <= updatesFullTextMax ? { fullText: text } : {}),
      };
      client.rpc.notify(protocol, "updates", params);
      client.sent = this.version;
    }
  }
  async flush(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((client) =>
        client.rpc.call(protocol, "flush", {}, { timeout: 1200 }),
      ),
    );
    await this.queue;
  }
  async history(action: "undo" | "redo"): Promise<void> {
    this.historyAction = true;
    try {
      await this.groups.run(
        action,
        () => this.fingerprint(),
        () => this.host.hostCommands.execute(action),
      );
    } finally {
      this.historyAction = false;
    }
  }
}
