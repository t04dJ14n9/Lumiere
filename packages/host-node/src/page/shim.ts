/**
 * Stands in for VS Code's webview API in a Lumière editor page outside VS
 * Code. In VS Code a webview posts with `acquireVsCodeApi().postMessage` and
 * hears the extension through `message` events; here both travel over the
 * page's socket to its panel on the host. The embedder (DSH's preview plugin,
 * the app shell) sends the theme (embedding.ts). Runs before the editor's
 * module (host/page.ts puts it first).
 */
import {
  INSET_VARIABLE,
  isEmbeddingMessage,
  isMenuMessage,
  parseInsetMessage,
  isPortMessage,
  isShownMessage,
  parseThemeMessage,
  TRANSPORT_META,
  type ConnectMessage,
} from "../embedding";
import { parseHostFrame, type PageFrame } from "../protocol";
import { applyTheme, followSystemTheme } from "./theme";
import { openMenuAtSelection, reportContextMenus } from "./context-menu";
import { createUi } from "./ui";
import { reconnectingSocket } from "./connection";
import { showConnection } from "./disconnected";
import { showSvgImagesSafely } from "./svg-images";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

const panelId = meta("lumiere-panel") ?? "";
// Registered before listenToEmbedder, which keeps embedding messages from the
// editor: a channel's port arrives as one.
const send =
  meta(TRANSPORT_META) === "channel"
    ? connectChannel(panelId)
    : connect(panelId);
window.acquireVsCodeApi = () => vsCodeApi(send);
listenToEmbedder(send);
reportFocus(send);
reportHidden(send);
reportContextMenus(send);
showSvgImagesSafely();

/**
 * The embedder's messages arrive as `message` events, like the editor's RPC.
 * This listener is registered first and keeps them from the editor.
 */
function listenToEmbedder(send: (frame: PageFrame) => void): void {
  const stopFollowingSystem = followSystemTheme();
  window.addEventListener("message", (event) => {
    if (!isEmbeddingMessage(event.data)) {
      return;
    }
    // Check the sender BEFORE stopping propagation: a foreign-origin message
    // that merely carries a `lumiere` key must not suppress the editor's RPC
    // listener for that event.
    if (event.source !== window.parent || event.origin !== location.origin) {
      return;
    }
    event.stopImmediatePropagation();
    const theme = parseThemeMessage(event.data);
    if (theme) {
      stopFollowingSystem();
      applyTheme(theme);
    } else if (isShownMessage(event.data)) {
      // Shown is active, as when the reader clicks in (reportFocus).
      send({ ch: "ui", data: { type: "focus" } });
    } else if (isMenuMessage(event.data)) {
      openMenuAtSelection(document);
    } else {
      applyInset(event.data);
    }
  });
}

/** The embedder's controls over the page's top; the editor measures again. */
function applyInset(data: unknown): void {
  const inset = parseInsetMessage(data);
  if (inset) {
    document.documentElement.style.setProperty(
      INSET_VARIABLE,
      `${inset.top}px`,
    );
    window.dispatchEvent(new Event("resize"));
  }
}

function meta(name: string): string | undefined {
  return (
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ??
    undefined
  );
}

/** A frame from the host: the editor's RPC, or a request to draw some UI. */
function receiver(send: (frame: PageFrame) => void): (text: string) => void {
  const handleUi = createUi((frame) => send(frame));
  return (text) => {
    const frame = parseHostFrame(text);
    if (!frame) {
      return;
    }
    if (frame.ch === "rpc") {
      // The editor's transport accepts messages from this page's own origin.
      window.dispatchEvent(
        new MessageEvent("message", {
          data: frame.data,
          origin: location.origin,
        }),
      );
    } else {
      handleUi(frame.data);
    }
  };
}

/** The host in the embedder's own window (host-web): a channel it hands over. */
function connectChannel(panel: string): (frame: PageFrame) => void {
  const waiting: string[] = [];
  let port: MessagePort | undefined;
  const receive = receiver((frame) => send(frame));
  // The port is the page's channel to its host: a foreign-origin parent is
  // not this page's embedder, and its message must not stop other listeners.
  window.addEventListener("message", (event) => {
    if (
      port ||
      event.source !== window.parent ||
      event.origin !== location.origin ||
      !isPortMessage(event.data, panel) ||
      !event.ports[0]
    ) {
      return;
    }
    event.stopImmediatePropagation();
    port = event.ports[0];
    port.onmessage = (message) => receive(String(message.data));
    for (const text of waiting.splice(0)) {
      port.postMessage(text);
    }
  });
  const request: ConnectMessage = { lumiere: "connect", panel };
  window.parent.postMessage(request, location.origin);
  function send(frame: PageFrame): void {
    const text = JSON.stringify(frame);
    if (port) {
      port.postMessage(text);
    } else {
      waiting.push(text);
    }
  }
  return send;
}

function connect(panel: string): (frame: PageFrame) => void {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${location.host}/lumiere/socket?panel=${encodeURIComponent(panel)}`;
  const receive = receiver((frame) => send(frame));
  const sendText = reconnectingSocket({
    open: () => new WebSocket(url),
    receive,
    onState: showConnection,
  });
  function send(frame: PageFrame): void {
    sendText(JSON.stringify(frame));
  }
  return send;
}

/** Saved view state (scroll, folds) lives with the tab, as VS Code keeps it with the webview. */
function vsCodeApi(send: (frame: PageFrame) => void): VsCodeApi {
  // A page host-web made is a blob: document, with no query to key on.
  const key = `lumiere:state:${meta("lumiere-state") ?? location.search}`;
  return {
    postMessage: (message) => send({ ch: "rpc", data: message }),
    getState: () => {
      try {
        const saved = sessionStorage.getItem(key);
        return saved === null ? undefined : JSON.parse(saved);
      } catch {
        return undefined;
      }
    },
    setState: (state) => {
      try {
        sessionStorage.setItem(key, JSON.stringify(state));
      } catch {
        // A full or blocked storage only loses the saved scroll position.
      }
    },
  };
}

/** The host's active panel is the one the reader is in. */
function reportFocus(send: (frame: PageFrame) => void): void {
  const focus = () => send({ ch: "ui", data: { type: "focus" } });
  window.addEventListener("focus", focus);
  window.addEventListener("pointerdown", focus, { capture: true });
  window.addEventListener("blur", () =>
    send({ ch: "ui", data: { type: "blur" } }),
  );
}

/**
 * A hidden page may never be shown again (the window closes, the process is
 * ended in the background): the host writes its note now.
 */
function reportHidden(send: (frame: PageFrame) => void): void {
  const hidden = () => send({ ch: "ui", data: { type: "hidden" } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hidden();
    }
  });
  window.addEventListener("pagehide", hidden);
}
