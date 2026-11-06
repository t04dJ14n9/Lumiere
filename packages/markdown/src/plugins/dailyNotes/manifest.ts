import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";

export const config = Schema.object({
  folder: Schema.string()
    .default("")
    .description(
      "Vault-relative folder for daily notes. Empty puts them at the vault root.",
    ),
  dateFormat: Schema.string()
    .default("YYYY-MM-DD")
    .description(
      "File name of a daily note. Tokens: YYYY, MM, DD, HH, mm and ss; a / makes subfolders.",
    ),
  template: Schema.string()
    .default("")
    .description(
      "Vault-relative path of the template for new daily notes, with or without .md. Empty creates an empty note.",
    ),
});

export default defineManifest({
  id: "dailyNotes",
  title: "Daily Notes",
  description:
    "Open or create today's note from a template, like Obsidian's Daily notes.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["commands", "vaultIndex", "navigation", "fileWrites"],
  config,
  contributes: {
    commands: [
      {
        id: "dailyNotes.openToday",
        title: "Open Today's Daily Note",
        scope: "workbench",
      },
      {
        id: "dailyNotes.openPrevious",
        title: "Open Previous Daily Note",
        scope: "workbench",
      },
      {
        id: "dailyNotes.openNext",
        title: "Open Next Daily Note",
        scope: "workbench",
      },
    ],
  },
} as const);
