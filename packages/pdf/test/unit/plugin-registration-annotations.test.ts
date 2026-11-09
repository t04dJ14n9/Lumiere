import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_GAP, viewerPlugins } from "../../src/webview/plugins";
import { prepareReadingPosition } from "../../src/webview/reading-position";

// The initial model a plugin starts its document with: for the Stage, the
// settings it was registered with.
type Registered = {
  id: string;
  state?: () => Record<string, unknown>;
  settings?: { registered?: Record<string, unknown> };
};

function plugin(id: string): Registered {
  const found = (viewerPlugins() as Registered[]).find(
    (candidate) => candidate.id === id,
  );
  assert.ok(found, `${id} is registered`);
  return found;
}

test("viewerPlugins registers every plugin the viewer is built from", () => {
  const ids = (viewerPlugins() as Registered[]).map(({ id }) => id).sort();
  assert.deepEqual(
    ids,
    [
      "annotation",
      "history",
      "interaction",
      "link",
      "lumia-text",
      "outline",
      "render",
      "search",
      "selection",
      "stage",
    ].sort(),
  );
});

// Before any position is remembered (the module remembers one for good).
test("with nothing saved the Stage starts in fit width", () => {
  assert.deepEqual(plugin("stage").state?.()["zoom"], { mode: "fit-width" });
});

test("the Stage keeps one point to a pixel, the room around pages and the saved layout", () => {
  prepareReadingPosition(undefined, {
    page: 3,
    top: 10,
    left: 0,
    zoom: 150,
    pageLayout: "spreadCover",
    scrollMode: "paged",
    scrollDirection: "horizontal",
  });
  const stage = plugin("stage").state?.();
  assert.equal(stage?.["viewUnitsPerPoint"], 1, "saved zoom percentages hold");
  assert.equal(stage?.["padding"], PAGE_GAP);
  assert.equal(stage?.["gap"], PAGE_GAP);
  assert.equal(stage?.["flow"], "paged");
  assert.equal(stage?.["layout"], "horizontal");
  assert.equal(stage?.["spread"], "even");
  assert.deepEqual(stage?.["zoom"], { level: 1.5 });
});

test("a new annotation is selected and its tool stays on; Lumiere's own tools join the hub", () => {
  const registered = plugin("annotation").settings?.registered;
  assert.deepEqual(registered?.["afterCreate"], {
    select: true,
    tool: "stay",
    editText: true,
  });
  assert.ok(
    (registered?.["tools"] as { id: string }[]).some(
      (tool) => tool.id === "lineArrow",
    ),
  );
});

test("the interaction hub starts on the pointer tool", () => {
  assert.equal(
    plugin("interaction").settings?.registered?.["defaultTool"],
    "pointer",
  );
});
