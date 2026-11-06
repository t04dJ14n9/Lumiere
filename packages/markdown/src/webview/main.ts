import { webviewLogging } from "../plugins/editor/logging";
import { protocol } from "../plugins/editor/protocol";
import { webviewTransport } from "./transport";
import { Endpoint } from "../shared/rpc/endpoint";
import { bootstrap } from "./bootstrap";
import "./styles/index.css";
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
declare global {
  interface Window {
    /** The API the page's inline loader took first (plugins/editor/webview-html.ts). */
    lumiaVsCodeApi?: VsCodeApi;
  }
}
performance.mark("mw:main");
// The page may call it once only: its loader has, when it has a snapshot.
const vscode = window.lumiaVsCodeApi ?? acquireVsCodeApi();
const logging = webviewLogging((record) => rpc.notify(protocol, "log", record));
const rpc: Endpoint = new Endpoint(
  webviewTransport(vscode),
  {
    after(ms, callback) {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  },
  logging.logger,
  { session: crypto.getRandomValues(new Uint32Array(4)).join("-") },
);
void bootstrap(
  rpc,
  document.getElementById("app")!,
  {
    saved: vscode.getState(),
    persist: (state) => vscode.setState(state),
  },
  logging,
).catch((error) => {
  logging.logger.error("Editor bootstrap failed", error);
  document.getElementById("app")!.textContent =
    `Lumia could not open: ${String(error)}`;
});
