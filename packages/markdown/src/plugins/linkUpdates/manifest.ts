import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";
export const config = Schema.object({
  mode: Schema.union(["prompt", "always", "never"])
    .default("prompt")
    .description(
      "Obsidian's Automatically update internal links: `prompt` (the default, matching `alwaysUpdateLinks: false`) asks before rewriting links in other notes when a file is renamed or moved; its Always Update button sets this to `always` for the note's workspace folder, `always` rewrites without asking, and `never` leaves links untouched.",
    ),
});
export default defineManifest({
  id: "linkUpdates",
  title: "Link updates",
  description:
    "Update links in other notes when a note or attachment is renamed or moved in VS Code.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["vaultIndex", "fileWrites", "commands"],
  config,
  contributes: {
    menus: [
      {
        command: "renameHeading",
        location: "webview/context",
        // Obsidian's editor menu offers Rename heading on a heading line;
        // the editor stamps the key when the menu opens (menu-context.ts).
        when: "webviewSection == 'markdownContent' && lumiere.markdown.selectionOnHeading",
        group: "1_heading@1",
      },
    ],
    commands: [
      { id: "renameHeading", title: "Rename Heading…", scope: "workbench" },
    ],
  },
} as const);
