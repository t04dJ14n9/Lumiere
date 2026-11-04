import * as vscode from "vscode";
import {
  Bypass,
  isReclaimableNote,
  shouldHoldNativeAfterReclaim,
  shouldReclaim,
  TabSwaps,
} from "./reclaim-policy";
import type { TabSwap } from "./reclaim-policy";
import { reclaimContext } from "./reclaim-context";
import { textBypass, handoffLease, hasNativeOptOut } from "./reclaim-opt-out";
import {
  createReclaimTransfer,
  hasSelectionTarget,
  nativeSelectionRange,
} from "./reclaim-transfer";
import { MARKDOWN_WORKSPACE_EDITOR_KEY } from "../shared/editor-provider";
import { readerText } from "./reader-text";
import type { NativeNavigation } from "./navigation";
import {
  createReclaimScheduler,
  registerSelectionReclaim,
} from "./reclaim-selection";
import { healWorkspaceEditorAssociation } from "./workspace-editor-heal";
import { kindOf, labelUri, tabModel, uriOf } from "./reclaim-tabs";
import { registerMissingOpenBridgeSave } from "./missing-open-bridge";

export { textBypass, handoffLease } from "./reclaim-opt-out";

/** Returns the note whose Cursor Edit session this tab change ended. */
function releaseLeaseWithoutTextTab(tab: vscode.Tab): string | undefined {
  const uri = uriOf(tab) ?? labelUri(tab);
  if (!uri || !handoffLease.has(uri)) {
    return undefined;
  }
  // Same-URI custom tabs can close or become inactive during Cursor Edit.
  // Established sessions end only when no native text tab remains in any group.
  // Pending handoffs keep their own tokens while warming/opening the next tab.
  const hasNativeTextTab = vscode.window.tabGroups.all.some((group) =>
    group.tabs.some(
      (candidate) =>
        candidate.input instanceof vscode.TabInputText &&
        candidate.input.uri.toString() === uri,
    ),
  );
  if (!hasNativeTextTab) {
    handoffLease.clear(uri);
  }
  return handoffLease.has(uri) ? undefined : uri;
}

/**
 * Reclaim native text / Cursor Markdown tabs into Lumia when enabled.
 * Opt-in `reclaimInPlaceTextEditor` also reclaims in-place workbench→text /
 * other→text (Claude); off by default. Open as Text / Toggle / handoff stay.
 */
export function registerReclaim(
  navigation?: NativeNavigation,
  memory?: vscode.Memento,
): vscode.Disposable & { adoptOpenTabs(): void } {
  const recentTransfers = new Bypass();
  const transfer = createReclaimTransfer(navigation, recentTransfers);
  const swaps = new TabSwaps(tabModel);
  readerText.restore(memory);
  const workspaceEditorHealed = healWorkspaceEditorAssociation(memory);
  const workspaceDefault = () =>
    workspaceEditorHealed ||
    (memory?.get(MARKDOWN_WORKSPACE_EDITOR_KEY, false) ?? false);
  const scheduler = createReclaimScheduler({
    open: transfer.open,
    readSelection: nativeSelectionRange,
    waitForTextSelection: workspaceDefault,
  });
  const judge = createReclaimJudge({
    recentTransfers,
    swaps,
    workspaceDefault,
    schedule: (tab, swap) =>
      scheduler.schedule(tab, swap.uri, swap.after === "text"),
  });
  const tabs = vscode.window.tabGroups.onDidChangeTabs((event) => {
    const ended = [...event.closed, ...event.opened, ...event.changed]
      .map(releaseLeaseWithoutTextTab)
      .filter((uri): uri is string => uri !== undefined);
    readerText.forgetClosed(event.closed);
    swaps.next(event, new Set(ended)).forEach(judge);
  });
  const stop = vscode.Disposable.from(
    tabs,
    registerMissingOpenBridgeSave(),
    registerSelectionReclaim({
      capture: transfer.capture,
      ready: scheduler.ready,
      shouldTransfer: (tab, uri) =>
        hasSelectionTarget(nativeSelectionRange(tab, uri)) &&
        shouldReclaim(
          { uri, before: "none", after: kindOf(tab) },
          reclaimContext(uri, workspaceDefault(), kindOf(tab)),
        ),
      transfer: transfer.open,
    }),
    scheduler,
    transfer,
  );
  return {
    dispose: () => stop.dispose(),
    /**
     * Judge the tabs already open, once, when the extension starts: notes the
     * window restored, or that were opened before it started, as text.
     */
    adoptOpenTabs() {
      // Kept notes whose text tab the last window closed are not kept now.
      readerText.forgetClosed();
      swaps
        .adopt(vscode.window.tabGroups.all.flatMap((group) => group.tabs))
        .forEach(judge);
    },
  };
}

function createReclaimJudge(options: {
  recentTransfers: Bypass;
  swaps: TabSwaps<vscode.Tab>;
  workspaceDefault: () => boolean;
  schedule: (tab: vscode.Tab, swap: TabSwap) => void;
}) {
  return ({ tab, swap }: { tab: vscode.Tab; swap: TabSwap }) => {
    if (handoffLease.has(swap.uri)) {
      options.swaps.hold(tab, swap);
      return;
    }
    const context = reclaimContext(
      swap.uri,
      options.workspaceDefault(),
      swap.after,
    );
    if (!shouldReclaim(swap, context)) {
      // Off: keep text skips. On: no keep for unbidden workbench→text, and no
      // keep for none→text that failed only as unassociated (missing
      // workspaceEditor with associations already `"default"`).
      const unbiddenInPlace =
        context.reclaimInPlace && swap.before === "workbench";
      const unassociatedNewText =
        context.enabled &&
        swap.before === "none" &&
        !context.associated(swap.uri);
      const keep =
        swap.after === "text" &&
        isReclaimableNote(swap.uri) &&
        (hasNativeOptOut(swap.uri) ||
          (!unbiddenInPlace && !unassociatedNewText));
      if (keep) {
        readerText.keep(swap.uri);
      }
      return;
    }
    const hasTarget = hasSelectionTarget(nativeSelectionRange(tab, swap.uri));
    if (
      shouldHoldNativeAfterReclaim({
        recentTransfer: options.recentTransfers.has(swap.uri),
        reclaimable: true,
        hasSelectionTarget: hasTarget,
      })
    ) {
      textBypass.allow(swap.uri);
      if (swap.after === "text") {
        readerText.keep(swap.uri);
      }
      return;
    }
    options.schedule(tab, swap);
  };
}
