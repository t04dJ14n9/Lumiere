// Focused regressions for the DSH e2e image-decode and PDF-render oracles.
//
//   node --test packages/dsh/test/e2e/render-oracles.test.mjs
//
// Source-level only: these fixtures are snapshots, not a Playwright page,
// an installed bundle, or a live DSH run. A pass here is not a browser or
// GUI pass.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SHORT_PDF_PAGE_COUNT,
  SHORT_PDF_TOOLBAR_SUFFIX,
  PDF_LOADING_TEXTS,
  PDF_RENDER_TIMEOUT_MS,
  afterSuccessfulNavigation,
  createAttemptLog,
  imageHasDecoded,
  isPdfLoadingPlaceholder,
  pdfViewerHasRendered,
  waitForImageReady,
  waitForPdfReady,
} from "./render-oracles.mjs";

function createClock() {
  let current = 0;
  const sleepers = [];
  return {
    now: () => current,
    sleep(ms) {
      return new Promise((resolve) => {
        sleepers.push({ due: current + ms, resolve });
      });
    },
    async advance(ms) {
      current += ms;
      const due = sleepers
        .filter((entry) => entry.due <= current)
        .sort((a, b) => a.due - b.due);
      for (const entry of due) {
        const index = sleepers.indexOf(entry);
        if (index >= 0) {
          sleepers.splice(index, 1);
        }
        entry.resolve();
      }
      for (let i = 0; i < 8; i += 1) {
        await Promise.resolve();
      }
    },
  };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

describe("image decode oracle", () => {
  it("rejects HTTP 200 with zero images in the DOM", () => {
    const verdict = imageHasDecoded({
      currentNavHttp200: true,
      imageCount: 0,
      complete: false,
      naturalWidth: 0,
    });
    assert.equal(verdict.ok, false, "zero-image after HTTP 200 must not pass");
  });

  it("rejects an image element that has not decoded", () => {
    const verdict = imageHasDecoded({
      currentNavHttp200: true,
      imageCount: 1,
      complete: false,
      naturalWidth: 0,
    });
    assert.equal(verdict.ok, false);
  });

  it("accepts a current-navigation 200 plus a decoded image", () => {
    const verdict = imageHasDecoded({
      currentNavHttp200: true,
      imageCount: 1,
      complete: true,
      naturalWidth: 1,
    });
    assert.equal(verdict.ok, true);
  });

  it("does not let a previous attempt's 200 satisfy a later attempt", () => {
    const previous = createAttemptLog();
    const current = createAttemptLog();
    previous.record("http://127.0.0.1/lumiere/file?path=pixel.png", 200);
    assert.equal(previous.hasHttp200(), true);
    assert.equal(current.hasHttp200(), false);
    const verdict = imageHasDecoded({
      currentNavHttp200: current.hasHttp200(),
      imageCount: 0,
      complete: false,
      naturalWidth: 0,
    });
    assert.equal(verdict.ok, false);
  });

  it("rejects a complete image with no decoded dimensions", () => {
    const verdict = imageHasDecoded({
      currentNavHttp200: true,
      imageCount: 1,
      complete: true,
      naturalWidth: 0,
    });
    assert.equal(verdict.ok, false);
  });
});

describe("PDF render oracle", () => {
  it("knows the short.pdf fixture contract and loading copy", () => {
    assert.equal(SHORT_PDF_PAGE_COUNT, 3);
    assert.equal(SHORT_PDF_TOOLBAR_SUFFIX, "of 3");
    assert.ok(PDF_RENDER_TIMEOUT_MS > 15_000);
    assert.ok(isPdfLoadingPlaceholder("Starting the PDF engine…"));
    assert.ok(isPdfLoadingPlaceholder("Opening the PDF…"));
    assert.equal(isPdfLoadingPlaceholder("Short page 1"), false);
    assert.deepEqual(PDF_LOADING_TEXTS, [
      "Starting the PDF engine…",
      "Opening the PDF…",
    ]);
  });

  it("rejects a stalled engine: bytes fetched, loading placeholder, no page", () => {
    const starting = pdfViewerHasRendered({
      bodyText: "Starting the PDF engine…",
      hasViewer: false,
      firstPageDecoded: false,
      toolbarPageCount: null,
      bytesOk: true,
      errors: [],
    });
    assert.equal(
      starting.ok,
      false,
      "stalled engine startup must not pass as a rendered page",
    );
    const opening = pdfViewerHasRendered({
      bodyText: "Opening the PDF…",
      hasViewer: false,
      firstPageDecoded: false,
      toolbarPageCount: null,
      bytesOk: true,
      errors: [],
    });
    assert.equal(
      opening.ok,
      false,
      "document-opening placeholder must not pass as a rendered page",
    );
  });

  it("accepts a decoded first page, the short.pdf toolbar count, and a byte fetch", () => {
    const verdict = pdfViewerHasRendered({
      bodyText: "1 of 3",
      hasViewer: true,
      firstPageDecoded: true,
      toolbarPageCount: SHORT_PDF_PAGE_COUNT,
      bytesOk: true,
      errors: [],
    });
    assert.equal(verdict.ok, true);
  });

  it("still fails when the document opened without the fixture page count", () => {
    const verdict = pdfViewerHasRendered({
      bodyText: "1 of 12",
      hasViewer: true,
      firstPageDecoded: true,
      toolbarPageCount: 12,
      bytesOk: true,
      errors: [],
    });
    assert.equal(verdict.ok, false);
  });

  it("retains HTTP/error failures as supporting rejects", () => {
    const noBytes = pdfViewerHasRendered({
      bodyText: "1 of 3",
      hasViewer: true,
      firstPageDecoded: true,
      toolbarPageCount: 3,
      bytesOk: false,
      errors: [],
    });
    assert.equal(noBytes.ok, false);
    const consoleError = pdfViewerHasRendered({
      bodyText: "1 of 3",
      hasViewer: true,
      firstPageDecoded: true,
      toolbarPageCount: 3,
      bytesOk: true,
      errors: ["engine exploded"],
    });
    assert.equal(consoleError.ok, false);
  });

  it("rejects the editor's actual bootstrap failure text", () => {
    const verdict = pdfViewerHasRendered({
      bodyText: "Lumiere could not open: the page did not start",
      hasViewer: false,
      firstPageDecoded: false,
      toolbarPageCount: null,
      bytesOk: true,
      errors: [],
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "bootstrap error shown");
  });
});

describe("attempt provenance", () => {
  it("does not attribute a delayed old response that arrives after a new attempt begins", () => {
    const previous = createAttemptLog();
    const current = createAttemptLog();
    previous.record("http://127.0.0.1/lumiere/file?path=pixel.png", 200);
    assert.equal(previous.hasHttp200(), true);
    assert.equal(
      current.hasHttp200(),
      false,
      "a response that started on the previous attempt must not count for the new one",
    );
  });
});

describe("asynchronous readiness waits", () => {
  it("keeps waiting after the image is visible until it is complete with positive dimensions", async () => {
    const clock = createClock();
    const state = {
      currentNavHttp200: true,
      imageCount: 1,
      complete: false,
      naturalWidth: 0,
    };
    const pending = waitForImageReady(() => Promise.resolve({ ...state }), {
      timeout: 1000,
      interval: 50,
      now: clock.now,
      sleep: clock.sleep,
    });
    await flush();
    state.complete = true;
    state.naturalWidth = 8;
    await clock.advance(50);
    const verdict = await pending;
    assert.equal(
      verdict.ok,
      true,
      "visible-then-later-decode must pass within the deadline",
    );
  });

  it("times out if a visible image never decodes", async () => {
    const clock = createClock();
    let reads = 0;
    const pending = waitForImageReady(
      () => {
        reads += 1;
        return Promise.resolve({
          currentNavHttp200: true,
          imageCount: 1,
          complete: false,
          naturalWidth: 0,
        });
      },
      { timeout: 200, interval: 50, now: clock.now, sleep: clock.sleep },
    );
    await flush();
    await clock.advance(50);
    await clock.advance(50);
    await clock.advance(50);
    await clock.advance(50);
    const verdict = await pending;
    assert.equal(verdict.ok, false);
    assert.ok(
      reads > 1,
      "must poll until the deadline, not snapshot once at visibility",
    );
    assert.ok(clock.now() >= 200);
  });

  it("keeps waiting for a real PDF page and toolbar count after the shell is visible", async () => {
    const clock = createClock();
    const state = {
      bodyText: "1 of 3",
      hasViewer: true,
      pageVisible: true,
      firstPageDecoded: false,
      toolbarPageCount: SHORT_PDF_PAGE_COUNT,
      bytesOk: true,
      errors: [],
    };
    const pending = waitForPdfReady(() => Promise.resolve({ ...state }), {
      timeout: 1000,
      interval: 50,
      now: clock.now,
      sleep: clock.sleep,
    });
    await flush();
    state.firstPageDecoded = true;
    await clock.advance(50);
    const verdict = await pending;
    assert.equal(verdict.ok, true);
  });

  it("stops immediately on a definitive PDF console or open error", async () => {
    const clock = createClock();
    let settledAt = null;
    const pending = waitForPdfReady(
      () =>
        Promise.resolve({
          bodyText: "could not be opened",
          hasViewer: false,
          pageVisible: false,
          firstPageDecoded: false,
          toolbarPageCount: null,
          bytesOk: true,
          errors: [],
        }),
      { timeout: 1000, interval: 50, now: clock.now, sleep: clock.sleep },
    ).then((verdict) => {
      settledAt = clock.now();
      return verdict;
    });
    await flush();
    if (settledAt === null) {
      await clock.advance(1000);
    }
    const verdict = await pending;
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "PDF failed to open");
    assert.equal(
      settledAt,
      0,
      "definitive failure must not consume the deadline",
    );
  });
});

describe("navigation provenance", () => {
  it("does not evaluate the previous page after a navigation failure", async () => {
    let evaluated = false;
    await assert.rejects(
      () =>
        afterSuccessfulNavigation(
          async () => {
            throw new Error("net::ERR_ABORTED");
          },
          async () => {
            evaluated = true;
            return imageHasDecoded({
              currentNavHttp200: true,
              imageCount: 1,
              complete: true,
              naturalWidth: 1,
            });
          },
        ),
      /ERR_ABORTED/,
    );
    assert.equal(evaluated, false);
  });

  it("accepts a successful 200 navigation and then runs the readiness check", async () => {
    const verdict = await afterSuccessfulNavigation(
      async () => ({ status: () => 200 }),
      async () =>
        imageHasDecoded({
          currentNavHttp200: true,
          imageCount: 1,
          complete: true,
          naturalWidth: 1,
        }),
    );
    assert.equal(verdict.ok, true);
  });
});
