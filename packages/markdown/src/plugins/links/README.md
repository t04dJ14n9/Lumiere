# Links

Renders and follows wikilinks and Markdown links, with local heading/block
navigation and side opens, like Obsidian's internal links. Wikilinks to notes
that do not exist yet are dimmed with a dotted underline. Links to PDFs
(`[[paper.pdf#page=3]]`, `[text](paper.pdf#page=3&viewrect=…)`) open in PDF
Lumiere at that page and box, through its Open Location command. As in
Obsidian 1.15.0, Alt+Enter follows the link at the caret, Mod+Enter opens it
in a new tab and Mod+Alt+Enter to the side; Mod-click and a middle click open
a new tab, Mod+Alt-click the side.

## How it works

The webview decorates wikilinks, distinguishes source clicks from rendered clicks
and selection gestures, and routes commands through a shared opener. Local
fragments navigate with metadata; other requests cross a validated RPC channel.
The host authorizes embedded source identities, offers links to host plugins,
then applies scheme policy or resolves through the vault/native adapter.
Native opening binds a panel ID before waiting for the links plugin, which
registers each editor's reveal: every jump into a note (links, Outline rows,
Go to Heading, Backlinks) goes through it, and with Links off for a note those
jumps open the note without moving in it (Outline says so). Each
webview registers a fresh session; requests are acknowledged after layout and
cancelled on newer navigation, reload or disposal. No URI-keyed pending reveal
survives successful delivery. Missing fragments show a message without moving
the caret or treating the existing note as missing.

The window half also supplies exact href ranges for precise local inline links
in VS Code's built-in Markdown editor. A signed source/version ticket checks the
clicked text, workspace containment and source group before native `openWith`.
The normal document-link provider takes precedence over overlapping built-in
links. VS Code's separate definition gesture may open the same target first;
that matching transition is allowed while unrelated departures, source edits and
caret movement away from the href cancel delivery. Native cross-file Back keeps
the source location; the destination's precise-jump history remains per pane.

For unresolved styling the host reads the note's `unresolvedLinks` from the
vault index. The webview asks for that set once when it starts, and the host
sends it again whenever the vault re-resolves links and the set has changed,
for example after the target note is created or the user types a new link.
The webview keeps the set in a CodeMirror state field, and the wikilink
renderer adds `is-unresolved` to rendered links whose path is in it.

## Files

- `suggestions.ts`: plugin-owned completion trigger through `suggest/trigger`,
  reading the text typed after `[[` with `src/markdown/link-trigger.ts`, which
  Suggestions' native text editor half reads too.

- `native-host.ts`: window-scoped native link registration through the host services `dialogs`, `settings` and `navigation`.
- `manifest.ts`: link settings and insert/follow/side command contributions.
- `api.ts`: typed link claim events.
- `protocol.ts`: session readiness, acknowledged navigation, missing-fragment,
  open and unresolved-link schemas.
- `target.ts`: scheme detection, link path/fragment parsing and unresolved keys.
- `navigation-host.ts`: per-panel readiness, session identity and cancellation.
- `host.ts`: unresolved sets, source authorization and
  default opening policy.
- `caret-link.ts`: the link or reference link at a caret, and the focus guard of the caret keys.
- `follow-caret.ts`: Follow Link, Open Link in New Tab and Open Link to Side,
  their keys in the editor's keymap, and the `links` service cells use.
- `clicks.ts`: where a click on a rendered link opens.
- `webview.ts`: decoration (including unresolved styling), click
  handling, navigation and Insert Wikilink.
- `navigate.ts`: webview fragment navigation (top-of-viewport jump).
- `scroll-to-top.ts`: fragment / outline / Search-match jumps use `y: "start"`
  and hold the target there (`EditorService.holdAtTop`) while the layout
  settles, with the sticky chrome height as the margin once a parent pin is
  present. The sticky bar can draw after the jump (its feature loads late) or
  change height; the margin follows it for about a second and a half, a few
  times at most, until the reader scrolls.
- `links.test.ts`: target parsing, caret lookup and reference-link units.
- `host.test.ts`: source identity, scheme policy, side opens and handler lifecycle.
- `test/unit/links/unresolved.test.ts`: unresolved keys, styled decorations and
  the host's set updates.
- `links.css`: the plugin's styles, bundled through `src/webview/styles/index.css`.
- `test/unit/links/flash-css.test.ts`: the target flash paints a colour Lumiere defines.

## Services, events and settings

Listens to `suggest/trigger` for its own completion syntax.

Webview injects `editor`, `livePreview`, `commands` and `rpc`; host injects `rpc`,
the host services `dialogs`, `settings` and `navigation`, `vault` and `resources`. Webview provides `links` for focused-editor
caret following; host provides no service. Queries `link/click`,
`links/open` and `links/followToken` with bail semantics: when Follow Link,
Open Link in New Tab or Open Link to Side finds no link at the caret,
another plugin may follow its token there (Tags searches a tag). Settings: plugin enabled (true),
`links.newLinkFormat` (shortest), `links.useWikilinks` (true), `links.folderNote`
(empty), `links.focusNewTab` (true), and native `files.newNoteFolder` for creation. The editor binds Alt+Enter, Mod+Enter and Mod+Alt+Enter, Obsidian's defaults, which are VS Code keybindings too.

## Limits and differences from Obsidian

The native adapter rechecks containment and symlinks before opening or creating.
External application schemes ask first; script, data, command and file schemes
are refused. Unresolved wikilinks can create notes. Basename Markdown destinations
(`Note`, `Note.md`) create too; relative Markdown paths stay open-only. Unresolved styling applies to wikilinks and Markdown links in Live Preview
while they are rendered, to wiki / Markdown / embed link source in source
mode, and to both kinds of link inside embedded notes. Obsidian 1.15.0 dims
only wikilinks in Live Preview (its embeds and Reading view dim both), so
the dimmed Markdown links in Live Preview are Lumiere's own. A link typed just
now is dimmed optimistically when its last segment names no file in the vault
(a note's basename or alias, or another file's name with its extension;
excluded files count, since links to them resolve); the open-note overlay
re-index still refreshes the authoritative unresolved set shortly after. In a
vault with more than 150,000 such names the optimistic dimming is off. Host
claim handlers may override default opening.

File-location fields are validated by this plugin's schema and exposed as
`files.newNoteFolder` and `files.attachmentFolder`. The native note-creation
pipeline consumes the former; the Attachments plugin saves dropped/pasted images using the latter.
`useWikilinks` controls suggestion acceptance; explicit Insert Wikilink retains
wiki syntax. New-link format still controls vault link text.

`links.focusNewTab` is Obsidian's Always focus new tabs. Off, a link opened in
a new tab (Open Link in New Tab) or beside (Open Link to Side) is shown with
VS Code's `preserveFocus`, and a heading or block it names is scrolled to
without moving the focus either. The tab is not opened in the background (a
heading it names needs its page to exist), so it still becomes the visible one
in its group, unlike Obsidian, where the old tab stays in front; a PDF always takes the focus
(Lumiere PDF's Open Location command has no such option), and hosts with no tabs
of their own ignore the setting.

A reused side-open destination must be unambiguous among same-note panes;
otherwise navigation fails clearly rather than choosing another pane. Ordinary
local jumps also participate in the editor's per-pane precise-jump history.

Native integration currently covers inline `.md`/`.markdown` links with heading
or block fragments in local workspace Markdown files. Reference-style links,
remote files, external links and native line/column fragments keep the built-in
route. Command links do not receive VS Code's side-open modifier context; this
route uses the source group. A manual switch to the exact expected target cannot
be distinguished from the built-in definition gesture through the public API.

Follow Link, Open Link in New Tab and Open Link to Side follow what
Obsidian 1.15.0's commands do: a link, a full or collapsed reference link
(`[text][label]`, `[text][]`) through the note's definition of the label,
matched as CommonMark matches labels, or a tag, which searches for it. A
shortcut reference (`[label]`) is not followed, as in Obsidian. Obsidian
opens a reference link's destination only when it has a scheme (a web or
`mailto:` link) and names labels as written; here a destination naming a
note opens it, as `[text](note)` does. Their keys below follow the same.

Alt+Enter (Follow Link), Mod+Enter (Open Link in New Tab) and Mod+Alt+Enter
(Open Link to Side) are Obsidian 1.15.0's default keys, bound since the
owner's decision of 2026-11-21 (before it Alt+Enter was Page Preview's key
and Mod+Enter followed in place). They are in the editor's own keymap, which
stops the event so VS Code does not run its binding a second time, and are
VS Code keybindings scoped to the focused note. They follow what the
commands follow, through the same navigation and trust checks as a click,
but only for a collapsed caret in the editor that has the focus: property
inputs, dialogs, the Vim prompt and text with nothing to follow keep the key.
The injected `links.follow(view, place)` service lets table cell editors
bind the same keys on their own text and caret. Each editor keeps its
contentDOM focus guard; focusing a cell never follows a link at the outer
editor's caret. The commands VS Code runs for the keys do nothing while the
focus is in such a field, since the key was the field's; from the Command
Palette they act on the caret where it was.

In VS Code a new tab is a tab of its own in the same group, one VS Code keeps
rather than a preview the next link replaces; the note stays open. A link
to a heading or block of the same note moves in place whatever the key,
except to the side, because VS Code shows a note once in a group (Obsidian
opens the note again in the new tab). Outside VS Code (the app and DSH,
through host-node) every followed link opens its file in a tab of its own
there, or shows the tab it is already in, whichever key or click opened it:
those tabs neither replace a note in place nor split.

Clicks follow Obsidian 1.15.0's Live Preview (`Keymap.isModEvent`) except for
a plain click: Mod-click opens a new tab, Mod+Alt-click the side and a middle
click a new tab; Obsidian's Mod+Alt+Shift-click (a new window) opens the side
here. A plain click on a rendered link reveals its source and places the
caret (BH-020, owner decision), where Obsidian follows the link; a plain
click on a link rendered as HTML (in a table cell, callout or embed) follows
it here. Alt-click places one caret to edit the link, Shift-click extends
the selection.
