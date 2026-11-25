import * as vscode from "vscode";
import { t } from "@workshop/l10n";
import { agentText, pageReferenceText } from "../../../shared/agent-text";
import {
  pdfBridgeEnvelope,
  type PdfBridgeEnvelope,
} from "../../../shared/bridge-envelope";
import type { PdfSelection } from "../../../shared/selection";
import type { PdfPanel } from "../pdf/panel";
import { displayPath } from "../pdf/files";
import type { RegionSnapshots } from "../pdfRegions/region-snapshots";
import { isRegionsEnabled } from "../pdfRegions/regions-enabled";
import { hashSelection } from "./envelope";

/** A PDF selection for an agent: see `AgentHandoff.snapshot`. */
export interface AgentSnapshot {
  file: string;
  uri: string;
  sha256: string;
  selectedAt: string;
  selection: PdfSelection;
  agentText: string;
  regionImage?: string;
}

/**
 * The `handoff` service: turns an editor's selection into the text an agent
 * receives (see `shared/agent-text.ts` and packages/agents/docs/agent-handoff-format.md), and
 * hands it over. Copy link writes the locator and quote to the clipboard only; the MCP
 * bridge still uses `snapshot` / `envelope` for structured handoff.
 *
 * Invariant: clipboard text and the structured envelope come from one
 * selection snapshot, taken once; a reload cannot pair a selection with
 * another file's hash on the envelope (see PdfSelectionState).
 */
export class AgentHandoff {
  constructor(private readonly regions: () => RegionSnapshots | undefined) {}

  /**
   * Copy link to this: clipboard only. With a selection, copies its locator
   * and quote (`agentText`); otherwise the reading page's locator.
   * Does not open agent chat. Returns whether something was copied.
   */
  async copyLinkForAgent(panel: PdfPanel): Promise<boolean> {
    const regionsEnabled = isRegionsEnabled();
    const selected = panel.selectionSnapshot();
    let text: string | undefined;
    if (selected) {
      text = agentText(
        selected.selection,
        { path: displayPath(panel.uri) },
        { regionsEnabled },
      );
    } else {
      const page = panel.view?.readingPage ?? panel.view?.page;
      if (page) {
        text = pageReferenceText({ path: displayPath(panel.uri) }, page);
      }
    }
    if (!text) {
      void vscode.window.showWarningMessage(
        t("Open a PDF page to copy a link."),
      );
      return false;
    }
    await vscode.env.clipboard.writeText(text);
    return true;
  }

  /**
   * The current selection as a Workbench v1 envelope, without the clipboard.
   * `capturedAt` is the selection time from the snapshot. No selection
   * returns `undefined`.
   */
  async envelope(panel: PdfPanel): Promise<PdfBridgeEnvelope | undefined> {
    const snapshot = await this.snapshot(panel);
    if (!snapshot) {
      return undefined;
    }
    const kind = panel.uri.scheme === "file" ? "file" : "remote";
    return pdfBridgeEnvelope({
      capturedAt: snapshot.selectedAt,
      identity: snapshot.file,
      // URI-safe reopen base — not displayPath, which may contain `#`.
      durableBase: snapshot.uri,
      kind,
      viewId: panel.viewId,
      selection: snapshot.selection,
      selectionSha256: hashSelection(snapshot.selection),
      sourceSha256: snapshot.sha256,
      isDirty: false,
    });
  }

  /**
   * The selection as an agent should see it, without touching the
   * clipboard: the text Copy Link for Agent produces, plus its parts.
   * With `notify`, the user hears why a region has no image (too large for
   * the snapshot limit, or a failed save).
   */
  async snapshot(
    panel: PdfPanel,
    options: { notify?: boolean } = {},
  ): Promise<AgentSnapshot | undefined> {
    const selected = panel.selectionSnapshot();
    if (!selected) {
      return undefined;
    }
    const image = await this.regions()?.save(panel, selected, options);
    const path = displayPath(panel.uri);
    return {
      file: path,
      uri: panel.uri.toString(),
      sha256: selected.sha256,
      selectedAt: selected.selectedAt,
      selection: selected.selection,
      agentText: agentText(
        selected.selection,
        { path },
        {
          regionsEnabled: isRegionsEnabled(),
        },
      ),
      ...(image ? { regionImage: image.fsPath } : {}),
    };
  }
}
