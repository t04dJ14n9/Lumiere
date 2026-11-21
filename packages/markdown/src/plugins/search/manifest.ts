import { MARKDOWN_EDITOR, whenActive } from "../../shared/editor-provider";
import { defineManifest } from "../../shared/manifest";
import { RESULTS_SHOWN_CONTEXT, SEARCH_VIEW_ID } from "./view-ids";

export default defineManifest({
  id: "search",
  title: "Search",
  description:
    "Render query blocks as live vault search results, and search the vault with Obsidian's syntax in the Vault Search view.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host", "webview"],
  capabilities: ["rendering", "vaultIndex", "views", "commands"],
  contributes: {
    commands: [
      {
        id: "search.vault",
        title: "Search Vault…",
        icon: "$(search)",
        scope: "workbench",
      },
      {
        id: "search.clearResults",
        title: "Clear Search Results",
        icon: "$(clear-all)",
        palette: false,
      },
    ],
    menus: [
      {
        command: "search.vault",
        location: "view/title",
        when: `view == ${SEARCH_VIEW_ID}`,
        group: "navigation@1",
      },
      {
        command: "search.clearResults",
        location: "view/title",
        when: `view == ${SEARCH_VIEW_ID} && ${RESULTS_SHOWN_CONTEXT}`,
        group: "navigation@2",
      },
    ],
    views: [
      {
        id: "search",
        name: "Vault Search",
        scope: "workbench",
        // Beside this editor, as Tags; and once a search has results, until
        // they are cleared, wherever the reader is.
        when: `(${whenActive(MARKDOWN_EDITOR)} || ${RESULTS_SHOWN_CONTEXT})`,
        visibility: "collapsed",
      },
    ],
  },
});
