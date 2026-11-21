import { defineManifest } from "../../shared/manifest";
export default defineManifest({
  id: "tasks",
  title: "Tasks",
  description: "Interactive checkboxes and checklist commands.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host", "webview"],
  capabilities: ["rendering", "editing", "commands", "keybindings"],
  contributes: {
    keybindings: [
      {
        // Obsidian 1.15.0's default. In Cursor the key opens the chat
        // (through the Cursor bridge), so it is not bound there.
        id: "toggleChecklist",
        key: "ctrl+l",
        mac: "cmd+l",
        when: "!lumiere.markdown.isCursorHost",
      },
    ],
    commands: [
      {
        id: "toggleChecklist",
        title: "Toggle Checklist Status",
        editorCommand: "editor:toggle-checklist-status",
      },
      {
        id: "cycleListChecklist",
        title: "Cycle List Checklist",
        editorCommand: "editor:cycle-list-checklist",
      },
    ],
  },
});
