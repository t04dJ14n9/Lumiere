import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AnnotationBundle,
  AnnotationCapability,
} from "@embedpdf/react/annotation";
import type { DocumentsCapability } from "@embedpdf/react/runtime";
import { annotationKey } from "@embedpdf/engine-core/public";
import {
  parseAnnotations,
  serializeAnnotations,
} from "../../src/shared/annotation-store";
import {
  RESTORE_OP_ID,
  StoreSession,
  type SessionHost,
} from "../../src/webview/annotation-store-session";
import type { OutgoingMessage } from "../../src/webview/outbox";
import { bundle, refOn } from "./support/bundle";

const SHA = "a".repeat(64);

/** The numbers of the object annotations in a store file's text. */
async function kept(text: string | null): Promise<number[]> {
  const stored = await parseAnnotations(text!);
  return stored!.bundle.items.map(
    ({ data }) => (data.ref as { objectNumber: number }).objectNumber,
  );
}

async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !condition(); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "timed out");
}

/**
 * A document whose annotations are `present`, with the parts of EmbedPDF
 * that the session uses: `import` makes the file's annotations 101, 102, ...
 * and reports them as the engine does (events carry the write's id before it
 * resolves); `export` answers with what is present now.
 */
function open(
  options: {
    stored?: string;
    dropped?: string[];
    gate?: Promise<void>;
    sha256?: () => string;
    load?: () => number;
  } = {},
) {
  const posted: OutgoingMessage[] = [];
  const present = new Map<number, string>();
  let exports = 0;
  let hostText = options.stored;
  const host: SessionHost = {
    post: (message) => posted.push(message),
    loadState: () => ({
      load: options.load?.() ?? 3,
      sha256: options.sha256?.() ?? SHA,
      ...(hostText === undefined ? {} : { annotations: hostText }),
    }),
    keepStoreText: (text) => {
      hostText = text;
    },
  };
  const annotation = {
    import: async (incoming: AnnotationBundle) => {
      const annotations = incoming.items.map((item, index) => ({
        ...item.data,
        ref: refOn(101 + index),
      }));
      for (const found of annotations) {
        const { objectNumber } = found.ref as { objectNumber: number };
        present.set(objectNumber, "highlight");
        session.committed("create", [found.ref], {
          transaction: { id: RESTORE_OP_ID },
        });
      }
      await options.gate;
      return {
        annotations,
        refMap: [],
        dropped: (options.dropped ?? []).map((reason) => ({
          ref: refOn(1),
          reason,
        })),
      };
    },
    export: async () => {
      exports += 1;
      await options.gate;
      return bundle(
        [...present].map(([objectNumber, subtype]) => ({
          ref: refOn(objectNumber),
          subtype,
        })),
      );
    },
  } as unknown as AnnotationCapability;
  // The engine reports an import's events to the session that asked for it.
  const session = new StoreSession(annotation, host);
  return {
    session,
    posted,
    present,
    exports: () => exports,
    saves: () =>
      posted.filter((message) => message.type === "annotationStoreSave"),
  };
}

test("the file's annotations come back as Lumiere's and are saved with new ones, not the PDF's", async () => {
  const stored = serializeAnnotations(
    bundle([{ ref: refOn(1) }, { ref: refOn(2) }]),
  )!;
  const { session, posted, present, saves } = open({ stored });
  present.set(7, "highlight"); // the PDF's own
  session.restore(true);
  // Drawn while the file's annotations are still coming back.
  present.set(300, "highlight");
  session.committed("create", [refOn(300)], {});
  await until(() => saves().length === 1);
  assert.deepEqual(
    posted.filter((message) => message.type === "annotationEmbeddedEdit"),
    [],
  );
  const save = saves()[0] as { load: number; sha256: string; text: string };
  assert.equal(save.load, 3);
  // Filed under the bytes the annotations were made on, which the host checks.
  assert.equal(save.sha256, SHA);
  assert.deepEqual((await kept(save.text)).sort(), [101, 102, 300]);
});

test("a change to the PDF's own annotation is reported, and nothing is saved for it", async () => {
  const { session, posted, saves } = open();
  session.restore(true);
  session.committed("update", [refOn(7)], {});
  session.committed("delete", [refOn(8)], {});
  assert.deepEqual(posted, [
    { type: "annotationEmbeddedEdit", load: 3 },
    { type: "annotationEmbeddedEdit", load: 3 },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(saves().length, 0);
});

test("a save still queued when the next bytes' load arrives is not filed under it", async () => {
  let load = 3;
  const { session, present, saves } = open({ load: () => load });
  session.restore(true);
  present.set(1, "highlight");
  session.committed("create", [refOn(1)], {});
  // Before the queued save runs, the file changed on disk: the host sent
  // load 4, whose document replaces this one.
  load = 4;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(saves().length, 0);
});

test("changes that come while a save waits share it", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { session, present, exports, saves } = open({ gate });
  session.restore(true);
  for (const number of [1, 2, 3, 4]) {
    present.set(number, "highlight");
    session.committed("create", [refOn(number)], {});
  }
  release();
  await until(() => saves().length >= 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  // The four changes made one save.
  assert.equal(exports(), 1);
  assert.deepEqual(
    await kept((saves()[0] as { text: string }).text),
    [1, 2, 3, 4],
  );
});

test("Undo of a delete brings the annotation back as a resync, and it is saved again", async () => {
  const { session, present, saves } = open();
  session.restore(true);
  present.set(10, "highlight");
  session.committed("create", [refOn(10)], {});
  await until(() => saves().length === 1);
  present.delete(10);
  session.committed("delete", [refOn(10)], {});
  await until(() => saves().length === 2);
  assert.equal((saves()[1] as { text: string | null }).text, null);
  // Undo: the same ref is back, with no create.
  present.set(10, "highlight");
  session.resynced();
  await until(() => saves().length === 3);
  assert.deepEqual(await kept((saves()[2] as { text: string }).text), [10]);
});

test("a file that cannot be read is reported and left as it is, not saved over", async () => {
  const { session, posted, present, saves } = open({ stored: "not json" });
  session.restore(true);
  present.set(10, "highlight");
  session.committed("create", [refOn(10)], {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(saves().length, 0);
  assert.equal(posted.length, 1);
  assert.match(
    (posted[0] as { message: string }).message,
    /could not be read\. It is left as it is/u,
  );
});

test("annotations that could not be restored are counted; a name already there is not", async () => {
  const stored = serializeAnnotations(bundle([{ ref: refOn(1) }]))!;
  const { session, posted } = open({
    stored,
    dropped: ["name-conflict", "unsupported-value", "parent-dropped"],
  });
  session.restore(true);
  await until(() => posted.length > 0);
  assert.match(
    (posted[0] as { message: string }).message,
    /^2 kept annotation/u,
  );
});

test("the file is read once however often the document reports it is ready", async () => {
  const stored = serializeAnnotations(bundle([{ ref: refOn(1) }]))!;
  const { session, present } = open({ stored });
  session.restore(true);
  session.restore(true);
  await until(() => present.size === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(present.size, 1);
});

test("a save that fails tells the host, which can ask again", async () => {
  const posted: OutgoingMessage[] = [];
  const session = new StoreSession(
    {
      export: async () => {
        throw new Error("no permission");
      },
    } as unknown as AnnotationCapability,
    {
      post: (message) => posted.push(message),
      loadState: () => ({ load: 3, sha256: SHA }),
      keepStoreText: () => undefined,
    },
  );
  session.restore(true);
  session.saveStore();
  await until(() => posted.length > 0);
  assert.deepEqual(posted, [
    { type: "annotationSaveFailed", load: 3, message: "no permission" },
  ]);
});

test("the PDF with its annotations goes to the host as an overwrite or as a copy", async () => {
  const { session, posted } = open();
  session.restore(true);
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const documents = {
    download: async () => bytes.subarray(1),
  } as unknown as DocumentsCapability;
  session.writePdf(documents, "pdf");
  session.writePdf(documents, "copy");
  await until(() => posted.length === 2);
  const [overwrite, copy] = posted as Array<{
    type: string;
    data: ArrayBuffer;
    baseSha256?: string;
  }>;
  assert.equal(overwrite!.type, "annotationSave");
  assert.equal(overwrite!.baseSha256, SHA);
  assert.equal(copy!.type, "annotationExport");
  for (const message of [overwrite!, copy!]) {
    assert.ok(message.data instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(message.data)], [80, 68, 70]);
  }
});

/** A document whose PDF downloads at once, and the PDF writes it sent. */
function writing(options: Parameters<typeof open>[0] = {}) {
  const opened = open(options);
  const documents = {
    download: async () => new Uint8Array([37, 80, 68, 70]),
  } as unknown as DocumentsCapability;
  const writes = () =>
    opened.posted.filter((message) => message.type === "annotationSave") as {
      write: number;
    }[];
  const write = async () => {
    const before = writes().length;
    opened.session.writePdf(documents, "pdf");
    await until(() => writes().length === before + 1);
    return writes().at(-1)!.write;
  };
  return { ...opened, write };
}

const stored101 = () => serializeAnnotations(bundle([{ ref: refOn(1) }]))!;
const key = (objectNumber: number) => annotationKey(refOn(objectNumber));

test("an annotation made while Save into This PDF writes stays Lumiere's and is saved for the new bytes", async () => {
  let sha256 = SHA;
  const { session, present, saves, write } = writing({
    stored: stored101(),
    sha256: () => sha256,
  });
  session.restore(true);
  const written = await write();
  // Drawn after the PDF was taken, before the host says it wrote it.
  present.set(300, "highlight");
  session.committed("create", [refOn(300)], {});
  await until(() => saves().length === 1);

  sha256 = "b".repeat(64);
  session.savedIntoPdf(written);
  await until(() => saves().length === 2);
  const resaved = saves()[1] as { sha256: string; text: string };
  assert.equal(resaved.sha256, sha256);
  // 101, the file's, went into the PDF and is the PDF's now; 300 did not.
  assert.equal(session.ownership.isOwn(key(101)), false);
  assert.equal(session.ownership.isOwn(key(300)), true);
  assert.deepEqual(await kept(resaved.text), [300]);
});

test("each PDF write's result settles only the annotations that write took", async () => {
  const { session, present, write } = writing({ stored: stored101() });
  session.restore(true);
  const first = await write();
  present.set(300, "highlight");
  session.committed("create", [refOn(300)], {});
  const second = await write();

  session.savedIntoPdf(first);
  assert.equal(session.ownership.isOwn(key(101)), false);
  assert.equal(session.ownership.isOwn(key(300)), true, "only in the second");
  session.pdfWriteFailed(second);
  assert.equal(session.ownership.isOwn(key(300)), true);
  // A result for a write already settled, or never made, changes nothing.
  session.savedIntoPdf(second);
  session.savedIntoPdf(99);
  assert.equal(session.ownership.isOwn(key(300)), true);
});

test("a change to an annotation a PDF write took, made during the write, is reported as the PDF's", async () => {
  const { session, posted, write } = writing({ stored: stored101() });
  session.restore(true);
  const written = await write();
  session.committed("update", [refOn(101)], {});
  const edits = () =>
    posted.filter((message) => message.type === "annotationEmbeddedEdit");
  assert.equal(edits().length, 0, "still Lumiere's while the write runs");

  session.savedIntoPdf(written);
  // The PDF has it as it was: only saving into the PDF again keeps the change.
  assert.equal(session.ownership.isOwn(key(101)), false);
  assert.deepEqual(edits(), [{ type: "annotationEmbeddedEdit", load: 3 }]);
});

test("a deleted annotation brought back by Undo while, or after, the PDF is written stays Lumiere's", async () => {
  let sha256 = SHA;
  const { session, present, saves, posted, write } = writing({
    stored: stored101(),
    sha256: () => sha256,
  });
  session.restore(true);
  await until(() => present.has(101));
  present.delete(101);
  session.committed("delete", [refOn(101)], {});
  const written = await write();
  // Undo brings it back while the write runs: it is in no PDF taken before.
  present.set(101, "highlight");
  session.resynced();

  sha256 = "b".repeat(64);
  const before = saves().length;
  session.savedIntoPdf(written);
  assert.equal(session.ownership.isOwn(key(101)), true);
  await until(() => saves().length > before);
  const resaved = saves().at(-1) as { sha256: string; text: string };
  assert.equal(resaved.sha256, sha256);
  assert.deepEqual(await kept(resaved.text), [101]);
  assert.deepEqual(
    posted.filter((message) => message.type === "annotationEmbeddedEdit"),
    [],
  );
});

test("a save for the old hash keeps what it owned there, though Save into This PDF is confirmed during it", async () => {
  const options: Parameters<typeof open>[0] = { stored: stored101() };
  const { session, present, saves, write } = writing(options);
  session.restore(true);
  const written = await write();
  // A new highlight's save takes the old hash, then its export is held.
  let release!: () => void;
  options.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  present.set(300, "highlight");
  session.committed("create", [refOn(300)], {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  session.savedIntoPdf(written);
  release();
  await until(() => saves().length >= 1);
  const old = saves()[0] as { sha256: string; text: string };
  assert.equal(old.sha256, SHA);
  // The original PDF (and every copy of it) still has 101 in its file.
  assert.deepEqual((await kept(old.text)).sort(), [101, 300]);
});

test("another editor's file in a form this viewer cannot show is not acknowledged, and nothing is saved over it", async () => {
  const { session, posted, present, saves } = open();
  session.restore(true);
  session.showStoreFile({
    sha256: SHA,
    revision: 1,
    text: '{"version":1,"annotations":[]}',
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    posted.filter((message) => message.type === "annotationStoreShown").length,
    0,
  );
  present.set(300, "highlight");
  session.committed("create", [refOn(300)], {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(saves().length, 0);
  assert.ok(
    posted.some((message) =>
      (message as { message?: string }).message?.includes("cannot show"),
    ),
  );
});

test("a change with no file is still acknowledged, as there is nothing to compare", async () => {
  const { session, posted } = open();
  session.restore(true);
  session.showStoreFile({ sha256: SHA, revision: 2, text: undefined });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(
    posted.filter((message) => message.type === "annotationStoreShown"),
    [{ type: "annotationStoreShown", load: 3, sha256: SHA, revision: 2 }],
  );
});
