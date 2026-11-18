# Callouts

Displays Obsidian-style callouts, including nested and foldable callouts, in Live
Preview. Insert Callout wraps selected lines, or, with a collapsed caret that only
whitespace precedes on its line, inserts a Title/Contents callout template at
the caret; the caret reveals callout source. As in Obsidian, a type is any
text but `]` (`[!笔记]`, `[!my type]` as `my-type`), and what follows a `|` is
metadata that CSS snippets select with `data-callout-metadata` (`[!note|wide]`).
An alias keeps its written type in `data-callout` (`[!tldr]` is
`data-callout="tldr"`, with the icon and colour of `abstract`), so snippets
that select an alias match, as in Obsidian.

## How it works

A block renderer recognizes callout blockquotes and uses the shared sanitized
render service. `edit.ts` wraps selected lines with blank lines around adjacent
text; a collapsed caret with only whitespace before it (column 0, indentation
or an empty line) inserts `\n> [!NOTE] Title\n> Contents\n` at the caret, which
leaves the rest of the line below the callout; whitespace before the caret
stays. Text before the caret, or any selection, wraps instead. The `NOTE` type
is selected and one editor transaction makes the insertion one undo step. As in Obsidian, the
command is refused (no edit) with the caret or selection in a table cell.
The post-processor binds disclosures to panel-local memory.
That memory is a `folds` view-state contribution, restored on registration and
mapped across renamed source identities. Each pass owns its event listeners and
bindings; plugin disposal removes registrations and remaining pass handlers.
Foldable titles (and the fold button) toggle disclosure; a `-` callout starts
closed. Clicking the body or padding reveals and selects the whole callout
source, as does its Edit button. Dragging across the body selects its
rendered text instead, as in reading view, and Copy copies that text
(`src/webview/ui/rendered-text-selection.ts`). Typing replaces that visible selection. Links
and controls keep their own clicks; keyboard navigation can reveal source with
a caret.

## Files

- `manifest.ts`: enablement and Insert Callout contribution.
- `webview.ts`: renderer, disclosure and command registrations.
- `edit.ts`: callout detection, pure insertion edits and the table-cell-guarded command.
- `view-state.ts`: disclosure memory, live bindings and source remapping.
- `callouts.test.ts`: recognition and insertion units.
- `view-state.test.ts`: persistence, restore and source-remapping units.
- `disclosure.test.ts`: title/chevron toggling and listener disposal.
- `../../../test/unit/callouts/interaction.test.ts`: body/button source editing (title folds).
- `callouts.css`: the plugin's styles, bundled through `src/webview/styles/index.css`.

## Services, events and settings

Injects `editor`, `commands`, `render` and `livePreview`; provides no service.
Listens to `render/postProcess`; emits no kernel events. Contributes `folds` to
editor view state. `lumiere.markdown.plugins.callouts.enabled` defaults to true.
Insert Callout has no default keybinding.

## Limits and differences from Obsidian

Colors follow VS Code's theme rather than Obsidian assets. Live Preview zeros the
outer callout margin (as Obsidian CM6) and keeps nested callouts at `1em` vertical
margin; titles use `flex-start` and a 4px icon gap (`--size-4-1`). Disclosure state
belongs to each panel, while text and undo belong to VS Code. Exact colour parity
awaits the owner's manual comparison. The template-or-wrap condition follows
Obsidian 1.15.0's shipped code read; live 1.15.0 vault remeasure is still pending.
