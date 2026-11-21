import { ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { documentTree } from "./document-tree";
import { renderRevision } from "./blocks";
import { editorFocus } from "./editor-focus";
import { inlineRenderers } from "./registry";
import { inlineDecorations } from "./inline";
import {
  isPointerSelecting,
  revealFreezeToggled,
} from "../../webview/ui/pointer-selection";
import { unresolvedLinks } from "../links/api";
import {
  offscreenReuse,
  outdatesOffscreenDrawing,
  type OffscreenDrawing,
  type OffscreenReuse,
} from "./offscreen-reuse";

/**
 * When Live Preview's inline decorations are built again: after an edit, a
 * caret move, a scroll, a focus change or a new tree, renderer or render
 * revision. The persistent widgets off screen keep what they drew while only
 * the caret moves, apart from those near it.
 *
 * Focus is read from the state field too (a `$$` formula reveals only while
 * focused): `initialFocus` reports a focused editor in a transaction of its
 * own, for which CodeMirror sets no `focusChanged`.
 */
function shouldRebuildInline(update: ViewUpdate): boolean {
  if (
    update.docChanged ||
    update.viewportChanged ||
    update.selectionSet ||
    update.focusChanged
  ) {
    return true;
  }
  const { startState, state } = update;
  if (startState === state) {
    return false;
  }
  return (
    startState.field(documentTree) !== state.field(documentTree) ||
    startState.facet(inlineRenderers) !== state.facet(inlineRenderers) ||
    startState.field(unresolvedLinks, false) !==
      state.field(unresolvedLinks, false) ||
    startState.field(renderRevision, false) !==
      state.field(renderRevision, false) ||
    startState.field(editorFocus, false) !== state.field(editorFocus, false) ||
    revealFreezeToggled(startState, state)
  );
}

export class HybridInline {
  decorations: DecorationSet;
  private wasComposing = false;
  private offscreen: { reuse?: OffscreenReuse; drawing?: OffscreenDrawing } =
    {};
  constructor(view: EditorView) {
    this.decorations = inlineDecorations(
      view.state,
      view.visibleRanges,
      this.offscreen,
    );
  }
  update(update: ViewUpdate): void {
    if (outdatesOffscreenDrawing(update.transactions)) {
      this.offscreen = {};
    }
    // Selection-only pointer updates keep the DOM stable. Scrollbar presses
    // also freeze reveal, but new viewport content still needs decorations;
    // revealRanges keeps those tied to the selection from before the press.
    if (
      update.view.composing ||
      (isPointerSelecting(update.state) && !update.viewportChanged)
    ) {
      this.wasComposing = update.view.composing;
      this.decorations = this.decorations.map(update.changes);
      return;
    }
    const endedComposing = this.wasComposing && !update.view.composing;
    this.wasComposing = false;
    if (!endedComposing && !shouldRebuildInline(update)) {
      return;
    }
    const reuse = offscreenReuse(this.offscreen.drawing, update.state);
    this.offscreen = { ...(reuse && { reuse }) };
    this.decorations = inlineDecorations(
      update.view.state,
      update.view.visibleRanges,
      this.offscreen,
    );
  }
}

export const hybridInline = ViewPlugin.fromClass(HybridInline, {
  decorations: (plugin) => plugin.decorations,
  eventHandlers: {
    compositionend(_event, view) {
      queueMicrotask(() => {
        if (view.dom.isConnected) {
          view.dispatch({});
        }
      });
    },
  },
});
