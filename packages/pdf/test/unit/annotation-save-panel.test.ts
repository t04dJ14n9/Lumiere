import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PdfViewerPanel } from "../../src/host/viewer/panel";
import type { PdfFiles, PdfWebview } from "../../src/shared/host";
import type { HostMessage } from "../../src/shared/messages";
import { parseViewSettings } from "../../src/shared/view-settings";

const INITIAL = new Uint8Array([37, 80, 68, 70]); // %PDF
const INITIAL_SHA = createHash("sha256").update(INITIAL).digest("hex");

function open(files: Partial<PdfFiles> = {}) {
  const posted: HostMessage[] = [];
  const errors: string[] = [];
  let receive: ((message: unknown) => unknown) | undefined;
  let watchCb: (() => void) | undefined;
  let writes = 0;
  const webview: PdfWebview = {
    cspSource: "'self'",
    asset: (name) => `/lumiere/pdf/viewer/${name}`,
    setHTML: () => undefined,
    post: (message) => posted.push(message),
    onMessage: (listener) => {
      receive = listener;
      return () => {
        receive = undefined;
      };
    },
    deliver: (bytes, load) => ({
      url: `/lumiere/pdf/bytes?panel=p&load=${load}`,
    }),
  };
  let disk = INITIAL;
  const panel = new PdfViewerPanel(
    "file:///papers/paper.pdf",
    webview,
    {
      files: {
        read: async () => disk,
        watch: (_uri, onChange) => {
          watchCb = onChange;
          return () => {
            watchCb = undefined;
          };
        },
        displayPath: () => "papers/paper.pdf",
        hash: async () => createHash("sha256").update(disk).digest("hex"),
        writeAtomic: async (_uri, bytes) => {
          writes += 1;
          disk = new Uint8Array(bytes);
          return {
            sha256: createHash("sha256").update(disk).digest("hex"),
          };
        },
        ...files,
      },
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
    writes: () => writes,
    triggerWatch: () => watchCb?.(),
    receive: (message: unknown) => receive?.(message),
  };
}

test("annotationSave overwrites and suppresses watcher reload", async () => {
  const { posted, receive, writes, triggerWatch } = open();
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  assert.equal(load.sha256, INITIAL_SHA);

  const next = new Uint8Array([37, 80, 68, 70, 45, 97]); // %PDF-a
  const before = posted.length;
  await receive({
    type: "annotationSave",
    load: load.load,
    baseSha256: INITIAL_SHA,
    data: next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength),
  });
  assert.equal(writes(), 1);
  const result = posted
    .slice(before)
    .find((m) => m.type === "annotationSaveResult");
  assert.ok(result && result.type === "annotationSaveResult" && result.ok);
  const loadsBeforeWatch = posted.filter((m) => m.type === "load").length;
  triggerWatch();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    posted.filter((m) => m.type === "load").length,
    loadsBeforeWatch,
    "self-write must not reload the viewer",
  );
});

const bytesOf = (...values: number[]) =>
  new Uint8Array([37, 80, 68, 70, ...values]);
const save = (load: number, base: string, data: Uint8Array) => ({
  type: "annotationSave",
  load,
  baseSha256: base,
  data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
});

test("a second save sent before the first one's result is no conflict", async () => {
  const { posted, receive, panel, writes } = open();
  const conflicts: unknown[] = [];
  panel.onAnnotationConflict((payload) => conflicts.push(payload));
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  // The viewer still names the file as loaded: the first result is on its way.
  await receive(save(load.load, INITIAL_SHA, bytesOf(1)));
  await receive(save(load.load, INITIAL_SHA, bytesOf(1, 2)));
  assert.equal(conflicts.length, 0);
  assert.equal(writes(), 2);
  const results = posted.filter((m) => m.type === "annotationSaveResult");
  assert.deepEqual(
    results.map((m) => m.type === "annotationSaveResult" && m.ok),
    [true, true],
  );
});

test("overlapping saves reach the disk in the order the viewer sent them", async () => {
  let disk = INITIAL;
  let firstHash = true;
  const { posted, receive } = open({
    read: async () => disk,
    hash: async () => {
      // The first save's check of the disk is the slow one.
      if (firstHash) {
        firstHash = false;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return createHash("sha256").update(disk).digest("hex");
    },
    writeAtomic: async (_uri, bytes) => {
      disk = new Uint8Array(bytes);
      return { sha256: createHash("sha256").update(disk).digest("hex") };
    },
  });
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  const first = receive(save(load.load, INITIAL_SHA, bytesOf(1)));
  const second = receive(save(load.load, INITIAL_SHA, bytesOf(1, 2)));
  await Promise.all([first, second]);
  assert.deepEqual([...disk], [...bytesOf(1, 2)]);
});

test("Keep mine that cannot write reports the failure as a save does", async () => {
  const { posted, receive, panel, errors } = open({
    writeAtomic: async () => {
      throw new Error("EACCES: permission denied");
    },
  });
  const failed: unknown[] = [];
  panel.onAnnotationSaveFailed((message) => failed.push(message));
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  await assert.doesNotReject(panel.keepMine(new ArrayBuffer(4), load.load));
  assert.equal(failed.length, 1);
  assert.match(errors.at(-1) ?? "", /EACCES/);
  const result = posted.filter((m) => m.type === "annotationSaveResult").at(-1);
  assert.ok(result && result.type === "annotationSaveResult" && !result.ok);
});

test("Retry after a failed write into the PDF asks for the PDF write again", async () => {
  const { posted, receive, panel } = open({
    writeAtomic: async () => {
      throw new Error("EACCES: permission denied");
    },
  });
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  await receive(save(load.load, INITIAL_SHA, bytesOf(1)));
  panel.postAnnotationRetry();
  assert.deepEqual(posted.at(-1), {
    type: "annotationWrite",
    load: load.load,
    to: "pdf",
  });
});

test("Retry after a failed Keep mine asks for the PDF write again", async () => {
  const { posted, receive, panel } = open({
    writeAtomic: async () => {
      throw new Error("EACCES: permission denied");
    },
  });
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  await panel.keepMine(new ArrayBuffer(4), load.load);
  panel.postAnnotationRetry();
  assert.deepEqual(posted.at(-1), {
    type: "annotationWrite",
    load: load.load,
    to: "pdf",
  });
});

test("Retry goes back to the annotation file once the PDF is saved", async () => {
  let failing = true;
  const { posted, receive, panel } = open({
    writeAtomic: async (_uri, bytes) => {
      if (failing) {
        throw new Error("EACCES: permission denied");
      }
      return { sha256: createHash("sha256").update(bytes).digest("hex") };
    },
  });
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  await receive(save(load.load, INITIAL_SHA, bytesOf(1)));
  failing = false;
  await receive(save(load.load, INITIAL_SHA, bytesOf(1)));
  panel.postAnnotationRetry();
  assert.deepEqual(posted.at(-1), { type: "annotationRetry", load: load.load });
});

test("Retry repeats the annotation file save when that failed after the PDF write", async () => {
  const { posted, receive, panel } = open({
    writeAtomic: async () => {
      throw new Error("EACCES: permission denied");
    },
    annotations: {
      read: async () => undefined,
      write: async () => {
        throw new Error("disk full");
      },
    },
  });
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  await receive(save(load.load, INITIAL_SHA, bytesOf(1)));
  await receive({ type: "annotationStoreSave", load: load.load, text: "A" });
  panel.postAnnotationRetry();
  assert.deepEqual(posted.at(-1), { type: "annotationRetry", load: load.load });
});

test("annotationSave conflicts when disk hash diverges", async () => {
  let writes = 0;
  const { posted, receive, panel } = open({
    hash: async () => "other-disk-hash",
    writeAtomic: async () => {
      writes += 1;
      return { sha256: "unused" };
    },
  });
  const conflicts: unknown[] = [];
  panel.onAnnotationConflict((payload) => conflicts.push(payload));
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  await receive({
    type: "annotationSave",
    load: load.load,
    baseSha256: load.sha256,
    data: new ArrayBuffer(4),
  });
  assert.equal(writes, 0);
  assert.equal(conflicts.length, 1);
  const result = posted.find((m) => m.type === "annotationSaveResult");
  assert.ok(result && result.type === "annotationSaveResult" && !result.ok);
  if (result && result.type === "annotationSaveResult" && !result.ok) {
    assert.equal(result.reason, "conflict");
  }
});

test("annotationSave suppresses watcher that fires during writeAtomic", async () => {
  let watchCb: (() => void) | undefined;
  let wrote = 0;
  // Shared disk so mid-write hash() sees the bytes already on disk
  // (realistic: rename completed before the watcher callback).
  let disk = INITIAL;
  const { posted, receive } = open({
    watch: (_uri, onChange) => {
      watchCb = onChange;
      return () => {
        watchCb = undefined;
      };
    },
    hash: async () => createHash("sha256").update(disk).digest("hex"),
    writeAtomic: async (_uri, bytes) => {
      disk = new Uint8Array(bytes);
      const sha256 = createHash("sha256").update(disk).digest("hex");
      // Simulate the FS watcher firing as soon as the file is replaced,
      // before annotation-save can call acceptWrite.
      watchCb?.();
      wrote += 1;
      return { sha256 };
    },
  });
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  const loadsBefore = posted.filter((m) => m.type === "load").length;
  const next = new Uint8Array([37, 80, 68, 70, 45, 98]); // %PDF-b
  await receive({
    type: "annotationSave",
    load: load.load,
    baseSha256: INITIAL_SHA,
    data: next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength),
  });
  assert.equal(wrote, 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    posted.filter((m) => m.type === "load").length,
    loadsBefore,
    "mid-write watcher must not reload (expectWrite before writeAtomic)",
  );
});

test("annotationSave survives create+change watcher pair after self-write", async () => {
  const { posted, receive, writes, triggerWatch } = open();
  await receive({ type: "ready" });
  const load = posted.find((m) => m.type === "load");
  assert.ok(load && load.type === "load");
  const next = new Uint8Array([37, 80, 68, 70, 45, 99]); // %PDF-c
  await receive({
    type: "annotationSave",
    load: load.load,
    baseSha256: INITIAL_SHA,
    data: next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength),
  });
  assert.equal(writes(), 1);
  const loadsBefore = posted.filter((m) => m.type === "load").length;
  // Atomic rename often delivers both create and change.
  triggerWatch();
  triggerWatch();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(
    posted.filter((m) => m.type === "load").length,
    loadsBefore,
    "paired watcher events must not reload after acceptWrite",
  );
});
