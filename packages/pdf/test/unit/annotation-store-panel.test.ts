import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PdfViewerPanel } from "../../src/host/viewer/panel";
import type {
  PdfAnnotationFiles,
  PdfFiles,
  PdfWebview,
} from "../../src/shared/host";
import type { HostMessage } from "../../src/shared/messages";
import { AnnotationOwnership } from "../../src/shared/annotation-ownership";
import { parseViewerMessage } from "../../src/shared/messages";
import { parseViewSettings } from "../../src/shared/view-settings";
import {
  parseAnnotations,
  serializeAnnotations,
} from "../../src/shared/annotation-store";
import { mergeAnnotationFile } from "../../src/shared/annotation-merge";
import { bundle, refOn } from "./support/bundle";

const PDF = new Uint8Array([37, 80, 68, 70]); // %PDF
const PDF_SHA = createHash("sha256").update(PDF).digest("hex");

/** A panel on a PDF whose annotation files live in `kept`, keyed by hash. */
function open(
  store: PdfAnnotationFiles | undefined,
  overrides: Partial<PdfFiles> = {},
  uri = "file:///vault/inbox/paper.pdf",
) {
  const posted: HostMessage[] = [];
  const errors: string[] = [];
  let receive: ((message: unknown) => unknown) | undefined;
  let pdfWrites = 0;
  const webview: PdfWebview = {
    cspSource: "'self'",
    asset: (name) => `/viewer/${name}`,
    setHTML: () => undefined,
    post: (message) => posted.push(message),
    onMessage: (listener) => {
      receive = listener;
      return () => undefined;
    },
    deliver: (_bytes, load) => ({ url: `/bytes?load=${load}` }),
  };
  const files: PdfFiles = {
    read: async () => PDF,
    watch: () => () => undefined,
    displayPath: () => "inbox/paper.pdf",
    hash: async () => PDF_SHA,
    writeAtomic: async () => {
      pdfWrites += 1;
      return { sha256: PDF_SHA };
    },
    ...(store ? { annotations: store } : {}),
    ...overrides,
  };
  const panel = new PdfViewerPanel(
    uri,
    webview,
    {
      files,
      error: (message) => errors.push(message),
      openExternal: async () => undefined,
      refocus: () => undefined,
    },
    {
      toolbar: { mode: "chrome", dock: "bottom" },
      settings: parseViewSettings({}),
      position: undefined,
      savePosition: () => undefined,
      route: async () => undefined,
    },
  );
  return {
    panel,
    posted,
    errors,
    pdfWrites: () => pdfWrites,
    receive: (message: unknown) => receive?.(message),
    load: () => {
      const load = posted.filter((m) => m.type === "load").at(-1);
      assert.ok(load && load.type === "load");
      return load;
    },
  };
}

function memoryStore() {
  const kept = new Map<string, string>();
  const calls: string[] = [];
  const store: PdfAnnotationFiles = {
    read: async (uri, sha256) => {
      calls.push(`read ${uri} ${sha256}`);
      return kept.get(sha256);
    },
    write: async (uri, sha256, text) => {
      calls.push(`write ${uri} ${sha256} ${text === undefined ? "-" : "text"}`);
      if (text === undefined) {
        kept.delete(sha256);
      } else {
        kept.set(sha256, text);
      }
    },
  };
  return { kept, calls, store };
}

test("the annotations kept for the PDF's hash go to the viewer with its bytes", async () => {
  const { kept, store } = memoryStore();
  kept.set(PDF_SHA, '{"version":1,"annotations":[]}');
  const { receive, load } = open(store);
  await receive({ type: "ready" });
  assert.equal(load().annotations, '{"version":1,"annotations":[]}');
});

test("a PDF with no annotations kept loads without any", async () => {
  const { store } = memoryStore();
  const { receive, load } = open(store);
  await receive({ type: "ready" });
  assert.equal("annotations" in load(), false);
});

test("Lumiere's annotations are saved by the hash of the bytes shown, and the PDF is not written", async () => {
  const { kept, calls, store } = memoryStore();
  const { receive, load, pdfWrites } = open(store);
  await receive({ type: "ready" });
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "A",
  });
  assert.equal(kept.get(PDF_SHA), "A");
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: null,
  });
  assert.equal(kept.has(PDF_SHA), false);
  // Each save reads the file first, to merge with what another editor saved.
  assert.deepEqual(calls.filter((call) => call.startsWith("write")).slice(-2), [
    `write file:///vault/inbox/paper.pdf ${PDF_SHA} text`,
    `write file:///vault/inbox/paper.pdf ${PDF_SHA} -`,
  ]);
  assert.equal(pdfWrites(), 0);
});

test("a save about an earlier load is dropped", async () => {
  const { kept, store } = memoryStore();
  const { receive, load } = open(store);
  await receive({ type: "ready" });
  await receive({ type: "ready" });
  assert.equal(load().load, 2);
  await receive({
    type: "annotationStoreSave",
    load: 1,
    sha256: PDF_SHA,
    text: "old",
  });
  assert.equal(kept.size, 0);
});

test("a reload that cannot read the PDF leaves the editor on the bytes it shows", async () => {
  const { kept, store } = memoryStore();
  let readable = true;
  const { panel, receive, load, errors } = open(store, {
    read: async () => {
      if (!readable) {
        throw new Error("EBUSY: resource busy");
      }
      return PDF;
    },
  });
  await receive({ type: "ready" });
  readable = false;
  await panel.reloadFromDisk();
  assert.match(errors.at(-1) ?? "", /EBUSY/u);
  // The viewer still shows load 1; its annotations are still kept.
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "A",
  });
  assert.equal(kept.get(PDF_SHA), "A");
});

/** Hold every read of the PDF until `release`. */
function gatedRead(bytes: () => Uint8Array) {
  let gate: Promise<void> | undefined;
  let release = () => undefined as void;
  return {
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
    read: async () => {
      await gate;
      return bytes();
    },
  };
}

test("a store save sent while a reload reads the PDF is kept under the bytes it was made on", async () => {
  const { kept, store } = memoryStore();
  let disk = PDF;
  const reads = gatedRead(() => disk);
  const { panel, receive, load } = open(store, { read: reads.read });
  await receive({ type: "ready" });
  disk = new Uint8Array([37, 80, 68, 70, 45, 50]); // another program's version
  reads.hold();
  const reloading = panel.reloadFromDisk();
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "A",
  });
  reads.release();
  await reloading;
  assert.equal(load().load, 2);
  assert.equal(kept.get(PDF_SHA), "A");
  assert.equal(kept.size, 1);
});

test("a reload of the same bytes gets the annotations saved while it read them", async () => {
  const { kept, store } = memoryStore();
  const reads = gatedRead(() => PDF);
  const { panel, receive, load } = open(store, { read: reads.read });
  await receive({ type: "ready" });
  reads.hold();
  const reloading = panel.reloadFromDisk();
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "A",
  });
  reads.release();
  await reloading;
  assert.equal(kept.get(PDF_SHA), "A");
  assert.equal(load().annotations, "A");
});

test("a watcher event that leaves the PDF's bytes as they were does not reload it", async () => {
  let changed: (() => void) | undefined;
  const { posted, receive } = open(memoryStore().store, {
    watch: (_uri, onChange) => {
      changed = onChange;
      return () => undefined;
    },
  });
  await receive({ type: "ready" });
  changed?.(); // touched or synced, same bytes
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(posted.filter((m) => m.type === "load").length, 1);
});

test("a store save is filed under the hash the viewer names, when that is its bytes", async () => {
  const { kept, store } = memoryStore();
  const SAVED_SHA = "c".repeat(64);
  const { panel, receive, load } = open(store, {
    writeAtomic: async () => ({ sha256: SAVED_SHA }),
  });
  await receive({ type: "ready" });
  panel.writeAnnotations("pdf");
  await receive({
    type: "annotationSave",
    write: 1,
    load: load().load,
    baseSha256: PDF_SHA,
    data: new Uint8Array([1]).buffer,
  });
  // Sent before the viewer heard that the PDF is now SAVED_SHA.
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "before",
  });
  assert.equal(kept.get(PDF_SHA), "before");
  assert.equal(kept.has(SAVED_SHA), false);
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: SAVED_SHA,
    text: "after",
  });
  assert.equal(kept.get(SAVED_SHA), "after");
  // A hash the viewer was never given is no file of its own.
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: "b".repeat(64),
    text: "other",
  });
  assert.equal(kept.size, 2);
});

// Each pane's engine numbers its new annotations itself: both call theirs 40.
const markA = serializeAnnotations(
  bundle([{ ref: refOn(40), nm: "uuid-a", contents: "A" }]),
)!;
const markB = serializeAnnotations(
  bundle([{ ref: refOn(40), nm: "uuid-b", contents: "B" }]),
)!;

async function namesKept(text: string | undefined): Promise<string[]> {
  if (text === undefined) {
    return [];
  }
  const stored = (await parseAnnotations(text))!;
  return stored.bundle.items
    .map((item) => String((item.data as { nm?: string }).nm))
    .sort();
}

/** Two editors of the same PDF, on one host's annotation files. */
async function twoPanes(memory = memoryStore()) {
  const one = open(memory.store);
  const two = open(memory.store);
  await one.receive({ type: "ready" });
  await two.receive({ type: "ready" });
  const save = (pane: typeof one, text: string | null) =>
    pane.receive({
      type: "annotationStoreSave",
      load: pane.load().load,
      sha256: PDF_SHA,
      text,
    });
  return { ...memory, one, two, save };
}

test("a mark made in pane 1, then one in pane 2: the file keeps both", async () => {
  const { kept, one, two, save } = await twoPanes();
  await save(one, markA);
  await save(two, markB);
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-a", "uuid-b"]);
});

test("pane 2 makes and deletes a mark: the file keeps pane 1's", async () => {
  const { kept, one, two, save } = await twoPanes();
  await save(one, markA);
  await save(two, markB);
  await save(two, null);
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-a"]);
});

test("the other pane is sent what the file holds after a save", async () => {
  const { kept, one, two, save } = await twoPanes();
  await save(one, markA);
  const changed = two.posted.filter(
    (message) => message.type === "annotationStoreChanged",
  );
  assert.deepEqual(changed, [
    {
      type: "annotationStoreChanged",
      load: two.load().load,
      sha256: PDF_SHA,
      revision: 1,
      text: kept.get(PDF_SHA),
    },
  ]);
  assert.equal(
    one.posted.some((message) => message.type === "annotationStoreChanged"),
    false,
  );
});

test("once pane 2 shows pane 1's mark, deleting it there deletes it from the file", async () => {
  const { kept, one, two, save } = await twoPanes();
  await save(one, markA);
  // Sent before pane 2 showed A: it does not delete A.
  await save(two, markB);
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-a", "uuid-b"]);
  await two.receive({
    type: "annotationStoreShown",
    load: two.load().load,
    sha256: PDF_SHA,
    revision: 1,
  });
  // Pane 2 deletes A and keeps B.
  await save(two, markB);
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-b"]);
});

test("a revision the host never sent changes nothing", async () => {
  const { kept, one, two, save } = await twoPanes();
  await save(one, markA);
  await two.receive({
    type: "annotationStoreShown",
    load: two.load().load,
    sha256: PDF_SHA,
    revision: 9,
  });
  await save(two, markB);
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-a", "uuid-b"]);
});

test("a pane that still shows a mark another pane deleted does not bring it back", async () => {
  const memory = memoryStore();
  memory.kept.set(PDF_SHA, markA);
  const { kept, one, two, save } = await twoPanes(memory);
  // Both opened with A; pane 1 deletes it.
  await save(one, null);
  assert.equal(kept.has(PDF_SHA), false);
  // Pane 2 adds B while it still shows A as it was.
  const both = serializeAnnotations(
    bundle([
      { ref: refOn(40), nm: "uuid-a", contents: "A" },
      { ref: refOn(41), nm: "uuid-b", contents: "B" },
    ]),
  )!;
  await save(two, both);
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-b"]);
});

test("a host with nowhere to keep annotations says so once", async () => {
  const { receive, load, errors } = open(undefined);
  await receive({ type: "ready" });
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "A",
  });
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "B",
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /not kept/u);
});

test("a store that cannot be written reports the failure", async () => {
  const { panel, receive, load, errors } = open({
    read: async () => undefined,
    write: async () => {
      throw new Error("disk full");
    },
  });
  const failures: string[] = [];
  panel.onAnnotationSaveFailed((message) => failures.push(message));
  await receive({ type: "ready" });
  await receive({
    type: "annotationStoreSave",
    load: load().load,
    sha256: PDF_SHA,
    text: "A",
  });
  assert.deepEqual(failures, ["disk full"]);
  assert.match(errors.at(-1)!, /disk full/u);
});

test("a store that cannot be read still opens the PDF, and says why", async () => {
  const { receive, load, errors } = open({
    read: async () => {
      throw new Error("permission denied");
    },
    write: async () => undefined,
  });
  await receive({ type: "ready" });
  assert.equal("annotations" in load(), false);
  assert.match(errors[0]!, /permission denied/u);
});

test("Export Annotated Copy and Save into This PDF ask the viewer, and its copy reaches the extension", async () => {
  const { panel, posted, receive, load } = open(memoryStore().store);
  await receive({ type: "ready" });
  panel.writeAnnotations("copy");
  panel.writeAnnotations("pdf");
  assert.deepEqual(posted.slice(-2), [
    { type: "annotationWrite", load: load().load, to: "copy" },
    { type: "annotationWrite", load: load().load, to: "pdf" },
  ]);
  const exported: number[] = [];
  panel.onAnnotationExport((data) => exported.push(data.byteLength));
  const edits: string[] = [];
  panel.onAnnotationEmbeddedEdit(() => edits.push("edit"));
  await receive({
    type: "annotationExport",
    load: load().load,
    data: new Uint8Array([1, 2, 3]).buffer,
  });
  await receive({ type: "annotationEmbeddedEdit", load: load().load });
  await receive({ type: "annotationEmbeddedEdit", load: 99 });
  assert.deepEqual(exported, [3]);
  assert.deepEqual(edits, ["edit"]);
});

test("annotation messages from the viewer are checked field by field", () => {
  assert.deepEqual(
    parseViewerMessage({
      type: "annotationStoreSave",
      load: 1,
      sha256: PDF_SHA,
      text: null,
    }),
    {
      type: "annotationStoreSave",
      load: 1,
      sha256: PDF_SHA,
      text: null,
    },
  );
  for (const bad of [
    { type: "annotationStoreSave", load: 0, text: "A" },
    { type: "annotationStoreSave", load: 1, text: 5 },
    { type: "annotationStoreSave", load: 1 },
    { type: "annotationStoreSave", load: 1, text: "A" },
    { type: "annotationStoreSave", load: 1, sha256: "../a", text: "A" },
    { type: "annotationExport", load: 1, data: "bytes" },
    { type: "annotationEmbeddedEdit", load: -1 },
  ]) {
    assert.equal(parseViewerMessage(bad), undefined, JSON.stringify(bad));
  }
});

test("Lumiere owns what it imported or made; changes to the PDF's own are the PDF's", () => {
  const owned = new AnnotationOwnership();
  owned.imported(["obj:10"]);
  assert.equal(owned.change("update", "obj:10"), "store");
  assert.equal(owned.change("create", "obj:20"), "store");
  assert.equal(owned.isOwn("obj:20"), true);
  assert.equal(owned.change("update", "obj:5"), "pdf");
  assert.equal(owned.change("delete", "obj:5"), "pdf");
  // Deleting one of Lumiere's does not disown it: Undo restores the same key.
  assert.equal(owned.change("delete", "obj:20"), "store");
  assert.equal(owned.isOwn("obj:20"), true);
  assert.equal(owned.change("update", "obj:20"), "store");
  // After Save into This PDF what went into it is the PDF's.
  assert.equal(owned.savedIntoPdf(["obj:10"]), true);
  assert.equal(owned.isOwn("obj:10"), false);
  assert.equal(owned.isOwn("obj:20"), true);
  assert.equal(owned.savedIntoPdf(owned.keys()), false);
  assert.equal(owned.change("update", "obj:10"), "pdf");
});

/**
 * Two VS Code windows on one disk: each extension host has its own
 * annotation files, which share `kept` and tell every watcher of a write,
 * as a file watcher would.
 */
function twoWindows() {
  const kept = new Map<string, string>();
  const watchers = new Set<{ sha256: string; onChange: () => void }>();
  const window = (): PdfAnnotationFiles => ({
    read: async (_uri, sha256) => kept.get(sha256),
    write: async (_uri, sha256, text) => {
      if (text === undefined) {
        kept.delete(sha256);
      } else {
        kept.set(sha256, text);
      }
      for (const watcher of [...watchers]) {
        if (watcher.sha256 === sha256) {
          watcher.onChange();
        }
      }
    },
    watch: (_uri, sha256, onChange) => {
      const watcher = { sha256, onChange };
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },
  });
  return { kept, watchers, first: window(), second: window() };
}

/** Let the watcher's read and the store's queue run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("a pane in another window is sent the file when another window saves it", async () => {
  const { kept, first, second } = twoWindows();
  const one = open(first);
  const two = open(second);
  await one.receive({ type: "ready" });
  await two.receive({ type: "ready" });
  await one.receive({
    type: "annotationStoreSave",
    load: one.load().load,
    sha256: PDF_SHA,
    text: markA,
  });
  await settle();
  const changed = two.posted.filter((m) => m.type === "annotationStoreChanged");
  assert.deepEqual(changed, [
    {
      type: "annotationStoreChanged",
      load: two.load().load,
      sha256: PDF_SHA,
      revision: 1,
      text: kept.get(PDF_SHA),
    },
  ]);
  // Its own write, seen by its own watcher, is no news to pane 1.
  assert.equal(
    one.posted.some((m) => m.type === "annotationStoreChanged"),
    false,
  );
  // Pane 2's unsaved mark is merged with pane 1's, not written over it.
  await two.receive({
    type: "annotationStoreSave",
    load: two.load().load,
    sha256: PDF_SHA,
    text: markB,
  });
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-a", "uuid-b"]);
});

test("a save over another window's write its watcher has not reported shows that write here too", async () => {
  const { kept, first } = twoWindows();
  const one = open(first);
  await one.receive({ type: "ready" });
  kept.set(PDF_SHA, markB); // another window's write, not yet reported
  await one.receive({
    type: "annotationStoreSave",
    load: one.load().load,
    sha256: PDF_SHA,
    text: markA,
  });
  const changed = one.posted.filter((m) => m.type === "annotationStoreChanged");
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.type, "annotationStoreChanged");
  assert.deepEqual(
    await namesKept(
      changed[0]?.type === "annotationStoreChanged"
        ? (changed[0].text ?? undefined)
        : undefined,
    ),
    ["uuid-a", "uuid-b"],
  );
});

test("a closed pane stops watching its annotation file", async () => {
  const { watchers, first } = twoWindows();
  const one = open(first);
  await one.receive({ type: "ready" });
  assert.equal(watchers.size, 1);
  one.panel.dispose();
  assert.equal(watchers.size, 0);
});

test("two PDFs with the same bytes in two folders keep apart annotation files", async () => {
  const kept = new Map<string, string>();
  const fileOf = (uri: string, sha256: string) =>
    `${uri.split("/")[3]}/${sha256}`;
  const store: PdfAnnotationFiles = {
    key: fileOf,
    read: async (uri, sha256) => kept.get(fileOf(uri, sha256)),
    write: async (uri, sha256, text) => {
      kept.set(fileOf(uri, sha256), text ?? "");
    },
  };
  const one = open(store);
  const two = open(store, {}, "file:///other/inbox/paper.pdf");
  await one.receive({ type: "ready" });
  await two.receive({ type: "ready" });
  await one.receive({
    type: "annotationStoreSave",
    load: one.load().load,
    sha256: PDF_SHA,
    text: markA,
  });
  assert.equal(
    two.posted.some((m) => m.type === "annotationStoreChanged"),
    false,
  );
});

test("a save that adds nothing does not write over another window's write that lands meanwhile", async () => {
  const { kept, first, second } = twoWindows();
  const one = open(first);
  // Window 2's store: another window writes the file between its read and its write.
  let landsAfterRead: (() => void) | undefined;
  const two = open({
    ...second,
    read: async (uri, sha256) => {
      const text = await second.read(uri, sha256);
      landsAfterRead?.();
      landsAfterRead = undefined;
      return text;
    },
  });
  await one.receive({ type: "ready" });
  await two.receive({ type: "ready" });
  await one.receive({
    type: "annotationStoreSave",
    load: one.load().load,
    sha256: PDF_SHA,
    text: markA,
  });
  await settle();
  const shown = two.posted.find((m) => m.type === "annotationStoreChanged");
  assert.ok(shown?.type === "annotationStoreChanged");
  await two.receive({
    type: "annotationStoreShown",
    load: two.load().load,
    sha256: PDF_SHA,
    revision: shown.revision,
  });
  // Window 1 makes a second mark; its write lands while window 2 saves
  // again what it was sent, with nothing of its own.
  const both = mergeAnnotationFile(kept.get(PDF_SHA), undefined, markB)!;
  landsAfterRead = () => kept.set(PDF_SHA, both);
  await two.receive({
    type: "annotationStoreSave",
    load: two.load().load,
    sha256: PDF_SHA,
    text: shown.text,
  });
  assert.deepEqual(await namesKept(kept.get(PDF_SHA)), ["uuid-a", "uuid-b"]);
});
