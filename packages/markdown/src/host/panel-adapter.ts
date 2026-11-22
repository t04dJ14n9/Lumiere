import * as vscode from "vscode";
import type { Disposer } from "@workshop/core";
import type { LumierePanel, PanelOptions } from "../shared/host";

/**
 * One webview panel per view type, or per `options.key`, independent of any
 * Markdown document.
 */
export function createLumierePanel(
  extensionUri: vscode.Uri,
): (viewType: string, title: string, options?: PanelOptions) => LumierePanel {
  const open = new Map<string, vscode.WebviewPanel>();
  return (viewType, title, options = {}) => {
    const id = `${viewType}\0${options.key ?? ""}`;
    const column = options.column ?? vscode.ViewColumn.Active;
    const existing = open.get(id);
    if (existing) {
      existing.reveal(column);
      return wrap(existing, extensionUri);
    }
    const panel = vscode.window.createWebviewPanel(viewType, title, column, {
      enableScripts: true,
      // No `command:` link in a panel's page runs a command.
      enableCommandUris: false,
      retainContextWhenHidden: options.retainContext === true,
      localResourceRoots: resourceRoots(extensionUri, options),
    });
    open.set(id, panel);
    panel.onDidDispose(() => open.delete(id));
    return wrap(panel, extensionUri);
  };
}

/** What the page may load: the roots asked for, else the extension's own files. */
function resourceRoots(
  extensionUri: vscode.Uri,
  options: PanelOptions,
): vscode.Uri[] {
  return options.resourceRoots
    ? options.resourceRoots.map((root) => vscode.Uri.parse(root))
    : [vscode.Uri.joinPath(extensionUri, "dist", "markdown")];
}

function wrap(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
): LumierePanel {
  const dist = vscode.Uri.joinPath(extensionUri, "dist", "markdown");
  return {
    reveal: () => panel.reveal(vscode.ViewColumn.Active),
    setTitle: (title) => {
      panel.title = title;
    },
    get visible() {
      return panel.visible;
    },
    onDidChangeVisibility: (listener) =>
      listen(
        panel.onDidChangeViewState((event) =>
          listener(event.webviewPanel.visible),
        ),
      ),
    onDispose: (listener) => listen(panel.onDidDispose(listener)),
    dispose: () => panel.dispose(),
    webview: {
      cspSource: panel.webview.cspSource,
      asset: (relative) =>
        panel.webview
          .asWebviewUri(vscode.Uri.joinPath(dist, relative))
          .toString(),
      resource: (uri) =>
        panel.webview.asWebviewUri(vscode.Uri.parse(uri)).toString(),
      setHTML: (html) => {
        panel.webview.html = html;
      },
      post: (message) => {
        void panel.webview.postMessage(message);
      },
      onMessage: (listener) =>
        listen(panel.webview.onDidReceiveMessage(listener)),
    },
  };
}

function listen(subscription: vscode.Disposable): Disposer {
  return () => subscription.dispose();
}
