import assert from "node:assert/strict";
import test from "node:test";
import { webviewHTML } from "../../../src/plugins/editor/webview-html";
import type { PanelShell } from "../../../src/shared/host";

function shell(trusted: boolean): PanelShell {
  return {
    cspSource: "vscode-resource:",
    trusted,
    asset: (relative: string) => `vscode-resource:/${relative}`,
  } as unknown as PanelShell;
}
function policy(trusted: boolean): Map<string, string> {
  const html = webviewHTML(shell(trusted));
  const content = /Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1];
  assert.ok(content);
  const directives = new Map<string, string>();
  for (const part of content.replaceAll("&amp;", "&").split(";")) {
    const [name, ...values] = part.trim().split(" ");
    if (name) {
      directives.set(name, values.join(" "));
    }
  }
  return directives;
}

test("the webview CSP matches DESIGN §19 in a trusted workspace", () => {
  const csp = policy(true);
  assert.equal(csp.get("default-src"), "'none'");
  assert.match(
    csp.get("script-src") ?? "",
    /^'nonce-[^']+' 'wasm-unsafe-eval' vscode-resource:$/,
  );
  assert.equal(csp.get("img-src"), "vscode-resource: data: blob: https:");
  assert.equal(csp.get("media-src"), "vscode-resource: blob: https:");
  assert.equal(csp.get("frame-src"), "https:");
  assert.equal(csp.get("font-src"), "vscode-resource: data:");
  assert.equal(csp.get("connect-src"), "vscode-resource: blob:");
});

test("an untrusted workspace drops remote images, media and frames", () => {
  const csp = policy(false);
  assert.equal(csp.get("img-src"), "vscode-resource: data: blob:");
  assert.equal(csp.get("media-src"), "vscode-resource: blob:");
  assert.equal(csp.get("frame-src"), "'none'");
  assert.equal(csp.get("connect-src"), "vscode-resource: blob:");
});

test("each page gets a fresh script nonce", () => {
  assert.notEqual(
    policy(true).get("script-src"),
    policy(true).get("script-src"),
  );
});

test("without a snapshot the editor is a module script, as ever", () => {
  const html = webviewHTML(shell(true));
  assert.match(
    html,
    /<main id="app"[^>]*><\/main><script type="module" nonce="[^"]+" src="vscode-resource:\/webview\/editor.js"><\/script>/,
  );
  assert.equal(html.includes("lumiaEarlyMessages"), false);
});

test("with a snapshot it is in #app and the editor loads by import()", () => {
  const html = webviewHTML(shell(true), '<div class="mw-snapshot">text</div>');
  assert.match(
    html,
    /<main id="app"[^>]*><div class="mw-snapshot">text<\/div><\/main><script nonce="([^"]+)">/,
  );
  // import() leaves the page's load event to fire at once; a module script
  // would hold it, and VS Code shows the webview only after it.
  assert.equal(html.includes('type="module"'), false);
  const nonce = /<script nonce="([^"]+)">/.exec(html)![1];
  assert.ok(html.includes(`'nonce-${nonce}'`), "the CSP allows that script");
  assert.match(html, /import\("vscode-resource:\/webview\/editor.js"\)/);
  assert.match(html, /window\.lumiaEarlyMessages=early/);
  // A restored view opens elsewhere than the top: no snapshot over it.
  assert.match(
    html,
    /window\.lumiaVsCodeApi=api;if\(api\.getState\(\)!==undefined\)\{document\.querySelector\("\.mw-snapshot"\)\?\.remove\(\)\}/,
  );
});

test("the editor's address cannot end the inline script", () => {
  const hostile = {
    cspSource: "vscode-resource:",
    trusted: true,
    asset: (relative: string) => `vscode-resource:/${relative}?a=</script><b>`,
  } as unknown as PanelShell;
  const html = webviewHTML(hostile, "<div></div>");
  assert.equal(html.match(/<\/script>/g)?.length, 1);
  assert.equal(html.includes("<b>"), false);
});
