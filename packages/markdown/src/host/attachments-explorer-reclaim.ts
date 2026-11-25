/**
 * VS Code-only: offer to add a media file opened over a note as an
 * attachment, for Explorer drops without Shift.
 *
 * Workbench disables pointer events on custom-editor webviews during Explorer
 * drags unless Shift is held, so the drop opens a pinned tab instead of
 * reaching the page. That open cannot be told apart from any other pinned
 * open in the note's group (`code image.png` in a terminal, Quick Open, a
 * double-click), so the tab stays open and the reader is asked; only
 * "Add to Note" closes it and inserts the embed. Portable hosts omit this
 * hook (no `tabGroups`).
 */
import * as vscode from "vscode";
import type { Disposer } from "@workshop/core";
import { shouldReclaimExplorerOpen } from "../attachments";
import { MARKDOWN_EDITOR } from "../shared/editor-provider";
import type { ExplorerAttachmentReclaimHandlers } from "../shared/host";
import { t } from "@workshop/l10n";

/**
 * Watch tab opens and convert matching pinned media tabs into attachments on
 * the prior Lumiere note in that column.
 */
export function registerAttachmentsExplorerReclaim(
  handlers: ExplorerAttachmentReclaimHandlers,
): Disposer {
  /** viewColumn → Lumiere note URI last known active in that column. */
  const priorLumiere = new Map<number, string>();
  const syncPrior = () => {
    const groups = vscode.window?.tabGroups?.all;
    if (!groups) {
      return;
    }
    for (const group of groups) {
      const column = group.viewColumn;
      if (column === undefined) {
        continue;
      }
      const active = group.activeTab;
      if (active && isLumiereTab(active)) {
        const uri = tabUri(active)?.toString();
        if (uri) {
          priorLumiere.set(column, uri);
          continue;
        }
      }
      // Clear when another editor is active so a later media open is not
      // mistaken for a drop onto this note.
      priorLumiere.delete(column);
    }
  };
  syncPrior();
  const sub = vscode.window.tabGroups.onDidChangeTabs((event) => {
    // Decide with the priors from before these opens, which have already
    // taken the active tab; the question does not hold up the next opens.
    for (const tab of event.opened) {
      const offer = reclaimOffer(tab, priorLumiere);
      if (offer) {
        void offerAttachment(handlers, tab, offer);
      }
    }
    syncPrior();
  });
  return () => sub.dispose();
}

interface ReclaimOffer {
  resource: vscode.Uri;
  column: number;
  lumiereUri: string;
}

function reclaimOffer(
  tab: vscode.Tab,
  priorLumiere: ReadonlyMap<number, string>,
): ReclaimOffer | undefined {
  const resource = tabUri(tab);
  const column = tab.group.viewColumn;
  if (!resource || column === undefined) {
    return undefined;
  }
  const priorNote = priorLumiere.get(column);
  const lumiereTab = tab.group.tabs.find(isLumiereTab);
  const lumiereUri = lumiereTab ? tabUri(lumiereTab)?.toString() : undefined;
  if (
    !lumiereUri ||
    !shouldReclaimExplorerOpen({
      openedPath: resource.fsPath || resource.path,
      isPreview: tab.isPreview,
      groupHadLumiereNote: true,
      priorActiveWasLumiere: priorNote === lumiereUri,
    })
  ) {
    return undefined;
  }
  return { resource, column, lumiereUri };
}

/** The English text of the button, the key of its translation (`t` below). */
export const ADD_TO_NOTE = "Add to Note";

/** Ask; on "Add to Note", close the media tab and insert the embed. */
async function offerAttachment(
  handlers: ExplorerAttachmentReclaimHandlers,
  tab: vscode.Tab,
  offer: ReclaimOffer,
): Promise<void> {
  const add = t("Add to Note");
  const choice = await vscode.window.showInformationMessage(
    t(
      "Add {0} to {1} as an attachment?",
      baseName(offer.resource),
      baseName(vscode.Uri.parse(offer.lumiereUri)),
    ),
    add,
  );
  if (choice !== add) {
    return;
  }
  // Close the workbench's open-on-drop tab; the plugin reveals the note.
  try {
    await vscode.window.tabGroups.close(tab, true);
  } catch {
    // Tab may already be gone.
  }
  await handlers.reclaim({
    resourceUri: offer.resource.toString(),
    column: offer.column,
    lumiereUri: offer.lumiereUri,
  });
}

function baseName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() || uri.path;
}

function isLumiereTab(tab: vscode.Tab): boolean {
  const input = tab.input;
  return (
    typeof vscode.TabInputCustom === "function" &&
    input instanceof vscode.TabInputCustom &&
    input.viewType === MARKDOWN_EDITOR.viewType
  );
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input as { uri?: vscode.Uri } | undefined;
  return input?.uri;
}
