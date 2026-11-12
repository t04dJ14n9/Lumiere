/**
 * Drives the #736 evidence harness in Chromium with real React 19.3.1.
 *
 * Serves the two bundles (current HEAD and the c7016eb3 prefix control), the
 * parent page, and the iframe's /lumiere/editor route on the assigned port
 * 19263. Every scenario is run once per bundle; results, request logs and
 * screenshots are written under /tmp/chain-evidence-final/react/.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createHash } from "node:crypto";

const WORKTREE = "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-737";
const ROOT = "/tmp/chain-evidence-final/react";
const HOST = "127.0.0.1";
const PORT = 19263;

const require = createRequire(`${WORKTREE}/package.json`);
const { chromium } = require("@playwright/test");

const bundles = {
  current: readFileSync(`${ROOT}/bundle-current.js`),
  prefix: readFileSync(`${ROOT}/bundle-prefix.js`),
};
const bundleMeta = Object.fromEntries(
  Object.entries(bundles).map(([name, bytes]) => [
    name,
    {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ]),
);

const editorDocument = (label) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="lumiere-panel" content="${label}">
<script>
window.__messages = [];
window.addEventListener("message", function (event) {
  window.__messages.push({ data: event.data, origin: event.origin, t: performance.now() });
});
</script></head><body><div id="app">editor ready (${label})</div></body></html>`;

const failureDocument = `<!doctype html><html><head><meta charset="utf-8"><script>
window.__messages = [];
window.addEventListener("message", function (event) { window.__messages.push({ data: event.data, origin: event.origin, t: performance.now() }); });
</script></head><body><div id="app">Lumiere could not open: probe failure</div></body></html>`;

const pageDocument = (scenario, bundle) => `<!doctype html><html><head><meta charset="utf-8">
<style>html,body,#root{height:100%;width:100%;margin:0} body{--dsw-alias-bg-base:#0b0b0b;--dsw-alias-label-primary:#f5f5f5;--dsw-alias-link:#4c9aff}</style>
</head><body data-ds-dark-theme><div id="root"></div>
<script src="/bundle-${bundle}.js"></script></body></html>`;

let active = { scenario: "single", bundle: "current" };
let editorCounts = new Map();
const requestLog = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const entry = {
    at: performance.now(),
    method: req.method,
    url: req.url,
    pathname: url.pathname,
    scenario: active.scenario,
    bundle: active.bundle,
    finished: false,
    aborted: false,
  };
  requestLog.push(entry);
  res.on("close", () => {
    if (!entry.finished) entry.aborted = true;
  });
  const respond = (status, type, body) => {
    if (res.writableEnded || res.destroyed) {
      entry.aborted = true;
      return;
    }
    entry.status = status;
    entry.finished = true;
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
    });
    res.end(body);
  };

  if (
    url.pathname === "/bundle-current.js" ||
    url.pathname === "/bundle-prefix.js"
  ) {
    const name = url.pathname.endsWith("current.js") ? "current" : "prefix";
    respond(200, "text/javascript", bundles[name]);
    return;
  }

  if (url.pathname === "/") {
    active = {
      scenario: url.searchParams.get("scenario") ?? "single",
      bundle: url.searchParams.get("bundle") ?? "current",
    };
    editorCounts = new Map();
    entry.scenario = active.scenario;
    entry.bundle = active.bundle;
    respond(200, "text/html", pageDocument(active.scenario, active.bundle));
    return;
  }

  if (url.pathname === "/lumiere/editor") {
    const key = `${url.pathname}${url.search}`;
    const count = (editorCounts.get(key) ?? 0) + 1;
    editorCounts.set(key, count);
    entry.editorRequest = count;
    const scenario = active.scenario;
    const isA = url.search.includes("A.md");
    let plan;
    if (scenario === "attempt") {
      plan =
        count === 1
          ? { delay: 40, body: failureDocument, kind: "failure" }
          : { delay: 300, body: editorDocument("retry"), kind: "editor" };
    } else if (scenario === "replace") {
      plan = isA
        ? { delay: 800, body: editorDocument("A"), kind: "editor-A" }
        : { delay: 200, body: editorDocument("B"), kind: "editor-B" };
    } else {
      plan = { delay: 500, body: editorDocument("note"), kind: "editor" };
    }
    entry.delayMs = plan.delay;
    entry.bodyKind = plan.kind;
    setTimeout(() => respond(200, "text/html", plan.body), plan.delay);
    return;
  }

  entry.status = 404;
  entry.finished = true;
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, HOST, resolve);
});
const address = server.address();
console.log(`harness server listening on http://${address.address}:${address.port}`);

const browser = await chromium.launch({ headless: true });

const resultOf = (value) => (value === undefined ? null : value);

async function readBaseline(page) {
  return page.evaluate(() => {
    const evidence = window.__evidence;
    const readMessages = (element) => {
      try {
        return element.contentWindow && element.contentWindow.__messages
          ? element.contentWindow.__messages
          : null;
      } catch (error) {
        return String(error);
      }
    };
    const docInfo = (element) => {
      let doc = null;
      try {
        doc = element.contentDocument;
      } catch (error) {
        doc = null;
      }
      return {
        contentDocumentURL: doc ? doc.URL : null,
        appText: doc && doc.getElementById("app")
          ? doc.getElementById("app").textContent
          : null,
        panelMeta: doc && doc.querySelector
          ? Boolean(doc.querySelector('meta[name="lumiere-panel"]'))
          : false,
      };
    };
    return {
      evidence,
      frameIdentity: window.__frames.map(
        (element, index) => index > 0 && window.__frames[index - 1] === element,
      ),
      frames: window.__frames.map((element, index) => ({
        index,
        isConnected: element.isConnected,
        src: element.getAttribute("src"),
        messages: readMessages(element),
        ...docInfo(element),
      })),
      domFrames: Array.from(document.querySelectorAll("iframe")).map(
        (element) => ({
          src: element.getAttribute("src"),
          isConnected: element.isConnected,
          messages: readMessages(element),
          ...docInfo(element),
        }),
      ),
    };
  });
}

async function probeReplacement(page) {
  return page.evaluate(() => {
    const evidence = window.__evidence;
    const frames = window.__frames;
    if (frames.length < 2) {
      return { error: `expected >= 2 attached frames, saw ${frames.length}` };
    }
    const stale = frames[0];
    const live = frames[frames.length - 1];
    const snapshot = () => ({
      loaded: evidence.loaded.map((event) => event.version),
      failed: evidence.failed.map((event) => event.mark),
    });
    const staleInfo = {
      isConnected: stale.isConnected,
      contentDocumentURL: stale.contentDocument
        ? stale.contentDocument.URL
        : null,
    };
    const before = snapshot();
    let staleError = null;
    try {
      stale.dispatchEvent(new Event("load"));
      stale.dispatchEvent(new Event("error"));
    } catch (error) {
      staleError = String(error);
    }
    const afterStale = snapshot();
    let liveError = null;
    try {
      live.dispatchEvent(new Event("load"));
    } catch (error) {
      liveError = String(error);
    }
    const afterLive = snapshot();
    return {
      staleIndex: 0,
      liveIndex: frames.length - 1,
      staleInfo,
      liveInfo: {
        isConnected: live.isConnected,
        contentDocumentURL: live.contentDocument
          ? live.contentDocument.URL
          : null,
      },
      before,
      afterStale,
      afterLive,
      staleError,
      liveError,
    };
  });
}

const runs = [];
for (const bundle of ["current", "prefix"]) {
  for (const scenario of ["single", "rerender", "attempt", "replace"]) {
    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const url = `http://${HOST}:${PORT}/?scenario=${scenario}&bundle=${bundle}`;
    const requestStart = requestLog.length;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(
        () => {
          const evidence = window.__evidence;
          return Boolean(
            evidence &&
              (evidence.loaded.length > 0 || evidence.failed.length > 0),
          );
        },
        { timeout: 5000 },
      )
      .catch(() => {});
    await page.waitForTimeout(1500);
    const baseline = await readBaseline(page);
    const screenshot = `${ROOT}/screenshots/${bundle}-${scenario}.png`;
    await page.screenshot({ path: screenshot });
    const replacement =
      scenario === "attempt" || scenario === "replace"
        ? await probeReplacement(page)
        : null;
    const requests = requestLog
      .slice(requestStart)
      .filter((entry) => entry.pathname !== "/bundle-current.js" && entry.pathname !== "/bundle-prefix.js");
    runs.push({
      bundle,
      scenario,
      url,
      settled: baseline.evidence.loaded.length + baseline.evidence.failed.length > 0,
      evidence: {
        startedAt: baseline.evidence.startedAt,
        loaded: baseline.evidence.loaded.map((event) => event.version),
        failed: baseline.evidence.failed.map((event) => event.mark),
        loadedTimeline: baseline.evidence.loaded,
        failedTimeline: baseline.evidence.failed,
        actions: baseline.evidence.actions,
        nativeLoads: baseline.evidence.nativeLoads,
        parentRenders: baseline.evidence.parentRenders,
        bodyRenders: baseline.evidence.bodyRenders,
      },
      frameIdentity: baseline.frameIdentity,
      frames: baseline.frames,
      domFrames: baseline.domFrames,
      replacement: resultOf(replacement),
      consoleErrors,
      pageErrors,
      screenshot,
      requests,
    });
    await page.close();
  }
}

const browserVersion = browser.version();
await browser.close();
server.close();

const provenance = JSON.parse(
  readFileSync(`${ROOT}/provenance-build.json`, "utf8"),
);
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: WORKTREE })
  .toString()
  .trim();

const results = {
  generatedAt: new Date().toISOString(),
  worktree: WORKTREE,
  head,
  headMatchesBuild: head === provenance.head,
  sourceClean:
    execFileSync("git", ["status", "--porcelain"], { cwd: WORKTREE })
      .toString()
      .trim() === "",
  port: PORT,
  browser: { name: "chromium", version: browserVersion, headless: true },
  react: provenance.react,
  reactDom: provenance.reactDom,
  esbuild: provenance.esbuild,
  bundles: bundleMeta,
  prefixSourceCommit: provenance.prefixSourceCommit,
  runs,
  requests: requestLog,
};
writeFileSync(
  `${ROOT}/results.json`,
  `${JSON.stringify(results, null, 2)}\n`,
);

const summarizeMessages = (messages) =>
  Array.isArray(messages)
    ? messages.map((item) => item && item.data && item.data.lumiere)
    : messages;

const lines = [];
lines.push(`# #736 React 19.3.1 browser harness`);
lines.push(`head ${head} (clean=${results.sourceClean})`);
lines.push(`react ${results.react.version}, react-dom ${results.reactDom.version}, chromium ${browserVersion}`);
lines.push("");
for (const run of runs) {
  const t0 = run.evidence.startedAt;
  const rel = (t) => Math.round(t - t0);
  const messages = summarizeMessages(
    run.domFrames.length === 1 ? run.domFrames[0].messages : null,
  );
  const frameMessages = run.domFrames.map((frame) => ({
    url: frame.contentDocumentURL,
    messages: summarizeMessages(frame.messages),
  }));
  const actionTimes = run.evidence.actions.map(
    (action) => `${action.action}@${rel(action.t)}ms`,
  );
  const loadedTimes = run.evidence.loadedTimeline.map(
    (event) => `${event.version}@${rel(event.t)}ms`,
  );
  const failedTimes = run.evidence.failedTimeline.map(
    (event) => `${event.mark}@${rel(event.t)}ms`,
  );
  const nativeLoads = run.evidence.nativeLoads.map(
    (event) => `${rel(event.t)}ms:${event.url}`,
  );
  lines.push(
    `${run.bundle.padEnd(7)} ${run.scenario.padEnd(8)} loaded=${JSON.stringify(run.evidence.loaded)} failed=${JSON.stringify(run.evidence.failed)} actions=${JSON.stringify(actionTimes)} renders=${run.evidence.parentRenders}/${run.evidence.bodyRenders} frameIdentity=${JSON.stringify(run.frameIdentity)} nativeLoads=${JSON.stringify(nativeLoads)} loadedAt=${JSON.stringify(loadedTimes)} failedAt=${JSON.stringify(failedTimes)} domFrames=${run.domFrames.length} iframeMessages=${JSON.stringify(frameMessages)}`,
  );
  if (run.replacement && !run.replacement.error) {
    lines.push(
      `        stale: connected=${run.replacement.staleInfo.isConnected} before=${JSON.stringify(run.replacement.before)} afterStaleLoad+Error=${JSON.stringify(run.replacement.afterStale)} afterLiveLoad=${JSON.stringify(run.replacement.afterLive)}`,
    );
  } else if (run.replacement) {
    lines.push(`        replacement probe: ${run.replacement.error}`);
  }
  if (run.consoleErrors.length || run.pageErrors.length) {
    lines.push(
      `        consoleErrors=${JSON.stringify(run.consoleErrors.slice(0, 3))} pageErrors=${JSON.stringify(run.pageErrors.slice(0, 3))}`,
    );
  }
}
lines.push("");
lines.push(`requests: ${requestLog.length} total`);
for (const entry of requestLog) {
  lines.push(
    `  ${entry.scenario}/${entry.bundle} ${entry.pathname} editorRequest=${entry.editorRequest ?? "-"} kind=${entry.bodyKind ?? "-"} delay=${entry.delayMs ?? "-"}ms finished=${entry.finished} aborted=${entry.aborted}`,
  );
}
const transcript = `${lines.join("\n")}\n`;
writeFileSync(`${ROOT}/logs/run.log`, transcript);
console.log(transcript);
