import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";

export const config = Schema.object({
  deleteUnlinkedAttachments: Schema.union(["ask", "always", "never"])
    .default("ask")
    .description(
      "Obsidian's Delete attachments when deleting files: when notes are deleted in VS Code, `ask` offers to delete the attachments only they linked, `always` deletes them (to the trash while files.enableTrash is on), and `never` leaves them. Deleting a folder does not offer; neither does a deletion made outside VS Code.",
    ),
});

export default defineManifest({
  id: "attachments",
  title: "Attachments",
  description:
    "Save dropped, pasted, and HTML-paste images into the vault attachment folder with Obsidian-style embeds.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host", "webview"],
  capabilities: ["editing", "clipboard", "fileWrites", "commands"],
  config,
  // Only VS Code and Cursor report the deletions made in their Explorer.
  settingNeeds: { deleteUnlinkedAttachments: ["workbench"] },
  contributes: {
    commands: [
      {
        id: "downloadAttachments",
        title: "Download Attachments for Current File",
      },
    ],
  },
} as const);
