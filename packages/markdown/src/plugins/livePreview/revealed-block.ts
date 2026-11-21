import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type WidgetType } from "@codemirror/view";
import type { BlockRenderer, RenderBlock } from "./api";
import { hasEditorFocus } from "./editor-focus";
import { findMatchTouches } from "./find-match";
import { revealed } from "./registry";

/**
 * Obsidian's reveal rule, which Lumiere applies to display math: a
 * selection touches `from`–`to` while the editor has focus, or the find
 * bar's current match does (the find field has the focus then).
 */
function revealedWhileFocused(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return (
    (hasEditorFocus(state) && revealed(state, from, to)) ||
    findMatchTouches(state, from, to)
  );
}

/**
 * Whether a `reveal` block shows its source: a selection touches it (only
 * while the editor has focus, for a renderer that asks for that).
 */
export function isSourceRevealed(
  state: EditorState,
  block: RenderBlock & { renderer: BlockRenderer },
): boolean {
  if (block.renderer.editing !== "reveal") {
    return false;
  }
  return block.renderer.revealsOnlyWhileFocused
    ? revealedWhileFocused(state, block.from, block.to)
    : revealed(state, block.from, block.to);
}

/**
 * A revealed block's source lines, marked, with the rendered result just
 * after them: below, as a block, unless the renderer places it inline.
 */
export function editingDecorations(
  state: EditorState,
  block: RenderBlock & { renderer: BlockRenderer },
  widget: () => WidgetType,
): Range<Decoration>[] {
  const preview = block.renderer.editingPreview;
  if (!preview) {
    return [];
  }
  const lines: Range<Decoration>[] = [];
  const last = state.doc.lineAt(block.to).number;
  for (let n = state.doc.lineAt(block.from).number; n <= last; n++) {
    lines.push(
      Decoration.line({ class: preview.sourceClass }).range(
        state.doc.line(n).from,
      ),
    );
  }
  if (preview.isBlock?.(state, block) ?? true) {
    lines.push(
      Decoration.widget({ block: true, side: 1, widget: widget() }).range(
        block.to,
      ),
    );
  }
  return lines;
}
