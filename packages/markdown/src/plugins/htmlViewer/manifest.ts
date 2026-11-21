import { defineManifest } from "../../shared/manifest";

export default defineManifest({
  id: "htmlViewer",
  title: "HTML Viewer",
  description:
    "Open a vault's HTML file from a link, or an HTML embed's Open button, as a page in a tab of its own, in a trusted workspace.",
  kind: "feature",
  defaultEnabled: true,
  surfaces: ["host"],
  capabilities: ["commands", "resourceLoading"],
  needs: ["panels"],
  contributes: {
    commands: [
      {
        // Called by link navigation with the file, so not offered in the palette.
        id: "htmlViewer.open",
        title: "Open HTML File",
        scope: "workbench",
        palette: false,
      },
    ],
  },
} as const);
