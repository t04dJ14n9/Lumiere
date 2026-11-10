import { defineManifest } from "../../shared/manifest";
export default defineManifest({
  id: "inlineTitle",
  title: "Inline title",
  description: "Show and rename the note title above its Markdown content.",
  kind: "feature",
  // On by default, matching Obsidian 1.15.0's "Show inline title".
  defaultEnabled: true,
  surfaces: ["host", "webview"],
  capabilities: ["rendering", "fileWrites"],
});
