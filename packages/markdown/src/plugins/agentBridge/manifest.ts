import { defineManifest } from "../../shared/manifest";
export default defineManifest({
  id: "agentBridge",
  title: "Copy link to this",
  description:
    "Copy selected text with a link to its saved source lines, for an agent.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host", "webview"],
  capabilities: ["agentHandoff", "clipboard", "commands"],
  contributes: {
    menus: [
      {
        command: "copyLinkForAgent",
        location: "webview/context",
        when: "webviewSection == 'markdownContent' && lumiere.markdown.hasSelection",
        // Rank ahead of other webview/context items (matches PDF 0_agent@1).
        group: "0_agent@1",
      },
    ],
    commands: [
      {
        id: "copyLinkForAgent",
        title: "Copy link to this",
        icon: "$(comment-discussion)",
        editorCommand: "copyLinkForAgent",
      },
    ],
  },
});
