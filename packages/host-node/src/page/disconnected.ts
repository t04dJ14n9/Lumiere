/**
 * What the page shows while its socket is down (connection.ts). A modal
 * dialog makes the rest of the page inert, so nothing is typed into a note
 * whose edits cannot reach the host. While reconnecting it only waits; once
 * the connection is lost it offers to reload the page, which opens the note
 * again from the host.
 */
import type { ConnectionState } from "./connection";

const STYLE = `
.lumiere-page-disconnected{max-width:min(420px,86vw);padding:14px 16px;border-radius:8px;
  background:var(--vscode-editorWidget-background);color:var(--vscode-editorWidget-foreground);
  border:1px solid var(--vscode-errorForeground);box-shadow:0 4px 16px var(--vscode-widget-shadow);font:13px var(--vscode-font-family)}
.lumiere-page-disconnected::backdrop{background:rgba(0,0,0,.25)}
.lumiere-page-disconnected p{margin:0 0 10px}
.lumiere-page-disconnected button{padding:4px 12px;border-radius:4px;border:1px solid var(--vscode-button-border);font:inherit;cursor:pointer;
  background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
`;

const RECONNECTING =
  "Lumière lost its connection to this note. Reconnecting… Typing is paused until it is back.";
const LOST =
  "Lumière could not reconnect to this note. Reload it to keep editing.";

/** Shows, updates or hides the dialog for each state of the connection. */
export function showConnection(state: ConnectionState): void {
  const existing = document.querySelector<HTMLDialogElement>(
    "dialog.lumiere-page-disconnected",
  );
  if (state === "open" || state === "connecting") {
    existing?.close();
    existing?.remove();
    return;
  }
  const dialog = existing ?? createDialog();
  const message = dialog.querySelector("p");
  if (message) {
    message.textContent = state === "lost" ? LOST : RECONNECTING;
  }
  const reload = dialog.querySelector("button");
  if (reload) {
    reload.hidden = state !== "lost";
  }
  if (!dialog.open) {
    dialog.showModal();
  }
}

function createDialog(): HTMLDialogElement {
  if (!document.querySelector("style[data-lumiere-disconnected]")) {
    const style = document.createElement("style");
    style.dataset.lumiereDisconnected = "";
    style.textContent = STYLE;
    document.head.append(style);
  }
  const dialog = document.createElement("dialog");
  dialog.className = "lumiere-page-disconnected";
  dialog.setAttribute("role", "alertdialog");
  // Escape would close a modal dialog and let typing reach a dead socket.
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  const message = document.createElement("p");
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => location.reload());
  dialog.append(message, reload);
  document.body.append(dialog);
  return dialog;
}
