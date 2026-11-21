import { defineManifest } from "../../shared/manifest";
export default defineManifest({
  id: "onlineVideos",
  title: "Online Videos",
  description:
    "Embed YouTube videos and tweets written as images (![](link)) as Obsidian does. In an untrusted workspace they show a link card.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["webview"],
  capabilities: ["rendering", "network"],
} as const);
