import type { EditorState, SelectionRange } from "@codemirror/state";
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";

const currentMatches = new WeakMap<EditorState, SelectionRange | null>();

/**
 * The find bar's current match: while the bar is open, the main selection
 * when it is exactly a match of its query, as Find leaves it after each step.
 * Obsidian reveals the source under its search highlight; every Live Preview
 * renderer already reveals a selection, and the ones that keep rendering
 * under a selection, or without the editor's focus (footnote references,
 * display math), ask this as well.
 *
 * Only while the bar is open: CodeMirror keeps the query after it closes, and
 * its first query is whatever text was selected when the search state was
 * created, so a later selection of the same text is no find match.
 */
export function currentFindMatch(state: EditorState): SelectionRange | null {
  let match = currentMatches.get(state);
  if (match === undefined) {
    match = selectedMatch(state);
    currentMatches.set(state, match);
  }
  return match;
}

function selectedMatch(state: EditorState): SelectionRange | null {
  const main = state.selection.main;
  const query = getSearchQuery(state);
  if (main.empty || !searchPanelOpen(state) || !query.valid) {
    return null;
  }
  const first = query.getCursor(state, main.from, main.to).next();
  return !first.done &&
    first.value.from === main.from &&
    first.value.to === main.to
    ? main
    : null;
}

/** Whether the find bar's current match touches `from`–`to`, ends included. */
export function findMatchTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const match = currentFindMatch(state);
  return match !== null && match.from <= to && match.to >= from;
}
