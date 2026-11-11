import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";
/** Preparatory schema for #701. Not part of active manifest.config until a plugin reads it. */
export const reservedConfig = Schema.object({
  showUnsupportedFiles: Schema.boolean()
    .default(false)
    .description(
      "Reserved schema for Obsidian's Show all file types (default false). Not read yet; not a live setting.",
    ),
});
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
