import { defineManifest } from "../../shared/manifest";
import { Schema } from "@workshop/core";
export const config = Schema.object({
  /** Follows VS Code's `editor.lineNumbers` for Markdown files. */
  style: Schema.union(["on", "off", "relative", "interval"]).default("on"),
});
export default defineManifest({
  id: "lineNumbers",
  title: "Line numbers",
  description:
    "Line numbers in the Markdown editor, laid out like VS Code's text editor and following editor.lineNumbers.",
  kind: "feature",
  // Off by default, matching Obsidian 1.15.0's hidden line numbers.
  defaultEnabled: false,
  surfaces: ["webview"],
  capabilities: ["editorChrome"],
  config,
  nativeConfigKeys: { style: "editor.lineNumbers" },
} as const);
