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
  ) as {
    PdfPanels: new () => {
      add(panel: unknown): void;
      active: unknown;
      editorsOf(uri: Uri): unknown[];
      waitForNew(
        uri: Uri,
        known: ReadonlySet<unknown>,
        current?: () => boolean,
        timeoutMs?: number,
      ): Promise<unknown>;
    };
  };
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

/** A panel for `file` in `viewColumn`; it is not the active tab's. */
function panelOf(file: Uri, viewColumn: number) {
  return {
    uri: file,
    webviewPanel: {
      viewColumn,
      active: false,
      onDidChangeViewState: subscription,
      onDidDispose: subscription,
    },
    onDidChange: subscription,
    dispose: () => undefined,
  };
}

test("the editors of a PDF are found in any group, not only the active one", () => {
  const file = new Uri("/work/paper.pdf");
  const panels = panelsShowing(new Uri("/work/note.pdf"));
  const left = panelOf(file, 1);
  const right = panelOf(new Uri("/work/paper.pdf"), 2);
  const other = panelOf(new Uri("/work/other.pdf"), 2);
  for (const panel of [left, other, right]) {
    panels.add(panel);
  }
  assert.deepEqual(panels.editorsOf(file), [left, right]);
});

test("waiting for a new editor of a PDF ignores the ones that were open and takes one in a group the reader is not in", async () => {
  const file = new Uri("/work/paper.pdf");
  const panels = panelsShowing(new Uri("/work/note.pdf"));
  const before = panelOf(file, 1);
  panels.add(before);
  const waiting = panels.waitForNew(file, new Set([before]));
  const created = panelOf(file, 2);
  setTimeout(() => panels.add(created), 20);
  // Neither is the active tab's: `waitFor` would never find it.
  assert.equal(await waiting, created);
});

test("waiting for a new editor gives up at the timeout, and when the open is superseded", async () => {
  const file = new Uri("/work/paper.pdf");
  const panels = panelsShowing(new Uri("/work/note.pdf"));
  assert.equal(
    await panels.waitForNew(file, new Set(), undefined, 80),
    undefined,
  );
  assert.equal(
    await panels.waitForNew(file, new Set(), () => false),
    undefined,
  );
});

test("a view report sets only the context keys whose values changed", () => {
  const set: string[] = [];
  let changed = (): void => undefined;
  class Panels extends PdfViewerPanels<never> {
    constructor() {
      super((key, value) => set.push(`${key}=${String(value)}`));
    }
    open(panel: never): void {
      this.track(panel, { onState: subscription, onDispose: subscription });
    }
    protected findActive(panels: ReadonlySet<never>): never | undefined {
      return [...panels][0];
    }
  }
  const view = { fit: "", tool: "text", pageLayout: "single" };
  const panel = {
    view,
    outline: [],
    onDidChange: (listener: () => void) => {
      changed = listener;
      return subscription();
    },
    dispose: () => undefined,
  } as unknown as never;
  const panels = new Panels();
  panels.open(panel);
  const first = set.length;
  assert.ok(first > 0);
  // Scrolling: page and zoom change, none of the keys do.
  changed();
  changed();
  assert.equal(set.length, first);
  view.tool = "region";
  changed();
  assert.deepEqual(set.slice(first), ["lumiere.pdf.tool=region"]);
});
