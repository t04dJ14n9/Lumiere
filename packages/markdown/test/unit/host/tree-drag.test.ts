import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as WorkbenchService from "../../../src/host/services/workbench";
import type { TreeNode, TreeSource } from "../../../src/shared/host";
import { forgetModules } from "../../support/module-cache";

// The VS Code adapter of a tree whose source takes drops, against a
// stand-in createTreeView that keeps the options it was given.

interface Controller {
  dragMimeTypes: readonly string[];
  dropMimeTypes: readonly string[];
  handleDrag(nodes: readonly TreeNode[], transfer: Transfer): void;
  handleDrop(target: TreeNode | undefined, transfer: Transfer): Promise<void>;
}

type Transfer = Map<string, { value: unknown }>;

function treeOptions(source: TreeSource): {
  dragAndDropController?: Controller;
} {
  let options: { dragAndDropController?: Controller } = {};
  const vscode = {
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire() {}
      dispose() {}
    },
    DataTransferItem: class {
      constructor(readonly value: unknown) {}
    },
    window: {
      createTreeView: (_id: string, given: typeof options) => {
        options = given;
        return { dispose() {} };
      },
    },
  };
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  forgetModules(require, "/src/host/", "/src/shared/");
  try {
    const { createWorkbenchViews } =
      require("../../../src/host/services/workbench.ts") as typeof WorkbenchService;
    createWorkbenchViews({} as never).tree("lumiere.markdown.outline", source);
  } finally {
    loader._load = originalLoad;
  }
  return options;
}

const roots = { roots: () => [], children: () => [] };

test("a tree whose source takes no drops cannot drag rows", () => {
  assert.equal(treeOptions(roots).dragAndDropController, undefined);
});

test("a row dragged within the tree reaches the source's drop with its target", async () => {
  const drops: [string, string | undefined][] = [];
  const controller = treeOptions({
    ...roots,
    drop: async (dragged, target) => {
      drops.push([dragged.id, target?.id]);
    },
  }).dragAndDropController!;
  const mimeType = "application/vnd.code.tree.lumiere.markdown.outline";
  assert.deepEqual(controller.dropMimeTypes, [mimeType]);
  const transfer: Transfer = new Map();
  controller.handleDrag([{ id: "1", label: "B" }], transfer);
  await controller.handleDrop({ id: "0", label: "A" }, transfer);
  await controller.handleDrop(undefined, transfer);
  assert.deepEqual(drops, [
    ["1", "0"],
    ["1", undefined],
  ]);
});

test("a drop carrying none of the tree's rows, or several, moves nothing", async () => {
  let drops = 0;
  const controller = treeOptions({
    ...roots,
    drop: async () => {
      drops++;
    },
  }).dragAndDropController!;
  await controller.handleDrop(undefined, new Map());
  const several: Transfer = new Map();
  controller.handleDrag(
    [
      { id: "0", label: "A" },
      { id: "1", label: "B" },
    ],
    several,
  );
  await controller.handleDrop(undefined, several);
  assert.equal(drops, 0);
});
