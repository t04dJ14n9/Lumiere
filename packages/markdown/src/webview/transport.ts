import type { Transport } from "../shared/rpc/endpoint";
/**
 * Whether a `message` event is the extension host's. VS Code masks
 * window.parent, but its actual wrapper still has the webview's origin and
 * names itself as the source. A frame a note put in the page (trusted
 * workspaces allow `<iframe src="https://…">`) has its own origin, `"null"`
 * if sandboxed, or the page's own if it is `about:blank` or `srcdoc`; and one
 * that posts and is removed at once arrives with no source at all. None of
 * those is the host, so the origin must be the page's and the source a window
 * that is not one of the page's frames.
 */
export function fromHost(event: MessageEvent<unknown>): boolean {
  if (event.origin === "null" || event.origin !== window.location.origin) {
    return false;
  }
  return event.source !== null && !isPageFrame(event.source);
}

function isPageFrame(source: MessageEventSource): boolean {
  return Array.from(window.document.querySelectorAll("iframe")).some(
    (frame) => frame.contentWindow === source,
  );
}
/**
 * Host messages the page's inline loader kept while the editor's script was
 * loading (plugins/editor/webview-html.ts, which loads it after `load`).
 */
interface EarlyMessages {
  readonly queue: readonly MessageEvent<unknown>[];
  stop(): void;
}
declare global {
  interface Window {
    lumiereEarlyMessages?: EarlyMessages;
  }
}

export function webviewTransport(api: {
  postMessage(message: unknown): void;
}): Transport {
  return {
    send: (message) => api.postMessage(message),
    listen(receive) {
      const listener = (event: MessageEvent<unknown>) => {
        if (fromHost(event)) {
          receive(event.data);
        }
      };
      window.addEventListener("message", listener);
      // Same task as the listener's registration: nothing can interleave.
      const early = window.lumiereEarlyMessages;
      early?.stop();
      early?.queue.forEach(listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}
