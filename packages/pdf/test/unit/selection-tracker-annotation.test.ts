import assert from "node:assert/strict";
import { test } from "node:test";
import type { RegionSelection } from "../../src/shared/selection";
import { loadModule } from "./support/load-module";

type RegionEnd =
  { kind: "drawn"; page: unknown; rect: number[] } | { kind: "click" };

/** Page k of the test document is the page dictionary with object number 9 + k. */
const page = (number: number) => ({
  kind: "objectNumber",
  objectNumber: 9 + number,
});

/**
 * Load SelectionTracker with a fake host so we can assert report patches
 * without acquireVsCodeApi, and with the region gestures driven by hand.
 */
function loadSelectionTracker(reports: unknown[]) {
  const regionListeners = new Set<(end: RegionEnd) => void>();
  const exports = loadModule(
    new URL("../../src/webview/selection.ts", import.meta.url),
    {
      react: {
        useCallback: (fn: unknown) => fn,
        useEffect: () => undefined,
        useMemo: (fn: () => unknown) => fn(),
        useRef: (value: unknown) => ({ current: value }),
        useState: (value: unknown) => [value, () => undefined],
      },
      "@embedpdf/react/runtime": {
        useDocuments: () => ({}),
        useOptionalCapability: () => null,
      },
      "@embedpdf/plugin-render/contract": { RenderToken: {} },
      "@embedpdf/plugin-selection/contract": { SelectionToken: {} },
      "./editable-target": { isEditableTarget: () => false },
      "./host": {
        postToHost: () => undefined,
        reportToHost: (patch: unknown) => reports.push(patch),
      },
      "./menu-context": { followMenuContext: () => () => undefined },
      "./region-details": {
        readRegionDetails: () => Promise.resolve({ text: "from page" }),
      },
      "./region-drag": {
        onRegionEnd: (listener: (end: RegionEnd) => void) => {
          regionListeners.add(listener);
          return () => regionListeners.delete(listener);
        },
      },
      "./text-access": { useTextAccess: () => null },
    },
  );
  const SelectionTracker = exports.SelectionTracker as new (
    setRegion: (region: RegionSelection | undefined) => void,
  ) => {
    region: RegionSelection | undefined;
    selectedText: string | undefined;
    changeRegion(next: RegionSelection | undefined): void;
    setAnnotationRegion(next: RegionSelection | undefined): void;
    reportSelection(selection: unknown): Promise<void>;
    follow(selection: unknown, source: unknown): () => void;
  };
  assert.equal(
    typeof SelectionTracker,
    "function",
    "SelectionTracker must be exported for annotation region wiring",
  );
  return {
    SelectionTracker,
    /** A region gesture ends, as the Select Region tool or an empty-space drag ends it. */
    endRegion: (end: RegionEnd) => regionListeners.forEach((l) => l(end)),
  };
}

/** The open document, with the page text its regions read. */
const source = {
  pageNumberOf: (ref: { objectNumber: number }) => ref.objectNumber - 9,
  readDetails: () => Promise.resolve({ text: "from page" }),
};

/** A selection capability whose text selections are made, cleared and read by hand. */
function mockSelection() {
  let committed: (() => void) | undefined;
  let cleared: (() => void) | undefined;
  let range: object | null = null;
  const reads: Array<{
    resolve: (text: string) => void;
    reject: (error: Error) => void;
  }> = [];
  return {
    selection: {
      onCommitted: (listener: () => void) => {
        committed = listener;
        return () => undefined;
      },
      onCleared: (listener: () => void) => {
        cleared = listener;
        return () => undefined;
      },
      hasSelection: () => range !== null,
      getRange: () => range,
      getSnapshot: () => ({
        pages: [
          {
            page: page(1),
            segments: [{ rect: { x: 1, y: 2, width: 3, height: 4 } }],
          },
        ],
      }),
      readText: () =>
        new Promise<string>((resolve, reject) => {
          reads.push({ resolve, reject });
        }),
      clear: () => undefined,
    },
    /** A drag that selects text ends; each selection has its own characters. */
    select(first = 0): void {
      range = {
        start: { page: page(1), index: first },
        end: { page: page(1), index: first + 5 },
      };
      committed?.();
    },
    /** A click clears the selection. */
    clear(): void {
      range = null;
      cleared?.();
    },
    reads,
  };
}

/** Reports made in the tracker's context, as plain data. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const textReport = (text: string) => ({
  selection: {
    selection: {
      kind: "text",
      text,
      pages: [{ page: 1, rects: [[1, 2, 4, 6]] }],
    },
  },
});

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a text read that ends after the selection is cleared reports nothing", async () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  const text = mockSelection();
  tracker.follow(text.selection, source);
  reports.length = 0;
  text.select();
  text.clear();
  text.reads[0]!.resolve("old text");
  await tick();
  assert.deepEqual(plain(reports), [{ selection: { selection: null } }]);
  assert.equal(tracker.selectedText, undefined);
});

test("an older text read never replaces a newer selection's text", async () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  const text = mockSelection();
  tracker.follow(text.selection, source);
  text.select(0);
  text.clear();
  text.select(10);
  text.reads[1]!.resolve("new text");
  text.reads[0]!.resolve("old text");
  await tick();
  assert.deepEqual(plain(reports.at(-1)), textReport("new text"));
  assert.equal(tracker.selectedText, "new text");
});

test("text is reported on one line, with a box per line of the selection", async () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  const text = mockSelection();
  tracker.follow(text.selection, source);
  text.select();
  text.reads[0]!.resolve("  Scaled dot-product\n  attention  ");
  await tick();
  assert.deepEqual(
    plain(reports.at(-1)),
    textReport("Scaled dot-product attention"),
  );
});

test("a PDF that forbids copying reports no text and keeps the last copy", async () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  const text = mockSelection();
  tracker.follow(text.selection, source);
  reports.length = 0;
  text.select();
  text.reads[0]!.reject(new Error("permission-denied"));
  await tick();
  assert.deepEqual(plain(reports), []);
  assert.equal(tracker.selectedText, undefined);
});

test("following a document tells the extension nothing is selected", () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  tracker.follow(mockSelection().selection, source);
  assert.deepEqual(plain(reports), [{ selection: { selection: null } }]);
});

test("following again while text or a region is selected reports nothing", () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  const text = mockSelection();
  tracker.follow(text.selection, source);
  text.select();
  reports.length = 0;
  // The source changes (the text layer arrives): the effect follows again.
  tracker.follow(text.selection, source);
  assert.deepEqual(reports, []);
  text.clear();
  tracker.setAnnotationRegion({ kind: "region", page: 1, rect: [1, 2, 3, 4] });
  reports.length = 0;
  tracker.follow(text.selection, source);
  assert.deepEqual(reports, []);
});

const annotationRegion: RegionSelection = {
  kind: "region",
  page: 1,
  rect: [74, 90, 205, 110],
  text: "Synthetic page 1",
};

test("annotation region survives a later textCleared (no null wipe)", () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  const { selection, clear } = mockSelection();
  tracker.follow(selection, source);

  tracker.setAnnotationRegion(annotationRegion);
  assert.deepEqual(tracker.region, annotationRegion);
  const before = reports.length;
  clear();
  assert.deepEqual(tracker.region, annotationRegion);
  assert.equal(
    reports.length,
    before,
    "textCleared must not report null while an annotation region is active",
  );
  const last = reports.at(-1) as { selection?: { selection?: unknown } };
  assert.notEqual(last?.selection?.selection, null);
});

test("reportSelection with no text selection awaits active annotation region", async () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  tracker.follow(mockSelection().selection, source);
  tracker.setAnnotationRegion(annotationRegion);
  assert.deepEqual(tracker.region, annotationRegion);
  await tracker.reportSelection(mockSelection().selection);
  assert.ok(tracker.region);
  assert.equal(tracker.region?.kind, "region");
  // After enrich, quote should prefer page text from readRegionDetails.
  assert.equal(tracker.region?.text, "from page");
});

test("clearing annotation region reports null through the tracker path", () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  tracker.setAnnotationRegion(annotationRegion);
  tracker.setAnnotationRegion(undefined);
  const last = reports.at(-1) as { selection?: { selection?: unknown } };
  assert.equal(last?.selection?.selection, null);
  assert.equal(tracker.region, undefined);
});

test("a click does not clear an annotation-owned region", () => {
  const reports: unknown[] = [];
  const { SelectionTracker, endRegion } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  tracker.follow(mockSelection().selection, source);

  tracker.setAnnotationRegion(annotationRegion);
  const before = reports.length;
  endRegion({ kind: "click" });
  assert.deepEqual(tracker.region, annotationRegion);
  assert.equal(
    reports.length,
    before,
    "a click must not wipe annotation region / host snapshot",
  );
});

test("a drawn region is reported at once, then again with its text", async () => {
  const reports: unknown[] = [];
  const { SelectionTracker, endRegion } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  tracker.follow(mockSelection().selection, source);
  reports.length = 0;

  endRegion({ kind: "drawn", page: page(2), rect: [10, 20, 50, 60] });
  assert.deepEqual(plain(tracker.region), {
    kind: "region",
    page: 2,
    rect: [10, 20, 50, 60],
  });
  assert.equal(reports.length, 1);
  await tracker.reportSelection(mockSelection().selection);
  assert.deepEqual(plain(reports.at(-1)), {
    selection: {
      selection: {
        kind: "region",
        page: 2,
        rect: [10, 20, 50, 60],
        text: "from page",
      },
    },
  });
});

test("a click still clears a dragged region", () => {
  const reports: unknown[] = [];
  const { SelectionTracker, endRegion } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  tracker.follow(mockSelection().selection, source);

  endRegion({ kind: "drawn", page: page(1), rect: [10, 20, 50, 60] });
  assert.equal(tracker.region?.kind, "region");
  endRegion({ kind: "click" });
  assert.equal(tracker.region, undefined);
  const last = reports.at(-1) as { selection?: { selection?: unknown } };
  assert.equal(last?.selection?.selection, null);
});

test("a region on a page the document lacks is ignored", () => {
  const reports: unknown[] = [];
  const { SelectionTracker, endRegion } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  tracker.follow(mockSelection().selection, {
    ...source,
    pageNumberOf: () => undefined,
  });
  reports.length = 0;
  endRegion({ kind: "drawn", page: page(1), rect: [10, 20, 50, 60] });
  assert.equal(tracker.region, undefined);
  assert.equal(reports.length, 0);
});

test("a stopped tracker no longer hears region gestures", () => {
  const reports: unknown[] = [];
  const { SelectionTracker, endRegion } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  const stop = tracker.follow(mockSelection().selection, source);
  stop();
  endRegion({ kind: "drawn", page: page(1), rect: [10, 20, 50, 60] });
  assert.equal(tracker.region, undefined);
});

// Copy link to this asks the viewer for its selection and waits for the
// answer (PdfViewerPanel.ensureSelection). With nothing selected the viewer
// must still answer, or the page-only link is copied only after the wait
// times out, and a paste in the meantime gets the old clipboard.
test("reportSelection with nothing selected reports none at once", async () => {
  const reports: unknown[] = [];
  const { SelectionTracker } = loadSelectionTracker(reports);
  const tracker = new SelectionTracker(() => undefined);
  await tracker.reportSelection(mockSelection().selection);
  // No selection capability at all: the viewer's selection is missing.
  await tracker.reportSelection(undefined);
  assert.equal(reports.length, 2);
  for (const report of reports) {
    const answer = report as { selection?: { selection?: unknown } };
    assert.equal(answer.selection?.selection, null);
  }
});
