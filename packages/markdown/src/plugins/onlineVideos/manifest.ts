import { defineManifest } from "../../shared/manifest";
export default defineManifest({
  id: "onlineVideos",
  title: "Online Videos",
  description: "Show YouTube links embedded as images as video cards.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["webview"],
  capabilities: ["rendering", "network"],
} as const);
