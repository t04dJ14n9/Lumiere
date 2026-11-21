import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";

export const config = Schema.object({
  folder: Schema.string()
    .default("")
    .description(
      "Vault-relative folder of template notes. Insert Template lists the Markdown files in it.",
    ),
  dateFormat: Schema.string()
    .default("YYYY-MM-DD")
    .description(
      "Format of {{date}} in templates and of Insert Current Date. Tokens: YYYY, MM, DD, HH, mm and ss.",
    ),
  timeFormat: Schema.string()
    .default("HH:mm")
    .description(
      "Format of {{time}} in templates and of Insert Current Time. Tokens: YYYY, MM, DD, HH, mm and ss.",
    ),
});

export default defineManifest({
  id: "templates",
  title: "Templates",
  description:
    "Insert a note from your templates folder at the caret, like Obsidian's Templates.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["commands", "vaultIndex"],
  config,
  contributes: {
    commands: [
      {
        id: "templates.insert",
        title: "Insert Template",
        // The editor host sets no plugin key for a window feature, so only
        // the setting and the open editor decide.
        scope: "workbench",
        when: "activeCustomEditorId == 'lumiere.markdown.editor'",
      },
      // Obsidian's Insert current date and time: no default keys there.
      {
        id: "templates.insertCurrentDate",
        title: "Insert Current Date",
        scope: "workbench",
        when: "activeCustomEditorId == 'lumiere.markdown.editor'",
      },
      {
        id: "templates.insertCurrentTime",
        title: "Insert Current Time",
        scope: "workbench",
        when: "activeCustomEditorId == 'lumiere.markdown.editor'",
      },
    ],
  },
} as const);
