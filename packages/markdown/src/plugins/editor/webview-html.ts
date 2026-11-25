import { l10nLanguage, l10nMeta } from "@workshop/l10n";
import type { PanelShell } from "../../shared/host";
import { scriptNonce } from "../../shared/nonce";
import { SNAPSHOT_CLASS } from "./snapshot-layout";
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
/**
 * With a snapshot, the editor is loaded by `import()` from a small inline
 * script, not a module script. VS Code shows a webview only once its page has
 * fired `load`, and a module script's whole import graph delays that
 * (`import()` does not), which would hold the snapshot back until the editor
 * was nearly up. Host messages that arrive before the editor's own listener
 * exists are kept in `window.lumiereEarlyMessages` for webview/transport.ts.
 * The script also takes the page's one VS Code API (`window.lumiereVsCodeApi`,
 * which webview/main.ts then uses) to see whether the webview was restored
 * with a view of its own: it opens elsewhere than the top, so no snapshot.
 */
function importEditor(entry: string): string {
  const url = JSON.stringify(entry).replaceAll("<", "\\u003c");
  const drop = `document.querySelector(".${SNAPSHOT_CLASS}")?.remove()`;
  return (
    `(()=>{const api=acquireVsCodeApi();window.lumiereVsCodeApi=api;` +
    `if(api.getState()!==undefined){${drop}}` +
    `const early={queue:[],stop(){removeEventListener("message",keep)}};` +
    `function keep(event){if(early.queue.length<1000){early.queue.push(event)}}` +
    `addEventListener("message",keep);window.lumiereEarlyMessages=early;` +
    `import(${url}).catch((error)=>{${drop};early.stop();console.error(error)})})()`
  );
}

/**
 * The webview's first HTML. `snapshot` (snapshot.ts) is the note's first
 * screen as inert markup inside `#app`, painted before the script loads.
 */
export function webviewHTML(panel: PanelShell, snapshot = ""): string {
  const nonce = scriptNonce();
  const source = panel.cspSource;
  // A module's imports, static or `import()`, inherit its nonce, so the
  // editor's chunks load without a source here.
  const scripts = panel.scriptsByNonceOnly ? "" : ` ${source}`;
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'${scripts}; style-src ${source} 'unsafe-inline'; img-src ${source} data: blob:${panel.trusted ? " https:" : ""}; media-src ${source} blob:${panel.trusted ? " https:" : ""}; frame-src ${panel.trusted ? "https:" : "'none'"}; font-src ${source} data:; connect-src ${source} blob:;`;
  const entry = panel.asset("webview/editor.js");
  const script = snapshot
    ? `<script nonce="${nonce}">${importEditor(entry)}</script>`
    : `<script type="module" nonce="${nonce}" src="${escape(entry)}"></script>`;
  return `<!doctype html><html lang="${escape(l10nLanguage())}"><head><meta charset="UTF-8">${l10nMeta()}<meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${escape(panel.asset("webview/editor.css"))}">${preloads(panel, nonce)}<style>html,body,#app{height:100%;margin:0;background:var(--vscode-editor-background,transparent)}</style></head><body><main id="app" data-pdfium-wasm="${escape(panel.pdfEngine ?? panel.asset("webview/embedpdf.wasm"))}">${snapshot}</main>${script}</body></html>`;
}

/**
 * The entry and the first view's feature chunks are all known when the page
 * is built. Listing them lets the browser request them together, while the
 * entry's own imports are still unknown: their fetches overlap instead of
 * following one another (the page evaluates none of them until it imports it).
 * Each carries the nonce: under a nonce-only policy a hint without it fails,
 * and the module it names would then fail to import as well.
 */
function preloads(panel: PanelShell, nonce: string): string {
  return (panel.preload ?? [])
    .map(
      (file) =>
        `<link rel="modulepreload" nonce="${nonce}" href="${escape(panel.asset(file))}">`,
    )
    .join("");
}
