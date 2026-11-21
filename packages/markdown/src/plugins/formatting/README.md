# Formatting

Formats Markdown selections, words and lines using Obsidian-style editor
commands: emphasis, code, comments, headings, lists, quotes, links and line moves.

## How it works

Inline toggling uses the shared dialect to locate enclosing syntax at the caret;
otherwise it wraps the word or selection, or removes selected delimiters. As
in Obsidian 1.14, a selection anywhere inside a span unwraps the whole span,
and one over or around spans merges them into one (`spans.ts`). As in
Obsidian 1.15, a selection is wrapped line by line after each line's quote,
list, task and heading markers, the spaces at its ends left outside, and a
table, code or math line it runs past is skipped (`line-parts.ts`).
Swap Line Up and Down move a list item with the lines under it, as Obsidian
1.15 does while Smart lists is on (`swap-lines.ts`, `list-blocks.ts`): past
a sibling item, a paragraph line, or out of and into a parent's next or
previous sibling, numbers staying in place; elsewhere, or with several
selections, CodeMirror moves the selected lines.
Clear Formatting strips the syntax markers of inline, image, reference,
autolink and link-definition forms, keeping label, URL and reference text
(`[l](u)` becomes `lu`, as in Obsidian); escaped literals, code text, bare URLs,
wikilinks and wiki embeds stay, since Obsidian does not class their brackets
as formatting.
It acts on the selected source, so a label-only selection does not remove
syntax outside it.

Highlights take Obsidian 1.14's colours, an emoji right after `==`
(`==🔵text==`): **Toggle Red Highlight** and the five other colours wrap the
word or selection in that colour; on a highlight they recolour it, or remove
it in its own colour; on part of one they split it, the part in the new
colour and the rest in its own, spaces left outside; highlights a selection
spans merge (`highlight-colour.ts`). The square emoji (`==🟦text==`) are the
same colours, as in Obsidian 1.15; the commands write round ones, but keep a
square one when merging highlights of its colour. Typing `==` that opens a highlight offers
Default and the six colours; taking one wraps an immediately following word,
reuses its closing `==` if present, or opens an empty pair, with the caret
inside after the colour (`highlight-suggest.ts`); Tab takes nothing, as in
Obsidian. Line commands edit each selected line of every selection, the line a
selection ends at the start of included, and Insert Link, Insert Horizontal
Rule and Insert Code Block act at every selection, as in Obsidian 1.15. Registered
commands target the active projected editor (including table cells), except the
list, quote and code-block commands: they check the outer document for a parsed
table at the caret or selection start and return false there, as do Insert
Callout and the checklist commands in their own plugins (`src/markdown/table-cell.ts`
holds the shared check). Owned keymaps
provide bold, italic, link and comment shortcuts. As in Obsidian,
Insert Link leaves the caret in the empty URL after a selected label (else in
the empty label), and Toggle Comment wraps the selection or the word at the
caret in `%%…%%` (no spaces, as in 1.14) with it selected, or inserts an empty comment
(`comment.ts`). Pasting a URL (any `scheme:` text without spaces) over
selected text on one line links the text and selects the link
(`paste-link.ts`). Those keymaps stop the
keystroke there: VS Code forwards webview keystrokes that reach the window to
its keybinding service, which would otherwise run the contributed binding a
second time (Ctrl+B bolding then unbolding) or Cursor's own Ctrl+I. The
contributed bindings still apply when focus is outside the editor text.
Read-only views reject edits. The note's right-click menu holds the inline
commands in submenus, as Obsidian's editor menu does: Format (bold, italics,
strikethrough, highlight, inline code), Highlight (the six colours) and
Insert (link), where host-node labels each by its short title (Bold).

## Files

- `manifest.ts`: command, keybinding and right-click menu contributions.
- `api.ts`: injected formatting service contract.
- `webview.ts`: service, command catalogue and keymap registrations.
- `format-keys.ts`: capture-phase Ctrl/Cmd+B/I so Vim cannot page-back / jumplist-steal bold and italic; Vim host consume yields while formatting is on (BH-024).
- `format-keys.test.ts`: Mod+B/I mapping and native-field skip.
- `inline.ts`: inline clearing, caret/word wrapping and selection toggling.
- `spans.ts`: the formatted spans around a selection.
- `line-parts.ts`: the part of each selected line an inline format wraps.
- `list-blocks.ts`: list items with the lines under them, and what is next to them.
- `swap-lines.ts`: Swap Line Up and Down.
- `highlight-colour.ts`: the coloured highlight commands.
- `highlight-suggest.ts`: the colour list after `==`.
- `lines.ts`: heading/list/quote edits and link insertion.
- `formatting.test.ts`: pure editor-state command units.
- `test/unit/formatting/table-cell.test.ts`: refusal and parser boundary units for
  the shared check (`src/markdown/table-cell.ts`).

## Services, events and settings

Injects `editor` and `commands`; provides `formatting` with wrap and clear
operations. Swap Line reads the `smartListsOn` facet
(`src/markdown/smart-lists.ts`) that the smartLists plugin provides. Most palette commands query the `editor/activeView` bail event;
the four guarded block commands use the outer view to check table syntax
through the shared `src/markdown/table-cell.ts`.
`lumiere.markdown.plugins.formatting.enabled` defaults to true. Bold, italics
Insert Link and Toggle Comment use Mod+B, Mod+I, Mod+K and Mod+/.

## Limits and differences from Obsidian

Swap Line does not carry folds inside a moved list item, as Obsidian's does.
As in Obsidian, list nesting counts tabs and runs of four spaces, so an item
indented by two spaces moves as its parent's sibling.

After an inline format the selection ends on the formatted text; Obsidian's
keeps a selected leading marker (`‹- **item›**`). Toggle Comment wraps the
selection as it is, markers and spaces included, as Obsidian's does.

After a highlight colour command the selection stays on the same text;
Obsidian 1.14 sometimes leaves it elsewhere, and with a selection running past
a highlight's end it can garble the markers (`==🔴two t==hree`), which Lumiere
does not copy. Coloured highlight toggles appear on the editor context menu
(and in the command palette), matching Obsidian's colour set.

VS Code owns saves and undo. Formatting changes source directly, including table
cell projections. Obsidian's command check callback hides the guarded
commands from its command list and disables the cell's block submenus; Lumiere
leaves them in the command palette as no-ops. The guard treats any parsed `Table` position as a cell, including separator
rows, raw table source in Source mode and tables the widget cannot draw. No live-reference
keybinding or visual-parity observation is claimed. Obsidian 1.15.0's other
default, Mod+D (Delete Paragraph), is left to VS Code's Add Selection to Next
Find Match (CAPABILITIES.md, Hotkeys).
