import type { PanelShell } from "../../shared/host";
import { scriptNonce } from "../../shared/nonce";
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
export function webviewHTML(panel: PanelShell): string {
  const nonce = scriptNonce();
  const source = panel.cspSource;
  const policy = `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${source}; style-src ${source} 'unsafe-inline'; img-src ${source} data: blob:${panel.trusted ? " https:" : ""}; media-src ${source} blob:${panel.trusted ? " https:" : ""}; frame-src ${panel.trusted ? "https:" : "'none'"}; font-src ${source} data:; connect-src ${source} blob:;`;
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${escape(panel.asset("webview/editor.css"))}">${preloads(panel)}<style>html,body,#app{height:100%;margin:0;background:var(--vscode-editor-background,transparent)}</style></head><body><main id="app" data-pdfium-wasm="${escape(panel.asset("webview/pdfium.wasm"))}"></main><script type="module" nonce="${nonce}" src="${escape(panel.asset("webview/editor.js"))}"></script></body></html>`;
}

/**
 * The entry and the first view's feature chunks are all known when the page
 * is built. Listing them lets the browser request them together, while the
 * entry's own imports are still unknown: their fetches overlap instead of
 * following one another (the page evaluates none of them until it imports it).
 */
function preloads(panel: PanelShell): string {
  return (panel.preload ?? [])
    .map(
      (file) =>
        `<link rel="modulepreload" href="${escape(panel.asset(file))}">`,
    )
    .join("");
}
