import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";

export const config = Schema.object({
  open: Schema.union(["workbench", "textEditor"])
    .default("workbench")
    .description(
      "Where a Marp deck opens. textEditor sends it to VS Code's text editor, where Marp's own preview and export run. Keep Marp Deck in Lumiere remembers a deck.",
    ),
});

export default defineManifest({
  id: "marp",
  title: "Marp",
  description: "Detect Marp decks and open Marp's preview or export.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["commands", "fileWrites"],
  needs: ["workbench"],
  config,
  contributes: {
    commands: [
      {
        id: "marp.preview",
        title: "Open Marp Preview to the Side",
        scope: "workbench",
      },
      {
        id: "marp.export",
        title: "Export Marp Slide Deck",
        scope: "workbench",
      },
      {
        id: "marp.toggle",
        title: "Toggle Marp",
        scope: "workbench",
      },
      {
        id: "marp.keepInWorkshop",
        title: "Keep Marp Deck in Lumiere",
        scope: "workbench",
      },
    ],
  },
} as const);
