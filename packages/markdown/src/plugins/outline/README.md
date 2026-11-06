# Outline

Shows the active note's headings beside this editor, with Collapse All,
Expand All and an optional Follow Cursor toggle. Clicking a heading jumps to
its section, like Obsidian's **Outline** core plugin. **Go to Heading…** searches
these headings in a native Quick Pick while the Workshop editor is active.

## How it works

The view parses the active panel's authoritative document text into nested
headings and refreshes after edits. Follow Cursor defaults to on; its checked
overflow action persists `outline.followCursor` through VS Code settings.
When enabled, cursor movement, scrolling, panel changes and view visibility
reveal and select the current section without taking focus. A scroll follows
where the reader is (`reading-position.ts`, the plugin's webview half): the
line at the top of the editor viewport (so the outline tracks what you are
reading at the top of the pane). Caret moves still follow via `followCaret`.
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
(`OUTLINE_JUMP_MS`) so a top-of-viewport report cannot yank selection off the
clicked row while the heading is still settling at the top; caret follow keeps
using `isOutlineJump`. The accordion applies again once the caret or the
reading position moves on.

Ctrl+Shift+O (Command+Shift+O on macOS), or **Lumia: Go to
Heading…** in the command palette, opens a searchable heading picker. It reads
the active panel's authoritative text, shows heading levels and parent titles,
and navigates through the same path as the tree. Dismissed or stale picks
(edited document, changed panel or stopped plugin) do not navigate.

Ctrl+Alt+O (Control+Command+O on macOS) toggles Markdown Outline while the Workshop
editor is active (editor-scoped keybinding, so Lumia PDF keeps the same keys).
The command palette entry is workbench/config-gated like Quick Switcher. Hiding
targets the view itself, including after moving it to the secondary sidebar or
panel; showing restores and focuses it in its current location.

When a Lumia editor is active, **Markdown Outline** stands in for VS Code's
native **Outline**: the native one is hidden as soon as Markdown Outline is on
screen, and comes back when the last Workshop editor is left (after a short
debounce, skipped if Lumia PDF or another Workshop editor already owns the
active tab), but only if this plugin hid it. Opening a note never changes which
sidebar container is shown: a note opened from Search or Quick Open leaves the
Search view in place, because focusing the view (`lumiere.markdown.outline.focus`)
would bring up the Explorer. Markdown Outline is therefore never focused on open. It
shows itself where the Explorer is already the container; VS Code lists an
extension's Explorer views collapsed the first time, so the reader expands it
once and VS Code remembers that. (Until then the native Outline is left alone.)
**Tags** and other Explorer subpanels stay collapsed by default
(`visibility: "collapsed"`). Manual changes to Outline while a Workshop editor
stays active are left alone: the native Outline is hidden once per time a note
becomes active. Tags also use the same `activeCustomEditorId` when-clause as
Markdown Outline so they do not linger beside non-Workshop editors.

## Files

- `host.ts`: the plugin registrations and editor/document event routing.
- `webview.ts`, `reading-position.ts`: report where the reader is after a
  scroll (debounced, only when it changes), over `protocol.ts`.
- `symbol-picker.ts`: searchable headings and guarded navigation for Quick Pick.
- `symbols.ts`: nested heading symbols with enclosing section ranges.
- `tree.ts`: heading nodes, parent lookup and editor-to-source coordinates.
- `view.ts`: refresh timing, cursor following and expansion traversal.
- `actions.ts`: commands, configuration reads and the follow context key.
- `focus.ts`: native Outline ↔ Markdown Outline swap while a Workshop editor is active, without changing the sidebar container (Tags stay collapsed).
- `commands.ts`: view, command, setting and context identifiers.
- `headings.ts`: nesting headings and finding the caret's section.
- `manifest.ts`: view/title actions, the view, keybinding and the follow setting.

## Services, events and settings

- Injects the host services `hostCommands`, `dialogs`, `views` and `settings`, `vaults` (navigation) and `editors`.
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

- No drag-and-drop reordering of sections.
- VS Code's native Outline and breadcrumbs require an editor integration that
  the supported CustomTextEditorProvider API does not supply. Workshop uses
  Markdown Outline and Go to Heading. The plain text editor uses VS Code's built-in
  Markdown symbols and Ctrl+Shift+O; this plugin registers no symbol provider,
  so split editors cannot cache duplicate headings from Workshop.
