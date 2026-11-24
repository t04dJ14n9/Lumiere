import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PdfOpening,
  PdfTextEngine,
  QuoteRegion,
} from "../../src/extension/pdf-text/engine";
import {
  MAX_TEXT_PDF_BYTES,
  PdfTextReader,
  REFUSAL_MESSAGES,
  type PdfRefusal,
} from "../../src/extension/pdf-text/reader";

interface Stamp {
  mtime: number;
  size: number;
}

/** Files, an engine and a log, all recording what the reader does with them. */
function setup(pdfs: Record<string, Stamp>) {
  const stamps = new Map(Object.entries(pdfs));
  const calls = {
    stat: 0,
    read: [] as string[],
    engines: 0,
    disposed: 0,
    opened: [] as string[],
    quotes: [] as (readonly QuoteRegion[])[],
    log: [] as string[],
  };
  let running = 0;
  let overlap = false;
  const gate = { wait: Promise.resolve() as Promise<unknown> };
  const readGate = { wait: Promise.resolve() as Promise<unknown> };
  /** What the engine answers for a PDF, by its name: a page of text, or why not. */
  const opening = async <T>(
    bytes: Uint8Array,
    value: (uri: string) => T,
  ): Promise<PdfOpening<T>> => {
    const uri = new TextDecoder().decode(bytes);
    calls.opened.push(uri);
    overlap ||= ++running > 1;
    await gate.wait;
    running--;
    if (uri.includes("broken")) {
      throw new Error("FPDF_LoadMemDocument failed");
    }
    if (uri.includes("locked")) {
      return { status: "locked" };
    }
    if (uri.includes("nocopy")) {
      return { status: "copy-forbidden" };
    }
    return { status: "ok", value: value(uri) };
  };
  const engine = async (): Promise<PdfTextEngine> => {
    calls.engines++;
    return {
      pages: (bytes) => opening(bytes, (uri) => [`Text of ${uri}`]),
      quotes: (bytes, regions) => {
        calls.quotes.push(regions);
        return opening(bytes, () => regions.map(({ page }) => `Quote ${page}`));
      },
      async dispose() {
        calls.disposed++;
      },
    };
  };
  const reader = new PdfTextReader({
    files: {
      async stat(uri) {
        calls.stat++;
        return stamps.get(uri);
      },
      async read(uri) {
        calls.read.push(uri);
        await readGate.wait;
        return new TextEncoder().encode(uri);
      },
    },
    engine,
    log: (message) => calls.log.push(message),
  });
  return { reader, stamps, calls, gate, readGate, overlapped: () => overlap };
}

const ok = <T>(value: T) => ({ ok: true, value });
const refused = (reason: PdfRefusal) => ({ ok: false, reason });

test("PDFium starts with the first text asked for, not before", async () => {
  const { reader, calls } = setup({ "file:///a.pdf": { mtime: 1, size: 10 } });
  assert.equal(calls.engines, 0);
  assert.deepEqual(
    await reader.pages("file:///a.pdf"),
    ok(["Text of file:///a.pdf"]),
  );
  assert.equal(calls.engines, 1);
});

test("a PDF's text is read once while its modification time and size stay the same", async () => {
  const { reader, stamps, calls } = setup({
    "file:///a.pdf": { mtime: 1, size: 10 },
  });
  const first = await reader.pages("file:///a.pdf");
  assert.equal(await reader.pages("file:///a.pdf"), first);
  assert.equal(await reader.pages("file:///a.pdf"), first);
  assert.deepEqual(calls.read, ["file:///a.pdf"]);
  assert.equal(calls.stat, 3);
  stamps.set("file:///a.pdf", { mtime: 2, size: 10 });
  assert.notEqual(await reader.pages("file:///a.pdf"), first);
  stamps.set("file:///a.pdf", { mtime: 2, size: 11 });
  await reader.pages("file:///a.pdf");
  assert.equal(calls.read.length, 3);
  assert.equal(calls.engines, 1);
});

test("asking again while a PDF is being read shares that read; PDFium opens one PDF at a time, quotes included", async () => {
  const { reader, calls, gate, overlapped } = setup({
    "file:///a.pdf": { mtime: 1, size: 10 },
    "file:///b.pdf": { mtime: 1, size: 10 },
  });
  let release!: () => void;
  gate.wait = new Promise<void>((resolve) => (release = resolve));
  const pending = [
    reader.pages("file:///a.pdf"),
    reader.pages("file:///a.pdf"),
    reader.pages("file:///b.pdf"),
    reader.quotes("file:///a.pdf", [{ page: 1, boxes: [] }]),
  ];
  // Let the stats and the first read start, then finish them all.
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  const [first, again, other] = await Promise.all(pending);
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.deepEqual(calls.opened, [
    "file:///a.pdf",
    "file:///b.pdf",
    "file:///a.pdf",
  ]);
  assert.equal(overlapped(), false);
});

test("a PDF that is missing, too large, locked, copy-protected or unreadable is refused with its reason, and the reader never rejects", async () => {
  const { reader, calls } = setup({
    "file:///huge.pdf": { mtime: 1, size: MAX_TEXT_PDF_BYTES + 1 },
    "file:///locked.pdf": { mtime: 1, size: 10 },
    "file:///nocopy.pdf": { mtime: 1, size: 10 },
    "file:///broken.pdf": { mtime: 1, size: 10 },
  });
  assert.deepEqual(await reader.pages("file:///gone.pdf"), refused("missing"));
  assert.deepEqual(
    await reader.pages("file:///huge.pdf"),
    refused("too-large"),
  );
  assert.deepEqual(calls.read, []);
  assert.deepEqual(await reader.pages("file:///locked.pdf"), refused("locked"));
  assert.deepEqual(
    await reader.pages("file:///nocopy.pdf"),
    refused("copy-forbidden"),
  );
  assert.deepEqual(
    await reader.pages("file:///broken.pdf"),
    refused("unreadable"),
  );
  assert.match(calls.log[0]!, /broken\.pdf.*FPDF_LoadMemDocument failed/);
  // The same bytes fail the same way: not opened again on every ask.
  await reader.pages("file:///broken.pdf");
  await reader.pages("file:///locked.pdf");
  assert.equal(calls.opened.length, 3);
  // Every reason has words an agent can read.
  for (const reason of [
    "missing",
    "too-large",
    "locked",
    "copy-forbidden",
    "unreadable",
  ] as const) {
    assert.ok(REFUSAL_MESSAGES[reason].length > 20, reason);
  }
});

test("an engine that cannot start leaves every PDF unreadable", async () => {
  const log: string[] = [];
  const reader = new PdfTextReader({
    files: {
      stat: async () => ({ mtime: 1, size: 1 }),
      read: async () => new Uint8Array(),
    },
    engine: async () => {
      throw new Error("outline-engine.js is missing");
    },
    log: (message) => log.push(message),
  });
  assert.deepEqual(await reader.pages("file:///a.pdf"), refused("unreadable"));
  assert.deepEqual(
    await reader.quotes("file:///a.pdf", []),
    refused("unreadable"),
  );
  assert.match(log[0]!, /outline-engine\.js is missing/);
});

test("the text under marks is asked of the PDF each time, in order, and refused like pages", async () => {
  const { reader, calls } = setup({
    "file:///a.pdf": { mtime: 1, size: 10 },
    "file:///locked.pdf": { mtime: 1, size: 10 },
  });
  const regions = [
    { page: 2, boxes: [[0, 0, 5, 5]] as const },
    { page: 7, boxes: [] },
  ];
  assert.deepEqual(
    await reader.quotes("file:///a.pdf", regions),
    ok(["Quote 2", "Quote 7"]),
  );
  await reader.quotes("file:///a.pdf", regions);
  assert.deepEqual(calls.quotes, [regions, regions]);
  assert.deepEqual(
    await reader.quotes("file:///locked.pdf", regions),
    refused("locked"),
  );
  assert.deepEqual(
    await reader.quotes("file:///gone.pdf", regions),
    refused("missing"),
  );
});

test("only the most recently asked PDFs are kept", async () => {
  const pdfs = Object.fromEntries(
    Array.from({ length: 6 }, (_, n) => [
      `file:///${n}.pdf`,
      { mtime: 1, size: 10 },
    ]),
  );
  const { reader, calls } = setup(pdfs);
  for (const uri of Object.keys(pdfs)) {
    await reader.pages(uri);
  }
  // The newest is kept, the oldest is not.
  await reader.pages("file:///5.pdf");
  assert.equal(calls.read.length, 6);
  await reader.pages("file:///0.pdf");
  assert.equal(calls.read.length, 7);
});

test("after dispose nothing is read", async () => {
  const { reader, calls } = setup({ "file:///a.pdf": { mtime: 1, size: 10 } });
  await reader.pages("file:///a.pdf");
  reader.dispose();
  assert.deepEqual(await reader.pages("file:///a.pdf"), refused("unreadable"));
  assert.deepEqual(
    await reader.quotes("file:///a.pdf", []),
    refused("unreadable"),
  );
  assert.equal(calls.read.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.disposed, 1);
});

test("disposing while the first PDF is being read leaves no PDFium running", async () => {
  const { reader, calls, readGate } = setup({
    "file:///a.pdf": { mtime: 1, size: 10 },
  });
  let release!: () => void;
  readGate.wait = new Promise<void>((resolve) => (release = resolve));
  const pending = reader.pages("file:///a.pdf");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.read, ["file:///a.pdf"]);
  reader.dispose();
  release();
  assert.deepEqual(await pending, refused("unreadable"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.disposed, calls.engines);
});
