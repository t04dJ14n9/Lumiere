import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetPdfDocuments,
  pdfPagePainter,
  sharedPdfDocument,
  type LoadPdfBytes,
  type OpenPdf,
  type OpenedPdf,
} from "../../../src/plugins/embeds/pdf-documents";

/** Fetches and opens that the test counts; each document counts its renders. */
function engine() {
  const loads: string[] = [];
  const signals: AbortSignal[] = [];
  const opened: Uint8Array[] = [];
  const closed: OpenedPdf[] = [];
  const renders: number[] = [];
  const load: LoadPdfBytes = async (url, signal) => {
    loads.push(url);
    signals.push(signal);
    return new Uint8Array([loads.length]);
  };
  const open: OpenPdf = async (bytes) => {
    opened.push(bytes);
    const document: OpenedPdf = {
      pageCount: 3,
      render: async (page) => {
        renders.push(page);
        return {
          page,
          pageCount: 3,
          width: 1,
          height: 1,
          rgba: new Uint8ClampedArray(4),
        };
      },
      close: async () => {
        closed.push(document);
      },
    };
    return document;
  };
  return { load, open, loads, signals, opened, closed, renders };
}

test("ten embeds of one PDF fetch and open it once, and share the open document", async () => {
  forgetPdfDocuments();
  const { load, open, loads, opened } = engine();
  const pass = new AbortController();
  const all = await Promise.all(
    Array.from({ length: 10 }, () =>
      sharedPdfDocument("/a.pdf", pass.signal, { open, load }),
    ),
  );
  assert.deepEqual(loads, ["/a.pdf"]);
  assert.equal(opened.length, 1);
  assert.ok(all.every((document) => document === all[0]));
  pass.abort();
});

test("a page turn renders the page of the open document, without opening it again", async () => {
  forgetPdfDocuments();
  const { load, open, opened, renders } = engine();
  const pass = new AbortController();
  const document = await sharedPdfDocument("/a.pdf", pass.signal, {
    open,
    load,
  });
  await document.render(1, 760);
  await document.render(2, 760);
  await document.render(3, 760);
  assert.equal(opened.length, 1);
  assert.deepEqual(renders, [1, 2, 3]);
  pass.abort();
});

test("an embed's page turns open its PDF once and draw only the latest turn", async () => {
  forgetPdfDocuments();
  const { load, open, opened, renders } = engine();
  const pass = new AbortController();
  const drawn: number[] = [];
  const paint = pdfPagePainter({
    document: () => sharedPdfDocument("/a.pdf", pass.signal, { open, load }),
    signal: pass.signal,
    draw: (rendered) => drawn.push(rendered.page),
    fail: (error) => assert.fail(String(error)),
  });
  await paint(1);
  await Promise.all([paint(2), paint(3)]);
  assert.equal(opened.length, 1);
  assert.deepEqual(drawn, [1, 3]);
  assert.ok(renders.includes(3));
  pass.abort();
  await paint(2);
  assert.deepEqual(drawn, [1, 3], "an embed that has gone draws nothing");
});

test("once every embed of a PDF is gone, its document closes, and a fetch still running stops", async () => {
  forgetPdfDocuments();
  const { load, open, loads, signals, closed } = engine();
  const one = new AbortController();
  const two = new AbortController();
  const document = sharedPdfDocument("/a.pdf", one.signal, { open, load });
  void sharedPdfDocument("/a.pdf", two.signal, { open, load });
  one.abort();
  assert.equal(signals[0]!.aborted, false, "another embed still shows it");
  two.abort();
  assert.equal(signals[0]!.aborted, true);
  // This fake fetch ignores the signal: what it opens late is closed at once.
  await document;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(closed.length, 1);
  const pass = new AbortController();
  await sharedPdfDocument("/a.pdf", pass.signal, { open, load });
  assert.equal(loads.length, 2);
  pass.abort();
});

test("the last embed of an open document closes it", async () => {
  forgetPdfDocuments();
  const { load, open, closed } = engine();
  const pass = new AbortController();
  const document = await sharedPdfDocument("/a.pdf", pass.signal, {
    open,
    load,
  });
  pass.abort();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(closed, [document]);
});

test("after files change, a new embed opens the file again", async () => {
  forgetPdfDocuments();
  const { load, open, loads, opened } = engine();
  const pass = new AbortController();
  await sharedPdfDocument("/a.pdf", pass.signal, { open, load });
  forgetPdfDocuments();
  await sharedPdfDocument("/a.pdf", pass.signal, { open, load });
  assert.equal(loads.length, 2);
  assert.equal(opened.length, 2);
  pass.abort();
});

test("a failed fetch or open is not kept", async () => {
  forgetPdfDocuments();
  const { open } = engine();
  let fail = true;
  const load: LoadPdfBytes = async () => {
    if (fail) {
      throw new Error("HTTP 404");
    }
    return new Uint8Array([1]);
  };
  const pass = new AbortController();
  await assert.rejects(
    sharedPdfDocument("/a.pdf", pass.signal, { open, load }),
  );
  fail = false;
  const document = await sharedPdfDocument("/a.pdf", pass.signal, {
    open,
    load,
  });
  assert.equal(document.pageCount, 3);
  pass.abort();
});
