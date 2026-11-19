# Editor

Hosts the Markdown editing surface and keeps each panel's selection, scroll and
presentation independent, like separate Obsidian editor panes.

## How it works

The host creates one panel context and RPC endpoint for each native editor panel,
attached to a shared TextDocument session. The webview creates CodeMirror and
provides caller-bound extension registration, clipboard and menu services. The
host also provides `selections` for capture and validation; `editor/selectionMenu`
is an awaited menu-contribution pipeline.
The validated `captureCursor` request returns the active selection end and
its synchronized version for cursor-following host views; projected table
selections return a position in the outer document.
Extensions sort by slot, catalog rank, owner ID and owner-local order in one
compartment. Persistence captures source identity and feature-owned contributions;
transfers flush first and reject a moving document version. A checkpoint
150 ms after the last caret move, edit, fold or scroll (and at once on
pagehide) saves the view with its geometric anchors, so no keypress captures
or measures it. Settings update a
separate compartment so user state survives reconfiguration.
Text-selection edge scrolling uses `lumiere.markdown.editor.dragScrollSpeed`,
a multiplier from 1 to 10 (default 4; 1 restores CodeMirror's original speed).
A selection-style observer starts the shared `EdgeScroll` helper with only
the additional velocity; CodeMirror's own timer continues extending the
selection, preserving word/line drags, Shift/Mod selections and atomic ranges.
The helper reads the current setting on every frame, in either editing mode,
and releases its listeners and frames when the gesture or view ends.
Tab and Shift+Tab never leave the note, as in Obsidian: on a list item they
indent or outdent the item with its nested lines (renumbering the ordered
lists it leaves and joins; an item that starts a new level counts from 1),
and otherwise they indent or outdent the lines the selection touches, even
with the caret mid-line. Inside code (between a fence's lines, or indented)
and frontmatter a line is text, so `# comment` or `---` there indents like
any other line, and Backspace does not unwrap a `- ` or `> `. Home (Cmd+Left on macOS), with Shift to select, goes
first to the start of a list item's, task's or quote's text, then to the line
start (`line-start.ts`).
Ctrl/Cmd+F opens an in-note find bar at the top right, like Obsidian's (capture-phase ownership so Vim cannot treat it as page-forward, BH-023; Ctrl/Cmd+H opens Replace the same way, BH-025): it
shows "N / M" for the selected match (counting stops at 1000; a caret move
looks the match up among those found, and an edit to the note is searched
again 150 ms after typing pauses), typing extends
the query at the caret even when the current query already has matches
(CodeMirror's findNext would otherwise select-all the field), Enter and
Shift+Enter (or F3, Ctrl/Cmd+G) move between matches, Aa toggles case,
Ctrl/Cmd+H or the ⇄ button shows the replace row (Enter replaces one,
Ctrl/Cmd+Enter or Replace all replaces all), and Escape closes it.
The note has its own size, `lumiere.markdown.editor.fontSize` (8 to 48, default
16: Obsidian 1.14.4's body size, measured in
`docs/obsidian-measurements/font-size.mjs`), and its own line height,
`lumiere.markdown.editor.lineHeight` (a multiple of the size, 1 to 3, default
1.5: Obsidian's 24px at 16px). They replace `editor.fontSize` and
`editor.lineHeight` for notes, which have no effect on them. Nor is
`editor.mouseWheelZoom` read: Lumiere adds no Ctrl/Cmd+scroll zoom, so use
**Set Note Font Size** (DESIGN §15.3). The line height is
a unitless ratio, so every line scales with the size; headings keep Obsidian's
own ratios (1.2, 1.2, 1.3, 1.4, 1.5 and 1.5). Headings are 1.618, 1.462, 1.318,
1.188, 1.076 and 1 times the body (Obsidian's ratios, em-relative), and tables,
properties, footnotes, code, the code-block and table buttons and the line
numbers are all em- or `--text-size`-relative, so one change rescales the whole
note live (the size is an editor theme: CodeMirror measures the lines again, so
the line numbers stay level). By default prose uses the system proportional font, while code keeps the
host's monospace font and property controls use the system UI font. Explicit
font-family choices (including an explicitly selected host default) are preserved.
The rest of the note text follows VS Code's
editor font settings as they apply to Markdown files, so `[markdown]`
overrides count as in the built-in text editor: `editor.fontFamily` (with a
monospace fallback), `fontWeight`, `letterSpacing`, `fontLigatures` (off by
default, as in VS Code) and `fontVariations`. Code is the same size as the text.
Those are native settings (`nativeConfigKeys`), not contributed again;
`font.ts` turns all of them into CSS variables, which `settings.ts` delivers as
an editor theme. The find bar, suggestion popup and sync toast keep fixed
sizes: they are editor chrome, not note text.
The native `editor.cursorStyle`, `cursorWidth`, `cursorBlinking` and
`cursorSmoothCaretAnimation` settings use the same manifest/configuration path.
A measured caret layer keeps block characters readable with VS Code's
`editorCursor.foreground` and `editorCursor.background` theme colours, and
keeps DOM elements in place so movement can animate. Modal plugins inject the
caret's mode and change notifications through the editor service;
`drawSelection` continues to draw selections. Explicit smooth animation applies
to arrow-key and pointer moves (in a modal editor only to pointer moves), while
`on` also animates typing and deletion. Carets sit on whole pixels counted from
the line's text start and blink with VS Code's own timings (a hard 500 ms
blink; 0.5 s smooth/phase/expand for 20 half cycles), measured in the built-in
editor and VSCodeVim (`docs/vim-caret.md`).

The page's first HTML carries the note's first screen (`snapshot.ts`), so its
text is painted before the editor's script has loaded, as in Obsidian. The host
draws the first 80 lines or 8 KB of source that Live Preview draws as plain
lines, with Live Preview's own classes and the settled editor's three gutter
columns, as inert markup (escaped text; no scripts, handlers, addresses or
images), and ends before the first thing it cannot draw exactly: tables,
callouts, images, embeds, math, tags, footnotes, HTML, tasks, a Properties
sheet that is taller than its placeholder. The editor mounts beneath it
(`webview/snapshot.ts`); once every feature has loaded and a frame has painted
the snapshot is removed, which moves nothing (`test/browser/first-paint-snapshot.spec.ts`
compares every line). The host builds it before a vault's own settings are
known, so the snapshot carries a layout key (`snapshot-layout.ts`) and the
editor drops it at once when its own settings, a search match or a saved view
say the note will not look as drawn. `lumiere.markdown.editor.firstPaintSnapshot`
(default on) turns it off; Source mode, a centred page, right-to-left text, an
inline title and notes without the line-number, change-bar and fold gutters
never get one. VS Code shows a webview only once its page has fired `load`, and
a module script's import graph delays that, so a page with a snapshot loads
the editor by `import()` from a small inline script (`webview-html.ts`): the
snapshot is visible as soon as the page's stylesheet is, and host messages that
arrive before the editor's own listener are kept and replayed by
`webview/transport.ts`. Hosts that build their own page (host-node) do not draw
it yet.

## Files

- `selection.ts`: host-held frozen selection snapshots, source coordinates and stale validation.

- `manifest.ts`: core identity, indentation, the note's font size and the native font/caret configuration schema.
- `font.ts`: the note's font size schema and editor font settings to the note's CSS variables.
- `caret.ts`: pure mode/settings mapping to caret dimensions and CSS variables.
- `caret-settings.ts`: validated native cursor fields and manifest keys.
- `caret-view.ts`: persistent caret DOM, modal sources and their cleanup.
- `caret-geometry.ts`: character/glyph/font measurements relative to the scroller.
- `caret.css`: theme colours, cursor shapes, blinking and movement transitions.
- `caret.test.ts`: native and modal cursor mapping units.
- Browser and real-editor specs: `test/browser/vim-caret.spec.ts` (settings), `test/browser/vim-caret-geometry.spec.ts` (graphemes, ligatures, lifecycle), `test/browser/vim-caret-vscodevim.spec.ts` (VSCodeVim's pixel rules and timings), `test/vscode/vim-caret.spec.ts` and `test/vscode/vim-caret-vscodevim.spec.ts` (against the built-in caret).
- `api.ts`: editor, panel, menu, view-state and event contracts; the
  `backgroundUpdate` annotation, which marks a transaction that only publishes
  background work (Live Preview's finished parse) so persistence skips it.
- `protocol.ts`: schemas for handshake, selection, view state and clipboard RPC.
- `host.ts`: panel registry, editor service and active-context registrations.
- `panel.ts`: per-panel context, session connection and RPC lifetimes.
- `logging.ts`: webview log forwarding over RPC and its host-side receiver.
- `associations.ts`: **Use Lumiere for Markdown in This Workspace**.
- `toggle-text-editor.ts`: **Toggle Text Editor** (Ctrl/Cmd+E) between Lumiere
  and the host default text editor. Capture-phase Mod+E ownership (BH-003) lives
  in `commands/toggle-text-editor-keys.ts`.
- `webview-html.ts`: CSP, scripts and native webview HTML, with
  `<link rel="modulepreload">` hints for the chunks the first view needs
  (`PanelShell.preload`, from `host/feature-chunks.ts`).
- `snapshot.ts`, `snapshot-blocks.ts`, `snapshot-inline.ts`: the first-screen
  snapshot: the note's first lines as inert markup in the page's first HTML.
- `snapshot-layout.ts`: the presentation the snapshot assumes, as a key the
  webview compares with its own settings (`webview/snapshot.ts`).
- `snapshot.css`: its scroller and content, sized as the editor's are.
- `indentation.ts`: Tab and Shift+Tab commands (capture-phase for Vim NORMAL, BH-040).
- `literal-lines.ts`: whether the caret's line is code or frontmatter text, where
  the Markdown indentation rules do not apply; `literal-lines.test.ts` covers it.
- `find.ts`, `find-panel.ts`, `find-caret.ts`, `find-count.ts`, `find.css`: in-note find and replace.
- `find-keys.ts`: capture-phase Ctrl/Cmd+F Find and Ctrl/Cmd+H Replace (BH-023 / BH-025).
- `find-keys.test.ts`: Mod+F/H mapping and native-field skip.
- `select-all.ts`: stops VS Code's own Select All from undoing the
  editor's Ctrl/Cmd+A (VS Code forwards every webview keydown).
- `focus-report.ts`: reports the webview's focus for
  `lumiere.markdown.editorFocus`, which every note keybinding requires.
- `menu-context.ts`: gives the native context menu the selection as it is
  when the menu opens, so a macOS secondary click that selects a word shows
  the selection items.
- `webview.ts`: view creation and named service/settings/RPC registrations.
- `service.ts`: shared editor facade with caller-bound extension ownership.
- `extensions.ts`: deterministic ordered extension registry.
- `settings.ts`: CodeMirror editor settings, indentation and font presentation.
- `drag-scroll.ts`: configurable extra scroll motion for CodeMirror selection drags.
- `drag-scroll.test.ts`: speed/schema validation, settings reconfiguration, gesture cleanup, the zone ramp and leaving the webview past an edge.
- `clipboard.ts`: validated clipboard RPC client.
- `contributions.ts`: feature-owned view-state validation and restoration.
- `persistence.ts`: view capture, restore and ordinary edit/scroll persistence.
- `persistence.test.ts`: which updates save view state.
- `view-state.ts`: geometric scroll anchoring and presentation restoration; a restored line stays pinned until the reader scrolls anywhere in the scroller. `holdAtTop` pins a jump's target the same way.
- `view-state.test.ts`: the reader's scroll and input end the pin, the pin's own corrections do not, every listener is passive, and a held jump target stays below the top margin as content above it grows.
- `keep-below-still.ts`: when a rendered block across the top edge resizes, holds its bottom, so the text below stays still.
- `keep-below-still.test.ts`: which block is held, and by how much the view scrolls.
- `view-transfer.ts`: flushed, version-checked native view transfers.
- `extensions.test.ts`: ordering, owner tie-breaks and retained state units.
- `settings.test.ts`: indentation settings and compartment preservation units.
- `contributions.test.ts`: contribution capture, late restoration and validation.
- `clipboard.test.ts`: clipboard RPC lifecycle units.

## Services, events and settings

Host injects the host services `hostDocuments`, `hostCommands`, `clipboard`, `dialogs`, `settings`, `storage`, `customEditors`, `activeEditor` and `workspace` (a page loaded in Restricted Mode is loaded again when the workspace is trusted, so its remote images and frames are allowed: `registerTrustReload` in `panel.ts`), plus `documents`, provides `editors`, and emits/listens to
`editor/opened`, `editor/closed` and `editor/activeChanged`. Webview injects
`document`, `markdown` and `rpc`, provides `editor` and `menu`, listens to
`document/syncStatus` and `editor/scrollInput` (widget scroll input cancels a
pending saved-position restore), calls `editor/projectSelection`, and emits
`editor/clearProjection` and `editor/modeRestored`. Selection and focus changes notify the
host through the editor channel; the host keeps the
`lumiere.markdown.hasSelection` and `lumiere.markdown.editorFocus` context
keys for the active panel. Core settings include `editor.useTabs` (true),
`editor.tabSize` (4, integer 1–16), `editor.dragScrollSpeed` (4, number 1–10)
and `editor.autosave` (true; read by the document plugin), under
`lumiere.markdown`.

Each panel kernel logs through the window's logger, tagged with the panel ID,
to the **Lumiere** output channel. The webview forwards its logs over
the editor channel (`log`) at warn and above, and at debug too while
`lumiere.markdown.debug.logging` (default false) is on; the host re-checks that
setting before writing a forwarded debug line.

**Use Lumiere for Markdown in This Workspace** writes `*.md` and
`*.markdown` into the workspace's `workbench.editorAssociations`, keeping its
other entries. The editor is otherwise only an option for Markdown (DESIGN
§25.2), so it does not take over every README; this makes a workspace behave
like an Obsidian vault, where notes always open in the editor.

`editor.reclaimTextEditor` (`auto`/`on`/`off`, auto meaning on in Cursor
only) is read by the host (`src/host/reclaim.ts`): a note the workspace routes
here that a tool opens in a new text tab (a chat link, a review card), or that
switches into Cursor's own Markdown editor, is warmed and reopened in this
editor. In-place workbench→text (Claude `showTextDocument`) is opt-in via
`editor.reclaimInPlaceTextEditor` (boolean, default `false`); when on, and
reclaim is enabled, those opens — and other→text — are reclaimed too. Clean
text tabs are closed; dirty text tabs keep their native document and undo.
Explicit native choice (Open as Text, Toggle Text Editor, Reopen With…
when it sets bypass / readerText, Cursor Edit/Chat handoff) is kept there
until its last text tab closes; the kept notes are saved in workspace state,
so a reload keeps them too. With the in-place option on, a first Reopen With
Text without bypass may reclaim (Open as Text / Toggle remain the supported
stay-native paths).
**Toggle Text Editor** (Ctrl/Cmd+E) switches the active note between Lumiere
and the host's default text editor via `vscode.openWith` (`default` ↔
`lumiere.markdown.editor`). Opening as text sets the reclaim bypass, and the
text tab it opens is then kept as the reader's. After `openWith`, the previous
view's tab for the same URI is closed in the active group (clean tabs only),
so the toggle leaves one tab rather than Lumiere + Text Editor side by side
(BH-011 / BH-003). This is **not** Obsidian's Ctrl/Cmd+E (Live Preview ↔
Source); Source mode stays on the unbound **Toggle Live Preview/Source Mode**
command. Selection and caret are not restored across the switch
(`vscode.openWith` carries no range). In a text editor the key is bound only
where the toggle acts, a `.md` file's own editor: a diff editor, an untitled
buffer or a notebook cell keeps VS Code's Ctrl+E (Quick Open) and Cmd+E (Use
Selection for Find).

**Open as Text** keeps the text editor. A just-reclaimed note also
ignores repeated tab notifications for 10 s; an explicit native command jump
can still navigate to the next hunk during that interval.

Native text-to-custom transfers carry the selection's start into the exact
destination panel, using LF-normalized offsets for CRLF documents. The range
is also the editor's opening selection, so the first paint is already on the
match instead of the top of the note. Command
selection changes also handle reused text tabs. Late native activation captures
the initial selection even while `openWith` is in flight. Delivery waits for that panel's
link-navigation readiness and uses its existing focus, centered scroll and
caret path. A newer navigation or provider disposal cancels pending delivery;
Cursor Edit handoff leases and explicit text bypasses suppress the bridge.
A direct custom-editor open (the `*.md` association is Lumiere itself) has no text
tab to transfer from. VS Code 1.144 still calls `resolveCustomTextEditorNavigation`
for a Search result about 100 ms after `resolveCustomTextEditor`, and its
`revealRange` reaches the panel through the same reveal path (`navigation.revealPanel`,
then the links plugin's `navigate`), so the match is selected and scrolled to the
top of the viewport below the sticky headings, after the first paint.

`editor.warmTextDocument` (`auto`/`on`/`off`, auto meaning on in Cursor) opens
Markdown `TextDocument`s early: at activation for open notes, on document open,
on file create/change and for git-dirty notes (at most 256 per repository
state change; a newer change of that repository stops the older sweep). Every
extension-controlled `openWith` into this editor awaits another warm, even
when Cursor's built-in editor already holds the dirty document. The workaround targets Cursor's
custom-editor handoff assertion before `resolveCustomTextEditor` runs.

## Limits and differences from Obsidian

Ctrl/Cmd+E toggles Lumiere ↔ the host text editor, not Live Preview ↔ Source
(an intentional diverge from Obsidian for host integration). Caret and
selection are not preserved across that switch.

VS Code owns text, saving and undo. The core editor cannot be disabled. Feature
state belongs to its contributing plugin; inactive/unknown contribution keys
are retained. Legacy top-level `folded`/`folds` fields remain readable compatibility
inputs. Structured clipboard and HTML conversion are owned by their features.
The drag-scroll multiplier covers mouse text selection in the main note editor;
table selection/handles and property reordering retain their existing speed.
The speed curve follows CodeMirror 6's 6 px trigger zone and accelerates further
outside the viewport. CodeMirror
continues selecting at its normal timer cadence while extra scroll motion uses
animation frames. The extra motion ramps in over 250 ms in the zone, so
selecting on the last visible line does not move the note.

In VS Code the note is a webview, and once a drag leaves it the page receives
no events at all (no moves, no mouseup), so CodeMirror never saw the pointer
past the edge: a drag carried out of the note did not scroll. When the
pointer goes silent within 64 px of the top or bottom edge, heading for it
fast enough to have crossed it, the plugin sends CodeMirror a move 16 px past
that edge; CodeMirror's own timer then scrolls and extends the selection
until the pointer comes back.

Editor config owns default mode, readable line length (700 px), strict rendered
line breaks, right-to-left direction, tabs and tab size. Changing default mode
does not overwrite an existing pane's presentation. Static commands use the native
webview context section; contextual widgets retain their menu service.

Host actions contribute plain labels to Note Actions (title) and Selection Actions
(context/palette). Selection callbacks receive freshly captured host-held
snapshots. The owner is rechecked after flushing/capture; provider disposal removes
its entries and revokes retained service handles. There are no default shortcuts.

- `actions-api.ts`: title/selection action service contract.
- `actions-protocol.ts`: data-only action messages.
- `actions.ts`: owner registry and native action picker.
- `actions-host.ts`: caller-bound service, panel RPC and context keys.
- `actions-webview.ts`: contextual selection-menu contributions.

Host provides `editorActions`; webview listens to `editor/selectionMenu` and the
action-registry notifications. Callbacks remain in the extension host.

The note's keybindings need `lumiere.markdown.editorFocus`, which the
webview reports through the extension host: a key pressed within a few
milliseconds of focusing the note can still reach VS Code's own binding.

## Precise-jump navigation

**Go Back in Note** and **Go Forward in Note** keep up to 100 locations per
pane in extension-host memory. Links, headings, footnotes, explicit find-next/
previous and API reveals capture the departure selection and geometric scroll
anchor. Typing, scrolling, incremental search text and ordinary Vim movement do
not record. A new jump after Back discards the forward branch. Offsets rebase
through document edits, including delayed records and CRLF source conversion.
Replay is addressed to the same panel and random webview session, checks source
version and interaction generation, and advances only after layout acknowledgment.

- `navigation.ts`: explicit jump observers and nested-jump suppression.
- `jump-history.ts`: bounded source-location stack and edit mapping.
- `jump-protocol.ts`: validated capture, record and replay messages.
- `jump-host.ts`: per-panel ownership, command/context registration and replay.
- `jump-webview.ts`: geometric capture, queued-edit mapping and replay guard.
- `layout.ts`: bounded measured-layout acknowledgment.

The host listens to editor open/close/active and document-change events. There
are no settings or default keybindings for this history. Deliberate agent/API
jumps record by default. Webview recreation keeps the stack; pane close and
extension-host restart clear it. Repeated Back/Forward clicks while a restore is
pending are ignored. Unknown document replacements clear the stack rather than
restore stale offsets. Native cross-file history and Vim's jumplist remain
separate. A failed or interrupted restore does not advance the history cursor.
