import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";
export const config = Schema.object({
  newLinkFormat: Schema.union(["shortest", "relative", "absolute"]).default(
    "shortest",
  ),
  useWikilinks: Schema.boolean().default(true),
  folderNote: Schema.string().default(""),
  focusNewTab: Schema.boolean()
    .default(true)
    .description(
      "Obsidian's Always focus new tabs: when a link opens in a new tab or beside, the new tab takes the keyboard focus. Off keeps the focus where it was (VS Code's preserveFocus); PDFs always take it.",
    ),
  newNoteFolder: Schema.string()
    .default("")
    .description(
      "New notes: empty for vault root, . for current folder, or a vault-relative path.",
    ),
  attachmentFolder: Schema.string()
    .default("")
    .description(
      "Attachment destination policy: empty for vault root, . for current folder, or ./sub. Dropped, pasted, and HTML-paste images are saved here under timestamp names.",
    ),
});
export default defineManifest({
  id: "links",
  title: "Links",
  description: "Follow Markdown links and wikilinks.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host", "webview"],
  capabilities: ["rendering", "vaultIndex", "navigation", "commands"],
  config,
  configKeys: {
    newNoteFolder: "files.newNoteFolder",
    attachmentFolder: "files.attachmentFolder",
  },
  // Only VS Code and Cursor open links in tabs of their own.
  settingNeeds: { focusNewTab: ["workbench"] },
  contributes: {
    commands: [
      {
        id: "insertWikilink",
        title: "Insert Wikilink",
        editorCommand: "editor:insert-wikilink",
      },
      // Obsidian 1.15.0's default keys (owner decision, 2026-11-21). The
      // editor's own keymap binds them too (follow-caret.ts).
      {
        id: "followLink",
        title: "Follow Link",
        editorCommand: "editor:follow-link",
        key: "alt+enter",
      },
      {
        id: "openLinkInNewTab",
        title: "Open Link in New Tab",
        editorCommand: "editor:open-link-in-new-leaf",
        key: "ctrl+enter",
        mac: "cmd+enter",
      },
      {
        id: "openLinkToSide",
        title: "Open Link to Side",
        editorCommand: "editor:open-link-in-new-split",
        key: "ctrl+alt+enter",
        mac: "cmd+alt+enter",
      },
    ],
  },
});
