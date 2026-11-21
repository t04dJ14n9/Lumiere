import assert from "node:assert/strict";
import test from "node:test";
import {
  viewerDocument,
  viewerPolicy,
} from "../../../src/plugins/htmlViewer/document";

const SOURCE = "https://*.vscode-cdn.net";
const FOLDER =
  "https://file%2B.vscode-resource.vscode-cdn.net/home/reader/vault/wiki/assets/";

function build(html: string, loadedAt = 1): string {
  return viewerDocument({
    html,
    folderAddress: FOLDER,
    cspSource: SOURCE,
    loadedAt,
  });
}

/** What was put in, wherever it went. */
const META = `<meta http-equiv="Content-Security-Policy" content="${viewerPolicy(SOURCE)}">`;
const BASE = `<base href="${FOLDER}">`;

test("the policy is exactly this, for the webview's source", () => {
  assert.equal(
    viewerPolicy(SOURCE),
    "default-src 'none'; " +
      "script-src 'unsafe-inline' 'unsafe-eval' https://*.vscode-cdn.net https:; " +
      "style-src 'unsafe-inline' https://*.vscode-cdn.net https:; " +
      "img-src https://*.vscode-cdn.net data: blob: https:; " +
      "font-src https://*.vscode-cdn.net data: https:; " +
      "media-src https://*.vscode-cdn.net data: blob: https:; " +
      "connect-src https://*.vscode-cdn.net blob: https:; " +
      "frame-src https:; " +
      "worker-src https://*.vscode-cdn.net blob:; " +
      "base-uri https://*.vscode-cdn.net; " +
      "form-action 'none'",
  );
});

test("the policy lets the page and the vault's files run and load, and closes what a page must not do", () => {
  const directives = new Map(
    viewerPolicy(SOURCE)
      .split("; ")
      .map((directive) => {
        const [name, ...values] = directive.split(" ");
        return [name, values] as const;
      }),
  );
  // The page is the document: inline and vault scripts and styles run.
  for (const name of ["script-src", "style-src"]) {
    assert.ok(directives.get(name)?.includes("'unsafe-inline'"), name);
    assert.ok(directives.get(name)?.includes(SOURCE), name);
    assert.ok(directives.get(name)?.includes("https:"), name);
  }
  // The rest is closed unless named.
  assert.deepEqual(directives.get("default-src"), ["'none'"]);
  assert.deepEqual(directives.get("form-action"), ["'none'"]);
  assert.deepEqual(directives.get("base-uri"), [SOURCE]);
  for (const name of directives.keys()) {
    assert.ok(
      [
        "default-src",
        "script-src",
        "style-src",
        "img-src",
        "font-src",
        "media-src",
        "connect-src",
        "frame-src",
        "worker-src",
        "base-uri",
        "form-action",
      ].includes(name!),
      String(name),
    );
  }
  // No file:, no wildcard, and no http: anywhere.
  assert.doesNotMatch(viewerPolicy(SOURCE), /\bfile:|\bhttp:| \* |'self'/);
});

test("the policy and the base come first in a page's head", () => {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title><script>1</script></head><body>B</body></html>';
  assert.equal(
    build(html),
    '<!doctype html><html lang="en"><head>' +
      `${META}${BASE}<!-- Lumiere HTML viewer, loaded 1 -->` +
      '<meta charset="utf-8"><title>T</title><script>1</script></head><body>B</body></html>',
  );
});

test("a page with no head gets one, after its doctype and html tag", () => {
  assert.equal(
    build("<!DOCTYPE html>\n<html><body>B</body></html>"),
    `<!DOCTYPE html>\n<html><head>${META}${BASE}<!-- Lumiere HTML viewer, loaded 1 --></head><body>B</body></html>`,
  );
  assert.equal(
    build("<script>run()</script><div>x</div>"),
    `<head>${META}${BASE}<!-- Lumiere HTML viewer, loaded 1 --></head><script>run()</script><div>x</div>`,
  );
  assert.equal(
    build("plain text"),
    `<head>${META}${BASE}<!-- Lumiere HTML viewer, loaded 1 --></head>plain text`,
  );
  assert.equal(
    build(""),
    `<head>${META}${BASE}<!-- Lumiere HTML viewer, loaded 1 --></head>`,
  );
});

test("a comment, a byte order mark, an XML declaration or the case of a tag do not hide the head", () => {
  const injected = `${META}${BASE}<!-- Lumiere HTML viewer, loaded 1 -->`;
  assert.equal(
    build(
      "\uFEFF<!-- note --><?xml version='1.0'?>\n<!DOCTYPE html>\n<HTML>\n<HEAD profile='x'><TITLE>t</TITLE>",
    ),
    `\uFEFF<!-- note --><?xml version='1.0'?>\n<!DOCTYPE html>\n<HTML>\n<HEAD profile='x'>${injected}<TITLE>t</TITLE>`,
  );
  // A tag that only starts like one is no tag.
  assert.equal(
    build("<header>h</header><headline>"),
    `<head>${injected}</head><header>h</header><headline>`,
  );
});

test("a `<head` in a script or a comment further on is not taken for the page's head", () => {
  const html =
    '<!doctype html><html><body><script>document.write("<head>")</script><!-- <head> --></body></html>';
  const page = build(html);
  assert.equal(
    page.indexOf(META),
    "<!doctype html><html><head>".length,
    "the policy sits where a head belongs",
  );
  assert.equal(page.split("<base ").length - 1, 1);
});

test("a base or policy of the page's own comes after ours, so ours rules", () => {
  const page = build(
    '<html><head><base href="https://evil.example/"><meta http-equiv="Content-Security-Policy" content="default-src *"></head></html>',
  );
  assert.ok(page.indexOf(BASE) < page.indexOf("https://evil.example/"));
  assert.ok(page.indexOf(META) < page.indexOf("default-src *"));
  // Ours is the first `<base>`, which is the one the browser takes.
  assert.equal(page.indexOf("<base "), page.indexOf(BASE));
});

test("nothing is put in the page but a policy, a base and a comment: no script", () => {
  const page = build("<html><head></head><body></body></html>");
  const added = page
    .replace("<html><head>", "")
    .replace("</head><body></body></html>", "");
  assert.equal(added, `${META}${BASE}<!-- Lumiere HTML viewer, loaded 1 -->`);
  assert.doesNotMatch(added, /<script|\son[a-z]+=|acquireVsCodeApi/i);
});

test("the page's text changes each time it is opened, so it loads again", () => {
  assert.notEqual(build("<p>x</p>", 1), build("<p>x</p>", 2));
});

test("a quote in an address cannot leave its attribute", () => {
  const page = viewerDocument({
    html: "<html><head></head></html>",
    folderAddress: 'https://host/a"><script>1</script>/',
    cspSource: SOURCE,
    loadedAt: 1,
  });
  assert.doesNotMatch(page, /<script>1/);
  assert.match(page, /<base href="https:\/\/host\/a&quot;&gt;&lt;script&gt;/);
});

test("a very large file is read for its head at its start only", () => {
  const body = "x".repeat(5_000_000);
  const page = build(`<html><head></head><body>${body}</body></html>`);
  assert.equal(page.length > 5_000_000, true);
  assert.ok(page.indexOf(META) < 100);
});
