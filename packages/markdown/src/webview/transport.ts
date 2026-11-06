import type { Transport } from "../shared/rpc/endpoint";
// VS Code masks window.parent, but its actual wrapper still has the webview's origin.
export function fromHost(event: MessageEvent<unknown>): boolean {
  return (
    event.source === null ||
    event.source === window ||
    event.origin === window.location.origin
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
    lumiaEarlyMessages?: EarlyMessages;
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
      const early = window.lumiaEarlyMessages;
      early?.stop();
      early?.queue.forEach(listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}
