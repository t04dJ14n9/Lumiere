import { defineManifest } from "../../shared/manifest";

/** The webview command behind the Look Up menu item (webview.ts registers it). */
export const LOOK_UP_COMMAND = "editor:look-up";

export default defineManifest({
  id: "lookUp",
  title: "Look Up",
  description:
    "macOS: Look Up in a note's right-click menu opens the word in the Dictionary app.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host", "webview"],
  capabilities: ["commands"],
  // VS Code's window: its `isMac` key shows the menu item, and it hands the
  // `dict:` URL to macOS. host-node's menu has no `isMac`, so the item could
  // never show there; the plugin stays off.
  needs: ["workbench"],
  contributes: {
    menus: [
      {
        command: "lookUp",
        location: "webview/context",
        when: "isMac && webviewSection == 'markdownContent'",
        // The first section, after Copy Link for Agent (0_agent@1) and
        // Selection Actions (0_agent@2), as the PDF's Look Up follows its
        // Copy Link for Agent; macOS also puts Look Up at a menu's top.
        group: "0_agent@3",
      },
    ],
    commands: [
      {
        id: "lookUp",
        title: "Look Up",
        editorCommand: LOOK_UP_COMMAND,
        // It acts on the word the menu opened on; the palette has none.
        palette: false,
      },
    ],
  },
});
