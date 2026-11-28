import type { Context, Plugin } from "@workshop/core";
import { noteRevision } from "../../shared/git";
import type { PanelShell } from "../../shared/host";
import type {} from "../vault/api";
import { NoteResources } from "./note-resources";
import { protocol } from "./protocol";
import { atRevision } from "./revision-image";
export const resourcesHost: Plugin<{ panel: PanelShell }> = {
  name: "resources",
  inject: { required: ["rpc", "vault", "workspace", "hostDocuments", "git"] },
  provides: ["resources"],
  apply(ctx, { panel }) {
    // A note from Git history resolves its links as its file does.
    const note = noteRevision(ctx.git, panel.document.uri);
    const resources = new NoteResources({
      source: note.source,
      vault: ctx.vault,
      host: ctx,
      resourceUrl: (uri) => panel.resource(uri),
    });
    ctx.provide("resources", resources);
    ctx.effect(() =>
      ctx.rpc.handle(protocol, "load", async (params) => {
        const resource = await resources.load(
          params.target,
          params.source === panel.document.uri ? note.source : params.source,
          params.syntax,
          params.snapshot,
        );
        return note.ref === undefined
          ? resource
          : atRevision(resource, note.ref, ctx);
      }),
    );
    // Any change can change a base's entries (a note's properties, links
    // or backlinks); the index also resolves again after silent updates.
    const changed = () => resources.vaultChanged();
    ctx.effect(() => ctx.vault.onDidChange(changed));
    ctx.effect(() => ctx.vault.onDidResolve(changed));
    reportFoundFiles(ctx, resources);
    reportChangedFiles(ctx, resources);
  },
};

/**
 * Changes are gathered this long into one notice: a sync or a save that
 * touches several shown files, or a burst of index events, reloads once.
 */
export const CHANGED_NOTICE_DELAY_MS = 100;

/**
 * Tell the page when a file it shows changes: edited in another editor
 * (the index re-reads unsaved text after each typing pause), rewritten by
 * another app, moved or removed. Its embeds show the new version.
 */
function reportChangedFiles(ctx: Context, resources: NoteResources): void {
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  ctx.effect(() => () => clearTimeout(timer));
  const send = () => {
    timer = undefined;
    const sources = [...changed].slice(0, 1024);
    changed.clear();
    ctx.rpc.notify(protocol, "changed", { sources });
  };
  ctx.effect(() =>
    ctx.vault.onDidChange((change) => {
      const source = resources.changedSource(change);
      if (source !== undefined) {
        changed.add(source);
        timer ??= setTimeout(send, CHANGED_NOTICE_DELAY_MS);
      }
    }),
  );
}

/**
 * Tell the page when a file it could not show is in the vault after all:
 * synced from another device, written by another app, or by a plugin a
 * moment after it embedded the file. The index learns of a file by its
 * event, or silently while it catches up after start-up, and then says it
 * has resolved links.
 */
function reportFoundFiles(ctx: Context, resources: NoteResources): void {
  const check = async () => {
    // The index first; the disk then finds what the index never lists.
    const isFound =
      resources.takeFound() || (await resources.takeFoundOnDisk());
    if (isFound && ctx.isLive) {
      ctx.rpc.notify(protocol, "found", {}, { coalesce: true });
    }
  };
  ctx.effect(() =>
    ctx.vault.onDidChange((change) => {
      if (change.type === "create" || change.type === "rename") {
        void check();
      }
    }),
  );
  ctx.effect(() => ctx.vault.onDidResolve(() => void check()));
}
