import type { Context, Plugin } from "@workshop/core";
import type { PanelShell } from "../../shared/host";
import { NoteFoldStore, type FoldPanel } from "./note-store";
import { protocol } from "./protocol";

/** Which open panel holds each note's folds, for every panel in the window. */
const writers = new Map<string, FoldPanel>();

/** Keeps a note's folds for the note, so a panel that opens it gets them. */
export const foldingHost: Plugin<{ panel: PanelShell }> = {
  name: "folding",
  inject: { required: ["rpc", "storage"] },
  apply(ctx, { panel }) {
    registerNoteFolds(
      ctx,
      new NoteFoldStore(ctx.storage, writers),
      panel.document.uri,
    );
  },
};

function registerNoteFolds(
  ctx: Context,
  store: NoteFoldStore,
  note: string,
): void {
  // The panel's own identity: one note can be open in two panels.
  const self = {};
  store.open(note, self);
  ctx.effect(() => () => store.close(note, self));
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "load", () => {
      const folds = store.read(note);
      return folds ? { folds } : {};
    }),
  );
  ctx.effect(() =>
    ctx.rpc.handle(protocol, "save", (change) =>
      store.save(note, self, change),
    ),
  );
}
