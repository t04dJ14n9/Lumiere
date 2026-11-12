// Final-head PDF-over-DSH GUI evidence. Read-only against the worktree.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const require = createRequire(
  "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-737/package.json",
);
const { chromium } = require("@playwright/test");

const WORKTREE = "/Users/t04dj14n9/Code/Lumia/.claude/worktrees/pr-737";
const EVIDENCE = "/tmp/chain-evidence-final/pdf";
const WORKSPACE =
  "/private/tmp/chain-evidence-final/dsh-docs/deepseek-harness/default-workspace";
const SHORT = path.join(
  WORKTREE,
  "packages/pdf/test/fixtures/generated/short.pdf",
);
const FIVE = path.join(
  WORKTREE,
  "packages/pdf/test/fixtures/generated/five.pdf",
);
const DSH_BIN =
  "/Users/t04dj14n9/.npm/_npx/50d2c97abf8f4186/node_modules/.bin/dsh";
const DSH_HOME = "/tmp/chain-evidence-final/dsh-home";
const PID_FILE = path.join(EVIDENCE, "dsh-web.pid");
const BASE = process.env.DSH_URL;
const COOKIE = process.env.DSH_COOKIE;
if (!BASE || !COOKIE) {
  throw new Error("DSH_URL and DSH_COOKIE are required");
}
const COOKIE_EQ = COOKIE.indexOf("=");
const COOKIE_NAME = COOKIE.slice(0, COOKIE_EQ);
const COOKIE_VALUE = COOKIE.slice(COOKIE_EQ + 1);
const ORIGIN = new URL(BASE).origin;

const results = [];
const screenshots = [];
const startedAt = new Date().toISOString();

function transcript(name, status, detail, extra = {}) {
  const entry = { name, status, detail, ...extra };
  results.push(entry);
  console.log(
    `${status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL"}  ${name} — ${detail}`,
  );
  return entry;
}

async function check(name, run) {
  try {
    const detail = await run();
    return transcript(name, "pass", typeof detail === "string" ? detail : JSON.stringify(detail));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    transcript(name, "fail", detail);
    return undefined;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(read, predicate, timeout, label) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) {
      return last;
    }
    await sleep(200);
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchAuth(url) {
  return fetch(url, {
    headers: { Cookie: COOKIE, Origin: ORIGIN, "Cache-Control": "no-cache" },
  });
}

function cookiePairs() {
  return COOKIE.split("; ").map((entry) => {
    const at = entry.indexOf("=");
    return { name: entry.slice(0, at), value: entry.slice(at + 1) };
  });
}

async function newContext(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    locale: "en-US",
    ...options,
  });
  await context.addCookies(
    cookiePairs().map((entry) => ({ ...entry, url: BASE })),
  );
  return context;
}

function watchPage(page, label) {
  const errors = [];
  const responses = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/lumiere/")) {
      responses.push({
        status: response.status(),
        url: response.url(),
        at: new Date().toISOString(),
      });
    }
  });
  return { label, errors, responses };
}

async function closeWelcome(page) {
  const dialogClose = page.getByRole("dialog").getByRole("button", { name: "Close" });
  if (await dialogClose.count()) {
    await dialogClose.first().click().catch(() => {});
    await page.waitForTimeout(300);
    return;
  }
  const close = page.getByRole("button", { name: "Close" });
  if (await close.count()) {
    await close.first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function openSettings(page) {
  const more = page.getByText("More", { exact: true }).last();
  await more.waitFor({ state: "visible", timeout: 10000 });
  await more.click();
  await page.waitForTimeout(300);
  const settings = page.getByText("Settings", { exact: true }).last();
  await settings.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  return dialog;
}

async function closeSettings(page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 10000 });
  await page.waitForTimeout(400);
}

async function setDshTheme(page, theme) {
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: theme, exact: true }).click();
  await page.waitForTimeout(500);
  await closeSettings(page);
}

async function bootApp(page, { light = true } = {}) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  await closeWelcome(page);
  if (light) {
    await setDshTheme(page, "Light");
  }
  await page.getByRole("button", { name: /Open right sidebar/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Workspace files/ }).first().click();
  await page.waitForTimeout(1800);
}

async function openFile(page, name) {
  const files = page.getByRole("button", { name: "Files", exact: true });
  if ((await files.count()) > 0 && (await files.first().isVisible().catch(() => false))) {
    await files.first().click();
    await page.waitForTimeout(700);
  }
  const entry = page.getByRole("button", { name, exact: true }).first();
  await entry.waitFor({ state: "visible", timeout: 20000 });
  await entry.click();
}

function pdfFrame(page) {
  return page.frames().find((frame) => frame.url().includes("/lumiere/pdf?"));
}

function pdfFrameNamed(page, needle) {
  return page.frames().find(
    (frame) =>
      frame.url().includes("/lumiere/pdf?") &&
      decodeURIComponent(frame.url()).includes(needle),
  );
}

async function viewerFile(page) {
  return page.frames().find((frame) => frame.url().includes("/lumiere/editor?"));
}

async function viewerState(page) {
  const frame = pdfFrame(page);
  if (!frame) {
    return { hasFrame: false };
  }
  try {
    const pageCount = await frame.locator(".page").count();
    const suffix = await frame.locator(".number-field").first().innerText();
    const currentPage = await frame
      .locator('input[aria-label="Page"]')
      .inputValue();
    return {
      hasFrame: true,
      url: frame.url(),
      pageCount,
      suffix: suffix.replace(/\s+/g, " ").trim(),
      currentPage,
    };
  } catch (error) {
    return { hasFrame: true, url: frame.url(), error: String(error) };
  }
}

async function waitForViewer(page, expectedPages, timeout = 25000) {
  return waitFor(
    () => viewerState(page),
    (state) =>
      state.hasFrame && String(state.suffix).includes(`of ${expectedPages}`),
    timeout,
    `PDF viewer with ${expectedPages} pages`,
  );
}

async function visiblePages(frame) {
  return frame.locator(".page").evaluateAll((pages) => {
    const viewport = document.querySelector(".viewport").getBoundingClientRect();
    return pages
      .map((page) => {
        const box = page.getBoundingClientRect();
        const height = Math.max(
          0,
          Math.min(box.bottom, viewport.bottom) - Math.max(box.top, viewport.top),
        );
        const width = Math.max(
          0,
          Math.min(box.right, viewport.right) - Math.max(box.left, viewport.left),
        );
        return {
          index: Number(page.getAttribute("data-page-index")),
          area: Math.round(height * width),
        };
      })
      .filter((entry) => entry.area > 0)
      .sort((a, b) => b.area - a.area);
  });
}

async function resetPageOne(page) {
  const frame = pdfFrame(page);
  assert(frame, "no PDF frame for page reset");
  const input = frame.locator('input[aria-label="Page"]');
  await input.click();
  await input.fill("1");
  await input.press("Enter");
  await page.waitForTimeout(800);
  return input.inputValue();
}

async function frameTheme(frame) {
  return frame.locator("body").evaluate((body) => {
    const style = getComputedStyle(body);
    return {
      className: body.className,
      background: style.backgroundColor,
      editorBackground: style.getPropertyValue("--vscode-editor-background"),
      editorForeground: style.getPropertyValue("--vscode-editor-foreground"),
    };
  });
}

async function dshTheme(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    return {
      source: html.getAttribute("data-ds-theme-source"),
      colorScheme: html.style.colorScheme,
      dark: body.hasAttribute("data-ds-dark-theme"),
    };
  });
}

async function previewIdentity(page) {
  return page.evaluate(() => {
    const preview = document.querySelector("[data-document-preview]");
    const iframe = document.querySelector('iframe[title="Lumière PDF"]');
    return {
      previewId: preview?.getAttribute("data-document-preview") ?? null,
      iframeTitle: iframe?.getAttribute("title") ?? null,
      iframeSrc: iframe?.getAttribute("src") ?? null,
      nativePdfEmbeds: document.querySelectorAll(
        'embed[type="application/pdf"], object[type="application/pdf"]',
      ).length,
    };
  });
}

async function wrapDshContentCallbacks(page) {
  return page.evaluate(() => {
    window.__loadedCalls = window.__loadedCalls ?? [];
    window.__failedCalls = window.__failedCalls ?? [];
    const iframe = document.querySelector('iframe[title="Lumière PDF"]');
    if (!iframe) {
      return { ok: false, reason: "no iframe" };
    }
    const fiberKey = Object.keys(iframe).find((key) =>
      key.startsWith("__reactFiber$"),
    );
    if (!fiberKey) {
      return { ok: false, reason: "no React fiber key" };
    }
    let fiber = iframe[fiberKey];
    const seen = [];
    for (let depth = 0; fiber && depth < 20; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props?.content && typeof props.content.loaded === "function") {
        seen.push({
          revision: props.content.revision,
          kind: props.content.kind,
        });
        if (!props.content.__evidenceWrapped) {
          const originalLoaded = props.content.loaded;
          const originalFailed = props.content.failed;
          props.content.loaded = (version) => {
            window.__loadedCalls.push({
              version,
              at: performance.now(),
              revision: props.content.revision,
            });
            return originalLoaded(version);
          };
          props.content.failed = () => {
            window.__failedCalls.push({
              at: performance.now(),
              revision: props.content.revision,
            });
            return originalFailed();
          };
          props.content.__evidenceWrapped = true;
          return { ok: true, wrapped: true, seen };
        }
        return { ok: true, wrapped: false, seen };
      }
    }
    return { ok: false, reason: "content props not found", seen };
  });
}

async function readDshCallbackCounts(page) {
  return page.evaluate(() => ({
    loaded: window.__loadedCalls ?? [],
    failed: window.__failedCalls ?? [],
  }));
}

function installSilentLumiereSocket() {
  const NativeWebSocket = window.WebSocket;
  class SilentSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      }, 20);
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  function EvidenceWebSocket(url, protocols) {
    if (!String(url).includes("/lumiere/socket")) {
      return new NativeWebSocket(url, protocols);
    }
    return new SilentSocket(url);
  }
  EvidenceWebSocket.prototype = NativeWebSocket.prototype;
  Object.setPrototypeOf(EvidenceWebSocket, NativeWebSocket);
  EvidenceWebSocket.CONNECTING = 0;
  EvidenceWebSocket.OPEN = 1;
  EvidenceWebSocket.CLOSING = 2;
  EvidenceWebSocket.CLOSED = 3;
  window.WebSocket = EvidenceWebSocket;
}

async function screenshot(page, name) {
  const file = path.join(EVIDENCE, name);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  return file;
}

copyFileSync(SHORT, path.join(WORKSPACE, "short.pdf"));
copyFileSync(FIVE, path.join(WORKSPACE, "five.pdf"));
writeFileSync(path.join(WORKSPACE, "broken.pdf"), "this is not a PDF\n");
writeFileSync(
  path.join(WORKSPACE, "note.md"),
  "# Note\n\nA note for the editor preview.\n",
);
rmSync(path.join(WORKSPACE, "escape.pdf"), { force: true });

const browser = await chromium.launch({ headless: true });
let mainContext;
let mainPage;

try {
  // ---------- provenance ----------
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: WORKTREE,
    encoding: "utf8",
  }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1"], {
    cwd: WORKTREE,
    encoding: "utf8",
  }).trim();
  const dshVersion = execFileSync(DSH_BIN, ["--version"], {
    encoding: "utf8",
  }).trim();
  const bundleDir = path.join(WORKTREE, "packages/dsh/dist/bundle");
  const bundleManifest = JSON.parse(
    readFileSync(path.join(bundleDir, "package.json"), "utf8"),
  );
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  const listening = execFileSync(
    "lsof",
    ["-nP", "-iTCP:19262", "-sTCP:LISTEN", "-t"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number);
  const outboundPid = listening[0];
  const provenance = {
    generatedAt: new Date().toISOString(),
    worktree: WORKTREE,
    head,
    headMatchesTask: head.startsWith("9a10d469"),
    gitStatusClean: status === "",
    gitStatus: status,
    dshVersion,
    dshBin: DSH_BIN,
    dshHome: DSH_HOME,
    dshUrl: BASE,
    dshPort: 19262,
    dshPid: pid,
    listeningPids: listening,
    portOwnedByStartedServer: outboundPid === pid,
    cookieName: "dsh-auth-<redacted>",
    cookieSource: "startup-URL token exchange (303 Set-Cookie); value held only in a 0600 env file outside evidence",
    cookieValue: "<redacted>",
    token: "<redacted>",
    bundle: {
      dir: bundleDir,
      name: bundleManifest.name,
      dshBundlePatch: bundleManifest.dsh?.bundle?.patch,
      clientExport: bundleManifest.exports?.["./client"],
      indexSha256: sha256File(path.join(bundleDir, "index.js")),
      clientSha256: sha256File(path.join(bundleDir, "client.js")),
    },
    fixtures: {
      short: { path: SHORT, sha256: sha256File(SHORT), pages: 3 },
      five: { path: FIVE, sha256: sha256File(FIVE), pages: 5 },
      workspace: WORKSPACE,
    },
    startedAt,
  };
  writeFileSync(
    path.join(EVIDENCE, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  await check("0. provenance: head, clean worktree, DSH version, owned port", () => ({
    head,
    gitStatusClean: status === "",
    dshVersion,
    dshPid: pid,
    listeningPids: listening,
    portOwnedByStartedServer: outboundPid === pid,
    bundle: `${bundleManifest.name} ${bundleManifest.dsh?.bundle?.patch}`,
  }));

  // ---------- main GUI pass ----------
  mainContext = await newContext(browser);
  mainPage = await mainContext.newPage();
  const mainWatch = watchPage(mainPage, "main");
  await bootApp(mainPage);

  await check("1. file-tree PDF opens Lumière's viewer in the Lumière frame", async () => {
    await openFile(mainPage, "short.pdf");
    await waitForViewer(mainPage, 3);
    await resetPageOne(mainPage);
    const state = await waitForViewer(mainPage, 3);
    const frame = pdfFrame(mainPage);
    assert(frame, "PDF frame disappeared");
    const identity = await previewIdentity(mainPage);
    const embedpdf = await frame.locator("#root").getAttribute("data-pdfium-wasm");
    const toolbar = await frame.getByRole("toolbar", { name: "PDF toolbar" }).count();
    const dshText = await mainPage.locator("body").innerText();
    assert(
      identity.previewId === "@lumiere/dsh/pdf",
      `DSH preview is ${identity.previewId}`,
    );
    assert(identity.iframeTitle === "Lumière PDF", "frame title is not Lumière PDF");
    assert(identity.nativePdfEmbeds === 0, "DSH native PDF embed is present");
    assert(dshText.includes("Lumière PDF"), "DSH preview header is not labeled Lumière PDF");
    assert(toolbar === 1, "viewer toolbar is missing");
    assert(
      embedpdf === "/lumiere/m/webview/embedpdf.wasm",
      `unexpected engine URL ${embedpdf}`,
    );
    await screenshot(mainPage, "01-open-pdf-lumiere-frame.png");
    return {
      frameUrl: state.url,
      frameTitle: identity.iframeTitle,
      dshPreviewId: identity.previewId,
      dshTab: "Lumière PDF",
      toolbar: state.suffix,
      pageCount: state.pageCount,
      currentPage: state.currentPage,
      engine: embedpdf,
      nativePdfEmbeds: identity.nativePdfEmbeds,
      screenshot: "01-open-pdf-lumiere-frame.png",
    };
  });

  await check("2. light↔dark reaches the PDF viewer without navigation", async () => {
    const frame = pdfFrame(mainPage);
    assert(frame, "no PDF frame for theme check");
    await frame.evaluate(() => {
      window.__evidenceNavStamp = `stamp-${Math.random().toString(36).slice(2)}`;
    });
    const before = {
      dsh: await dshTheme(mainPage),
      viewer: await frameTheme(frame),
      frameUrl: frame.url(),
      pageUrl: mainPage.url(),
      stamp: await frame.evaluate(() => window.__evidenceNavStamp),
    };
    await setDshTheme(mainPage, "Dark");
    await waitFor(() => frameTheme(frame), (value) => value.className.includes("vscode-dark"), 8000, "dark viewer theme");
    const dark = {
      dsh: await dshTheme(mainPage),
      viewer: await frameTheme(frame),
      frameUrl: frame.url(),
      pageUrl: mainPage.url(),
      stamp: await frame.evaluate(() => window.__evidenceNavStamp),
    };
    await screenshot(mainPage, "02-theme-dark.png");
    await setDshTheme(mainPage, "Light");
    await waitFor(() => frameTheme(frame), (value) => value.className.includes("vscode-light"), 8000, "light viewer theme");
    const light = {
      dsh: await dshTheme(mainPage),
      viewer: await frameTheme(frame),
      frameUrl: frame.url(),
      pageUrl: mainPage.url(),
      stamp: await frame.evaluate(() => window.__evidenceNavStamp),
    };
    await screenshot(mainPage, "03-theme-light-again.png");
    assert(before.stamp === dark.stamp && dark.stamp === light.stamp, "iframe navigated across theme changes");
    assert(before.frameUrl === dark.frameUrl && dark.frameUrl === light.frameUrl, "iframe URL changed");
    assert(before.pageUrl === light.pageUrl, "DSH page navigated");
    assert(before.viewer.className.includes("vscode-light"), "initial viewer was not light");
    assert(dark.viewer.className.includes("vscode-dark"), "dark class did not reach viewer");
    assert(light.viewer.className.includes("vscode-light"), "light class did not return");
    assert(before.viewer.background !== dark.viewer.background, "viewer background did not repaint dark");
    assert(dark.viewer.background !== light.viewer.background, "viewer background did not repaint light");
    return { before, dark, light, sameNavigationStamp: true, screenshots: ["02-theme-dark.png", "03-theme-light-again.png"] };
  });

  await check("3. rewriting the PDF reloads the open viewer to 5 pages with fresh bytes", async () => {
    const auto = mainPage.locator('button[data-textpreview-tool="auto-refresh"]');
    assert((await auto.count()) === 1, "DSH auto-refresh toggle not found");
    await auto.evaluate((button) => button.click());
    await mainPage.waitForTimeout(400);
    assert((await auto.getAttribute("aria-pressed")) === "false", "DSH auto-refresh did not turn off");
    const frame = pdfFrame(mainPage);
    assert(frame, "no PDF frame before rewrite");
    await frame.evaluate(() => {
      window.__evidenceReloadStamp = `reload-${Math.random().toString(36).slice(2)}`;
    });
    const initial = await viewerState(mainPage);
    const initialBytes = mainWatch.responses.filter((entry) =>
      entry.url.includes("/lumiere/pdf/bytes"),
    );
    assert(String(initial.suffix).includes("of 3"), `initial page count ${initial.suffix}`);
    copyFileSync(FIVE, path.join(WORKSPACE, "short.pdf"));
    const five = await waitForViewer(mainPage, 5, 25000);
    const fiveFrame = pdfFrame(mainPage);
    assert(fiveFrame, "PDF frame disappeared after rewrite");
    const reloadStamp = await fiveFrame.evaluate(() => window.__evidenceReloadStamp);
    assert(reloadStamp, "iframe was replaced during in-place reload");
    const fiveBytes = mainWatch.responses.filter((entry) =>
      entry.url.includes("/lumiere/pdf/bytes"),
    );
    const newest = fiveBytes.at(-1);
    assert(newest && newest.status === 200, "new bytes response was not 200");
    assert(/load=2(?:&|$)/.test(new URL(newest.url).search), `new bytes URL is not load=2: ${newest.url}`);
    const body = await (await fetchAuth(newest.url)).arrayBuffer();
    const freshHash = sha256Buffer(Buffer.from(body));
    assert(freshHash === sha256File(FIVE), "reloaded bytes do not match five.pdf");
    await screenshot(mainPage, "04-rewritten-five-pages.png");
    copyFileSync(SHORT, path.join(WORKSPACE, "short.pdf"));
    const three = await waitForViewer(mainPage, 3, 25000);
    const restoredFrame = pdfFrame(mainPage);
    const restoredStamp = await restoredFrame.evaluate(() => window.__evidenceReloadStamp);
    assert(restoredStamp === reloadStamp, "iframe was replaced when restoring short.pdf");
    const restoredBytes = mainWatch.responses.filter((entry) =>
      entry.url.includes("/lumiere/pdf/bytes"),
    ).at(-1);
    assert(restoredBytes && restoredBytes.status === 200, "restored bytes response missing");
    const restoredBody = await (await fetchAuth(restoredBytes.url)).arrayBuffer();
    assert(sha256Buffer(Buffer.from(restoredBody)) === sha256File(SHORT), "restored bytes are stale");
    // The evidence above is the in-place proof. DSH's own file banner still
    // says it shows the previous content because its auto-refresh is off; use
    // DSH's Reload once so later screenshots are not confused by that banner.
    const dshReload = mainPage.getByRole("button", { name: "Reload", exact: true });
    let dshBannerCleared = false;
    if (await dshReload.count()) {
      await dshReload.first().click();
      await waitForViewer(mainPage, 3, 25000);
      dshBannerCleared = true;
    }
    return {
      dshAutoRefresh: "off (isolates Lumière's watcher)",
      initial,
      afterRewrite: five,
      restored: three,
      sameIframeStamp: reloadStamp,
      initialBytesUrls: initialBytes.map((entry) => entry.url),
      newBytesUrl: newest.url,
      newBytesSha256: freshHash,
      expectedFiveSha256: sha256File(FIVE),
      restoredBytesUrl: restoredBytes.url,
      restoredBytesSha256: sha256Buffer(Buffer.from(restoredBody)),
      expectedShortSha256: sha256File(SHORT),
      dshBannerClearedByReload: dshBannerCleared,
      screenshot: "04-rewritten-five-pages.png",
    };
  });

  await check("4. wheel and keyboard paging change the visible page", async () => {
    await resetPageOne(mainPage);
    const frame = pdfFrame(mainPage);
    assert(frame, "no PDF frame for paging");
    const beforeWheel = {
      page: await frame.locator('input[aria-label="Page"]').inputValue(),
      visible: await visiblePages(frame),
    };
    const box = await mainPage.locator('iframe[title="Lumière PDF"]').boundingBox();
    assert(box, "PDF iframe has no box");
    await mainPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mainPage.mouse.wheel(0, 900);
    await mainPage.waitForTimeout(1200);
    const afterWheel = {
      page: await frame.locator('input[aria-label="Page"]').inputValue(),
      visible: await visiblePages(frame),
    };
    assert(afterWheel.visible[0]?.index !== beforeWheel.visible[0]?.index, "wheel did not change the visible page");
    await screenshot(mainPage, "05-wheel-paging.png");
    await resetPageOne(mainPage);
    const beforeKey = {
      page: await frame.locator('input[aria-label="Page"]').inputValue(),
      visible: await visiblePages(frame),
    };
    await mainPage.mouse.click(box.x + box.width / 2, box.y + 300);
    await mainPage.keyboard.press("PageDown");
    await mainPage.waitForTimeout(1000);
    const afterKey = {
      page: await frame.locator('input[aria-label="Page"]').inputValue(),
      visible: await visiblePages(frame),
    };
    assert(afterKey.visible[0]?.index !== beforeKey.visible[0]?.index, "keyboard did not change the visible page");
    await screenshot(mainPage, "06-keyboard-paging.png");
    return { beforeWheel, afterWheel, beforeKey, afterKey, screenshots: ["05-wheel-paging.png", "06-keyboard-paging.png"] };
  });

  // ---------- containment ----------
  await check("6. PDF page/bytes containment, contained missing 404, assets 200", async () => {
    const escape = path.join(WORKSPACE, "escape.pdf");
    const short = path.join(WORKSPACE, "short.pdf");
    const latestBytes = mainWatch.responses.filter((entry) =>
      entry.url.includes("/lumiere/pdf/bytes"),
    ).at(-1);
    assert(latestBytes && latestBytes.status === 200, "no current bytes URL");
    try {
      rmSync(escape, { force: true });
      symlinkSync("/etc/hosts", escape);
      const pageUrl = `${BASE}/lumiere/pdf?path=${encodeURIComponent(escape)}&root=${encodeURIComponent(WORKSPACE)}`;
      const pageResponse = await fetchAuth(pageUrl);
      const pageBody = await pageResponse.text();
      assert(pageResponse.status === 403, `escape page -> ${pageResponse.status}`);
      assert(pageBody === "", "escape page returned a body");
      rmSync(short, { force: true });
      symlinkSync("/etc/hosts", short);
      await mainPage.waitForTimeout(700);
      const bytesResponse = await fetchAuth(latestBytes.url);
      const bytesBody = await bytesResponse.arrayBuffer();
      assert(bytesResponse.status === 403, `symlink bytes -> ${bytesResponse.status}`);
      assert(bytesBody.byteLength === 0, "symlink bytes returned a body");
      const missingAsset = await fetchAuth(`${BASE}/lumiere/pdf/viewer/no-such-file.js`);
      assert(missingAsset.status === 404, `missing viewer asset -> ${missingAsset.status}`);
      const stale = new URL(latestBytes.url);
      stale.searchParams.set("load", "999");
      const staleResponse = await fetchAuth(stale.toString());
      assert(staleResponse.status === 404, `stale bytes load -> ${staleResponse.status}`);
      const missingPage = await fetchAuth(
        `${BASE}/lumiere/pdf?path=${encodeURIComponent(path.join(WORKSPACE, "missing.pdf"))}&root=${encodeURIComponent(WORKSPACE)}`,
      );
      assert(missingPage.status === 403, `missing contained PDF page -> ${missingPage.status}`);
      const assets = {};
      for (const asset of [
        "/lumiere/pdf/viewer/viewer.js",
        "/lumiere/pdf/viewer/viewer.css",
        "/lumiere/m/webview/embedpdf.wasm",
      ]) {
        const response = await fetchAuth(BASE + asset);
        assets[asset] = {
          status: response.status,
          contentType: response.headers.get("content-type"),
          bytes: (await response.arrayBuffer()).byteLength,
        };
        assert(response.status === 200, `${asset} -> ${response.status}`);
      }
      const evidence = {
        symlinkPage: { status: pageResponse.status, bodyBytes: pageBody.length },
        symlinkBytes: { status: bytesResponse.status, bodyBytes: bytesBody.byteLength },
        missingViewerAsset: missingAsset.status,
        staleBytesLoad: staleResponse.status,
        missingPdfPage: missingPage.status,
        assets,
      };
      writeFileSync(
        path.join(EVIDENCE, "containment.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
      );
      return evidence;
    } finally {
      rmSync(escape, { force: true });
      rmSync(short, { force: true });
      copyFileSync(SHORT, short);
      await mainPage.waitForTimeout(500);
    }
  });


  await check("5a. failed PDF open shows Lumière's message", async () => {
    const context = await newContext(browser);
    const page = await context.newPage();
    watchPage(page, "failed-pdf");
    try {
      await bootApp(page, { light: true });
      await openFile(page, "broken.pdf");
      const frame = await waitFor(
        () => pdfFrameNamed(page, "broken.pdf"),
        (value) => Boolean(value),
        15000,
        "broken PDF iframe",
      );
      const text = await waitFor(
        () => frame.locator("body").innerText().catch(() => ""),
        (value) => value.includes("This PDF could not be opened."),
        20000,
        "Lumière PDF failure message",
      );
      const identity = await previewIdentity(page);
      await screenshot(page, "07-pdf-failed-lumiere-message.png");
      assert(identity.previewId === "@lumiere/dsh/pdf", "failed PDF left Lumière's preview body");
      return {
        message: text.trim(),
        frameUrl: frame.url(),
        dshPreviewId: identity.previewId,
        screenshot: "07-pdf-failed-lumiere-message.png",
      };
    } finally {
      await context.close();
    }
  });

  // ---------- editor failure with the retry prefix ----------
  await check("5b. failed editor preview shows the retry prefix", async () => {
    const context = await newContext(browser);
    await context.addInitScript(installSilentLumiereSocket);
    const page = await context.newPage();
    const watch = watchPage(page, "editor-failure");
    try {
      await bootApp(page, { light: true });
      await openFile(page, "note.md");
      const frame = await waitFor(
        () => viewerFile(page),
        (value) => Boolean(value),
        15000,
        "editor iframe",
      );
      const appText = await waitFor(
        () => frame.locator("#app").innerText().catch(() => ""),
        (value) => value.startsWith("Lumiere could not open:"),
        30000,
        "editor retry prefix",
      );
      await screenshot(page, "08-editor-failed-retry-prefix.png");
      return {
        appText: appText.trim(),
        frameUrl: frame.url(),
        dshTab: "Lumière",
        injectedFailure: "silent /lumiere/socket ready handshake; DSH retried the iframe once",
        screenshot: "08-editor-failed-retry-prefix.png",
      };
    } finally {
      await context.close();
    }
  });

  // ---------- parent re-render mid-load ----------
  await check("7. parent re-render mid-load: loaded still fires", async () => {
    const context = await newContext(browser);
    const page = await context.newPage();
    let pdfRequests = 0;
    await page.route("**/lumiere/pdf?**", async (route) => {
      pdfRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 9000));
      await route.continue();
    });
    const watch = watchPage(page, "rerender");
    try {
      await bootApp(page, { light: true });
      await openFile(page, "short.pdf");
      await waitFor(
        () => page.locator('iframe[title="Lumière PDF"]').count(),
        (count) => count === 1,
        10000,
        "pending PDF iframe",
      );
      assert(pdfRequests === 1, `expected one delayed PDF request, got ${pdfRequests}`);
      const wrapped = await wrapDshContentCallbacks(page);
      assert(wrapped.ok && wrapped.wrapped, `could not wrap callbacks: ${JSON.stringify(wrapped)}`);
      const mark = await page.locator('iframe[title="Lumière PDF"]').evaluate((iframe) => {
        iframe.dataset.evidenceMark = "mid-load";
        return iframe.dataset.evidenceMark;
      });
      await setDshTheme(page, "Dark");
      const afterRerender = await page.locator('iframe[title="Lumière PDF"]').evaluate((iframe) => iframe.dataset.evidenceMark);
      assert(afterRerender === mark, "parent re-render replaced the pending iframe");
      const rewrapped = await wrapDshContentCallbacks(page);
      assert(rewrapped.ok, `could not inspect callbacks after re-render: ${JSON.stringify(rewrapped)}`);
      await waitForViewer(page, 3, 25000);
      await waitFor(
        () => {
          const frame = pdfFrame(page);
          return frame ? frame.locator(".page").count().catch(() => 0) : 0;
        },
        (count) => count > 0,
        15000,
        "painted PDF pages",
      );
      await resetPageOne(page);
      await page.waitForTimeout(500);
      const state = await viewerState(page);
      const counts = await readDshCallbackCounts(page);
      const finalMark = await page.locator('iframe[title="Lumière PDF"]').evaluate((iframe) => iframe.dataset.evidenceMark);
      assert(finalMark === mark, "iframe was replaced by the time load settled");
      assert(counts.loaded.length === 1, `loaded fired ${counts.loaded.length} times; expected 1`);
      assert(counts.failed.length === 0, `failed fired ${counts.failed.length} times`);
      await screenshot(page, "09-parent-rerender-mid-load.png");
      return {
        dshSettingsToggle: "opened, Dark selected, closed while the PDF page request was delayed",
        pageRequestDelayMs: 9000,
        sameIframeMark: finalMark,
        loadedCalls: counts.loaded,
        failedCalls: counts.failed,
        viewer: state,
        screenshot: "09-parent-rerender-mid-load.png",
      };
    } finally {
      await context.close();
    }
  });

  // ---------- dedicated React proof lane ----------
  await check("8. dedicated React frame-load proof lane passes", async () => {
    const log = path.join(EVIDENCE, "unit-frame-load.log");
    const output = execFileSync(
      "pnpm",
      [
        "--filter",
        "@workshop/dsh",
        "exec",
        "tsx",
        "--test",
        "test/unit/frame-load.test.ts",
      ],
      {
        cwd: WORKTREE,
        encoding: "utf8",
        env: { ...process.env, CI: "1" },
        timeout: 120000,
      },
    );
    writeFileSync(log, output);
    const lines = output.split("\n");
    assert(lines.some((line) => line.includes("a re-render detach and re-attach does not retire the live frame")), "ref-detach regression missing");
    assert(lines.some((line) => line.includes("PDF body reports only a Lumière page as loaded")), "PDF loaded callback test missing");
    return {
      log,
      tests: lines.find((line) => line.includes("tests 13"))?.trim(),
      passes: lines.find((line) => line.includes("pass 13"))?.trim(),
    };
  });

  // ---------- redaction ----------
  await check("9. evidence contains no raw cookie or token", async () => {
    const offenders = [];
    const scan = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
          continue;
        }
        if (!/\.(?:log|json|html|txt|mjs)$/i.test(entry.name)) {
          continue;
        }
        const text = readFileSync(full, "utf8");
        if (text.includes(COOKIE_VALUE)) {
          offenders.push(`${full}:raw-cookie`);
        }
        if (/token=[A-Za-z0-9_-]{16,}/.test(text)) {
          offenders.push(`${full}:raw-token`);
        }
      }
    };
    scan(EVIDENCE);
    assert(offenders.length === 0, `raw secrets found: ${offenders.join(", ")}`);
    const redacted = readFileSync(path.join(EVIDENCE, "dsh-web.log"), "utf8");
    assert(redacted.includes("token=<redacted>"), "startup log is not redacted");
    return "cookie value and startup token absent; startup log redacted";
  });
} finally {
  if (mainContext) {
    await mainContext.close().catch(() => {});
  }
  await browser.close().catch(() => {});
}

const failed = results.filter((entry) => entry.status === "fail");
const summary = {
  generatedAt: new Date().toISOString(),
  startedAt,
  finishedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: WORKTREE, encoding: "utf8" }).trim(),
  checks: results,
  screenshots,
  failures: failed.map((entry) => entry.name),
  ok: failed.length === 0,
};
writeFileSync(
  path.join(EVIDENCE, "evidence.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(
  `\n${results.filter((entry) => entry.status === "pass").length} passed, ${failed.length} failed (${results.length} checks)`,
);
if (failed.length > 0) {
  process.exitCode = 1;
}
