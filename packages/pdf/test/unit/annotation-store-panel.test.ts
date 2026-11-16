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

const PDF = new Uint8Array([37, 80, 68, 70]); // %PDF
const PDF_SHA = createHash("sha256").update(PDF).digest("hex");

/** A panel on a PDF whose annotation files live in `kept`, keyed by hash. */
function open(
  store: PdfAnnotationFiles | undefined,
  overrides: Partial<PdfFiles> = {},
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
    "file:///vault/inbox/paper.pdf",
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
  assert.deepEqual(calls.slice(-2), [
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
