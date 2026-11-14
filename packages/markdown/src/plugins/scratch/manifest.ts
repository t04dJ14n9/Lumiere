import { Schema } from "@workshop/core";
import { defineManifest } from "../../shared/manifest";

export const config = Schema.object({
  folder: Schema.string()
    .default("scratch")
    .description(
      "Project-relative folder for scratch notes. The folder is created when you create a note.",
    ),
});

export default defineManifest({
  id: "scratch",
  title: "Scratch",
  description: "Temporary notes in a scratch folder.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["commands", "fileWrites"],
  config,
  contributes: {
    commands: [
      {
        id: "scratch.new",
        title: "New Scratch Note",
        scope: "workbench",
      },
    ],
  },
} as const);
