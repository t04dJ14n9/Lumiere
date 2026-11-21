# Math

Renders inline and display TeX formulas with MathJax, like Obsidian's math in
Live Preview. Moving the caret into a formula reveals its source, which reads
as code with its `$` delimiters in the accent colour. As in Obsidian 1.15.0,
a `$$` formula reveals only while the editor has focus, and then is typeset
again just after its closing `$$` as you edit it: below the source when the
`$$` have their lines to themselves, inline after the `$$` otherwise.
Clicking a formula reveals it with the formula selected, without its
delimiters, as in Obsidian.

## How it works

The plugin registers inline/block renderers and a render post-processor. MathJax
loads on demand (a load that fails is tried again by the next formula, not
remembered for the session); its SVG is sanitized before insertion. The font keeps many
glyphs (`\mathbb`, `\mathfrak`, `\mathscr`, `\mathcal`, `\ell`, AMS relations,
arrows, accented letters) in separate files that MathJax asks for on first use;
each is a chunk of the webview bundle, so they load offline and only when
needed. Each render pass owns its pending result and restoration callback, and
plugin disposal clears all remaining renders. Each formula travels to the
post-processor percent-encoded in `data-math`; a value that is not valid
percent-encoding (raw HTML in the note can write one) is typeset as written,
and a lone surrogate in the source becomes U+FFFD, so one bad formula never
stops the rest of the block. Editing commands wrap or unwrap
the selection through CodeMirror. Rendered clicks synchronize the editor range
and browser selection, including a second click on a display preview whose
source is already shown, so typing replaces the body and preserves delimiters.

## Files

- `manifest.ts`: feature metadata and the two command contributions.
- `webview.ts`: renderer, post-processor, cleanup and command registrations.
- `commands.ts`: pure selection edits and delimiter placement.
- `editing-preview.ts`: inline math and revealed math source, and where a
  revealed `$$` formula's preview goes (Obsidian's rule); the block
  renderer's preview below the source is Live Preview's `editingPreview`.
- `test/unit/math/editing-preview.test.ts`: placement, focus, and the
  inline preview's click.
- `source.ts`: a formula's delimiters, the span a click selects, and the
  range a display formula's widget replaces: text after a closing `$$` on a
  later line is a paragraph of its own, which the widget renders below the
  formula.
- `source-marks.ts`: highlights a revealed formula, only the lines on screen
  (an unclosed `$$` reaches to the end of the note).
- `test/unit/math/source-marks.test.ts`: highlighting, and its cost bounded by the screen.
- `mathjax.ts`: lazy TeX-to-SVG conversion with supported TeX packages and user macros.
- `macros.ts`: normalize Obsidian-style MathJax macro maps for configmacros.
- `fonts.ts`: MathJax's loader for the font's dynamic glyph files.
- `fonts.test.ts`: every dynamic file is bundled; formulas that need them typeset.
- `math.test.ts`: selection, delimiter and formula-span unit tests.
- `test/unit/math/data-values.test.ts`: lone surrogates and malformed `data-math` values do not stop a render.
- `math.css`: the plugin's styles, bundled through `src/webview/styles/index.css`.

## Services, events and settings

Injects `editor`, `commands`, `livePreview` and `render`; provides no services.
Listens to `render/postProcess`; emits no events. Enabled by
`lumiere.markdown.plugins.math.enabled` (default true). `lumiere.markdown.math.macros`
is a name→replacement map, like the MathJax macros that Obsidian community plugins
add (Obsidian core has no macro setting); `#1`…`#9` mark arguments.
Commands are Toggle Inline Math and Insert Math Block; neither has a default keybinding.
Insert Math Block puts `$$` lines around the lines of every selection, one
block for selections that share a line (`src/markdown/fence-lines.ts`). Both
refuse a read-only editor.

## Limits and differences from Obsidian

Uses the configured MathJax TeX packages plus optional user macros. Errors retain the
placeholder and show a render error. Save and undo belong to VS Code. Display math shares MarkdownBlock `estimatedHeight` with a MathJax-aware floor so short matrices do not collapse the height map on remount. Inline math line box matches Obsidian `.hmd-fold-math` (placeholder `line-height: 0`, inline SVG `overflow: hidden`). Exact glyph metrics still await the owner's manual comparison.

The editing preview reverses #269 (Host GUI findings BH-009 / BH-004 had
called the stacked formula a duplicate); the owner chose Obsidian's
behaviour on 2026-11-21 (#698 item 23). Differences: `$$` after quote
markers count as starting their line, so quoted display math, which Lumiere
renders as a block, keeps a block preview (Obsidian renders it, and its
preview, inline in the quote); a `$$` formula whose later lines are quoted
and whose closing line carries text gets no inline preview, since a click on
it could not map back to the note; `$…$` still reveals without focus (only
`$$` formulas follow Obsidian's focus rule) and, as in Obsidian, has no
preview. While the find field has focus, the find bar's match still reveals
a formula, as Obsidian's search highlight does.
