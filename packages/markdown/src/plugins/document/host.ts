import type { Context, Plugin } from "@workshop/core";
import type { HostDocument } from "../../shared/host";
import { Session, flushDeadline } from "./session";
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
    ctx.on("document/willSave", (session, deadline) =>
      session.flush(undefined, deadline),
    );
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
    registerNativeSaveFlush(ctx, sessions);
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

/**
 * Before VS Code saves a note, bring in every panel's typing. The flush runs
 * twice, in the `document/willSave` listeners and after all of them (a failure
 * of the last one rejects the save). VS Code gives all of a save's listeners
 * one time budget and drops one that overruns it, so both flushes spend the
 * same deadline, set when the save began.
 */
function registerNativeSaveFlush(
  ctx: Context,
  sessions: Map<HostDocument, Entry>,
): void {
  ctx.effect(() =>
    ctx.hostDocuments.onWillSave(async (document) => {
      const session = sessions.get(document)?.session;
      if (session) {
        const deadline = flushDeadline();
        await ctx.serial("document/willSave", session, deadline);
        await session.flush(undefined, deadline);
      }
    }),
  );
}

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
