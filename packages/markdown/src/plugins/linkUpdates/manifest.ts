import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";
export const config = Schema.object({
  mode: Schema.union(["prompt", "always", "never"])
    .default("prompt")
    .description(
      "Obsidian's Automatically update internal links: `prompt` (the default, matching `alwaysUpdateLinks: false`) asks before rewriting links in other notes when a file is renamed or moved; its Always Update button sets this to `always`, `always` rewrites without asking, and `never` leaves links untouched.",
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
    commands: [
      { id: "renameHeading", title: "Rename Heading…", scope: "workbench" },
    ],
  },
} as const);
