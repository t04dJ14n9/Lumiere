import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";
export const config = Schema.object({
  rootMarkers: Schema.array(Schema.string())
    .default([".obsidian"])
    .description(
      "A folder containing one of these entries is a vault root; without one, the workspace folder is the vault.",
    ),
  excludedFiles: Schema.array(Schema.string())
    .default([])
    .description(
      "Obsidian's Excluded files: path prefixes such as `Archive/`, or globs such as `**/*.excalidraw.md`. Excluded files stay linkable but are left out of the quick switcher, suggestions, search and unlinked mentions.",
    ),
  showUnsupportedFiles: Schema.boolean()
    .default(false)
    .description(
      "Obsidian's Show all file types: the quick switcher also finds files Obsidian cannot open (such as .csv or .zip), not only notes and the attachments it opens. Link suggestions already list every file, and the Explorer is VS Code's.",
    ),
});
export default defineManifest({
  id: "vault",
  title: "Vault",
  description: "Vault index: files, metadata, link resolution and backlinks.",
  kind: "core",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["vaultIndex"],
  config,
} as const);
