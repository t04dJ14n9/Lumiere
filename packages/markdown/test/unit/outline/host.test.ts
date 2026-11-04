import test from "node:test";
import assert from "node:assert/strict";
import {
  DISABLE_FOLLOW_COMMAND,
  ENABLE_FOLLOW_COMMAND,
  EXPAND_ALL_COMMAND,
  EXPAND_MODE_SETTING,
  FOLLOW_CURSOR_SETTING,
  OPEN_COMMAND,
  TOGGLE_COMMAND,
} from "../../../src/plugins/outline/commands";
import { deferred, outlineFixture, tick } from "./fixture";
import { render, uriOf, wait } from "../views/fakes";

test("the Markdown Outline shows and follows the first editor opened", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  assert.equal(fixture.view.message, "No headings.");
  const { panel } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  assert.equal(fixture.view.message, undefined);
  assert.deepEqual(await render(fixture.view.source), [["Title", ["Part"]]]);
  assert.equal(fixture.reveals.at(-1)?.node.label, "Title");
  assert.deepEqual(fixture.reveals.at(-1)?.options, {
    select: true,
    focus: false,
  });
  assert.deepEqual(fixture.treeOptions, { showCollapseAll: true });
  assert.equal(fixture.commandsAvailable, true);
  assert.deepEqual(fixture.warnings, []);
});

test("opening from a native selection leaves the Search sidebar in place", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel } = fixture.panel("search-result");
  Object.assign(panel, { openedFromNativeSelection: true });

  fixture.open(panel);
  await tick();

  assert.deepEqual(
    fixture.executed.filter(([command]) =>
      [
        "outline.removeView",
        "lumiere.markdown.outline.focus",
        "workbench.action.focusActiveEditorGroup",
      ].includes(String(command)),
    ),
    [],
  );
});

test("Follow Cursor commands persist the setting and update the checked context", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  assert.equal(fixture.followsCursor, true);
  await fixture.fake.commands.get(DISABLE_FOLLOW_COMMAND)!();
  assert.equal(fixture.followsCursor, false);
  fixture.reveals.length = 0;
  const calls = cursor.calls;
  cursor.head = fixture.texts.get("A.md")!.indexOf("body");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(cursor.calls, calls);
  assert.equal(fixture.reveals.length, 0);
  await fixture.fake.commands.get(ENABLE_FOLLOW_COMMAND)!();
  assert.equal(fixture.followsCursor, true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "Part");
  assert.deepEqual(fixture.settingsWrites, [
    [FOLLOW_CURSOR_SETTING, false, uriOf("A.md")],
    [FOLLOW_CURSOR_SETTING, true, uriOf("A.md")],
  ]);
});

test("external settings and resource overrides follow the current panel", async (t) => {
  const fixture = await outlineFixture({ "A.md": "# A", "B.md": "# B" });
  t.after(() => fixture.root.dispose());
  fixture.fake.settings[FOLLOW_CURSOR_SETTING] = false;
  const first = fixture.panel("one");
  const second = fixture.panel("two", "B.md");
  fixture.resources.set(uriOf("B.md"), true);
  fixture.open(first.panel);
  await tick();
  assert.equal(fixture.followsCursor, false);
  assert.equal(fixture.reveals.length, 0);
  fixture.switchTo(second.panel);
  await tick();
  assert.equal(fixture.followsCursor, true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "B");
  fixture.switchTo(first.panel);
  await tick();
  fixture.fake.settings[FOLLOW_CURSOR_SETTING] = true;
  fixture.configure();
  await tick();
  assert.equal(fixture.followsCursor, true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A");
});

test("cursor movement selects its section while clicks still navigate with following off", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = fixture.texts.get("A.md")!.indexOf("body");
  fixture.root.emit("editor/selectionChanged", panel, true);
  await tick();
  const item = fixture.reveals.at(-1)!.node;
  assert.equal(item.label, "Part");
  await fixture.fake.commands.get(DISABLE_FOLLOW_COMMAND)!();
  await fixture.fake.commands.get(OPEN_COMMAND)!(...item.command!.args!);
  assert.deepEqual(fixture.opened, [
    {
      uri: uriOf("A.md"),
      offset: fixture.texts.get("A.md")!.indexOf("## Part"),
    },
  ]);
});

test("showing a hidden view selects the latest cursor position", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  fixture.show(false);
  const { panel, cursor } = fixture.panel("one", "A.md", 20);
  fixture.open(panel);
  await tick();
  assert.equal(cursor.calls, 0);
  assert.equal(fixture.reveals.length, 0);
  fixture.show(true);
  await tick();
  assert.equal(fixture.reveals.at(-1)?.node.label, "Part");
});

test("an edit rebuilds and follows the active section from the authoritative text", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  fixture.texts.set("A.md", "# Updated\n## Added\nbody");
  cursor.documentVersion++;
  cursor.version++;
  cursor.head = fixture.texts.get("A.md")!.indexOf("body");
  fixture.reveals.length = 0;
  fixture.root.emit("document/changed", panel.session);
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(
    fixture.reveals.length,
    0,
    "old heading offsets are not used during the debounce",
  );
  await wait(350);
  assert.deepEqual(await render(fixture.view.source), [["Updated", ["Added"]]]);
  assert.equal(fixture.reveals.at(-1)?.node.label, "Added");
});

test("pending captures cannot select a different panel, even for the same note", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const first = fixture.panel("one");
  const second = fixture.panel("two", "A.md", 20);
  fixture.open(first.panel);
  await tick();
  const pending = deferred<{ head: number; version: number }>();
  first.cursor.capture = () => pending.promise;
  fixture.root.emit("editor/selectionChanged", first.panel, false);
  await tick();
  fixture.reveals.length = 0;
  fixture.switchTo(second.panel);
  await tick();
  pending.resolve({ head: 0, version: 0 });
  await tick();
  assert.deepEqual(
    fixture.reveals.map((reveal) => reveal.node.label),
    ["Part"],
  );
  fixture.root.emit("editor/selectionChanged", first.panel, false);
  await tick();
  assert.equal(fixture.reveals.length, 1);
});

test("newer cursor captures supersede older replies", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const pending = deferred<{ head: number; version: number }>();
  cursor.capture = () => pending.promise;
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  fixture.reveals.length = 0;
  cursor.capture = async () => ({ head: 20, version: 0 });
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  pending.resolve({ head: 0, version: 0 });
  await tick();
  assert.deepEqual(
    fixture.reveals.map((reveal) => reveal.node.label),
    ["Part"],
  );
});

test("a capture from an older document or synchronization version is ignored", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  fixture.reveals.length = 0;
  cursor.version = 2;
  cursor.capture = async () => ({ head: 20, version: 1 });
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.reveals.length, 0);

  const pending = deferred<{ head: number; version: number }>();
  cursor.capture = () => pending.promise;
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  cursor.documentVersion++;
  pending.resolve({ head: 20, version: 2 });
  await tick();
  assert.equal(fixture.reveals.length, 0);
});

test("a failed cursor RPC is contained and subsequent movement still follows", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const failure = new Error("panel RPC unavailable");
  cursor.capture = async () => {
    throw failure;
  };
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.deepEqual(fixture.warnings, [failure]);
  fixture.reveals.length = 0;
  cursor.capture = async () => ({ head: 20, version: 0 });
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.reveals.at(-1)?.node.label, "Part");
});

test("turning follow off or disposing cancels an in-flight capture", async (t) => {
  for (const stop of ["disable", "dispose"]) {
    const fixture = await outlineFixture();
    t.after(() => fixture.root.dispose());
    const { panel, cursor } = fixture.panel("one");
    fixture.open(panel);
    await tick();
    const pending = deferred<{ head: number; version: number }>();
    cursor.capture = () => pending.promise;
    fixture.root.emit("editor/selectionChanged", panel, false);
    await tick();
    fixture.reveals.length = 0;
    if (stop === "disable") {
      await fixture.fake.commands.get(DISABLE_FOLLOW_COMMAND)!();
    } else {
      await fixture.root.dispose();
    }
    pending.resolve({ head: 20, version: 0 });
    await tick();
    assert.equal(fixture.reveals.length, 0, stop);
  }
});

test("Expand All visits every level and preserves selection and focus", async (t) => {
  const text =
    "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n# Other\n";
  const fixture = await outlineFixture({ "A.md": text });
  t.after(() => fixture.root.dispose());
  fixture.fake.settings[FOLLOW_CURSOR_SETTING] = false;
  fixture.open(fixture.panel("one").panel);
  await tick();
  await fixture.fake.commands.get(EXPAND_ALL_COMMAND)!();
  assert.deepEqual(
    fixture.expands.map((node) => node.label),
    ["One", "Two", "Three", "Four", "Five"],
    "each parent is recorded open so a later collapse can close it",
  );
  assert.deepEqual(
    fixture.reveals.map((reveal) => reveal.node.label),
    ["Six", "Other"],
  );
  for (const reveal of fixture.reveals) {
    assert.deepEqual(reveal.options, {
      expand: true,
      select: false,
      focus: false,
    });
  }
});

test("stopping the plugin removes commands, view and follow context", async () => {
  const fixture = await outlineFixture();
  fixture.open(fixture.panel("one").panel);
  await tick();
  await fixture.root.dispose();
  assert.equal(fixture.view.disposed, true);
  assert.equal(fixture.fake.commands.size, 0);
  assert.equal(fixture.followsCursor, undefined);
  assert.equal(fixture.commandsAvailable, undefined);
  assert.deepEqual(fixture.warnings, []);
});

// A1a and A2 have child headings, so they are expandable. `body-a` still
// sits in A1a (before its child), which is the node Follow Cursor reveals.
const NESTED = `# A
## A1
### A1a
body-a
#### Detail
## A2
### A2a
body-a2
# B
## B1
### B1a
body-b
`;

test("accordion follow expands only the active path and does not refresh", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const refreshAfterOpen = fixture.refreshCount;
  const collapseAllBeforeFollow = fixture.collapseAllCount;
  fixture.expands.length = 0;
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.refreshCount, refreshAfterOpen, "no caret-only refresh");
  assert.equal(
    fixture.collapseAllCount,
    collapseAllBeforeFollow,
    "A, open since the note opened, is on the path: nothing has to close",
  );
  assert.deepEqual(
    fixture.expands.map((node) => node.label).sort(),
    ["A1", "A1a"].sort(),
    "only the rows that were not open yet",
  );
  assert.equal(fixture.reveals.at(-1)?.node.label, "A1a");
});

test("unchanged accordion path skips expand/collapse", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  fixture.expands.length = 0;
  fixture.collapses.length = 0;
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-a") + 1;
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.deepEqual(fixture.expands, []);
  assert.deepEqual(fixture.collapses, []);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A1a");
});

// VS Code can close one row only by collapsing the whole tree, which flashes
// the outline shut and open again: it is done only when a branch must close.
test("moving into a section that has sub-sections only opens rows, without collapsing the tree", async (t) => {
  const text = "# A\nintro\n## A1\n### A1a\nleaf\n## A2\nlast\n";
  const fixture = await outlineFixture({ "A.md": text });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = text.indexOf("intro");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.deepEqual(
    fixture.expands.map((node) => node.label),
    ["A"],
  );
  const collapses = fixture.collapseAllCount;
  fixture.expands.length = 0;
  // A1 has a sub-section: its row opens, nothing needs to close.
  cursor.head = text.indexOf("leaf");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.collapseAllCount, collapses, "nothing flashes shut");
  assert.deepEqual(
    fixture.expands.map((node) => node.label),
    ["A1"],
  );
  assert.equal(fixture.isOpen("A"), true);
  assert.equal(fixture.isOpen("A1"), true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A1a");
  // Leaving A1 for A2 does close a branch: now the tree is reset.
  cursor.head = text.indexOf("last");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.collapseAllCount, collapses + 1);
  assert.equal(fixture.isOpen("A1"), false);
  assert.equal(fixture.isOpen("A"), true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A2");
});

// Each pause in typing refreshes the outline. VS Code keeps the open rows
// across the refresh, so the next follow must not collapse the whole tree.
test("an edit's refresh leaves the open rows alone, so the tree does not flash while typing", async (t) => {
  const text = "# A\nintro\n## A1\n### A1a\nleaf\n## A2\nlast\n";
  const fixture = await outlineFixture({ "A.md": text });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = text.indexOf("leaf");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapses = fixture.collapseAllCount;
  const typed = text.replace("leaf", "leafy");
  fixture.texts.set("A.md", typed);
  cursor.documentVersion++;
  cursor.version++;
  cursor.head = typed.indexOf("leafy") + 5;
  fixture.root.emit("document/changed", panel.session);
  await wait(350);
  assert.equal(fixture.collapseAllCount, collapses, "nothing flashes shut");
  assert.equal(fixture.isOpen("A1"), true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A1a");
});

const TWO_CHAPTERS =
  "# A\nintro\n## A1\n### A1a\nleaf\n# B\n## B1\n### B1a\nbleaf\n";

test("a follow waits for the one before it, so an older expand cannot leave its branch open", async (t) => {
  const fixture = await outlineFixture({ "A.md": TWO_CHAPTERS });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = TWO_CHAPTERS.indexOf("intro");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapses = fixture.collapseAllCount;
  const release = fixture.holdExpands();
  // Into A1: its expand is still on its way when the reader moves on to B.
  cursor.head = TWO_CHAPTERS.indexOf("leaf");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  cursor.head = TWO_CHAPTERS.indexOf("bleaf");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  release();
  await wait(10);
  assert.equal(fixture.collapseAllCount, collapses + 1);
  assert.equal(fixture.isOpen("A1"), false, "the older follow's row closed");
  assert.equal(fixture.isOpen("B"), true);
  assert.equal(fixture.isOpen("B1"), true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "B1a");
});

test("after a follow fails partway, the next one lays the whole path out again", async (t) => {
  const fixture = await outlineFixture({ "A.md": TWO_CHAPTERS });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = TWO_CHAPTERS.indexOf("intro");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  fixture.failNextExpand();
  cursor.head = TWO_CHAPTERS.indexOf("leaf");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.warnings.length, 1, "the failure is logged");
  assert.equal(fixture.isOpen("A1"), false);
  const collapses = fixture.collapseAllCount;
  cursor.head = TWO_CHAPTERS.indexOf("leaf") + 1;
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.collapseAllCount, collapses + 1);
  assert.equal(fixture.isOpen("A1"), true);
});

test("turning follow off and on forgets what the accordion opened", async (t) => {
  const fixture = await outlineFixture({ "A.md": TWO_CHAPTERS });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = TWO_CHAPTERS.indexOf("leaf");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  fixture.fake.settings[FOLLOW_CURSOR_SETTING] = false;
  fixture.configure();
  await tick();
  const collapses = fixture.collapseAllCount;
  // Meanwhile the reader may open other chapters by hand. Turning follow back
  // on follows the caret, on the same path as before.
  fixture.fake.settings[FOLLOW_CURSOR_SETTING] = true;
  fixture.configure();
  await tick();
  assert.equal(
    fixture.collapseAllCount,
    collapses + 1,
    "the tree is laid out again, closing what the reader opened",
  );
  assert.equal(fixture.isOpen("A1"), true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A1a");
});

test("a tree without a native collapse-all closes the other rows one by one whenever the path changes", async (t) => {
  const fixture = await outlineFixture(
    { "A.md": TWO_CHAPTERS },
    { native: false },
  );
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = TWO_CHAPTERS.indexOf("intro");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  fixture.collapses.length = 0;
  // Only rows to open: such a tree still closes the others, which costs no flash.
  cursor.head = TWO_CHAPTERS.indexOf("leaf");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.deepEqual(
    fixture.collapses.map((node) => node.label),
    ["B", "B1"],
  );
  assert.equal(fixture.isOpen("A1"), true);
  assert.equal(fixture.collapseAllCount, 0);
});

test("accordion chapter switch closes the prior path in the tree UI", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapseAllBeforeSwitch = fixture.collapseAllCount;
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-b");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();

  assert.equal(
    fixture.collapseAllCount,
    collapseAllBeforeSwitch + 1,
    "chapter switch resets native expansion before opening the next path",
  );
  assert.equal(fixture.isOpen("A"), false, "prior chapter closes");
  assert.equal(fixture.isOpen("A1"), false, "prior ancestor closes");
  assert.equal(fixture.isOpen("A1a"), false, "prior nested branch closes");
  assert.equal(
    fixture.isOpen("A2"),
    false,
    "prior sibling branch stays closed",
  );
  assert.equal(fixture.isOpen("B"), true, "active chapter is open");
  assert.equal(fixture.isOpen("B1"), true, "active nested branch is open");
  assert.equal(fixture.reveals.at(-1)?.node.label, "B1a");
});

test("expandMode all keeps parents expanded on build and only reveals on follow", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  fixture.fake.settings[EXPAND_MODE_SETTING] = "all";
  fixture.configure();
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const roots = await fixture.view.source.roots();
  assert.equal(roots[0]?.expanded, true);
  fixture.expands.length = 0;
  fixture.collapses.length = 0;
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-b");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.deepEqual(fixture.expands, []);
  assert.deepEqual(fixture.collapses, []);
  assert.equal(fixture.reveals.at(-1)?.node.label, "B1a");
});

test("Expand All is folded back to the active path on the next follow", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  await fixture.fake.commands.get(EXPAND_ALL_COMMAND)!();
  fixture.expands.length = 0;
  fixture.collapses.length = 0;
  const collapseAllBeforeFollow = fixture.collapseAllCount;
  cursor.head = fixture.texts.get("A.md")!.indexOf("body-a") + 1;
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(
    fixture.collapseAllCount,
    collapseAllBeforeFollow + 1,
    "the next follow resets every branch Expand All opened",
  );
  assert.equal(fixture.reveals.at(-1)?.node.label, "A1a");
  assert.equal(fixture.isOpen("A"), true);
  assert.equal(fixture.isOpen("A1"), true);
  assert.equal(fixture.isOpen("A1a"), true);
  assert.equal(
    fixture.isOpen("A2"),
    false,
    "sibling opened by Expand All collapses",
  );
  assert.equal(
    fixture.isOpen("B"),
    false,
    "other chapter opened by Expand All collapses",
  );
});

test("Toggle Markdown Outline targets the view's hide command and restores it with focus", async (t) => {
  const fixture = await outlineFixture();
  t.after(() => fixture.root.dispose());
  const { panel } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  fixture.executed.length = 0;
  fixture.show(true);
  await fixture.fake.commands.get(TOGGLE_COMMAND)!();
  assert.deepEqual(fixture.executed.at(-1), [
    "lumiere.markdown.outline.removeView",
  ]);
  fixture.show(false);
  await fixture.fake.commands.get(TOGGLE_COMMAND)!();
  assert.deepEqual(fixture.executed.at(-1), ["lumiere.markdown.outline.focus"]);
});

test("a click on an outline row leaves the tree as it is, so a double-click's second click hits the same row", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const text = fixture.texts.get("A.md")!;
  cursor.head = text.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapseAllBefore = fixture.collapseAllCount;
  fixture.expands.length = 0;
  // Click "B": the outline opens it. The editor takes focus first, still
  // reporting its caret from before; then the caret lands on "B".
  await fixture.fake.commands.get(OPEN_COMMAND)!(
    uriOf("A.md"),
    text.indexOf("# B"),
  );
  fixture.root.emit("editor/activeChanged", panel);
  await tick();
  assert.equal(
    fixture.collapseAllCount,
    collapseAllBefore,
    "the caret from before the click lays nothing out",
  );
  cursor.head = text.indexOf("# B");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(
    fixture.collapseAllCount,
    collapseAllBefore,
    "no collapse under the pointer",
  );
  assert.equal(fixture.expands.length, 0, "no rows opened above it either");
  // The second click of the double-click, and its caret move: still alone.
  await fixture.fake.commands.get(OPEN_COMMAND)!(
    uriOf("A.md"),
    text.indexOf("# B"),
  );
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.collapseAllCount, collapseAllBefore);
  // Moving on in the editor applies the accordion as before.
  cursor.head = text.indexOf("body-b");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(fixture.collapseAllCount, collapseAllBefore + 1);
  assert.deepEqual(fixture.expands.map((node) => node.label).sort(), [
    "B",
    "B1",
  ]);
});

// A scroll fires follows in quick succession. Clearing openBranches for every
// follow meant a superseded one left the model unknown, so the next follow
// collapsed the whole tree even when the path only needed more rows open.
test("a scroll that only opens rows does not flash when a slower follow is superseded", async (t) => {
  const text = "# A\nintro\n## A1\n### A1a\nleaf\n## A2\nlast\n";
  const fixture = await outlineFixture({ "A.md": text });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = text.indexOf("intro");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapses = fixture.collapseAllCount;
  const release = fixture.holdExpands();
  // Into A1a: only A1 has to open. Hold that expand so the next scroll report
  // can supersede this follow before openBranches is restored.
  cursor.read(text.indexOf("leaf"));
  await tick();
  cursor.read(text.indexOf("leaf") + 1);
  await tick();
  release();
  await wait(10);
  assert.equal(fixture.collapseAllCount, collapses, "nothing flashes shut");
  assert.equal(fixture.isOpen("A"), true);
  assert.equal(fixture.isOpen("A1"), true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A1a");
});

// Open-only expand that completes under a superseded follow must still count
// those rows in openBranches: otherwise a same-parent sibling leave (A1a→A2)
// sees mustClose false and skips Collapse All, leaving A1 open.
test("a superseded open-only expand still closes its branch when the next follow leaves for a sibling", async (t) => {
  const text = "# A\nintro\n## A1\n### A1a\nleaf\n## A2\nlast\n";
  const fixture = await outlineFixture({ "A.md": text });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  cursor.head = text.indexOf("intro");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapses = fixture.collapseAllCount;
  const release = fixture.holdExpands();
  // Hold A1's expand, then supersede by scrolling to A2 before openBranches
  // is updated to include A1.
  cursor.read(text.indexOf("leaf"));
  await tick();
  cursor.read(text.indexOf("last"));
  await tick();
  release();
  await wait(10);
  assert.equal(
    fixture.collapseAllCount,
    collapses + 1,
    "sibling leave collapses the branch the superseded follow opened",
  );
  assert.equal(fixture.isOpen("A1"), false, "A1 closes");
  assert.equal(fixture.isOpen("A"), true);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A2");
});

test("scrolling the note moves the accordion to the section being read, as the caret does", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const text = fixture.texts.get("A.md")!;
  cursor.head = text.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  assert.equal(cursor.listeners, 1, "the panel's scroll reports are heard");
  const collapses = fixture.collapseAllCount;
  fixture.expands.length = 0;
  // The caret stays in A1a; the reader scrolls down to B1a.
  cursor.read(text.indexOf("body-b"));
  await tick();
  assert.equal(fixture.collapseAllCount, collapses + 1);
  assert.deepEqual(fixture.expands.map((node) => node.label).sort(), [
    "B",
    "B1",
  ]);
  assert.equal(fixture.reveals.at(-1)?.node.label, "B1a");
  // A report for an older text, or from a panel in the background, is not.
  cursor.read(text.indexOf("body-a2"), cursor.version - 1);
  await tick();
  assert.equal(fixture.collapseAllCount, collapses + 1);
  const other = fixture.panel("two");
  other.cursor.read(text.indexOf("body-a2"));
  await tick();
  assert.equal(fixture.collapseAllCount, collapses + 1);
});

test("a scroll report after a click in the outline leaves the tree as it is", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const text = fixture.texts.get("A.md")!;
  cursor.head = text.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapses = fixture.collapseAllCount;
  await fixture.fake.commands.get(OPEN_COMMAND)!(
    uriOf("A.md"),
    text.indexOf("# B"),
  );
  // The editor centres "B", with the caret on it, and reports that.
  cursor.head = text.indexOf("# B");
  cursor.read(text.indexOf("# B"));
  await tick();
  assert.equal(fixture.collapseAllCount, collapses);
});

test("top-of-viewport reading during an outline jump does not yank the clicked row", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const { panel, cursor } = fixture.panel("one");
  fixture.open(panel);
  await tick();
  const text = fixture.texts.get("A.md")!;
  cursor.head = text.indexOf("body-a");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  // Freeze Date so the OUTLINE_JUMP_MS window is under the test's control.
  t.mock.timers.enable({ apis: ["Date"] });
  await fixture.fake.commands.get(OPEN_COMMAND)!(
    uriOf("A.md"),
    text.indexOf("# B"),
  );
  // Caret arrives on the clicked heading (jump lands).
  cursor.head = text.indexOf("# B");
  fixture.root.emit("editor/selectionChanged", panel, false);
  await tick();
  const collapses = fixture.collapseAllCount;
  fixture.expands.length = 0;
  fixture.reveals.length = 0;
  // Centering put "B" mid-pane; ~100ms later readingPosition reports the
  // top-of-viewport line — a heading above "B". Must not accordion-follow it.
  cursor.read(text.indexOf("# A"));
  await tick();
  assert.equal(
    fixture.collapseAllCount,
    collapses,
    "must ignore followReading for a different node while the jump window is open",
  );
  assert.equal(fixture.expands.length, 0);
  assert.equal(
    fixture.reveals.length,
    0,
    "must not reveal/select the top-of-viewport heading during the jump",
  );
  // After OUTLINE_JUMP_MS, scroll follow applies again.
  t.mock.timers.tick(1001);
  cursor.read(text.indexOf("# A"));
  await tick();
  assert.equal(fixture.collapseAllCount, collapses + 1);
  assert.equal(fixture.reveals.at(-1)?.node.label, "A");
});

test("scroll reports stop when the panel closes or the outline stops", async (t) => {
  const fixture = await outlineFixture({ "A.md": NESTED });
  t.after(() => fixture.root.dispose());
  const first = fixture.panel("one");
  fixture.open(first.panel);
  await tick();
  assert.equal(first.cursor.listeners, 1);
  fixture.root.emit("editor/closed", first.panel);
  await tick();
  assert.equal(first.cursor.listeners, 0);
  const second = fixture.panel("two");
  fixture.open(second.panel);
  await tick();
  assert.equal(second.cursor.listeners, 1);
  await fixture.root.dispose();
  assert.equal(second.cursor.listeners, 0);
});
