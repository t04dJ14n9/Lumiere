/**
 * VS Code's `undo` and `redo` commands, outside VS Code. The Markdown
 * plugins run them as the native step under their undo groups
 * (`Session.history`); as in VS Code, they act on the active editor's note.
 */
import type { Disposer } from "@workshop/core";
import type { HostCommands } from "@workshop/markdown/portable";
import type { NoteDocuments } from "./documents";
import type { PanelHub } from "./panels";

export function registerHistoryCommands(
  commands: Pick<HostCommands, "register">,
  panels: Pick<PanelHub, "active">,
  documents: Pick<NoteDocuments, "undoOrRedo">,
): Disposer {
  const stops = (["undo", "redo"] as const).map((action) =>
    commands.register(action, () => {
      // The page asking is the active one: the commands plugin refuses Undo
      // from a page that lost focus before it ran (commands/host.ts). Each
      // note keeps its own steps, so two pages on two notes never share them.
      const panel = panels.active();
      return panel ? documents.undoOrRedo(panel.document, action) : false;
    }),
  );
  return () => {
    for (const stop of stops) {
      void stop();
    }
  };
}
