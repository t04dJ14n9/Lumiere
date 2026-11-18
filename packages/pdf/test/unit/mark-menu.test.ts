import assert from "node:assert/strict";
import { test } from "node:test";
import {
  annotationQuoteText,
  selectionFromAnnotation,
} from "../../src/shared/annotation-handoff";
import { markColorPatch } from "../../src/shared/annotation-tools";
import { fakeReact } from "./support/fake-react";
import { loadHook } from "./support/load-hook";

type Ref = { id: string };
type Mark = {
  ref: Ref;
  page: string;
  subtype: string;
  rect: { x: number; y: number; width: number; height: number };
  contents?: string;
};

const PAGE = { ref: "page-1" };
const own: Mark = {
  ref: { id: "own" },
  page: "page-1",
  subtype: "highlight",
  rect: { x: 10, y: 20, width: 100, height: 12 },
  contents: "first note",
};
const theirs: Mark = { ...own, ref: { id: "pdf" } };

/** The mark menu over a fake annotation API, with a mark (or none) under the pointer. */
function setUp() {
  const hooks = fakeReact();
  const calls: unknown[][] = [];
  const regions: unknown[] = [];
  const colors: string[] = [];
  const errors: unknown[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  let under: Mark | null = own;
  const annotation = {
    getAt: (page: unknown, point: unknown) => {
      calls.push(["getAt", page, point]);
      return under;
    },
    createFromSelection: async (tool: string) => {
      calls.push(["createFromSelection", tool]);
      return { annotations: [{ ...own, ref: { id: "new" } }] };
    },
    update: async (ref: Ref, patch: unknown) => {
      calls.push(["update", ref.id, { ...(patch as object) }]);
      return { annotation: { ...own, ref, ...(patch as object) } };
    },
    delete: async (ref: Ref) => {
      calls.push(["delete", ref.id]);
    },
    isPending: (ref: Ref) => ref.id === "pending",
  };
  const module = loadHook(
    "mark-menu.ts",
    {
      react: hooks.react,
      "@embedpdf/react/annotation": { AnnotationToken: "annotation" },
      "@embedpdf/react/runtime": {
        useOptionalCapability: () => annotation,
        useDocuments: () => ({
          getPageIndex: (page: string) => (page === "page-1" ? 0 : -1),
        }),
      },
      "../shared/annotation-handoff": {
        annotationQuoteText,
        selectionFromAnnotation,
      },
      "../shared/annotation-tools": { markColorPatch },
      "./host": { postToHost: (message: unknown) => errors.push(message) },
      "./look-up-pages": {
        lookUpPageAt: () => ({ page: PAGE, point: { x: 40, y: 25 } }),
      },
      "./page-colors": { currentPageColors: () => "normal" },
    },
    {
      document: {
        addEventListener: (type: string, listener: (e: unknown) => void) =>
          listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      },
    },
  ) as {
    useMarkMenu: (options: unknown) => {
      openAt: (event: unknown) => boolean;
      markSelection: (tool: string, note?: string) => void;
      setNote: (note: string) => void;
      setColor: (color: string) => void;
      deleteMark: () => void;
    };
  };
  let menu!: ReturnType<typeof module.useMarkMenu>;
  hooks.render(() => {
    menu = module.useMarkMenu({
      isOwn: (ref: Ref) => ref.id === "own" || ref.id === "new",
      setAnnotationRegion: (region: unknown) => regions.push(region),
      setHighlightColor: (color: string) => colors.push(color),
    });
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    menu: () => menu,
    calls,
    regions,
    colors,
    errors,
    listeners,
    settle,
    pointAt: (mark: Mark | null) => {
      under = mark;
    },
  };
}

const rightClick = { clientX: 300, clientY: 200 };

test("a right-click on one of Lumiere's marks makes it the menu's mark, with its note", () => {
  const view = setUp();
  assert.equal(view.menu().openAt(rightClick), true);
  assert.deepEqual(view.calls[0], ["getAt", "page-1", { x: 40, y: 25 }]);
  assert.deepEqual(view.regions, [
    {
      kind: "region",
      page: 1,
      rect: [10, 20, 110, 32],
      // The note is the quote until the page text in the box is read.
      text: "first note",
      mark: true,
      note: "first note",
    },
  ]);
});

test("a note too long to send is flagged, not dropped as if there were none", () => {
  const view = setUp();
  view.pointAt({ ...own, contents: "x".repeat(10_001) });
  view.menu().openAt(rightClick);
  const region = view.regions.at(-1) as { note?: string; noteTooLong?: true };
  assert.equal(region.note, undefined);
  assert.equal(region.noteTooLong, true);
});

test("the PDF's own annotations, and empty page, are not marks the menu acts on", () => {
  const view = setUp();
  view.pointAt(theirs);
  assert.equal(view.menu().openAt(rightClick), false);
  view.pointAt(null);
  assert.equal(view.menu().openAt(rightClick), false);
  assert.deepEqual(view.regions, []);
  view.menu().deleteMark();
  view.menu().setNote("x");
  assert.equal(
    view.calls.some(([verb]) => verb === "delete" || verb === "update"),
    false,
  );
});

test("a mark just made, still waiting for the engine, is Lumiere's", () => {
  const view = setUp();
  view.pointAt({ ...own, ref: { id: "pending" } });
  assert.equal(view.menu().openAt(rightClick), true);
});

test("a miss, a left press or Escape puts the menu's mark down", () => {
  for (const put of [
    (view: ReturnType<typeof setUp>) => {
      view.pointAt(null);
      view.menu().openAt(rightClick);
    },
    (view: ReturnType<typeof setUp>) =>
      view.listeners.get("pointerdown")!({ button: 0 }),
    (view: ReturnType<typeof setUp>) =>
      view.listeners.get("keydown")!({ key: "Escape" }),
  ]) {
    const view = setUp();
    view.menu().openAt(rightClick);
    put(view);
    assert.equal(view.regions.at(-1), undefined);
    assert.equal(view.regions.length, 2);
  }
  // A right press (the menu itself) keeps it.
  const view = setUp();
  view.menu().openAt(rightClick);
  view.listeners.get("pointerdown")!({ button: 2 });
  assert.equal(view.regions.length, 1);
});

test("Add Annotation highlights the selected text and puts the note on it", async () => {
  const view = setUp();
  view.menu().markSelection("highlight", "why this matters");
  await view.settle();
  assert.deepEqual(view.calls, [
    ["createFromSelection", "highlight"],
    ["update", "new", { contents: "why this matters" }],
  ]);

  const plain = setUp();
  plain.menu().markSelection("squiggly");
  await plain.settle();
  assert.deepEqual(plain.calls, [["createFromSelection", "squiggly"]]);
});

test("Edit Note, Change Color and Delete act on the menu's mark", async () => {
  const view = setUp();
  view.menu().openAt(rightClick);
  view.menu().setNote("second note");
  await view.settle();
  assert.deepEqual(view.calls.at(-1), [
    "update",
    "own",
    { contents: "second note" },
  ]);
  // The reported mark now carries the new note, for the next Edit Note….
  assert.equal((view.regions.at(-1) as { note?: string }).note, "second note");

  view.menu().setColor("#4DABF7");
  await view.settle();
  assert.deepEqual(view.calls.at(-1), [
    "update",
    "own",
    { color: "#4DABF7", opacity: 0.3, blendMode: "multiply" },
  ]);
  // New highlights follow the colour picked last.
  assert.deepEqual(view.colors, ["#4DABF7"]);

  view.menu().deleteMark();
  await view.settle();
  assert.deepEqual(view.calls.at(-1), ["delete", "own"]);
  assert.equal(view.regions.at(-1), undefined);
  assert.deepEqual(view.errors, []);
});

test("a stamp has no colour to change", async () => {
  const view = setUp();
  view.pointAt({ ...own, subtype: "stamp" });
  view.menu().openAt(rightClick);
  view.menu().setColor("#4DABF7");
  await view.settle();
  assert.equal(
    view.calls.some(([verb]) => verb === "update"),
    false,
  );
  assert.deepEqual(view.colors, []);
});
