import type { Context, Disposer, Plugin } from "@workshop/core";
import { expandTemplate } from "../../markdown/templates";
import { registerReportedCommands } from "../../shared/reported-command";
import { contributionId } from "../../shared/setting-schema";
import type { Vault } from "../vault/api";
import { createDailyNote, type DailyNoteFiles } from "./create";
import {
  adjacentDailyNote,
  dailyNoteKey,
  dailyNotePath,
  type DailyNoteSettings,
} from "./names";

/** **Lumia: Daily Notes**: open or create the note for a day. */
export const dailyNotesHost: Plugin = {
  name: "dailyNotes",
  inject: {
    required: [
      "hostCommands",
      "dialogs",
      "settings",
      "vaults",
      "activeEditor",
      "workspace",
    ],
  },
  apply(ctx) {
    const effect = (setup: () => Disposer) => {
      ctx.effect(setup);
    };
    registerReportedCommands(
      effect,
      ctx.hostCommands,
      (message) => ctx.dialogs.error(message),
      [
        {
          id: contributionId("dailyNotes.openToday"),
          run: () => openToday(ctx),
        },
        {
          id: contributionId("dailyNotes.openPrevious"),
          run: () => openAdjacent(ctx, -1),
        },
        {
          id: contributionId("dailyNotes.openNext"),
          run: () => openAdjacent(ctx, 1),
        },
      ],
    );
  },
};

interface DailyNotesPlace {
  readonly vault: Vault;
  readonly settings: DailyNoteSettings;
  /** The active note's vault path, when it is in this vault. */
  readonly activePath?: string;
}

/** The active note's vault (else the workspace's) and its daily-note settings. */
async function locate(ctx: Context): Promise<DailyNotesPlace | undefined> {
  const active = ctx.activeEditor.note();
  const located = active ? await ctx.vaults.locate(active) : undefined;
  const vault = located?.vault ?? (await ctx.vaults.forWorkspace());
  if (!vault) {
    ctx.dialogs.error("Open a folder to use daily notes.");
    return undefined;
  }
  // Obsidian's daily-notes.json reaches these settings once prepared.
  const resource = located && active ? active : `${vault.index.root}/`;
  await ctx.settings.effective.prepare(resource);
  const get = (key: string) =>
    ctx.settings.effective.get(`dailyNotes.${key}`, "", resource);
  return {
    vault,
    settings: {
      folder: get("folder"),
      dateFormat: get("dateFormat"),
      template: get("template"),
    },
    ...(located ? { activePath: located.path } : {}),
  };
}

async function openToday(ctx: Context): Promise<void> {
  const place = await locate(ctx);
  if (!place) {
    return;
  }
  const now = new Date();
  const path = dailyNotePath(place.settings, now);
  if (!path) {
    ctx.dialogs.error("The daily notes folder must stay inside the vault.");
    return;
  }
  const uri = await createDailyNote(dailyNoteFiles(ctx, place.vault), {
    path,
    template: place.settings.template,
    expand: (text, title) =>
      expandTemplate(text, {
        title,
        now,
        dateFormat: place.settings.dateFormat,
      }),
  });
  if (uri) {
    await ctx.vaults.open(uri);
  }
}

async function openAdjacent(ctx: Context, direction: -1 | 1): Promise<void> {
  const place = await locate(ctx);
  if (!place) {
    return;
  }
  const today = dailyNotePath(place.settings, new Date());
  const reference =
    (place.activePath && dailyNoteKey(place.activePath, place.settings)) ||
    (today && dailyNoteKey(today, place.settings));
  if (!reference) {
    ctx.dialogs.error("The daily note format cannot be compared by date.");
    return;
  }
  const paths = place.vault.index.files().map((file) => file.path);
  const path = adjacentDailyNote(paths, place.settings, reference, direction);
  const file = path ? place.vault.index.file(path) : undefined;
  if (!file) {
    ctx.dialogs.inform(
      direction < 0 ? "No earlier daily note." : "No later daily note.",
    );
    return;
  }
  await ctx.vaults.open(file.uri);
}

function dailyNoteFiles(ctx: Context, vault: Vault): DailyNoteFiles {
  return {
    root: vault.index.root,
    files: ctx.workspace.files,
    isIndexed: (path) => vault.index.file(path) !== undefined,
    inform: (message) => ctx.dialogs.inform(message),
    error: (message) => ctx.dialogs.error(message),
  };
}
