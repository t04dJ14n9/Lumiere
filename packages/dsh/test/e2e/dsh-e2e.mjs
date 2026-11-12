// End-to-end checks for the Lumière DSH bundle against a RUNNING harness.
//
//   DSH_URL=http://127.0.0.1:61440 \
//   DSH_COOKIE='name=value; ...' node packages/dsh/test/e2e/dsh-e2e.mjs
//
// Both values must come from a pinned DSH started with a throwaway DSH_HOME
// and a disposable workspace. The runner never reads the owner's desktop
// profile or a demo profile. Checks run sequentially and share panel, browser
// and console state; the script prints PASS/FAIL/SKIP per check and exits
// non-zero on any failure (skips are counted separately from passes).
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const results = [];
let base;
let origin;
let cookie;
let scratch;
let WebSocket;
let chromium;

export class Skip extends Error {
  constructor(detail) {
    super(detail);
    this.name = "Skip";
  }
}

export function skip(detail) {
  throw new Skip(detail);
}

export function resetResults() {
  results.length = 0;
}

export function summarize(list = results) {
  const passed = list.filter((result) => result.ok === true);
  const skipped = list.filter((result) => result.ok === "skipped");
  const failed = list.filter((result) => result.ok === false);
  const line =
    `\n${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed (${list.length} checks)` +
    (failed.length
      ? `; FAILED: ${failed.map((result) => result.name).join(" | ")}`
      : "");
  return { passed, skipped, failed, line, exitCode: failed.length ? 1 : 0 };
}

export const UNSUPPORTED_SYMLINK_CODES = new Set([
  "EPERM",
  "EACCES",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

export function readCookie() {
  const value = process.env.DSH_COOKIE;
  if (!value) {
    throw new Error("Set DSH_COOKIE from the throwaway DSH_HOME profile");
  }
  return value;
}

function pairs() {
  return cookie.split("; ").map((entry) => {
    const at = entry.indexOf("=");
    return { name: entry.slice(0, at), value: entry.slice(at + 1) };
  });
}

export async function check(name, run) {
  try {
    const detail = await run();
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    if (error instanceof Skip) {
      results.push({ name, ok: "skipped", detail: error.message });
      console.log(`SKIP  ${name} — ${error.message}`);
      return;
    }
    results.push({ name, ok: false, detail: String(error) });
    console.log(`FAIL  ${name} — ${String(error).slice(0, 300)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function staticTraversalRefused({ base, get, assert }) {
  const probe = `${base}/lumiere/m/..%2fetc/passwd`;
  const outbound = new URL(probe);
  assert(
    outbound.pathname.startsWith("/lumiere/m/"),
    `pathname left /lumiere/m/: ${outbound.pathname}`,
  );
  const response = await get(probe);
  assert(response.status === 403, `expected 403, got ${response.status}`);
  return String(response.status);
}

export async function symlinkEscapeRefused({
  base,
  scratch,
  path,
  pathToFileURL,
  symlinkSync,
  openPanel,
  get,
  skip,
  assert,
  md,
}) {
  const link = path.join(scratch, "escape.md");
  try {
    symlinkSync("/etc/hosts", link);
  } catch (error) {
    const code = error?.code;
    if (UNSUPPORTED_SYMLINK_CODES.has(code)) {
      skip(`symlink unsupported (${code})`);
    }
    throw error;
  }
  const panel = await openPanel(md);
  try {
    const uri = pathToFileURL(link).href;
    const response = await get(
      `${base}/lumiere/file?panel=${panel.panel}&uri=${encodeURIComponent(uri)}`,
    );
    assert(response.status === 403, `expected 403, got ${response.status}`);
    return String(response.status);
  } finally {
    panel.socket.close();
  }
}

function note(name, text = "# Note\n\nHello.\n") {
  const file = path.join(scratch, name);
  writeFileSync(file, text);
  return file;
}

function editorUrl(file, root = scratch) {
  return `${base}/lumiere/editor?path=${encodeURIComponent(file)}&root=${encodeURIComponent(root)}`;
}

async function get(url, extra = {}) {
  return fetch(url, {
    headers: { Cookie: cookie, Origin: origin, ...extra },
  });
}

async function expectStatus(url, status, extra) {
  const response = await get(url, extra);
  assert(
    response.status === status,
    `expected ${status}, got ${response.status}`,
  );
  return response;
}

async function ready(socket, session) {
  const reply = new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error("no ready reply within 5s")),
      5000,
    );
    socket.on("message", (raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.ch === "rpc" && frame.data?.id === 1) {
        globalThis.clearTimeout(timer);
        resolve(frame.data);
      }
    });
  });
  socket.send(
    JSON.stringify({
      ch: "rpc",
      data: {
        kind: "request",
        id: 1,
        channel: "editor",
        method: "ready",
        params: {},
        session,
      },
    }),
  );
  return reply;
}

async function openPanel(file, root) {
  const response = await get(editorUrl(file, root));
  const html = await response.text();
  const panel = /name="lumiere-panel" content="([^"]+)"/.exec(html)?.[1];
  assert(panel, `no panel id in ${response.status} body`);
  const socket = new WebSocket(
    `${base.replace("http", "ws")}/lumiere/socket?panel=${panel}`,
    { headers: { Cookie: cookie, Origin: origin } },
  );
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
    socket.once("unexpected-response", (_r, res) =>
      reject(new Error(`upgrade ${res.statusCode}`)),
    );
  });
  return { socket, panel };
}

async function main() {
  const require = createRequire(path.resolve("packages/host-node/package.json"));
  WebSocket = require("ws");
  ({ chromium } = require("@playwright/test"));

  base = process.env.DSH_URL;
  if (!base) {
    throw new Error("Set DSH_URL for the pinned throwaway harness");
  }
  origin = new URL(base).origin;
  cookie = readCookie();
  scratch = mkdtempSync(path.join(tmpdir(), "lumiere-e2e-"));

  let browser;
  let context;
  let page;

  try {
  const md = note("plain.md");
  const markdown = note("long.markdown");
  const upper = note("UPPER.MD");
  const spaced = note("a note #1 (draft).md");
  const big = note("big.md", "# Big\n\n" + "line of text\n".repeat(2000));
  const unicode = note("café.md", "# Café\n\n日本語 и русский 🎉\n");
  const outside = "/etc/hosts";

  // ---------- HTTP surface ----------
  await check("editor page: valid note", async () => {
    const response = await expectStatus(editorUrl(md), 200);
    const html = await response.text();
    assert(html.includes('name="lumiere-panel"'), "missing panel meta");
    assert(html.includes("/lumiere/page/shim.js"), "missing shim");
    assert(html.includes("/lumiere/m/webview/editor.js"), "missing editor.js");
    assert(/nonce="[^"]+"/.test(html), "missing script nonce");
    assert(
      response.headers.get("cache-control") === "no-store",
      "missing no-store",
    );
    return "200 with nonce, shim, module, no-store";
  });
  await check("editor page: .markdown extension", () =>
    expectStatus(editorUrl(markdown), 200).then(() => "200"),
  );
  await check("editor page: uppercase .MD", () =>
    expectStatus(editorUrl(upper), 200).then(() => "200"),
  );
  await check("editor page: spaces, # and parentheses in path", () =>
    expectStatus(editorUrl(spaced), 200).then(() => "200"),
  );
  await check("editor page: unicode path", () =>
    expectStatus(editorUrl(unicode), 200).then(() => "200"),
  );
  await check("editor page: large note", () =>
    expectStatus(editorUrl(big), 200).then(() => "200"),
  );
  await check("editor page: missing params", () =>
    expectStatus(`${base}/lumiere/editor`, 400).then(() => "400"),
  );
  await check("editor page: relative path", () =>
    expectStatus(
      `${base}/lumiere/editor?path=plain.md&root=${scratch}`,
      400,
    ).then(() => "400"),
  );
  await check("editor page: non-markdown path", () =>
    expectStatus(editorUrl(path.join(scratch, "plain.txt")), 400).then(
      () => "400",
    ),
  );
  await check("editor page: note outside root", () =>
    expectStatus(editorUrl("/etc/hosts", scratch), 400).then(() => "400"),
  );
  await check("editor page: filesystem root refused", async () => {
    const response = await get(editorUrl(md, "/"));
    assert([400, 403].includes(response.status), `got ${response.status}`);
    return String(response.status);
  });
  await check("editor page: .. traversal refused", async () => {
    const sub = path.join(scratch, "sub");
    const traversal = `${sub}${path.sep}..${path.sep}plain.md`;
    const response = await get(
      `${base}/lumiere/editor?path=${encodeURIComponent(traversal)}&root=${encodeURIComponent(sub)}`,
    );
    assert([400, 403].includes(response.status), `got ${response.status}`);
    return String(response.status);
  });
  await check("write to a read-only route is rejected with 405", async () => {
    for (const route of [
      `/lumiere/editor?path=${encodeURIComponent(md)}&root=${encodeURIComponent(scratch)}`,
      `${base}/lumiere/page/shim.js`,
      `${base}/lumiere/file?uri=${encodeURIComponent(`file://${md}`)}`,
      `${base}/lumiere/m/webview/editor.js`,
    ]) {
      const response = await fetch(
        route.startsWith("http") ? route : base + route,
        {
          method: "POST",
          headers: { Cookie: cookie, Origin: origin },
        },
      );
      assert(response.status === 405, `${route} -> ${response.status}`);
      assert(
        response.headers.get("allow") === "GET, HEAD",
        "missing Allow header",
      );
    }
    return "405 + Allow on all four";
  });
  await check("malformed JSON bodies return 400, not 500", async () => {
    for (const route of [
      "/lumiere/settings",
      "/lumiere/views/outline/run",
      "/lumiere/views/outline/visible",
    ]) {
      const response = await fetch(base + route, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "content-type": "application/json",
        },
        body: "{not json",
      });
      assert(response.status === 400, `${route} -> ${response.status}`);
    }
    return "400 for all three";
  });
  await check("editor page: unauthenticated refused", async () => {
    const response = await fetch(editorUrl(md), {
      headers: { Origin: origin },
    });
    assert(
      response.status === 401 || response.status === 403,
      `got ${response.status}`,
    );
    return String(response.status);
  });
  await check("shim.js served", () =>
    expectStatus(`${base}/lumiere/page/shim.js`, 200).then(async (r) => {
      assert(
        (await r.text()).includes("__ModuleLoader__") === false,
        "shim is not the module loader",
      );
      return "200";
    }),
  );
  await check("editor.js and css served", async () => {
    for (const file of [
      "/lumiere/m/webview/editor.js",
      "/lumiere/m/webview/editor.css",
    ]) {
      await expectStatus(base + file, 200);
    }
    return "200 for js and css";
  });
  await check("static path traversal refused", () =>
    staticTraversalRefused({ base, get, assert }),
  );
  await check("unknown route → 404", () =>
    expectStatus(`${base}/lumiere/does-not-exist`, 404).then(() => "404"),
  );
  await check("file route: no panel refused", () =>
    expectStatus(
      `${base}/lumiere/file?uri=${encodeURIComponent(`file://${md}`)}`,
      403,
    ).then(() => "403"),
  );

  // ---------- WebSocket ----------
  const first = await openPanel(md);
  await check("socket: ready RPC returns note text", async () => {
    const reply = await ready(first.socket, "e2e-session-1");
    assert(
      reply.kind === "response",
      `got ${reply.kind}: ${reply.message ?? ""}`,
    );
    assert(reply.result.text.includes("# Note"), "wrong note text");
    return "response with note text";
  });
  await check("socket: file route serves note inside workspace", async () => {
    const response = await get(
      `${base}/lumiere/file?panel=${first.panel}&uri=${encodeURIComponent(pathToFileURL(realpathSync(md)).toString())}`,
    );
    assert(response.status === 200, `got ${response.status}`);
    assert((await response.text()).includes("# Note"), "wrong bytes");
    return "200";
  });
  await check(
    "file route: non-canonical workspace path is still inside the root",
    async () => {
      const panel = await openPanel(md);
      const response = await get(
        `${base}/lumiere/file?panel=${panel.panel}&uri=${encodeURIComponent(pathToFileURL(md).toString())}`,
      );
      panel.socket.close();
      assert(response.status === 200, `got ${response.status}`);
      return "200";
    },
  );
  await check("file route: outside workspace refused", () =>
    expectStatus(
      `${base}/lumiere/file?panel=${first.panel}&uri=${encodeURIComponent(`file://${outside}`)}`,
      403,
    ).then(() => "403"),
  );
  await check("file route: no panel refused", () =>
    expectStatus(
      `${base}/lumiere/file?uri=${encodeURIComponent(`file://${md}`)}`,
      403,
    ).then(() => "403"),
  );
  await check(
    "socket: unauthenticated upgrade answered with HTTP 401",
    async () => {
      const socket = new WebSocket(
        `${base.replace("http", "ws")}/lumiere/socket?panel=x`,
        {
          headers: { Origin: origin },
        },
      );
      const outcome = await new Promise((resolve) => {
        socket.once("open", () => resolve("open"));
        socket.once("error", () => resolve("refused"));
        socket.once("unexpected-response", (_r, res) =>
          resolve(`http ${res.statusCode}`),
        );
      });
      socket.terminate();
      assert(outcome === "http 401", `expected http 401, got ${outcome}`);
      return String(outcome);
    },
  );
  await check("socket: unknown panel refused", async () => {
    const socket = new WebSocket(
      `${base.replace("http", "ws")}/lumiere/socket?panel=unknown-panel`,
      { headers: { Cookie: cookie, Origin: origin } },
    );
    const outcome = await new Promise((resolve) => {
      socket.once("open", () => resolve("open"));
      socket.once("error", () => resolve("refused"));
      socket.once("unexpected-response", (_r, res) =>
        resolve(`http ${res.statusCode}`),
      );
    });
    socket.terminate();
    assert(outcome !== "open", "unknown panel was accepted");
    return String(outcome);
  });
  await check("socket: same file in two independent panels", async () => {
    const second = await openPanel(md);
    const reply = await ready(second.socket, "e2e-session-2");
    assert(reply.result.text.includes("# Note"), "second panel got wrong text");
    second.socket.close();
    return "both panels answered";
  });
  await check("socket: malformed frame does not break the panel", async () => {
    first.socket.send("not json");
    const reply = await ready(first.socket, "e2e-session-3");
    assert(reply.kind === "response", `got ${reply.kind}`);
    return "still responsive";
  });
  first.socket.close();

  // ---------- Browser editor ----------
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  await context.addCookies(pairs().map((entry) => ({ ...entry, url: base })));
  page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  async function render(file, root = scratch) {
    const response = await page.goto(editorUrl(file, root), {
      waitUntil: "load",
      timeout: 20000,
    });
    assert(response?.status() === 200, `HTTP ${response?.status()}`);
    await page.locator(".cm-content").waitFor({ timeout: 15000 });
    return page.locator(".cm-content").innerText();
  }

  await check("browser: markdown note renders", async () => {
    const text = await render(md);
    assert(
      text.includes("# Note") && text.includes("Hello."),
      "content missing",
    );
    return "CodeMirror rendered";
  });
  await check("browser: .markdown renders", async () => {
    const text = await render(markdown);
    assert(text.includes("# Note"), "content missing");
    return "rendered";
  });
  await check("browser: uppercase .MD renders", async () => {
    const text = await render(upper);
    assert(text.includes("# Note"), "content missing");
    return "rendered";
  });
  await check("browser: special-character path renders", async () => {
    const text = await render(spaced);
    assert(text.includes("# Note"), "content missing");
    return "rendered";
  });
  await check("browser: unicode path and content render", async () => {
    const text = await render(unicode);
    assert(text.includes("Café") && text.includes("日本語"), "unicode missing");
    return "unicode intact";
  });
  await check("browser: 2000-line note renders", async () => {
    const text = await render(big);
    assert(text.includes("Big"), "heading missing");
    return "rendered";
  });
  await check("browser: typing auto-saves to disk", async () => {
    const file = note("save.md");
    await render(file);
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\nE2E_SAVED_MARKER\n");
    await page.waitForTimeout(3000);
    assert(
      readFileSync(file, "utf8").includes("E2E_SAVED_MARKER"),
      "not saved",
    );
    return "edit persisted";
  });
  await check(
    "browser: parent theme/SHOWN/inset messages are harmless",
    async () => {
      const url = editorUrl(md);
      const probe = await context.newPage();
      const errors = [];
      probe.on("pageerror", (error) => errors.push(String(error)));
      await probe.route(`${base}/__e2e_parent__`, (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-a'; frame-src 'self'; style-src 'unsafe-inline'"><iframe id="f" src="${url}" style="width:100vw;height:100vh;border:0"></iframe><script nonce="a">const f=document.getElementById('f');f.addEventListener('load',()=>{f.contentWindow.postMessage({lumiere:'shown'},location.origin);f.contentWindow.postMessage({lumiere:'theme',dark:false,variables:{'--vscode-editor-background':'#fff'}},location.origin);f.contentWindow.postMessage({lumiere:'inset',top:12},location.origin)})</script>`,
        }),
      );
      await probe.goto(`${base}/__e2e_parent__`, { waitUntil: "load" });
      await probe
        .frameLocator("#f")
        .locator(".cm-content")
        .waitFor({ timeout: 15000 });
      const text = await probe
        .frameLocator("#f")
        .locator(".cm-content")
        .innerText();
      assert(
        text.includes("# Note"),
        "editor did not render under embedder messages",
      );
      assert(errors.length === 0, `page errors: ${errors.join(", ")}`);
      await probe.close();
      return "rendered with no errors";
    },
  );
  await check("auxiliary routes: views, settings, commands", async () => {
    for (const route of [
      "/lumiere/views",
      "/lumiere/settings",
      "/lumiere/commands",
    ]) {
      const response = await get(base + route);
      assert(response.status === 200, `${route} -> ${response.status}`);
      assert(
        (response.headers.get("content-type") ?? "").includes("json"),
        `${route} not JSON`,
      );
    }
    return "200 JSON for all three";
  });
  await check("file route: symlink escaping the workspace refused", () =>
    symlinkEscapeRefused({
      base,
      scratch,
      path,
      pathToFileURL,
      symlinkSync,
      openPanel,
      get,
      skip,
      assert,
      md,
    }),
  );
  await check("editor page: path containing ? and #", async () => {
    const odd = note("why?what#now.md");
    const response = await get(editorUrl(odd));
    assert(response.status === 200, `got ${response.status}`);
    const html = await response.text();
    assert(html.includes('name="lumiere-panel"'), "no panel id");
    return "200";
  });
  await check(
    "browser: image in a note loads through /lumiere/file",
    async () => {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wFPuSkQAAAABJRU5ErkJggg==",
        "base64",
      );
      writeFileSync(path.join(scratch, "pixel.png"), png);
      const withImage = note("image.md", "# Image\n\n![pixel](pixel.png)\n");
      await render(withImage);
      const image = page.locator('img[src*="/lumiere/file"]').first();
      await image.waitFor({ timeout: 15000 });
      const width = await image.evaluate((element) => element.naturalWidth);
      assert(width > 0, `image failed to decode (naturalWidth ${width})`);
      return "image decoded";
    },
  );
  await check("browser: dark theme message applies to the page", async () => {
    const url = editorUrl(md);
    const probe = await context.newPage();
    await probe.route(`${base}/__e2e_dark__`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-a'; frame-src 'self'; style-src 'unsafe-inline'"><iframe id="f" src="${url}" style="width:100vw;height:100vh;border:0"></iframe><script nonce="a">const f=document.getElementById('f');f.addEventListener('load',()=>f.contentWindow.postMessage({lumiere:'theme',dark:true,variables:{'--vscode-editor-background':'#101010'}},location.origin))</script>`,
      }),
    );
    await probe.goto(`${base}/__e2e_dark__`, { waitUntil: "load" });
    const frame = probe.frameLocator("#f");
    await frame.locator(".cm-content").waitFor({ timeout: 15000 });
    const state = await frame.locator("body").evaluate((element) => ({
      dark: element.classList.contains("vscode-dark"),
      background: element.ownerDocument.documentElement.style.getPropertyValue(
        "--vscode-editor-background",
      ),
    }));
    assert(state.dark, "vscode-dark class missing");
    assert(
      state.background === "#101010",
      `wrong variable: ${state.background}`,
    );
    await probe.close();
    return "vscode-dark + variable set";
  });
  await check("browser: no console errors across scenarios", () => {
    assert(consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    return "clean";
  });

  // ---------- Bundle and composition ----------
  await check("boot graph contains the Lumière client module", async () => {
    const response = await get(base);
    assert(response.status === 200, `got ${response.status}`);
    const html = await response.text();
    assert(
      html.includes("@lumiere/dsh"),
      "client row missing from __DSH_BOOT__",
    );
    assert(html.includes("__DSH_BOOT__"), "boot graph missing");
    return "row present";
  });
  await check("workspace bundle manifest is a valid DSH bundle", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.resolve("packages/dsh/dist/bundle/package.json"),
        "utf8",
      ),
    );
    assert(
      manifest.dsh?.bundle?.patch === "./cordis.patch.yml",
      "missing patch",
    );
    assert(manifest.dsh?.client?.platform === "web", "missing client platform");
    assert(
      manifest.exports?.["./client"] === "./client.js",
      "missing client export",
    );
    assert(
      Array.isArray(manifest.files) && manifest.files.length > 0,
      "no files",
    );
    return "manifest valid";
  });

  // ---------- Real DSH app ----------
  // A fresh browser context per scenario resets the saved sidebar layout, so
  // each one starts from the default DSH app and opens its own file tree.
  async function freshApp() {
    const fresh = await browser.newContext();
    await fresh.addCookies(pairs().map((entry) => ({ ...entry, url: base })));
    const app = await fresh.newPage();
    const errors = [];
    app.on("pageerror", (error) => errors.push(String(error)));
    app.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await app.goto(base, { waitUntil: "domcontentloaded", timeout: 40000 });
    await app.waitForTimeout(5000);
    const notice = app.getByRole("button", { name: "Continue" });
    if (await notice.count()) {
      await notice.first().click();
    }
    const sidebar = app.getByRole("button", { name: /Open right sidebar/ });
    if (await sidebar.count()) {
      await sidebar.first().click();
    }
    await app.waitForTimeout(1500);
    const picker = app.getByRole("button", { name: /Workspace files/ });
    if (await picker.count()) {
      await picker.first().click();
    }
    await app.waitForTimeout(2000);
    return { fresh, app, errors };
  }

  await check("DSH app: non-markdown file does not use Lumière", async () => {
    const { fresh, app } = await freshApp();
    try {
      await app.getByText(".gitignore", { exact: true }).first().click();
      await app.waitForTimeout(2500);
      const lumiere = app.locator('iframe[title="Lumière"]');
      assert(
        (await lumiere.count()) === 0,
        "Lumière claimed a non-markdown file",
      );
      return "DSH's own renderer used";
    } finally {
      await fresh.close();
    }
  });
  await check("DSH app: file-tree preview opens in Lumière", async () => {
    const { fresh, app, errors } = await freshApp();
    try {
      await app.getByText("README.md", { exact: true }).first().click();
      const frame = app.frameLocator('iframe[title="Lumière"]');
      await frame.locator(".cm-content").waitFor({ timeout: 25000 });
      const text = await frame.locator(".cm-content").innerText();
      const bodyText = await frame.locator("body").innerText();
      assert(text.length > 20, "editor rendered no content");
      assert(
        !bodyText.includes("Lumia could not open"),
        "bootstrap error shown",
      );
      assert(
        errors.length === 0,
        `console errors: ${errors.slice(0, 2).join(" | ")}`,
      );
      return "Lumière iframe rendered the note";
    } finally {
      await fresh.close();
    }
  });
} finally {
  if (browser) {
    await browser.close();
  }
  rmSync(scratch, { recursive: true, force: true });
}

  const { line, exitCode } = summarize(results);
  console.log(line);
  process.exitCode = exitCode;
}

function launchedAsMain() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (launchedAsMain()) {
  await main();
}
