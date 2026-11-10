import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";
export const config = Schema.object({
  mode: Schema.union(["prompt", "always", "never"])
    .default("never")
    .description(
      "Obsidian's Automatically update internal links: `never` (the default, matching `alwaysUpdateLinks: false`) leaves links untouched on rename, `always` rewrites them without asking, and `prompt` asks first — its Always Update button then sets this to `always` for the resource.",
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
