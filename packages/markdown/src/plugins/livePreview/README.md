# Live Preview

Renders Markdown in place and reveals syntax around the caret, like Obsidian's
Live Preview. Each panel can switch between Live Preview and Source mode.

## How it works

A shared document tree feeds block indexes and viewport inline decorations.
It is CodeMirror's own syntax tree: the editor parses a note once, in
CodeMirror's language, and Live Preview reads that tree and only asks the
parse to go further when it needs more of the note (as in Obsidian, one tree
for everything). For a large note it starts as the opening band; when the
viewport passes its end, the parse is pushed up to the viewport and a margin
before the frame paints, and idle slices of a few milliseconds finish the
rest, during scrolling too (CodeMirror's own background parse stops 100,000
characters past the viewport).
Feature renderers are selected in catalog rank order; generic core blocks use
the base slot. Caller-bound registrations retain the contributing plugin's owner.
Built-in block renderers declare their eligible node names. Structural syntax
is discovered once per tree and reused across registrations; unrelated inline
syntax and match predicates are skipped. Undeclared or inline node renderers
retain complete discovery.
The engine compartment switches presentation without replacing the document.
Inline decorations map through IME and selection-only mouse drag updates.
Viewport changes during a drag or scrollbar press render newly visible text using
the frozen reveal selection; rendered clicks map visible text back to source
before syntax is revealed.
A coloured highlight (`==🔵text==`, Obsidian 1.14; the square `==🟦text==`
too, as in 1.15) shows in its colour with
the emoji hidden, or a swatch in its place while the caret is in it, as
Obsidian shows it.
Emphasis around a highlight remains parsed inside a word, including its colour
emoji, so moving the caret outside hides both pairs of syntax markers. The
syntax parser and HTML renderer share the highlight-aware emphasis flanking rule.

## Files

- `manifest.ts`: core metadata and Toggle Source command.
- `api.ts`: renderer, inline context and service contracts; `documentTree`,
  CodeMirror's syntax tree as Live Preview needs it (a prefix while a large
  note is still parsing, never covering less after an edit than before it);
  `treeReached`, where a transaction's tree became more than the old one
  parsed again, for indexes of the note.
- `host.ts`: native Toggle Source command routing.
- `webview.ts`: engine/service, invalidation, fallback and mode registrations.
- `registry.ts`: renderer facets and reveal rules.
- `find-match.ts`: the find bar's current match, which reveals source where a
  selection would not; `find-match.test.ts` covers it.
- `document-tree.ts`: pushes CodeMirror's parse past the viewport when the
  viewport outruns the tree, and finishes a large note in idle slices.
- `../../markdown/dialect/language.ts`: the parser CodeMirror's language
  runs, with the first-line frontmatter rule Lezer's block reuse lacks.
- `document-tree.test.ts`: first-paint band, one parse shared with
  CodeMirror, viewport catch-up, idle slices, reach kept across edits,
  progress handed on, first-line frontmatter edits, indexing what a parse
  newly reached.
- `blocks.ts`: block index, widget decorations and render revision. A block
  that starts after `> ` (display math or a diagram in a quote) carries its
  Markdown without the later lines' quote markers, which is what its widget
  renders (`../../markdown/quoted-block.ts`).
- `quoted-block.test.ts`: quote markers stay out of a quoted block's render.
- `revealed-block.ts`: whether a block shows its source (for a renderer
  that asks, only while the editor has focus or under the find bar's match),
  and the editing preview after a revealed block's source.
- `editor-focus.ts`: the editor's focus as a state field, which block
  decorations read; `editor-focus-tracking.ts` sets it from CodeMirror's
  focus-change transactions, and once when installed into a focused editor.
- `block-discovery.ts`: structural syntax cache and renderer candidate selection.
- `block-discovery.test.ts`: registration cost, discovery parity and unrestricted renderers.
- `inline.ts`: basic inline decoration builder.
- `inline-plugin.ts`: when inline decorations are built again, and their
  composition/drag lifetime.
- `offscreen-reuse.ts`: while only the caret moves, persistent widgets off
  screen (tall embeds) keep what they drew, apart from those in the
  paragraphs the old or new selection reveals; `offscreen-reuse.test.ts`
  checks this against a full drawing over random selections.
- `highlight-colour.ts`: a coloured highlight's class and emoji.
- `../../markdown/dialect/highlight-emphasis.ts`: highlight-aware emphasis flanking,
  shared with the HTML renderer.
- `code-lines.ts`: code block lines; only fence text hides, so reveals never
  change the layout. Thematic breaks are likewise one decorated line.
- `rendered-position.ts`: visible-text projection and DOM-to-source mapping.
- `motion.ts`: Escape and vertical motion around rendered blocks, visible-widget queries and disjoint fold spans.
- `core.test.ts`: reveal, motion, mode and lifecycle unit coverage.
- `inline.test.ts`: basic/custom decoration and line-deduplication units.
- `../../../test/unit/livePreview/nested-formatting.test.ts`: formatting commands
  followed by caret-outside syntax hiding.
- `inline-viewport.test.ts`: scrollbar and drag viewport rendering, frozen reveal,
  selection-only stability and composition mapping units.
- `code-lines.test.ts`: code and thematic break line classes and hidden text.
- `invalidation.test.ts`: incremental index and decorations equal a full rebuild (randomised); invalidation reasons.
- `decoration-cost.test.ts`: renderer matches and widgets built per caret move and edit on a 4,000-block note.
- `viewport-cost.test.ts`: tree steps to decorate one screen, the same in a note four times longer (counted, not timed).
- `heading-drag.ts`: a drag that starts at the start of a heading's text,
  its `#` marks hidden (reveal is frozen from the press), starts at the start
  of the line, so the selection takes the marks as in Obsidian.
  `heading-drag.test.ts` covers it.
- `plain-edit.ts`: whether an edit is plain text that can change no block
  (no line break or block mark, the line's leading marks kept, the same
  blocks around it in the tree after it); indexes of the note's blocks then
  map their positions instead of walking the whole note on every keystroke.
  `test/unit/livePreview/plain-edit.test.ts` applies random edits and checks
  every index that took that shortcut against a fresh walk.

## Incremental invalidation

Each transaction yields `RenderInvalidation`s (`invalidation.ts`):
`{ fromLine, toLine, reason }` with reason `text` (the lines whose blocks a
text change may have altered: every top-level syntax node, before or after
the change, that touches it or the region found so far, widened to whole
lines until stable), `selection` (lines the caret left or
entered, and the selection's lines when the editor gains or loses focus) or `metadata` (an effect, a reconfiguration or a renderer change:
every line). The `text` region is computed in `changed-region.ts`, which
needs no DOM; `api.ts` offers it to other plugins' indexes as
`changedBlocks` (sticky scroll's headings, the line-number gutter).

- `blockIndex` indexes only the `text` region again. Blocks before it are
  kept as the same objects; blocks after it are shifted copies. A region over
  half the note, or a block found there that reaches outside it, falls back
  to a full index.
- Below-fold blocks use `DeferredBlockWidget` until `blockHotRanges`
  (viewport + margin, plus the caret) covers them; see
  `docs/perf/startup-viewport-2026-10-22.md`.
- `blockDecorations` rebuilds decorations only for blocks that are new to
  the index or touched by an invalidation, found by binary search;
  `metadata` (or more than half the blocks dirty) rebuilds all. A caret move
  costs O(log blocks + blocks it enters or leaves).
- Costs that remain document-wide (measured with
  `scripts/measure-decorations.ts`; `decoration-cost.test.ts` pins the
  counts): an edit still rebuilds the widgets of every block after it
  (widgets carry source positions; their DOM is kept because the source did
  not change), and `blockIndex` maps the positions of every block after it.
  On a 16,000-block note (372 KB, a loaded machine) an edit at the start
  costs about 10 ms more than the syntax tree's own ~11 ms; at the end, about
  1 ms more; a caret move about 0.05 ms (was 2.8 ms).
- Renderers' `match` and `range` may read only the node and the text around
  it; anything else they depend on must reach them as a facet change or an
  effect. `invalidation.test.ts` checks, over thousands of random edits and
  caret moves, that the incremental index and decorations equal a full
  rebuild. A renderer's optional `nodes` list must name every syntax node
  its `match` can accept; omitting it retains the complete traversal.

## Services, events and settings

Webview injects `editor`, `commands` and `render`; host injects the host service `hostCommands` and
`editors`. Provides `livePreview`. Listens to
`render/changed` and `editor/modeRestored`; emits no kernel events. Initial mode
comes from `editor.defaultMode`; Toggle Source changes only the active panel.
Renderer registrations belong to their caller and dispose with that caller.

## Limits and differences from Obsidian

Source mode retains the inline title (when it is on). A block covering the whole document has no
outside destination for Escape. Rendered-position mapping refuses mismatched DOM
text such as embedded media/math. VS Code owns text/undo; exact visual parity is
left to the owner's manual comparison.

The `visiblePosition` service query places external badges after replacement
blocks without exposing renderer internals to marker providers.

### Reveal rules

Follows the measured [Obsidian rules](../../../docs/OBSIDIAN_REVEAL_RULES.md).
Any selection touching an inline element (inclusive endpoints) reveals its
outermost ancestor and the transitive chain of directly abutting elements;
one character or space breaks the chain. Escapes and heading/quote marks reveal
on selected lines. Tasks reveal only through the checkbox end (columns 0–5
for `- [ ]`). Both code fences reveal anywhere in the block. Callouts reveal
source with quote marks per line and inline syntax per element. Definition
markers reveal on their first line; math and HTML blocks reveal whole.
Display math (a renderer with `revealsOnlyWhileFocused`) reveals only while
the editor has focus, as everything does in Obsidian, and keeps its formula
typeset just after the source (`editingPreview`: a block below it, or the
math plugin's own inline preview when the `$$` share a line with text). Images
do the same (owner request 2026-11-21, Obsidian 1.12's behaviour): an image
alone on its line is a block with `revealsOnlyWhileFocused` and
`editingPreview`, and an image in text is drawn again after its source
through `widgetAfter` (embeds' `image-reveal.ts`); images join reveal chains. Styled inline HTML (`kbd`, `mark`, `span`, …) hides both tags and paints the content even when the opener carries attributes (`<kbd class="…">`); self-closing and block tags stay source. A click on a
rendered math block reveals it as in Obsidian, selecting the formula. Callout
title/body clicks and Edit select the whole source; their fold buttons toggle disclosure.
A click on a drawn horizontal rule selects its source (head at start) via the
same `selectRenderedSource` handoff so typing replaces the rule.
Rendered fenced code (diagrams,
queries, processed code) only from its Edit button, selecting the code
(`BlockEditing` in `src/webview/ui/markdown-widget.ts`).
Tables and Properties retain their widgets; bullets, numbers, tags and comment
markers stay visible. Footnote references deliberately retain superscript
rendering except when a caret touches the reference itself.
The find bar's current match reveals the source around it, as Obsidian's
search highlight does: Find selects each match, so the rules above apply, and
footnote references, display math and images, which keep rendering under a
selection or without focus, ask `findMatchTouches` (provided through `api.ts`) while the bar is open. Tables
and Properties keep their widgets for a match too.

`reveal-rules.test.ts` documents the inline and line rules as caret-offset tables;
`test/unit/livePreview/reveal-plugins.test.ts` checks feature renderer composition.
