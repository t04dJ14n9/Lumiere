# Outline

Shows the active note's headings beside this editor, with Collapse All,
Expand All and an optional Follow Cursor toggle. Clicking a heading jumps to
its section, and dragging it moves the section, like Obsidian's **Outline**
core plugin. **Go to Heading…** searches these headings in a native Quick
Pick while the Lumiere editor is active.

## How it works

The view parses the active panel's authoritative document text into nested
headings and refreshes after edits. Follow Cursor defaults to on; its checked
overflow action persists `outline.followCursor` through VS Code settings.
When enabled, cursor movement, scrolling, panel changes and view visibility
reveal and select the current section without taking focus. A scroll follows
where the reader is (`reading-position.ts`, the plugin's webview half): the
first line visible at the top of the editor viewport, below the sticky
headings and the embedder's controls (`--lumiere-inset-top`), so a heading a
jump put right under the pins is the one read. Caret moves still follow via
`followCaret`, and the caret wins: a scroll the caret caused (an arrow past
the bottom, Page Down, Ctrl+End, find next) is not reported, so the caret's
section stays selected, as in Obsidian, whose outline follows the caret and
not the scroll. Every deliberate jump (Go to Heading, a `[[#Heading]]` link, a
sticky pin, an outline click) goes through the editor's `navigate`, which the
reporter observes: what it scrolls is the jump's, however it was clamped at
the end of the note, and the caret follow has the heading the jump selected.
The default
expand mode is accordion, like a page's table of contents: the active
heading's parents and its own subheadings are open and every other branch
is closed, without rebuilding the tree. VS Code can close a single row only
through the whole-tree collapse, which flashes the outline shut and open
again, so the accordion uses it only when a branch that is open is not on
the new path (leaving a chapter or a section that has subsections); a move
that only opens rows (into a section that has subsections, or deeper) opens
them and collapses nothing. Rows stay open across the refresh an edit makes
(VS Code keeps them by id), so typing does not flash the tree either. A
follow that is superseded while only opening rows (common while scrolling)
keeps that model too, so the next follow does not Collapse All. Follows
change the tree one at a time; hosts without the native collapse close the
other rows one by one whenever the path changes. `all` starts every parent
expanded and follow only selects. Version and panel identity guards discard stale captures. Collapse All uses VS Code's native tree action;
Expand All reveals every node in order so deeply nested headings also expand.
Clicking a heading opens the note at its offset; the links plugin's `navigate` then
scrolls that offset to the **top** of the editor viewport (intentional product
choice — not VS Code Outline `InCenter` / Obsidian centre), below sticky-heading
chrome when a parent pin is present or appears after the jump. Near the start or
end of a note the scroll range ends first, so the heading stays as close to
the top as the note allows. The jump a click makes does not collapse or expand
anything (nor does the caret the editor reports from before it): rows that
moved under the pointer sent a double-click's second click to another heading.
Scroll follow (`followReading`) is held for that same jump window
(`OUTLINE_JUMP_MS`, `jump-window.ts`) so a top-of-viewport report cannot yank
selection off the clicked row while the heading is still settling at the top;
caret follow keeps using `isCaretOnJump`. The webview counts a report as sent,
so the last one held back is applied when the window ends (scroll on to
another section within the second and stop, and the outline moves there a
moment later), unless a caret move or another click came after it. The
accordion applies again once the caret or the reading position moves on.
Above the first heading (frontmatter or a preamble) no section is current, and
Obsidian clears the highlight; the view does the same through the tree's
optional `clearSelection`, leaving the open rows as they are.

Dragging a heading's row moves its section: the heading, its text and its
subheadings, up to the next heading of the same or a higher level. Dropped
on another row, the section goes before that heading; dropped below the last
row, to the end of the note. Levels are kept, as in Obsidian, and the text
before the insertion point and the moved section each end in a blank line
(`move-section.ts`). The move is one edit to the note's `TextDocument`
(`section-drag.ts`), so one Undo takes it back and every panel of the note
follows. A drop inside the dragged section, or right after it, changes
nothing, and a note edited since the outline last refreshed is not moved
(the rows' offsets would no longer fit it); a message says to try again.
Rows are named by sibling ordinals (`1`, `0/2`), and VS Code hands the drop
the row it picked up, not a fresh one. Each row therefore carries the
revision of the text it was built from (a third argument of its click
command, which a click ignores), and the outline bumps the revision when a
refresh finds the note's text or URI changed. A drop whose dragged row or
target row is of an older revision moves nothing and gives the same message,
so another writer's edit during the drag cannot turn a row's id into another
heading. A refresh that finds the text unchanged keeps the revision.

Ctrl+Shift+O (Command+Shift+O on macOS), or **Lumiere: Go to
Heading…** in the command palette, opens a searchable heading picker. It reads
the active panel's authoritative text, shows heading levels and parent titles,
and navigates through the same path as the tree. Dismissed or stale picks
(edited document, changed panel or stopped plugin) do not navigate.

Ctrl+Alt+O (Control+Command+O on macOS) toggles Markdown Outline while the Lumiere
editor is active (editor-scoped keybinding, so Lumiere PDF keeps the same keys).
The command palette entry is workbench/config-gated like Quick Switcher. Hiding
targets the view itself, including after moving it to the secondary sidebar or
panel; showing restores and focuses it in its current location.

When a Lumiere editor is active, **Markdown Outline** stands in for VS Code's
native **Outline**: the native one is hidden as soon as Markdown Outline is on
screen, and comes back when the last Lumiere editor is left (after a short
debounce, skipped if Lumiere PDF or another Lumiere editor already owns the
active tab), but only if this plugin hid it, and without taking the keyboard
focus: the reader may be in another window by then. Opening a note never changes which
sidebar container is shown: a note opened from Search or Quick Open leaves the
Search view in place, because focusing the view (`lumiere.markdown.outline.focus`)
would bring up the Explorer. Markdown Outline is therefore never focused on open. It
shows itself where the Explorer is already the container; VS Code lists an
extension's Explorer views collapsed the first time, so the reader expands it
once and VS Code remembers that. (Until then the native Outline is left alone.)
**Tags** and other Explorer subpanels stay collapsed by default
(`visibility: "collapsed"`). Manual changes to Outline while a Lumiere editor
stays active are left alone: the native Outline is hidden once per time a note
becomes active. Tags also use the same `activeCustomEditorId` when-clause as
Markdown Outline so they do not linger beside non-Lumiere editors.

## Files

- `host.ts`: the plugin registrations and editor/document event routing.
- `webview.ts`, `reading-position.ts`: report where the reader is after a
  scroll (debounced, only when it changes and the caret did not cause the
  scroll), over `protocol.ts`.
- `symbol-picker.ts`: searchable headings and guarded navigation for Quick Pick.
- `jump.ts`: opens a note at a heading for rows and Go to Heading; checks
  Links and logs a failed jump.
- `symbols.ts`: nested heading symbols with enclosing section ranges.
- `tree.ts`: heading nodes, parent lookup, editor-to-source coordinates, the
  text revision each row carries and the dropped row's move.
- `move-section.ts`: the edit that moves a heading's section before another
  heading or to the end of the note.
- `section-drag.ts`: applies a dropped row's move to the note's document, and
  refuses a drop of rows from replaced text.
- `view.ts`: refresh timing, cursor following and expansion traversal.
- `jump-window.ts`: the second after an outline click, when the tree and scroll follow are left alone.
- `actions.ts`: commands, configuration reads and the follow context key.
- `focus.ts`: native Outline ↔ Markdown Outline swap while a Lumiere editor is active, without changing the sidebar container (Tags stay collapsed).
- `commands.ts`: view, command, setting and context identifiers.
- `headings.ts`: nesting headings and finding the caret's section.
- `manifest.ts`: view/title actions, the view, keybinding and the follow setting.

## Services, events and settings

- Injects the host services `hostCommands`, `dialogs`, `views`, `settings`
  and `hostDocuments` (a dropped row's edit), `vaults` (navigation) and
  `editors`.
- Depends on the Links plugin of the note's editor for every jump (row
  clicks and Go to Heading): Links registers the editor's reveal with the
  `navigation` host service and moves the view. Links runs per note and
  Outline per window, so this cannot be an `inject`; instead, with Links off
  for the note, a jump shows a message at once rather than waiting for a
  reveal that never comes. A jump that fails otherwise is logged as a
  warning.
- Listens to `editor/opened`, `editor/closed`, `editor/ready`,
  `editor/activeChanged`, `editor/selectionChanged` and `document/changed`,
  each panel's `outline.readingPosition` notification, plus native
  configuration and tree visibility changes. The webview half injects
  `editor` and `rpc`. Emits no events and
  provides no services.
- Maintains `lumiere.markdown.plugin.outline` while the window plugin is
  running, so editor-scoped shortcuts (Go to Heading, Ctrl+Alt+O) reflect its
  lifetime. The Toggle Markdown Outline palette entry uses workbench/config gating.
- Settings: `lumiere.markdown.plugins.outline.enabled`,
  `lumiere.markdown.outline.followCursor` (default `true`, resource-scoped),
  and `lumiere.markdown.outline.expandMode` (default `accordion`,
  resource-scoped; `all` expands every parent).
- Commands: `lumiere.markdown.outline.expandAll`,
  `lumiere.markdown.outline.enableFollowCursor`,
  `lumiere.markdown.outline.disableFollowCursor` and
  `lumiere.markdown.outline.toggle` and `lumiere.markdown.outline.goToHeading`;
  internal navigation uses
  `lumiere.markdown.outline.open`.

## Limits and differences from Obsidian

- VS Code's TreeView API can select a row but not clear the selection, so
  there the last row stays highlighted while the caret or the top line is above
  the first heading.
- VS Code's tree reports only the row a heading is dropped on, not which
  half of it, so a drop always puts the section before that heading (below
  the last row for the end of the note); Obsidian also offers the position
  after a row. Obsidian's drop at the very top of a note adds blank lines
  before the section; here it starts the note.
- VS Code's native Outline and breadcrumbs require an editor integration that
  the supported CustomTextEditorProvider API does not supply. Lumiere uses
  Markdown Outline and Go to Heading. The plain text editor uses VS Code's built-in
  Markdown symbols and Ctrl+Shift+O; this plugin registers no symbol provider,
  so split editors cannot cache duplicate headings from Lumiere.
