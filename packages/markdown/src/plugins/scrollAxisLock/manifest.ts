import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";

export const config = Schema.object({
  /** Follows VS Code's `editor.scrollPredominantAxis` for Markdown files. */
  predominantAxis: Schema.boolean().default(true),
});

export default defineManifest({
  id: "scrollAxisLock",
  title: "Axis-locked scrolling",
  description:
    "A trackpad or wheel scroll that is nearly straight up and down or sideways moves the note, its tables and its code blocks along that one axis, following editor.scrollPredominantAxis.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["webview"],
  capabilities: ["editorChrome"],
  config,
  nativeConfigKeys: { predominantAxis: "editor.scrollPredominantAxis" },
} as const);
