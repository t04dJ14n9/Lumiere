# Capabilities

What Lumiere does, plugin by plugin, and where it differs from
Obsidian. Each plugin's README (`src/plugins/<id>/README.md`) has the
details. "Default" is the `obsidian` preset; the `minimal` preset loads only
the core plugins. No row here is an Obsidian parity claim until the owner
records it in `docs/PARITY.md`.

Three defaults deliberately differ from Obsidian 1.15.0's, which has readable
line length **on**, the inline title **on** and line numbers **off**. Here
readable line length is **off**, the inline title is **off** and line numbers
are **on** (owner decision, DESIGN §15.3), so a fresh profile shows text
filling the pane, no title above the note and a line-number gutter. They are
product choices for VS Code, not parity claims.

## Core (always on)

| Plugin | What it does | Differences and limits |
| --- | --- | --- |
| document | One text shared by every panel and VS Code's text editor; VS Code owns save, EOL and undo | Typing groups for undo like Obsidian; history is VS Code's |
| editor | Per-pane precise-jump Back/Forward (100 locations, in memory), geometric restoration, and the CodeMirror editor in a webview, view state per panel, settings for mode, readable line length (700 px; off by default, Obsidian 1.15.0's is on), strict line breaks, right-to-left, tabs; note text follows VS Code's `editor.font*`, `letterSpacing` and `lineHeight` for Markdown files | Panels of one note keep separate selections, scroll and folds. A selection dragged out of the note continues only past its top and bottom edges, at one speed, until the pointer returns (a webview gets no pointer events outside it). At the default `editor.lineHeight` (0) lines are as tall as in the built-in text editor (19px at 14px on Linux and Windows), not Obsidian's 1.5; headings keep Obsidian's sizes |
| dialect | Obsidian-flavoured Markdown: wikilinks, embeds, tags, highlights, comments, callouts, footnotes, math, block IDs | Grammar is fixed; plugins cannot change parsing |
| render | Sanitized HTML for rendered blocks | Scripts, forms, objects, embeds and `srcdoc` are removed; application links (`obsidian:`, `zotero:`) are kept and confirmed before opening |
| livePreview | Syntax hidden except where the selection is; rendered blocks crossed as one unit | No Reading view (DESIGN §25.8); comments stay visible, faint, as in Obsidian |
| commands | Obsidian editor command IDs, save/undo/redo/close, Open as Text | Commands act on the active panel |
| publicApi | Versioned extension API, plugin management, and **Open Copied Agent Reference** | Explicit `@path#lines`/full-URI navigation; native chat clicks and global cross-extension history are unchanged |
| vault | Index of every note: link resolution like Obsidian's, resolved and unresolved links, tags, aliases, headings, blocks | `.obsidian` marks a vault; without it the workspace folder is the vault. 50,000-note cap (other files capped apart); hidden folders, `node_modules` and, in VS Code, `files.exclude` skipped |
| resources | Contained file access for embeds and previews | Files outside the vault and escaping symlinks are refused |

## Features (on by default unless noted)

| Plugin | What it does | Differences and limits |
| --- | --- | --- |
| properties | The properties sheet: every type, chips, type menu, sort, drag, structured copy and paste | Type choices are stored per vault by this extension |
| inlineTitle | Off by default. The file name above the note; edit it to rename | Off so line 1 starts at the top, as in VS Code; a deliberate difference from Obsidian 1.15.0, which shows it by default. Only saved local files can be renamed |
| links | Click to follow, Mod-click in source, open to side, create missing notes, unresolved links dimmed | Wikilinks and Markdown links dimmed when unresolved, in Live Preview, source mode and inside embeds; Obsidian 1.15.0 dims Markdown links only inside embeds and in Reading view, not in Live Preview (code read) |
| embeds | Notes, sections, blocks, images (with an inspector), audio, video, PDFs | A PDF embed draws one page inline (`#page=`, `#height=`) with page buttons and an Open button for Lumiere PDF, not Obsidian's full PDF viewer; remote media needs a trusted workspace |
| onlineVideos | YouTube (watch, youtu.be, Shorts) and Bilibili (BV, av, `?p=`) links written as images show as cards with a button that opens the browser; in trusted workspaces the title, author, length and cover (Bilibili via its public API, YouTube via oEmbed, looked up by the extension host) | Not in Obsidian. No player by default: YouTube refuses to play in VS Code webviews (error 153) and Bilibili's player does not buffer there (`onlineVideos.bilibiliPlayer` brings back **Play here**); nothing is fetched in an untrusted workspace |
| pagePreview | Mod-hover preview of notes, headings, blocks and attachments | External links are not previewed |
| tables | Spreadsheet-style table editing, selection, TSV clipboard, row and column commands and dragging | — |
| callouts | All callout types, nesting, folding with per-panel memory | Colours follow the VS Code theme |
| math | MathJax inline and block math | `lumiere.markdown.math.macros` supplies user macros (name → replacement); empty by default |
| diagrams | Mermaid | Theme follows VS Code light or dark; HTML labels off |
| codeBlocks | Prism highlighting and a Copy button | Languages without a loaded grammar stay plain |
| footnotes | References as superscript numbers in LaTeX paper style (an intentional departure from Obsidian), kept under selections, faint source only at the caret, hover previews, click to the definition, inline footnotes, Insert Footnote | Definitions stay editable text led by their number; no Reading view footnotes section |
| tasks | Clickable checkboxes in notes, embeds and callouts; checklist commands | Any status but a space is checked, like Obsidian's default theme; `data-task` attributes let a snippet style custom statuses |
| tags | Tag rendering and search, Explorer **Tags** view | Search results are a quick pick, not a search pane |
| suggest | `[[`, `[[#`, `[[^` and `#` completions | At most 50 results |
| search | `query` blocks with Obsidian's search syntax | No Dataview |
| outline | Explorer **Markdown Outline** and **Go to Heading…** (Ctrl+Shift+O) | No drag to reorder sections; VS Code's native Outline and breadcrumbs apply to the plain text editor |
| backlinks | Explorer **Backlinks** with unlinked mentions and a status bar count | Off by default (owner decision) |
| outgoingLinks | Explorer **Outgoing Links** | Off by default; no unlinked mentions section |
| quickSwitcher | **Quick Switcher** over notes, aliases and unresolved links | No key binding (Mod+O is VS Code's Open File; see [Hotkeys](#hotkeys)); an empty query lists recently opened notes, then recently modified ones never opened here |
| wordCount | Words and characters in the status bar | Counting rules are this extension's reading of Obsidian's |
| linkUpdates | Updates links when notes or folders are renamed in VS Code | Asks first by default (`prompt`, matching Obsidian's `alwaysUpdateLinks: false`), with a persistent **Always Update** (saved for the renamed file's workspace folder); `always` rewrites without asking, `never` leaves links untouched; **Rename Heading…** updates links to a heading |
| folding | Heading and list folding, restored on reload | — |
| lineNumbers | Line numbers laid out like VS Code's gutter, following `editor.lineNumbers`; rendered blocks list all their source lines' numbers | On by default, a deliberate difference from Obsidian 1.15.0, where they are off |
| gitGutter | Git change bars (added, modified, deleted) beside the line numbers against HEAD or the index, through VS Code's git extension; click a bar for a rendered peek with Revert and Stage File; Alt+F5 / Shift+Alt+F5 move between changes | On by default |
| gitBlame | Quiet dim EOL authorship on the caret line in Live Preview (no wrap; hover shows full commit message), against the exact editor snapshot; You for matching Git identity | Off by default; works without change bars; uncommitted/unavailable lines hide |
| gitInline | Inline track changes over the git change bars' hunks: removed words struck through, added words tinted, a rendered ghost of changed tables, code and frontmatter, removed blocks with Restore; needs gitGutter | Off by default; Toggle Inline Git Changes |
| gitDiffEditor | A side-by-side diff of two versions of a note, both rendered: blocks aligned, changed words and lines marked, read-only left side; Open Rendered Git Diff, or replaces Source Control's Markdown text diffs when diffEditor is rendered | On; diffEditor setting (native by default) |
| indentGuides | Indentation guides | No active-guide highlight |
| stickyScroll | Pins ancestor headings while scrolling in Live Preview and Source; click to navigate | On by default; document-level headings only; up to five compact rows by default, limited to one third of the pane height |
| spellcheck | The host's spellchecker | Languages and dictionaries are the host's (VS Code's Chromium spellchecker; on macOS the system's); no language setting, unlike Obsidian 1.15.0's per-device Spellcheck languages (DESIGN §15.3) |
| autoPair | Brackets, quotes and Markdown markers | — |
| smartLists | List continuation and exit | — |
| formatting | Bold, italics, strikethrough, highlight, code, comment, link, headings, lists, quote, line swaps | Obsidian 1.15.0's default keys where VS Code and Cursor leave them free; see [Hotkeys](#hotkeys) |
| vim | Vim mode with `:w`, `:q`, `:u`, `:red` mapped to VS Code | Off by default |
| pasteHtml | Rich paste as Markdown | Images are not downloaded |
| agentBridge | **Copy link to this** copies `@path#lines` and the quoted passage, opening a chat only when the editor's own chat is the only agent or a target is set | Not an Obsidian feature. The separate Copy for Agent command was removed (plain Ctrl+C copies text). No public API |
| lookUp | macOS: **Look Up** in a note's right-click menu opens the word right-clicked (or the selected word) in the Dictionary app | macOS, VS Code and Cursor only; opens the Dictionary app, not the popover; not in the palette |
| bridge | **Copy Bridge Envelope** copies a versioned JSON selection. The hidden `bridge.envelope` command returns the same object. Agent PDF Viewer is called only when `vscodeEmbedPdf.bridge.envelope` is registered | Does not open a chat. See `docs/bridge-envelope.md` |
| attachments | Drop, paste, or HTML-paste images into `files.attachmentFolder` with Obsidian-style timestamp names and embeds | Shares folder/embed rules with sketches. Import Asset / `assets.path` removed |
| scratch | **New Scratch Note** writes a temporary note in `scratch.folder` | No automatic filing |
| templates | **Insert Template** inserts a note from `templates.folder` at the caret, expanding `{{title}}`, `{{date}}`, `{{time}}` and `{{date:FORMAT}}` | Formats know `YYYY MM DD HH mm ss` only; Lumiere's editor only |
| marp | Detects `marp: true` and bridges to VS Code preview and Marp export | Slide widgets and Marp themes are not drawn here |
| markers | Badges and actions that other extensions place on source ranges | Plain text only; at most 1,000 per plugin per editor |
| graph | **Open Vault Graph**: a vault's notes as a directed graph in a panel, global or local, filtered by type, tag, folder, text and orphans | Hard caps (2000 notes, 20000 links); a larger graph is refused, not sampled; no 3D view |
| settings | Open Settings, Change Setting… (any contributed setting, edited by type), and commands to set the note font size and toggle line numbers, readable line width, Mermaid, inline title and Vim | Same keys as the Settings UI, no state of its own. Obsidian 1.15.0 has commands only for line numbers, readable line length, spellcheck, the font size and opening Settings; the others are Lumiere's |

## Hotkeys

Obsidian 1.15.0's default editor hotkeys (read from its shipped code; DESIGN
§14) are bound where neither VS Code nor Cursor has a default on the key while
a note has focus (owner decision, 2026-11-21). Each is scoped to the focused
Lumiere editor (`activeCustomEditorId == 'lumiere.markdown.editor'` and
`lumiere.markdown.editorFocus`), so it never shadows a key elsewhere in the
window. Mod is Ctrl on Windows and Linux, Cmd on macOS.

| Key | Command |
| --- | --- |
| Mod+B, Mod+I | Toggle Bold, Toggle Italics |
| Mod+K | Insert Link (not in Cursor) |
| Mod+/ | Toggle Comment |
| Mod+L | Toggle Checklist Status (not in Cursor) |
| Mod+; | Add File Property |
| Mod+Alt+Enter | Open Link to Side |
| Mod+F; Mod+H, or Mod+Alt+F on macOS | Find; Replace (the editor's own keys) |

Left unbound, because the key already does something here:

| Key | Obsidian 1.15.0 | Here instead |
| --- | --- | --- |
| Mod+D | Delete paragraph | VS Code's Add Selection to Next Find Match, which the note does too |
| Mod+E | Toggle Reading view | Lumiere's Toggle Text Editor (there is no Reading view) |
| Mod+O | Open quick switcher | VS Code's (and Cursor's) Open File |
| Alt+Enter | Follow link under cursor | Page Preview of the link at the caret (Lumiere's own key; VS Code has none) |
| Mod+Enter | Open link under cursor in new tab | The note follows the link in place, as a Mod-click does (VS Code has none) |
| Mod+K in Cursor | Insert link | Cursor's inline edit, through the Cursor bridge |
| Mod+L in Cursor | Toggle checkbox status | Cursor's chat, through the Cursor bridge |

Mod+Alt+Shift+Enter (open link in a new window) has no Lumiere command.
Follow Link, Open Link in New Tab, Delete Paragraph and the Quick Switcher are
in the command palette and can be given keys in VS Code's Keyboard Shortcuts.
Mod+Alt+0…6 (Set Heading) and Mod+Alt+Up/Down (more carets) are Lumiere's
own; Obsidian binds no key to those commands.

## Lumiere

- **Manage Plugins**, **Show Plugin Status** and **Use Lumiere
  for Markdown in This Workspace**.
- A **Lumiere** log output channel;
  `lumiere.markdown.debug.logging` adds debug lines from host and webview.
- Untrusted workspaces: no remote images, media or frames, and no external
  code block processors.

## API

API v1 (see [API.md](API.md)): editors, selections, agent references,
vault metadata and backlinks, the plugin catalog and states, and external
plugins with markers, actions, link handlers and code block processors.
Webview-side plugins from other extensions are not in v1.

## Not implemented

- Reading view, canvas, bookmarks, publish and sync.
- Obsidian community plugins and themes. CSS snippets are supported: those
  `.obsidian/appearance.json` enables load from `.obsidian/snippets/`.
- Performance measurement against DESIGN §20.
