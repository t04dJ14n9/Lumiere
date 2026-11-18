import type { Context, Plugin } from "@workshop/core";
import type { HostDocument } from "../../shared/host";
import { Session } from "./session";
import { Autosave } from "./autosave";
import type { Documents } from "./api";
/** A document's session, kept while panels use it, with its autosave countdown. */
interface Entry {
  session: Session;
  autosave: Autosave;
  references: number;
}
export const documentHost: Plugin = {
  name: "document",
  inject: { required: ["hostDocuments", "hostCommands", "settings"] },
  provides: ["documents"],
  apply(ctx) {
    const sessions = new Map<HostDocument, Entry>();
    const documents: Documents = {
      session(document) {
        let entry = sessions.get(document);
        if (!entry) {
          entry = openEntry(ctx, document);
          sessions.set(document, entry);
        }
        entry.references++;
        return entry.session;
      },
      release(document) {
        const entry = sessions.get(document);
        if (entry && --entry.references <= 0) {
          // With no panel left, an unsaved note is VS Code's to ask about.
          entry.autosave.dispose();
          sessions.delete(document);
        }
      },
    };
    ctx.provide("documents", documents);
    ctx.on("document/willSave", (session) => session.flush());
    ctx.effect(() =>
      ctx.hostDocuments.onChange((document, changes) => {
        const entry = sessions.get(document);
        if (entry) {
          entry.session.changed();
          // An event with no edits only reports a flag, such as dirty.
          if (changes === undefined || changes.length > 0) {
            entry.autosave.edited();
          }
          ctx.emit("document/changed", entry.session, changes);
        }
      }),
    );
    ctx.effect(() =>
      ctx.hostDocuments.onWillSave(async (document) => {
        const session = sessions.get(document)?.session;
        if (session) {
          await ctx.serial("document/willSave", session);
          await session.flush();
        }
      }),
    );
    ctx.effect(() =>
      ctx.hostDocuments.onSave((document) => {
        const session = sessions.get(document)?.session;
        if (session) {
          session.markSaved(document.getText());
        }
      }),
    );
    ctx.effect(() => () => {
      for (const entry of sessions.values()) {
        entry.autosave.dispose();
      }
      sessions.clear();
    });
  },
};

function openEntry(ctx: Context, document: HostDocument): Entry {
  const session = new Session(document, ctx);
  const autosave = new Autosave({
    document,
    settings: ctx.settings,
    save: () => session.save(),
    logger: ctx.logger,
  });
  return { session, autosave, references: 0 };
}
