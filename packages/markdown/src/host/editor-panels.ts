import * as vscode from "vscode";
import type { EditorProvider } from "../shared/editor-provider";
import type { PanelShell } from "../shared/host";
import { SourceCoordinates } from "../shared/document/coordinates";
import { panelIsActive } from "./active-panel";
import { firstViewPreload } from "./feature-chunks";
import { isMarkdownAbsentOnDisk } from "./markdown-absent-on-disk";
import {
  bindShellState,
  bindingForPanel,
  createCustomEditorNavigation,
  enableCustomTextEditorProposals,
} from "./custom-editor-navigation";
import type { NativeNavigation } from "./navigation";
import {
  hasTopLineOpen,
  isNativeSelectionOpen,
  nativeOpeningSelection,
} from "./native-selection-open";
import type { NativeDocuments } from "./services/native-documents";

/**
 * The VS Code side of an editor panel: registration, the webview, its
 * transport and its active state, for any `EditorProvider`. Invariant:
 * nothing here depends on the document's language; what the panel shows is
 * the editor plugin's business.
 */
interface EditorHost {
  extension?: unknown;
  extensionUri: vscode.Uri;
  documents: NativeDocuments;
  navigation?: NativeNavigation;
}

function currentNativeSelection(
  document: vscode.TextDocument,
): { at: number; to: number } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== document.uri.toString()) {
    return undefined;
  }
  const coordinates = new SourceCoordinates(document.getText());
  const at = coordinates.toEditor(document.offsetAt(editor.selection.start));
  const to = coordinates.toEditor(document.offsetAt(editor.selection.end));
  return to > at ? { at, to } : undefined;
}

function openingSelectionFor(
  uri: string,
  column: number,
  live: { at: number; to: number } | undefined,
): { anchor: number; head: number; topLine?: number } | undefined {
  return (
    nativeOpeningSelection(uri, column) ??
    (live ? { anchor: live.at, head: live.to } : undefined)
  );
}

function revealNativeSelection(
  navigation: NativeNavigation | undefined,
  panel: PanelShell,
  selection: { at: number; to: number } | undefined,
  // topLine: 0 is a real pin — only undefined means "no pin".
  skipForTopLinePin = false,
): void {
  if (skipForTopLinePin || !navigation?.revealPanel || !selection) {
    return;
  }
  const intent = navigation.begin();
  void navigation.revealPanel(panel.id, selection, intent).catch((error) => {
    console.error("Lumia editor selection reveal failed", error);
  });
}

function panelTransport(
  panel: vscode.WebviewPanel,
  shellDisposeListeners: Set<() => void>,
): PanelShell["transport"] {
  let disposed = false;
  const stops = new Set<vscode.Disposable>();
  // When a panel moves to a new document, the WebviewPanel stays alive while
  // the old shell's endpoint is still tearing down; disconnect it immediately.
  shellDisposeListeners.add(() => {
    disposed = true;
    for (const stop of stops) {
      stop.dispose();
    }
    stops.clear();
  });
  return {
    send(message) {
      if (!disposed) {
        void panel.webview.postMessage(message);
      }
    },
    listen(receive) {
      if (disposed) {
        return () => {};
      }
      const stop = panel.webview.onDidReceiveMessage(receive);
      stops.add(stop);
      return () => {
        stops.delete(stop);
        stop.dispose();
      };
    },
  };
}
function isActivePanel(
  viewType: string,
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
): boolean {
  const group = vscode.window.tabGroups.activeTabGroup;
  const input = group.activeTab?.input;
  const custom = input instanceof vscode.TabInputCustom ? input : undefined;
  return panelIsActive(
    panel,
    {
      groupColumn: group.viewColumn,
      viewType: custom?.viewType,
      uri: custom?.uri.toString(),
    },
    { viewType, uri: document.uri.toString() },
  );
}
function panelState(
  panel: vscode.WebviewPanel,
  listener: () => void,
): ReturnType<PanelShell["onState"]> {
  const panelSubscription = panel.onDidChangeViewState(listener);
  const groupSubscription =
    vscode.window.tabGroups.onDidChangeTabGroups(listener);
  // Closing a tab opened over the panel (Ctrl+N, then close) changes tabs,
  // not groups; without this the plugin context keys stayed false.
  const tabSubscription = vscode.window.tabGroups.onDidChangeTabs(listener);
  return () => {
    panelSubscription.dispose();
    groupSubscription.dispose();
    tabSubscription.dispose();
  };
}

function panelResourceRoots(
  document: vscode.TextDocument,
  extensionUri: vscode.Uri,
): vscode.Uri[] {
  const root =
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri ??
    vscode.Uri.joinPath(document.uri, "..");
  return [vscode.Uri.joinPath(extensionUri, "dist", "markdown"), root];
}

function panelOpenFields(options: {
  openedFromNativeSelection?: boolean;
  openingSelection?: { anchor: number; head: number; topLine?: number };
}): Pick<PanelShell, "openedFromNativeSelection" | "openingSelection"> {
  return {
    ...(options.openedFromNativeSelection
      ? { openedFromNativeSelection: true }
      : {}),
    ...(options.openingSelection
      ? { openingSelection: options.openingSelection }
      : {}),
  };
}

function createPanelShell(
  provider: EditorProvider,
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  options: {
    host: EditorHost;
    openedFromNativeSelection?: boolean;
    openingSelection?: { anchor: number; head: number; topLine?: number };
  },
): PanelShell {
  const { extensionUri, documents } = options.host;
  const binding = bindingForPanel(panel, document);
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: panelResourceRoots(document, extensionUri),
  };

  return {
    id: binding.id,
    get column() {
      return panel.viewColumn;
    },
    document: documents.wrap(document),
    cspSource: panel.webview.cspSource,
    trusted: vscode.workspace.isTrusted,
    ...panelOpenFields(options),
    transport: panelTransport(panel, binding.shellDisposeListeners),
    preload: firstViewPreload(extensionUri),
    active: () => isActivePanel(provider.viewType, binding.document, panel),
    reveal() {
      panel.reveal();
    },
    dispose() {
      panel.dispose();
    },
    setHTML(html) {
      panel.webview.html = html;
    },
    resource(uri) {
      return panel.webview.asWebviewUri(vscode.Uri.parse(uri)).toString();
    },
    asset(relative) {
      return panel.webview
        .asWebviewUri(
          vscode.Uri.joinPath(extensionUri, "dist", "markdown", relative),
        )
        .toString();
    },
    onDispose(listener) {
      binding.shellDisposeListeners.add(listener);
      return () => {
        binding.shellDisposeListeners.delete(listener);
      };
    },
    onState: (listener) => panelState(panel, listener),
    ...bindShellState(binding),
  };
}
async function movePanelToDocument(
  provider: EditorProvider,
  newDocument: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  options: {
    host: EditorHost;
    open: (panel: PanelShell) => void;
    token?: vscode.CancellationToken;
  },
): Promise<void> {
  const { host, open, token } = options;
  if (token?.isCancellationRequested) {
    return;
  }
  const binding = bindingForPanel(panel);
  let snapshot: unknown;
  try {
    snapshot = await binding.viewState?.capture();
  } catch {
    snapshot = undefined;
  }
  if (token?.isCancellationRequested) {
    return;
  }
  for (const listener of [...binding.shellDisposeListeners]) {
    listener();
  }
  binding.shellDisposeListeners.clear();
  binding.viewState = undefined;
  binding.document = newDocument;
  binding.pendingRestore = snapshot;
  open(createPanelShell(provider, newDocument, panel, { host }));
}
function resolveEditorPanel(
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
  ctx: {
    provider: EditorProvider;
    host: EditorHost;
    open: (panel: PanelShell) => void;
  },
): void {
  const uri = document.uri.toString();
  const selection = currentNativeSelection(document);
  const column = panel.viewColumn ?? vscode.ViewColumn.One;
  const openingSelection = openingSelectionFor(uri, column, selection);
  const shell = createPanelShell(ctx.provider, document, panel, {
    host: ctx.host,
    openedFromNativeSelection:
      selection !== undefined || isNativeSelectionOpen(uri, column),
    ...(openingSelection ? { openingSelection } : {}),
  });
  ctx.open(shell);
  // topLine pin is applied on first paint; a center reveal would move it.
  revealNativeSelection(
    ctx.host.navigation,
    shell,
    selection,
    openingSelection?.topLine !== undefined || hasTopLineOpen(uri, column),
  );
}

/**
 * A missing note (`code test.md`) opens in the built-in text editor, whose
 * buffer the user saves to create it (product lock 2026-11-04). With Lumia
 * associated directly VS Code asks Lumia first, so hand the tab back.
 */
function openMissingNoteAsText(
  document: vscode.TextDocument,
  panel: vscode.WebviewPanel,
): void {
  void vscode.commands
    .executeCommand(
      "vscode.openWith",
      document.uri,
      "default",
      panel.viewColumn ?? vscode.ViewColumn.Active,
    )
    .then(
      () => panel.dispose(),
      (error: unknown) => {
        console.error("Lumia could not open a missing note as text", error);
        panel.dispose();
      },
    );
}

/** Register `provider` as a custom editor; each panel it opens goes to `open`. */
export function registerEditor(
  provider: EditorProvider,
  host: EditorHost,
  open: (panel: PanelShell) => void,
) {
  enableCustomTextEditorProposals(host.extension);
  const ctx = { provider, host, open };
  const registration = vscode.window.registerCustomEditorProvider(
    provider.viewType,
    {
      resolveCustomTextEditor(document, panel) {
        if (isMarkdownAbsentOnDisk(document.uri.toString())) {
          openMissingNoteAsText(document, panel);
          return;
        }
        resolveEditorPanel(document, panel, ctx);
      },
      resolveCustomTextEditorNavigation(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
      ) {
        return createCustomEditorNavigation(document, panel, host.navigation);
      },
      async moveCustomTextEditor(
        newDocument: vscode.TextDocument,
        panel: vscode.WebviewPanel,
        token?: vscode.CancellationToken,
      ) {
        await movePanelToDocument(provider, newDocument, panel, {
          host,
          open,
          ...(token ? { token } : {}),
        });
      },
    } as vscode.CustomTextEditorProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: provider.retainContextWhenHidden,
      },
      supportsMultipleEditorsPerDocument: provider.multipleEditorsPerDocument,
    },
  );
  return () => registration.dispose();
}
