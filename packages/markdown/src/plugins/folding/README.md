# Folding

Collapses headings and indented sections with gutter controls and commands,
corresponding to Obsidian's Fold heading and Fold indent settings.

## How it works

Heading queries inspect only the requested lines in the shared syntax tree
(Live Preview's, else CodeMirror's), then scan sibling headings for the
section boundary. Results are cached by immutable document identity and the
tree they came from; no full metadata extraction is needed. While a large
note's tree is still a prefix, nothing parses the rest of it: a line past
the prefix has no fold yet, and the gutter asks again as the tree grows.
Indentation uses the configured tab width. The plugin owns the fold state,
gutter, service and `folded` view-state contribution. A private fold-service
compartment updates configuration while retaining ranges. Gutter invalidation
observes configuration, tab width and Live Preview's tree. Disposal captures
ranges before removing controls; late enable restores valid saved ranges.

A note's folds are kept for the note, as Obsidian keeps them per file: a
panel that opens the note (a reopen, a second panel, a window reload) gets
them from the host (`host.ts`), in workspace storage keyed by the note's
URI. Each open panel keeps its own folds; the note's record is the folds of
the panel where the reader last folded or unfolded, saved half a second
later as in Obsidian, and kept up to date while the text changes in that
panel. Another panel of the note never overwrites it by being edited or
closed, so the panels do not undo each other's folds; when no open panel
holds the record, the next panel to open the note does. Obsidian saves
from every leaf of the file, after edits and on close too, so there the
last leaf changed or closed wins. The panel's own view state still carries
its folds when it moves (a rename, Back and Forward in the panel).

## Files

- `manifest.ts`: heading/indent settings and three command contributions.
- `api.ts`: fold service contract.
- `webview.ts`: range calculation, gutter, commands and reconfiguration.
- `heading-fold.ts`: lazy heading ranges with per-document caching.
- `heading-fold.test.ts`: range parity, bounded gutter traversal, edit
  invalidation and folds from a prefix tree.
- `view-state.ts`: fold capture, validation, source mapping and restore. A
  saved fold records the text of the lines it starts and ends on and comes
  back only where they still read the same, so a note changed outside the
  panel does not fold other lines. Folds saved without that record (before
  it existed) are restored by offset.
- `view-state.test.ts`: restore on the same text, and not on changed text.
- `protocol.ts`: the saved-fold schema and the `folding` RPC (`load`, `save`).
- `note-folds.ts`: the webview half of the note's folds: put back on open,
  sent after a fold, and after a text change while the note keeps them.
- `note-folds.test.ts`: when a panel sends its folds, and what is a fold.
- `note-store.ts`: the note's record in workspace storage, and which open
  panel holds it (at most 500 notes, 1000 folds each).
- `host.ts`: the panel's host half, answering `load` and `save`.
- `note-store.test.ts`: last fold wins, other panels' edits and closing do
  not, a second panel opens with the first's folds.

## Services, events and settings

The webview half injects `editor`, `commands` and `rpc`; provides `fold`.
The host half injects `rpc` and the host service `storage`. No kernel
events. Contributes `folded` view state. `plugins.folding.enabled`, `folding.heading` and
`folding.indent` under `lumiere.markdown` default to true. Commands: Fold All,
Unfold All, Toggle Fold, Fold More and Fold Less (`commands.ts`), as in
Obsidian, measured against it: Fold All folds nested sections too; Toggle Fold
acts only on a section that starts on the caret's line; Fold More folds the
innermost open section around the caret and Fold Less opens the outermost
folded one. No default keybindings.

## Limits and differences from Obsidian

Uses CodeMirror's gutter and fold state with VS Code colors. Until a large
note has finished parsing (usually well under a second after it opens), a
heading whose section runs past the parsed part folds only to the last parsed
line, and Fold All skips headings past it. Two open panels of one note keep
their own folds; the note keeps those of the panel last folded in (Obsidian:
the leaf last changed or closed). A saved fold comes back only where its
lines still read the same (Obsidian drops all of a note's folds when its
line count changed). Like Obsidian's, the record follows neither a rename
nor a move of the note. Text and undo remain host-owned.
