import * as vscode from "vscode";
import { shouldWarmBeforeReclaim } from "./reclaim-policy";
import type { Bypass, TabKind } from "./reclaim-policy";
import { MARKDOWN_EDITOR } from "../shared/editor-provider";
import { warmMarkdownDocument } from "./document-warm";
import type { NativeNavigation } from "./navigation";
import type { NavigationIntent } from "../shared/host";
import { openRange, withNativeSelectionOpen } from "./native-selection-open";
import { nativeSelectionRange as readNativeSelectionRange } from "./reclaim-selection";
import {
  kindOf,
  labelUri,
  reclaimKey,
  resolveLiveNativeTab,
  showsNatively,
  uriOf,
} from "./reclaim-tabs";
import { hasNativeOptOut } from "./reclaim-opt-out";
import {
  isFileNotFoundError,
  isMissingMarkdownFileUri,
  missingOpenBridge,
  openBridgeForMissingMarkdown,
  type MissingOpenBridgeHost,
} from "./missing-open-bridge";

const { viewType } = MARKDOWN_EDITOR;

interface ReclaimRequest {
  uri: string;
  /** Where the note was native: how the tab is found again (see currentTab). */
  column: vscode.ViewColumn;
  kind: TabKind;
  intent: NavigationIntent | undefined;
  at: number | undefined;
  to: number | undefined;
  /** Pin this native viewport top line in Live Preview (skip centering). */
  topLine: number | undefined;
  /** Once reveal delivery has started, later same-tab jumps must supersede. */
  delivering?: boolean;
  /**
   * Sticky: an Open as Text / Edit lease was observed while this transfer was
   * still pending. textBypass TTL (10s) can expire before reveal readiness
   * (up to 15s), so the decision must outlive `has()` alone.
   */
  keepNative?: boolean;
}

export function createReclaimTransfer(
  navigation: NativeNavigation | undefined,
  recentTransfers: Bypass,
) {
  // Key by uri+column: Tab identity drifts when VS Code rebuilds the model.
  const pending = new Map<string, ReclaimRequest>();
  const capture = (tab: vscode.Tab, uri: string) => {
    const request = pending.get(reclaimKey(uri, tab.group.viewColumn));
    if (request?.uri === uri && !request.intent?.token.cancelled) {
      refreshRequestSelection(tab, uri, request);
    }
  };
  return {
    capture,
    open(tab: vscode.Tab, uri: string) {
      const shown = resolveLiveNativeTab(tab, uri);
      if (!shown) {
        return;
      }
      startPendingReclaim({
        pending,
        recentTransfers,
        navigation,
        capture,
        shown,
        uri,
      });
    },
    dispose() {
      for (const request of pending.values()) {
        request.intent?.token.cancel();
      }
    },
  };
}

function startPendingReclaim(options: {
  pending: Map<string, ReclaimRequest>;
  recentTransfers: Bypass;
  navigation: NativeNavigation | undefined;
  capture: (tab: vscode.Tab, uri: string) => void;
  shown: vscode.Tab;
  uri: string;
}): void {
  const { pending, recentTransfers, navigation, capture, shown, uri } = options;
  const key = reclaimKey(uri, shown.group.viewColumn);
  const request = pending.get(key);
  if (request?.uri === uri && !request.intent?.token.cancelled) {
    // Before delivery: refresh the selection only. After revealOpened has
    // started, a later hunk must cancel and supersede that delivery.
    if (!request.delivering) {
      capture(shown, uri);
      return;
    }
    request.intent?.token.cancel();
  }
  recentTransfers.allow(uri);
  const selection = nativeSelectionRange(shown, uri);
  const next: ReclaimRequest = {
    uri,
    column: shown.group.viewColumn,
    kind: kindOf(shown),
    intent: navigation?.begin(),
    at: selection?.at,
    to: selection?.to,
    topLine: selection?.topLine,
  };
  pending.set(key, next);
  void reopen(uri, next, navigation)
    .catch(async (error) => {
      if (
        isMissingMarkdownFileUri(uri) &&
        isFileNotFoundError(error) &&
        !next.keepNative &&
        !hasNativeOptOut(uri, next.kind) &&
        !next.intent?.token.cancelled
      ) {
        try {
          await openMissingMarkdownBridge(uri, next);
          return;
        } catch (bridgeError) {
          console.error("Lumia missing-open bridge failed", bridgeError);
          return;
        }
      }
      console.error("Lumia editor transfer failed", error);
    })
    .finally(() => {
      if (pending.get(key) === next) {
        pending.delete(key);
      }
    });
}

export function nativeSelectionRange(
  tab: vscode.Tab,
  uri: string,
): { at: number; to?: number; topLine?: number } | undefined {
  return readNativeSelectionRange(
    tab,
    uri,
    (candidate) => uriOf(candidate) ?? labelUri(candidate),
  );
}

export function hasSelectionTarget(s?: {
  at: number;
  to?: number;
  topLine?: number;
}): boolean {
  return s !== undefined && (s.at > 0 || (s.to !== undefined && s.to > s.at));
}

function refreshRequestSelection(
  tab: vscode.Tab,
  uri: string,
  request: ReclaimRequest,
): void {
  const selection = nativeSelectionRange(tab, uri);
  if (selection) {
    request.at = selection.at;
    request.to = selection.to;
    request.topLine = selection.topLine;
  }
}

/** Transfer when ready, keeping any dirty text tab and its native undo. */
async function reopen(
  uri: string,
  request: ReclaimRequest,
  navigation?: NativeNavigation,
): Promise<void> {
  const target = vscode.Uri.parse(uri);
  if (
    isMissingMarkdownFileUri(uri) &&
    !(await markdownFileExists(target)) &&
    !request.keepNative &&
    !hasNativeOptOut(uri, request.kind) &&
    !request.intent?.token.cancelled
  ) {
    await openMissingMarkdownBridge(uri, request);
    return;
  }
  // showTextDocument has already materialized a text tab's document. Avoid
  // another warm call and its awaits; Cursor Markdown still needs the reissue.
  const isDocumentOpen = vscode.workspace.textDocuments.some(
    (document) => document.uri.toString() === uri,
  );
  if (shouldWarmBeforeReclaim(request.kind, isDocumentOpen)) {
    await warmMarkdownDocument(target);
  }
  const native = reopenableTab(request);
  if (!native) {
    return;
  }
  const { column } = request;
  refreshRequestSelection(native, uri, request);
  const open = () =>
    vscode.commands.executeCommand("vscode.openWith", target, viewType, {
      viewColumn: column,
      preview: native.isPreview,
    });
  await withNativeSelectionOpen(uri, column, () => openRange(request), open);
  // A topLine pin is applied by placeOpeningSelection (y:"start"). Centering
  // via revealOpened would move that line off the top of the viewport.
  if (
    navigation &&
    request.intent &&
    request.at !== undefined &&
    request.topLine === undefined
  ) {
    request.delivering = true;
    refreshRequestSelection(native, uri, request);
    await revealOpenedWatchingOptOut(uri, request, () =>
      navigation.revealOpened(
        uri,
        column,
        {
          at: request.at!,
          ...(request.to !== undefined ? { to: request.to } : {}),
        },
        request.intent!,
      ),
    );
  }
  // Opt-outs or a superseding jump may land during the reveal wait. Do not
  // close a native tab the user just chose (Open as Text / Edit lease) or a
  // transfer that navigation cancelled. keepNative is sticky across bypass TTL.
  if (
    request.keepNative ||
    hasNativeOptOut(uri, request.kind) ||
    request.intent?.token.cancelled
  ) {
    return;
  }
  // openWith opens a second tab beside the native one; left open, a Cursor
  // Markdown tab would sit next to the note's Workshop tab.
  const left = currentTab(request);
  if (left && !left.isDirty) {
    await vscode.window.tabGroups.close(left, true);
  }
}

/**
 * Reveal readiness can wait longer than textBypass TTL. Watch for an opt-out
 * during the wait, sticky-mark keepNative, and cancel so delivery stops.
 */
async function revealOpenedWatchingOptOut(
  uri: string,
  request: ReclaimRequest,
  deliver: () => Promise<void>,
): Promise<void> {
  const noteOptOut = () => {
    if (hasNativeOptOut(uri, request.kind)) {
      request.keepNative = true;
      request.intent?.token.cancel();
      return true;
    }
    return false;
  };
  if (noteOptOut()) {
    return;
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    timer = setInterval(() => {
      noteOptOut();
    }, 25);
    await deliver();
  } finally {
    if (timer !== undefined) {
      clearInterval(timer);
    }
    noteOptOut();
  }
}

/** Warming can outlive a handoff, a newer jump, or the reader leaving this tab. */
function reopenableTab(request: ReclaimRequest): vscode.Tab | undefined {
  if (
    hasNativeOptOut(request.uri, request.kind) ||
    request.intent?.token.cancelled
  ) {
    return undefined;
  }
  const native = currentTab(request);
  return native && vscode.window.tabGroups.activeTabGroup.activeTab === native
    ? native
    : undefined;
}


async function markdownFileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function openMissingMarkdownBridge(
  uri: string,
  request: ReclaimRequest,
): Promise<void> {
  const native = currentTab(request);
  await openBridgeForMissingMarkdown({
    intendedFileUri: uri,
    viewType,
    viewColumn: request.column,
    preview: native?.isPreview ?? true,
    bridge: missingOpenBridge,
    host: vscodeMissingOpenHost(),
  });
  const left = currentTab(request);
  if (
    left &&
    !left.isDirty &&
    !request.keepNative &&
    !hasNativeOptOut(uri, request.kind) &&
    !request.intent?.token.cancelled
  ) {
    await vscode.window.tabGroups.close(left, true);
  }
}

function vscodeMissingOpenHost(): MissingOpenBridgeHost {
  return {
    async openTextDocument(uri) {
      await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    },
    async openWith(uri, type, options) {
      await vscode.commands.executeCommand(
        "vscode.openWith",
        vscode.Uri.parse(uri),
        type,
        options,
      );
    },
  };
}

/**
 * The transfer's native tab as the tab model shows it now. VS Code rebuilds
 * that model with new Tab objects, and no tab event, after some editor
 * changes (Cursor does right after openWith), so the tab is found again by
 * what it shows: a group holds at most one tab per editor and note.
 */
function currentTab(request: ReclaimRequest): vscode.Tab | undefined {
  const group = vscode.window.tabGroups.all.find(
    (candidate) => candidate.viewColumn === request.column,
  );
  return group?.tabs.find(
    (candidate) =>
      kindOf(candidate) === request.kind &&
      showsNatively(candidate, request.uri),
  );
}
