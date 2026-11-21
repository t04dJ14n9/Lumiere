import { defineManifest } from "../../shared/manifest";
import { SWITCHER_OPEN_CONTEXT } from "./accept";

/** The switcher's own keys apply only inside its quick pick. */
const SWITCHER_KEYS_WHEN = `inQuickOpen && ${SWITCHER_OPEN_CONTEXT}`;

export default defineManifest({
  id: "quickSwitcher",
  title: "Quick switcher",
  description:
    "Find a note by name, alias or path, or create it, like Obsidian's quick switcher.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["vaultIndex", "navigation", "commands"],
  contributes: {
    commands: [
      { id: "quickSwitcher", title: "Quick Switcher", scope: "workbench" },
      // Obsidian's modifier keys in its switcher, live only while it is open
      // (accept.ts). Mod is Cmd on macOS and Ctrl elsewhere, as there.
      {
        id: "quickSwitcher.openInNewTab",
        title: "Quick Switcher: Open in New Tab",
        palette: false,
        key: "ctrl+enter",
        mac: "cmd+enter",
        scope: "workbench",
        when: SWITCHER_KEYS_WHEN,
      },
      {
        id: "quickSwitcher.openToSide",
        title: "Quick Switcher: Open to the Side",
        palette: false,
        key: "ctrl+alt+enter",
        mac: "cmd+alt+enter",
        scope: "workbench",
        when: SWITCHER_KEYS_WHEN,
      },
      {
        id: "quickSwitcher.create",
        title: "Quick Switcher: Create Note",
        palette: false,
        key: "shift+enter",
        scope: "workbench",
        when: SWITCHER_KEYS_WHEN,
      },
      {
        id: "quickSwitcher.createInNewTab",
        title: "Quick Switcher: Create Note in New Tab",
        palette: false,
        key: "ctrl+shift+enter",
        mac: "cmd+shift+enter",
        scope: "workbench",
        when: SWITCHER_KEYS_WHEN,
      },
    ],
  },
} as const);
