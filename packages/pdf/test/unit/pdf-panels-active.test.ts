import assert from "node:assert/strict";
import { test } from "node:test";
import { PdfViewerPanels } from "../../src/host/viewer/panels";
import { loadModule } from "./support/load-module";

/** A `vscode.Uri` that keeps a fragment, as VS Code's does. */
class Uri {
  constructor(
    readonly path: string,
    readonly fragment = "",
  ) {}
  with({ fragment }: { fragment: string }): Uri {
    return new Uri(this.path, fragment);
  }
  toString(): string {
    return `file://${this.path}${this.fragment ? `#${this.fragment}` : ""}`;
  }
}

class TabInputCustom {
  constructor(
    readonly uri: Uri,
    readonly viewType: string,
  ) {}
}

const subscription = () => ({ dispose: () => undefined });

/** `PdfPanels` with the active tab showing `opened` in the first group. */
function panelsShowing(opened: Uri) {
  const { PdfPanels } = loadModule(
    new URL("../../src/extension/plugins/pdf/panels.ts", import.meta.url),
    {
      vscode: {
        TabInputCustom,
        commands: { executeCommand: async () => undefined },
        window: {
          tabGroups: {
            activeTabGroup: {
              viewColumn: 1,
              activeTab: {
                input: new TabInputCustom(opened, "lumiere.pdf.viewer"),
              },
            },
            onDidChangeTabs: subscription,
            onDidChangeTabGroups: subscription,
          },
        },
      },
      "../../../host/viewer/panels": {
        PdfViewerPanels,
        VIEW_TYPE: "lumiere.pdf.viewer",
      },
    },
  ) as { PdfPanels: new () => { add(panel: unknown): void; active: unknown } };
  return new PdfPanels();
}

test("a PDF opened from a link with a #page fragment is the active one", () => {
  // VS Code keeps the fragment on the tab; the editor provider drops it.
  const opened = new Uri("/work/paper.pdf", "page=3");
  const panels = panelsShowing(opened);
  const panel = {
    uri: opened.with({ fragment: "" }),
    webviewPanel: {
      viewColumn: 1,
      active: true,
      onDidChangeViewState: subscription,
      onDidDispose: subscription,
    },
    onDidChange: subscription,
    dispose: () => undefined,
  };
  panels.add(panel);
  assert.equal(panels.active, panel);
});
