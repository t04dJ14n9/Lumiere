# Math

Renders inline and display TeX formulas with MathJax, like Obsidian's math in
Live Preview. Moving the caret into a formula reveals its source, which reads
as code with its `$` delimiters in the accent colour. A display formula shows
either its typeset result or its source — not both stacked — while you edit
(callout-style; Obsidian keeps a live preview under the `$$` lines). Clicking a
formula reveals it with the formula selected, without its delimiters, as in
Obsidian.

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

## Limits and differences from Obsidian

Uses the configured MathJax TeX packages plus optional user macros. Errors retain the
placeholder and show a render error. Save and undo belong to VS Code. Display math shares MarkdownBlock `estimatedHeight` with a MathJax-aware floor so short matrices do not collapse the height map on remount. Inline math line box matches Obsidian `.hmd-fold-math` (placeholder `line-height: 0`, inline SVG `overflow: hidden`). Exact glyph metrics still await the owner's manual comparison. Unlike Obsidian, revealed display math does not keep a typeset preview under the source (BH-009 / BH-004).
