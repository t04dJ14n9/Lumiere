import type { Transaction } from "@codemirror/state";
import {
  revealFreezeToggled,
  revealRanges,
} from "../../webview/ui/pointer-selection";
import { blockRenderers } from "./registry";
import { changedRegion } from "./changed-region";
import { editorFocusToggled, setEditorFocus } from "./editor-focus";

export { changedRegion, type Region } from "./changed-region";

/**
 * Which lines of the new document a transaction may have re-rendered, and
 * why. `text`: the source changed there, so its blocks are indexed again.
 * `selection`: the caret entered or left there, so blocks may reveal or
 * hide their source. `metadata`: something outside the text changed (a
 * renderer, an effect such as a resource refresh), so every line counts.
 */
export interface RenderInvalidation {
  fromLine: number;
  toLine: number;
  reason: "text" | "metadata" | "selection";
}

/**
 * Whether a transaction changes anything besides the text, the selection
 * and the editor's focus (which, like the selection, matters only where the
 * selection is).
 */
export function changesMetadata(tr: Transaction): boolean {
  return (
    tr.effects.some((effect) => !effect.is(setEditorFocus)) ||
    tr.reconfigured ||
    tr.startState.facet(blockRenderers) !== tr.state.facet(blockRenderers)
  );
}

/** The invalidations of one transaction, in new-document lines. */
export function renderInvalidations(tr: Transaction): RenderInvalidation[] {
  const doc = tr.state.doc;
  if (changesMetadata(tr)) {
    return [{ fromLine: 1, toLine: doc.lines, reason: "metadata" }];
  }
  const result: RenderInvalidation[] = [];
  const region = changedRegion(tr);
  if (region) {
    result.push({
      fromLine: doc.lineAt(region.from).number,
      toLine: doc.lineAt(region.to).number,
      reason: "text",
    });
  }
  if (
    tr.selection ||
    tr.docChanged ||
    editorFocusToggled(tr) ||
    revealFreezeToggled(tr.startState, tr.state)
  ) {
    const before = revealRanges(tr.startState).map((range) =>
      range.map(tr.changes),
    );
    for (const range of [...before, ...revealRanges(tr.state)]) {
      result.push({
        fromLine: doc.lineAt(range.from).number,
        toLine: doc.lineAt(range.to).number,
        reason: "selection",
      });
    }
  }
  return result;
}
