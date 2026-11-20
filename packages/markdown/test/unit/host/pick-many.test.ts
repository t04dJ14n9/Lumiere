import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as WorkbenchService from "../../../src/host/services/workbench";
import { forgetModules } from "../../support/module-cache";

// The VS Code adapter of Dialogs.pickMany, against a stand-in quick pick.

function loadWorkbench(vscode: unknown) {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  forgetModules(require, "/src/host/", "/src/shared/");
  try {
    return require("../../../src/host/services/workbench.ts") as typeof WorkbenchService;
  } finally {
    loader._load = originalLoad;
  }
}

interface Row {
  label: string;
  description?: string;
  detail?: string;
  index: number;
}

/** A quick pick the test drives: accept and hide are the user's moves. */
function standIn() {
  const pick = {
    placeholder: "",
    canSelectMany: false,
    items: [] as Row[],
    selectedItems: [] as Row[],
    shown: false,
    disposed: false,
    accept: () => {},
    hide: () => {},
  };
  const quickPick = {
    get placeholder() {
      return pick.placeholder;
    },
    set placeholder(value: string) {
      pick.placeholder = value;
    },
    get canSelectMany() {
      return pick.canSelectMany;
    },
    set canSelectMany(value: boolean) {
      pick.canSelectMany = value;
    },
    get items() {
      return pick.items;
    },
    set items(value: Row[]) {
      pick.items = value;
    },
    get selectedItems() {
      return pick.selectedItems;
    },
    set selectedItems(value: Row[]) {
      pick.selectedItems = value;
    },
    onDidAccept: (listener: () => void) => {
      pick.accept = listener;
      return { dispose() {} };
    },
    onDidHide: (listener: () => void) => {
      pick.hide = listener;
      return { dispose() {} };
    },
    show: () => {
      pick.shown = true;
    },
    // Hiding is what a real quick pick does after an accept, too.
    hide: () => pick.hide(),
    dispose: () => {
      pick.disposed = true;
    },
  };
  const { createDialogs } = loadWorkbench({
    window: { createQuickPick: () => quickPick },
  });
  return { pick, dialogs: createDialogs() };
}

const items = [
  {
    label: "a.png",
    description: "ex.com",
    detail: "https://ex.com/a.png",
    value: "A",
  },
  { label: "b.png", value: "B" },
  { label: "c.png", value: "C" },
];

test("every row starts ticked, in a multi-select pick", () => {
  const { pick, dialogs } = standIn();
  void dialogs.pickMany({ placeholder: "Download?", items });
  assert.equal(pick.canSelectMany, true);
  assert.equal(pick.placeholder, "Download?");
  assert.equal(pick.shown, true);
  assert.deepEqual(
    pick.items.map(({ label, description, detail }) => ({
      label,
      description,
      detail,
    })),
    [
      { label: "a.png", description: "ex.com", detail: "https://ex.com/a.png" },
      { label: "b.png", description: undefined, detail: undefined },
      { label: "c.png", description: undefined, detail: undefined },
    ],
  );
  assert.deepEqual(pick.selectedItems, pick.items);
});

test("accepting resolves the ticked values in the rows' order", async () => {
  const { pick, dialogs } = standIn();
  const answer = dialogs.pickMany({ placeholder: "x", items });
  // VS Code lists selected items in the order they were ticked.
  pick.selectedItems = [pick.items[2]!, pick.items[0]!];
  pick.accept();
  assert.deepEqual(await answer, ["A", "C"]);
  assert.equal(pick.disposed, true);
});

test("accepting with nothing ticked is an empty answer, dismissing is none", async () => {
  const accepted = standIn();
  const empty = accepted.dialogs.pickMany({ placeholder: "x", items });
  accepted.pick.selectedItems = [];
  accepted.pick.accept();
  assert.deepEqual(await empty, []);

  const dismissed = standIn();
  const none = dismissed.dialogs.pickMany({ placeholder: "x", items });
  dismissed.pick.hide();
  assert.equal(await none, undefined);
});
