import { defineManifest } from "../../shared/manifest";
// The id is the plugin's setting key (`plugins.onlineVideos.enabled`), kept
// from when it also carded video sites, so no setting changes.
export default defineManifest({
  id: "onlineVideos",
  title: "Embedded tweets",
  description:
    "Embed tweets written as images (![](link)) as Obsidian does. In an untrusted workspace they show a link card.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["webview"],
  capabilities: ["rendering", "network"],
} as const);
