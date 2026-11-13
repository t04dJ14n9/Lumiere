// Shared PDF engine-URL contract used by the DSH e2e suite and its focused
// regression. The shipped file is embedpdf.wasm under /lumiere/m/webview/.
// The HTML attribute name stays data-pdfium-wasm.

export const ENGINE_ATTR = "data-pdfium-wasm";
export const SHIPPED_ENGINE_PATH = "/lumiere/m/webview/embedpdf.wasm";

export function htmlDeclaresShippedEngine(html) {
  return html.includes(`${ENGINE_ATTR}="${SHIPPED_ENGINE_PATH}"`);
}

export function isShippedEngineAsset(pathname) {
  return pathname === SHIPPED_ENGINE_PATH;
}
