// Oracles and small wait/provenance helpers for the DSH e2e browser
// image and PDF-render scenarios. These do not run a browser or an
// installed bundle.

// short.pdf is packages/pdf/test/fixtures/make-fixtures.mjs shortPdf():
// three 300x400 pages whose painted label is "Short page N".
export const SHORT_PDF_PAGE_COUNT = 3;
export const SHORT_PDF_TOOLBAR_SUFFIX = `of ${SHORT_PDF_PAGE_COUNT}`;

// engine.tsx Status copy. A nonempty placeholder is not a rendered page.
export const PDF_LOADING_TEXTS = [
  "Starting the PDF engine…",
  "Opening the PDF…",
];

// Longer than engine.tsx WORKER_TIMEOUT_MS (15s) so a main-thread fallback
// can still succeed; this is a deadline, not a fixed sleep.
export const PDF_RENDER_TIMEOUT_MS = 20_000;
export const IMAGE_ATTEMPT_TIMEOUT_MS = 8_000;

export function isPdfLoadingPlaceholder(bodyText) {
  return PDF_LOADING_TEXTS.some((text) => bodyText.includes(text));
}

export function isPixelFileUrl(url) {
  return url.includes("/lumiere/file") && url.includes("pixel.png");
}

export function imageHasDecoded({
  currentNavHttp200,
  imageCount,
  complete,
  naturalWidth,
}) {
  if (!currentNavHttp200) {
    return {
      ok: false,
      reason: "image was never fetched through /lumiere/file",
    };
  }
  if (!(imageCount > 0 && complete === true && naturalWidth > 0)) {
    return {
      ok: false,
      reason:
        imageCount > 0
          ? `image failed to decode (complete ${complete}, naturalWidth ${naturalWidth})`
          : "no image in the DOM",
    };
  }
  return { ok: true };
}

// One log per page/attempt. Record only on the attempt that issued the
// request; a delayed arrival must not be written to a later attempt.
export function createAttemptLog() {
  const events = [];
  return {
    record(url, status) {
      if (isPixelFileUrl(url)) {
        events.push(status);
      }
    },
    hasHttp200() {
      return events.includes(200);
    },
  };
}

export function pdfViewerHasRendered({
  bodyText,
  hasViewer,
  firstPageDecoded,
  toolbarPageCount,
  bytesOk,
  errors,
}) {
  if (bodyText.includes("could not be opened")) {
    return { ok: false, reason: "PDF failed to open" };
  }
  if (bodyText.includes("Lumiere could not open:")) {
    return { ok: false, reason: "bootstrap error shown" };
  }
  if (errors.length > 0) {
    return {
      ok: false,
      reason: `console errors: ${errors.slice(0, 2).join(" | ")}`,
    };
  }
  if (!bytesOk) {
    return { ok: false, reason: "the page never fetched its PDF bytes" };
  }
  if (!firstPageDecoded || !hasViewer) {
    const loading = isPdfLoadingPlaceholder(bodyText)
      ? "loading placeholder, no rendered page"
      : "no rendered PDF page";
    return { ok: false, reason: loading };
  }
  if (toolbarPageCount !== SHORT_PDF_PAGE_COUNT) {
    return {
      ok: false,
      reason: `toolbar page count is not the short.pdf fixture (got ${toolbarPageCount})`,
    };
  }
  return { ok: true };
}

export function isDefinitivePdfFailure(verdict) {
  return (
    !verdict.ok &&
    (verdict.reason === "PDF failed to open" ||
      verdict.reason === "bootstrap error shown" ||
      String(verdict.reason).startsWith("console errors:"))
  );
}

async function defaultSleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForReady(readVerdict, options = {}) {
  const timeout = options.timeout;
  const interval = options.interval ?? 50;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const isFinal = options.isFinal ?? ((verdict) => verdict.ok);
  const deadline = now() + timeout;
  let verdict = await readVerdict();
  if (isFinal(verdict)) {
    return verdict;
  }
  while (now() < deadline) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(interval, remaining));
    verdict = await readVerdict();
    if (isFinal(verdict)) {
      return verdict;
    }
  }
  return verdict;
}

export async function waitForImageReady(read, options) {
  return waitForReady(async () => imageHasDecoded(await read()), options);
}

export async function waitForPdfReady(read, options) {
  return waitForReady(async () => pdfViewerHasRendered(await read()), {
    ...options,
    isFinal: (verdict) => verdict.ok || isDefinitivePdfFailure(verdict),
  });
}

export async function afterSuccessfulNavigation(goto, then) {
  const response = await goto();
  const status =
    typeof response?.status === "function"
      ? response.status()
      : response?.status;
  if (status !== 200) {
    return { ok: false, reason: `HTTP ${status}` };
  }
  return then(response);
} /* global setTimeout */
