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
  } = {},
) {
  const posted: OutgoingMessage[] = [];
  const present = new Map<number, string>();
  let exports = 0;
  const host: SessionHost = {
    post: (message) => posted.push(message),
    loadState: () => ({
      load: 3,
      sha256: options.sha256?.() ?? SHA,
      ...(options.stored === undefined ? {} : { annotations: options.stored }),
    }),
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

test("an annotation made while Save into This PDF writes stays Lumiere's and is saved for the new bytes", async () => {
  const stored = serializeAnnotations(bundle([{ ref: refOn(1) }]))!;
  let sha256 = SHA;
  const { session, posted, present, saves } = open({
    stored,
    sha256: () => sha256,
  });
  session.restore(true);
  const documents = {
    download: async () => new Uint8Array([37, 80, 68, 70]),
  } as unknown as DocumentsCapability;
  session.writePdf(documents, "pdf");
  await until(() =>
    posted.some((message) => message.type === "annotationSave"),
  );
  // Drawn after the PDF was taken, before the host says it wrote it.
  present.set(300, "highlight");
  session.committed("create", [refOn(300)], {});
  await until(() => saves().length === 1);

  sha256 = "b".repeat(64);
  session.savedIntoPdf();
  await until(() => saves().length === 2);
  const resaved = saves()[1] as { sha256: string; text: string };
  assert.equal(resaved.sha256, sha256);
  // 101, the file's, went into the PDF and is the PDF's now; 300 did not.
  assert.equal(session.ownership.isOwn(annotationKey(refOn(101))), false);
  assert.equal(session.ownership.isOwn(annotationKey(refOn(300))), true);
  assert.deepEqual(await kept(resaved.text), [300]);
});
