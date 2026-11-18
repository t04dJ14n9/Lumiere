import type { Context, Disposer, Plugin } from "@workshop/core";
import { registerReportedCommands } from "../../shared/reported-command";
import { contributionId } from "../../shared/setting-schema";
import { asString, asStrings } from "../../shared/values";
import { createScratchNote } from "./run";

/** Temporary notes in the scratch folder. */
export const scratchHost: Plugin = {
  name: "scratch",
  inject: {
    required: ["hostCommands", "dialogs", "workspace", "settings"],
  },
  apply(ctx) {
    const effect = (setup: () => Disposer) => {
      ctx.effect(setup);
    };
    const report = (message: string) => ctx.dialogs.error(message);
    registerReportedCommands(effect, ctx.hostCommands, report, [
      { id: contributionId("scratch.new"), run: () => newScratch(ctx) },
    ]);
  },
};

async function newScratch(ctx: Context): Promise<void> {
  const root = asStrings(ctx.workspace.folders())[0];
  if (!root) {
    ctx.dialogs.error("Open a folder before creating a scratch note.");
    return;
  }
  const title = await ctx.dialogs.input({
    prompt: "Scratch note title",
    value: "Untitled",
    validate: (value) => (value.trim() ? undefined : "Enter a title."),
  });
  if (typeof title !== "string" || title.trim() === "") {
    return;
  }
  await createScratchNote(
    {
      files: ctx.workspace.files,
      rootUri: root,
      execute: (id: string, ...args: unknown[]) =>
        ctx.hostCommands.execute(id, ...args),
      inform: (message: string) => ctx.dialogs.inform(message),
      error: (message: string) => ctx.dialogs.error(message),
    },
    {
      title: title.trim(),
      at: new Date().toISOString(),
      folder:
        asString(ctx.settings.get("scratch.folder", "scratch")) || "scratch",
    },
  );
}
