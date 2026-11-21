import { EditorView, type ViewUpdate } from "@codemirror/view";

// A table cell is edited in a view of its own; the editor's `noteReadOnly`
// and `followNoteReadOnly` give it the note's read-only state. This keeps
// track of the open cells, so they follow the note when it turns read-only
// (sync failed for good) or writable again.

interface ReadOnlyFollower {
  followReadOnly(): void;
}

/** The cell editors open over each note's editor. */
const openCells = new WeakMap<EditorView, Set<ReadOnlyFollower>>();

/**
 * Tell `cell` when the note in `outer` turns read-only or writable again,
 * until the returned function is called.
 */
export function watchNoteReadOnly(
  outer: EditorView,
  cell: ReadOnlyFollower,
): () => void {
  let cells = openCells.get(outer);
  if (!cells) {
    cells = new Set();
    openCells.set(outer, cells);
  }
  cells.add(cell);
  return () => {
    cells.delete(cell);
  };
}

/** Pass a change of the note's read-only state to its open cells. */
export function followReadOnlyChange(
  update: Pick<ViewUpdate, "startState" | "state" | "view">,
): void {
  if (update.startState.readOnly === update.state.readOnly) {
    return;
  }
  for (const cell of openCells.get(update.view) ?? []) {
    cell.followReadOnly();
  }
}

/** The note editor's extension that keeps its open cells' read-only state. */
export const cellsFollowNoteReadOnly =
  EditorView.updateListener.of(followReadOnlyChange);
