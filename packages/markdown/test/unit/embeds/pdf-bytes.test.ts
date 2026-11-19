import assert from "node:assert/strict";
import test from "node:test";
import {
  forgetPdfBytes,
  sharedPdfBytes,
  type LoadPdfBytes,
} from "../../../src/plugins/embeds/pdf-bytes";

function loader() {
  const loads: string[] = [];
  const signals: AbortSignal[] = [];
  const load: LoadPdfBytes = async (url, signal) => {
    loads.push(url);
    signals.push(signal);
    return new Uint8Array([loads.length]);
  };
  return { load, loads, signals };
}

test("ten embeds of one PDF fetch it once and share its bytes", async () => {
  forgetPdfBytes();
  const { load, loads } = loader();
  const pass = new AbortController();
  const all = await Promise.all(
    Array.from({ length: 10 }, () =>
      sharedPdfBytes("/a.pdf", pass.signal, load),
    ),
  );
  assert.deepEqual(loads, ["/a.pdf"]);
  assert.ok(all.every((bytes) => bytes === all[0]));
  pass.abort();
});

test("once every embed of a PDF is gone, its bytes go, and a fetch still running stops", async () => {
  forgetPdfBytes();
  const { load, loads, signals } = loader();
  const one = new AbortController();
  const two = new AbortController();
  void sharedPdfBytes("/a.pdf", one.signal, load);
  void sharedPdfBytes("/a.pdf", two.signal, load);
  one.abort();
  assert.equal(signals[0]!.aborted, false, "another embed still shows it");
  two.abort();
  assert.equal(signals[0]!.aborted, true);
  await sharedPdfBytes("/a.pdf", new AbortController().signal, load);
  assert.equal(loads.length, 2);
});

test("after files change, a new embed fetches the file again", async () => {
  forgetPdfBytes();
  const { load, loads } = loader();
  const pass = new AbortController();
  await sharedPdfBytes("/a.pdf", pass.signal, load);
  forgetPdfBytes();
  await sharedPdfBytes("/a.pdf", pass.signal, load);
  assert.equal(loads.length, 2);
  pass.abort();
});

test("a failed fetch is not kept", async () => {
  forgetPdfBytes();
  let fail = true;
  const load: LoadPdfBytes = async () => {
    if (fail) {
      throw new Error("HTTP 404");
    }
    return new Uint8Array([1]);
  };
  const pass = new AbortController();
  await assert.rejects(sharedPdfBytes("/a.pdf", pass.signal, load));
  fail = false;
  assert.deepEqual(
    await sharedPdfBytes("/a.pdf", pass.signal, load),
    new Uint8Array([1]),
  );
  pass.abort();
});
