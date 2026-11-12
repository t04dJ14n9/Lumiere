# Lumiere PDF

[![CI](https://github.com/t04dJ14n9/vscode-embedPDF/actions/workflows/ci.yml/badge.svg)](https://github.com/t04dJ14n9/vscode-embedPDF/actions/workflows/ci.yml)

A Lumiere PDF viewer for VS Code and Cursor, built on [EmbedPDF](https://www.embedpdf.com/)
3 and its PDFium engine. Select text and choose **Copy link to this**: the
clipboard gets a Quote with a Chrome-aligned deep link (`#page=` +
`#:~:text=`), ready to paste into any note. Opening the PDF paints
**backlink overlays** from those vault Markdown links. Annotate tools
(Highlight, Note, freeText, …) never change the PDF: their marks are kept in
the workspace's `.lumiere/pdf-annotations/`. Region / box selection
is opt-in (`lumiere.pdf.regions.enabled`, default off).

## Features

- **Viewer.** Single pages or two-page spreads (1–2, 3–4, or a cover alone
  followed by 2–3, 4–5), continuous or page-by-page scrolling, vertical and
  horizontal reading, page and zoom controls, fit width, fit page and actual size (100%),
  Ctrl/⌘+wheel and pinch zoom around the pointer (a wheel notch zooms by 1.2),
  find in PDF (⌘F / Ctrl+F), internal links and web links.
  When the file changes on disk (a rebuilt paper), the viewer reloads at the
  same page and zoom.
- **View controls.** A View picker in the editor title/status bar, and a
  compact **View** menu in the slim toolbar of the web and iPad hosts, selects zoom, layout,
  scrolling mode and direction. Saved choices and reading position return
  when a PDF reopens. Next/previous moves by spreads in two-page layouts;
  go to page opens its containing spread, and fit modes measure the whole spread.
  Smooth scrolling follows `editor.smoothScrolling`,
  with a PDF setting to override it, and respects reduced motion. See
  [View controls](docs/view-controls.md) for settings, commands and native
  EmbedPDF support.
- **Controls in VS Code's own UI.** By default the viewer has no toolbar of
  its own: find, zoom, fit and the selection tool are buttons in the editor
  title bar, and the page, zoom and **View** are in the status bar. Click **Page 4 / 15**
  to go to a page, or the zoom to pick one (or type one, such as `140`). See
  [Toolbar and shortcuts](#toolbar-and-shortcuts) for the other layouts.
- **Select Region tool (opt-in).** Off by default. Turn on
  `lumiere.pdf.regions.enabled` to draw a region even over text (a paragraph
  with its equation, a table with its caption); Escape puts the tool down.
  When off, empty-page drag pans the view in continuous scrolling. In
  page-by-page scrolling, a mouse or pen blank-page drag that travels 60 CSS
  pixels of the viewer (Stage viewport / EmbedPDF screen px, not PDF points;
  the same at every zoom) turns the page. Touch keeps the Stage's native
  one-finger pan, fling, double-tap and pinch: this handler does not claim
  touch contacts. A drag over text or a page whose text geometry is not ready
  stays with text selection or Stage pan. Device touch is not GUI-verified
  here. Select Region is hidden.
- **Passage highlights = vault Markdown.** **Copy link to this** copies a
  Quote with `#page=N#:~:text=…` (or a page-only `#page=N` link with nothing
  selected). Paste into any note; the viewer paints **backlink overlays**
  from those links (hover preview, click opens the note; Del ignores
  overlays). See [CAPABILITIES.md](CAPABILITIES.md).
- **Annotations never change the PDF.** Annotate **Highlight** / Note /
  freeText / underline / ink are kept in
  `.lumiere/pdf-annotations/<sha256>.json` in the PDF's workspace folder
  (`~/.lumiere/…` for a PDF outside every folder), named by the PDF's
  SHA-256. `lumiere.pdf.annotations.folder` puts them elsewhere: another
  workspace-relative folder, `~/…`, or an absolute path. The PDF's bytes, and so the hash a vault records for an immutable
  source, stay as they are. The same PDF anywhere (in `inbox/`, then
  captured into `.raw/`) shows the same annotations, and a renamed or moved
  copy keeps them. Del deletes them. The file is Lumiere's own format
  (`{"version": 2, "bundle": …}`, EmbedPDF 3's annotation transfer); files
  from earlier versions are converted when read and saved in the new format on
  the next change, after which earlier versions cannot read them.
  - **PDF: Save Annotations into This PDF** writes them into the file after
    you confirm (its SHA-256 changes). It refuses PDFs in
    `lumiere.pdf.annotations.protectedFolders` (default `[".raw"]`).
  - **PDF: Export Annotated Copy…** writes a new PDF with them, for sharing.
  - Annotations a PDF already holds show as usual; a change to one is kept
    only by saving into the PDF, and Lumiere says so the first time.
- **PDF Outline in the Explorer.** The PDF's bookmarks appear as a native
  tree view; click an entry to open its page. The title bar offers **Expand All**
  and **Collapse All**. **Follow Cursor** (on by default; toggle it in the **…**
  menu) selects the bookmark for the current page and reading position as you
  scroll, without moving focus, like a page's table of contents: that
  bookmark's parents and its own sub-bookmarks are open and every other
  branch is closed. A click on a bookmark leaves the tree as it is, so a
  double-click's second click hits the same row. This choice is saved as
  `lumiere.pdf.outline.followCursor`.
  Opening a Lumiere PDF editor hides VS Code's native **Outline** and shows
  **PDF Outline**; leaving restores the native Outline after a short debounce,
  skipped if Lumiere already owns the active tab.
- **Section links from notes.** In a Markdown note in Lumiere, typing
  `[[paper.pdf#` lists the PDF's bookmarks; typing more filters them, and
  picking one inserts `[[paper.pdf#page=5|Methods]]` (or
  `[Methods](paper.pdf#page=5)` with wikilinks off). The extension reads the
  bookmarks with its own PDFium, started on the first request, from PDFs up to
  200 MB, and rereads a PDF only when it changes.
- **Copy link to this.** Right-click the PDF (or run **PDF: Copy link to
  this**). With text selected, the clipboard gets a Quote:

  ```markdown
  > selected text
  >
  > [paper.pdf · p.3](papers/paper.pdf#page=3#:~:text=…)
  ```

  With nothing selected, it copies a page-only link for the reading page:
  `[paper.pdf · p.N](papers/paper.pdf#page=N)`. Clipboard only — it does
  **not** open agent chat. ⌘C / Ctrl+C still copies plain selected text.
  `lumiere.pdf.copyLinkForAgent.target` is legacy for IDE Context / MCP
  delivery only. Region `viewrect=` links appear only when
  `lumiere.pdf.regions.enabled` is on. Contract:
  `packages/agents/docs/agent-handoff-format.md`.

- **Open Location.** **PDF: Open Location…** takes a link an agent printed and
  opens that page with the box highlighted.

## Toolbar and shortcuts

![The viewer with its controls in the editor title bar and the status bar](docs/images/toolbar-chrome-dark.png)

`lumiere.pdf.toolbar.mode` is `chrome` (status bar) or `none`. **PDF: Choose
Toolbar Location…** (also in the editor's **…** menu) switches it, and every
open PDF follows at once.

| Mode               | Controls                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chrome` (default) | Editor title buttons (find, zoom out and in, fit page or width, Select Text, View; Select Region when regions are enabled) and status bar entries for the page, zoom and View. Click them to open Go to Page, the zoom picker or view choices. |
| `none`             | No controls: keyboard shortcuts, the right-click menu, the **…** menu and the command palette.                                                                                                                         |

![The zoom picker, opened from the status bar](docs/images/toolbar-zoom-picker.png)

Every action is also a **PDF:** command with a shortcut, active while a PDF
editor has focus (not in a text field, the side bar or the panel):

| Action                 | Windows / Linux           | macOS               |
| ---------------------- | ------------------------- | ------------------- |
| Previous / next page   | Alt+PageUp / Alt+PageDown | ⌥PageUp / ⌥PageDown |
| Previous / next page, keeping the zoom and the place in the page | ←/→, and Ctrl+Alt+↑/↓ | ←/→, and ⌥↑/↓ |
| Go to page…            | Ctrl+G                    | ⌃G                  |
| Zoom in / out          | Ctrl+= / Ctrl+-           | ⌘= / ⌘-             |
| Pick a zoom…           | click the status bar zoom |                     |
| Fit width              | Ctrl+0                    | ⌘0                  |
| Fit page               | Ctrl+Alt+0                | ⌥⌘0                 |
| Find in PDF            | Ctrl+F                    | ⌘F                  |
| Go to outline item…    | Ctrl+Shift+O              | ⌘⇧O                 |
| Toggle the PDF Outline | Ctrl+Alt+O                | ⌃⌘O                 |
| Select Text tool       | Ctrl+Alt+T                | ⌃⌘T                 |
| Select Region tool (when regions enabled) | Ctrl+Alt+R                | ⌃⌘R                 |

⌥Arrow on macOS is what Preview does to turn pages keeping the zoom (confirmed by the user, not by Apple documentation). Plain Alt+←/→ stay VS Code's Go Back / Forward, which is why Windows and Linux use Ctrl+Alt+Arrow.

By default (`lumiere.pdf.view.arrowsKeepPlace`) plain ←/→ turn the page keeping the zoom and the place in it, and ⌥←/→ (Ctrl+Alt+←/→ on Windows and Linux) take the arrows' other meaning: pan a zoomed page and turn it at its edge, to the top of the next page. Turn the setting off to swap them back. ↑/↓ always pan, and ⌥↑/↓ always keep the place.

While a PDF has focus, these take over the editor-wide meanings of the same
keys (Ctrl+G is Go to Line elsewhere, Ctrl+0 focuses the side bar, Ctrl+= zooms
the window). Set `lumiere.pdf.keyboardShortcuts` to `false` to leave every key
to VS Code (the **PDF:** commands remain, unbound, for **Keyboard Shortcuts**).
Some desktops keep Ctrl+Alt+T for opening a terminal; rebind it there if so.

**In Cursor**, the editor title bar keeps extension buttons in its **…**
menu, so the viewer leaves its title buttons out (the menu lists every
action, grouped) and the status bar also shows previous and next page, zoom
out and in, and find buttons. `lumiere.pdf.toolbar.statusBarButtons`
(`auto`, `always`, `never`) changes that, in either editor.

![Cursor: page, zoom and find in the status bar](docs/images/toolbar-cursor.png)

## Settings

**PDF: Open Settings** opens the Settings editor on this extension; **PDF: Change Setting…** lists every setting and edits it by type; there are also toggles for smooth scrolling and keyboard shortcuts. See [docs/settings.md](docs/settings.md).

## Zen mode

**PDF: Enter Zen Mode** (`Ctrl+Alt+Z`, `Ctrl+Cmd+Z` on macOS) is VS Code's Zen Mode for the PDF. The status bar is hidden while it lasts, so the PDF controls are the keyboard shortcuts and the command palette; the same key, **PDF: Exit Zen Mode** or Escape Escape leaves it. See [docs/zen.md](docs/zen.md); not tried in Cursor.

## macOS Look Up

On macOS, press hard on a word (or tap it with three fingers) for the system's
Dictionary popover, as in Preview, or right-click a word and choose **Look Up**
to open it in the Dictionary app. Turn it off with
`lumiere.pdf.lookUp.enabled`. See [docs/look-up.md](docs/look-up.md) for how the
viewer gives the system a word to find, and what needs a Mac to verify.

## What Copy link puts on the clipboard

```markdown
> Scaled dot-product attention
>
> [attention.pdf · p.3](papers/attention.pdf#page=3#:~:text=Scaled%20dot%2Dproduct%20attention)
```

With no selection:

```markdown
[attention.pdf · p.3](papers/attention.pdf#page=3)
```

A path with spaces or parentheses is percent-encoded
(`papers/my%20paper%20%28v2%29.pdf`) so the link stays one Markdown link, and
the quote's `(`, `)`, `-`, `,` and `&` are encoded too.

Backlink overlays read a note's link path the way the Markdown editor opens
it: `./`, `../` and a bare name from the note's folder, a leading `/` from the
workspace folder's root, and any other foldered path (`papers/a.pdf`) from that
root, or from the note's folder when the root has no such file. In a
multi-root workspace a note's links reach only PDFs in its own workspace
folder.

Paste into any note; **PDF: Open Location…** and clicking a Markdown link
open that page (and resolve `#:~:text=` to an overlay when possible). Legacy
`#page=N&viewrect=…` links still open best-effort.

When **regions are enabled**, a region Copy link may include RFC 8118
`viewrect=left,top,width,height` (PDF points from the page's top-left). MCP
`get_current_pdf_selection` can still attach a region PNG snapshot from
extension storage (`workspaceStorage/…/regions`); Copy link itself does not
put the image path on the clipboard. See
`packages/agents/docs/agent-handoff-format.md`.

## Agent bridge (MCP, experimental, off by default)

Instead of pasting, an agent can ask the viewer for what you have selected.
Turn on `lumiere.pdf.agentBridge.enabled` (or run **PDF: Copy MCP Setup
for Claude Code / Codex…**, which offers to) and the extension starts a local
[MCP](https://modelcontextprotocol.io/) server with these tools:

| Tool                         | What it does                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_current_pdf_selection`  | The text or region selected in the PDF you last looked at: the same text Copy link to this copies, and for a region its PNG snapshot.                                         |
| `open_pdf_location`          | Opens a `path#page=N&viewrect=…` link in the viewer.                                                                                                                            |
| `get_current_note_selection` | The selection in Lumiere (the same extension), as `@path#lines` and the quoted text (the same text as its Copy link to this; see `packages/agents/docs/agent-handoff-format.md`). |

The server is off by default because it opens a port. When on, it listens on
`127.0.0.1` only, on a random port, requires a random bearer token, and
refuses requests that carry a browser `Origin`. Turning the setting off stops
it at once; no reload is needed.

- **VS Code** (chat agent mode) and **Cursor** find it by themselves.
- **Claude Code** and **Codex** connect through a small stdio shim: **PDF: Copy
  MCP Setup for Claude Code / Codex…** copies the `claude mcp add …` or
  `codex mcp add …` command (or a config snippet) to run once; on Windows each
  command comes in a PowerShell and a cmd form, and the cmd form is left out
  when the shim's path contains `%`, which cmd would expand. The shim picks
  the window whose workspace contains the agent's folder (the most specific
  one when workspaces nest), from the files each running bridge writes to
  `~/.agent-pdf-viewer/bridges/`. If no window matches, or two match
  equally, it refuses rather than guess; set `AGENT_PDF_BRIDGE_PID` (shown
  in the extension's log) to name the window.

This is a prototype: the Cursor registration uses an undocumented API, and
only the on/off switch has an end-to-end test.

## Selection envelope

Other extensions can ask for the current PDF selection as data, without the
clipboard. `vscodeEmbedPdf.bridge.envelope` returns a Workbench v1 envelope
(`producer` `"pdf"`) for the PDF you last looked at: the same shape Markdown
Workshop's `parseBridgeEnvelope` already consumes (`capturedAt`,
`source.identity` / `kind` / `media`, `locator`, `view`, `selection`,
`revision`). Lumiere is the aggregator and may call this command;
this command does not call Workshop back. Copy link to this still copies
the same source-link text. See [docs/bridge-envelope.md](docs/bridge-envelope.md).

## Opening a location from another extension

```ts
await vscode.commands.executeCommand(
  "lumiere.pdf.openLocation",
  vscode.Uri.file("/path/to/paper.pdf"),
  { page: 3, viewRect: { left: 72, top: 83, width: 134, height: 21 } },
);
```

The command also accepts a link string such as
`papers/paper.pdf#page=3&viewrect=72,83,134,21`.

## With LLM Wiki installed

LLM Wiki for VS Code ships its own PDF viewer for now. Both register as the
default editor for `*.pdf`, so VS Code asks which one to use; pick one with
**Reopen Editor With…** or the `workbench.editorAssociations` setting.

## How it is built

```text
src/
├── shared/      used on both sides; no DOM, no VS Code, no Node
│   ├── messages.ts       every message between extension and viewer, validated
│   ├── selection.ts      text and region selections
│   ├── pdf-location.ts   page + viewrect links (RFC 8118)
│   ├── agent-text.ts     the text Copy link to this hands over
│   ├── agent-target.ts   which agent chat Copy link to this opens
│   ├── note-reference.ts the @note#lines text the agent bridge returns
│   │                     (shared format: packages/agents/docs/agent-handoff-format.md)
│   ├── region-text.ts    the text inside a region, line by line
│   ├── outline-sections.ts  a PDF's bookmarks as a flat list of pages and titles
│   ├── zoom-steps.ts     the zoom levels the buttons and keys step through
│   ├── view-state.ts     page and zoom reported by the viewer; view actions
│   ├── toolbar-settings.ts  toolbar modes; old floating-bar values still parse
│   └── geometry.ts       page rectangles
├── bridge-stdio/  the stdio shim Claude Code and Codex run to reach the bridge
├── extension/   the VS Code side
│   ├── extension.ts            activation: builds the plugin runtime, nothing else
│   ├── outlines/               the bookmarks of PDFs, for `[[paper.pdf#` in Lumiere:
│   │                           a cached reader, inside-folders.ts, which reads no
│   │                           PDF whose real path leaves the workspace, and
│   │                           engine.ts, a separate lazily loaded bundle
│   │                           (outline-engine.js) of PDFium that loads the
│   │                           viewer's embedpdf.wasm
│   ├── runtime/                plugin manifests and the runtime: dependency order,
│   │                           transactional start (a failed plugin rolls back what
│   │                           it registered), teardown in reverse order
│   └── plugins/                one folder per plugin, each with a manifest
│       ├── catalog.ts, services.ts   which plugins exist; the services they share
│       ├── pdf/                the custom editor: panels, loading, reloads,
│       │                       selections, navigation, view commands, page HTML
│       ├── pdfToolbar/         where the controls go; status bar entries
│       ├── pdfOutline/         the PDF Outline tree
│       ├── pdfRegions/         region snapshots saved for agents (size-capped)
│       └── agentBridge/        AgentHandoff (Copy link to this), the agent
│                               chat, and the opt-in MCP bridge (mcp/), whose
│                               server is a separate lazily loaded bundle
└── webview/     the viewer (React + EmbedPDF), one module per concern
    ├── main.tsx, host.ts       entry and messages to the extension
    ├── outbox.ts               state reports batched into versioned patches
    ├── engine-host.ts          the page's one engine, kept across reloads
    ├── engine.tsx, plugins.ts  PDFium in a worker (main-thread fallback);
    │                           the plugins EmbedPDF 3 runs (stage, render, …)
    ├── viewer.tsx              toolbar, search, the Stage and its pages
    ├── toolbar.tsx             the slim bar's controls
    ├── floating-toolbar.tsx    the removed floating bar, no longer shown
    ├── view-sync.ts            page and zoom to the extension, its actions back
    ├── tool-mode.ts            the Select Text and Select Region tools
    ├── page.tsx, page-links.tsx  one page's layers in the Stage
    ├── navigation.ts           pages, locations, highlights (Stage verbs)
    ├── stage-layout.ts, stage-position.ts  layout choices and the reading
    │                           place, to and from the Stage
    ├── reading-position.ts     the place and zoom kept across reloads
    ├── smooth-scrolling.ts     animated wheel notches in continuous reading
    ├── text-access.ts          the page text and its glyph boxes, as a plugin
    ├── annotation-store-session.ts  marks to and from their file
    ├── selection.ts            reporting text and region selections
    ├── region-details.ts       a region's text and PNG snapshot
    ├── drag-release.ts         ending drags released outside the viewer
    ├── secondary-buttons.ts    right-clicks left to the context menu
    └── styles/                 CSS using VS Code theme colours
```

The viewer renders untrusted PDF content, so the extension accepts only
well-formed messages from it (`shared/messages.ts`), opens only web and mail
links, and loads scripts only from the extension. The viewer never makes
network requests.

## Development

### Local PDF jump history

`PDF: Back to Previous Location` and `PDF: Forward to Next Location` return
through deliberate jumps in the current PDF editor. They also appear in the
editor title and the slim PDF toolbar. These are separate from Previous/
Next Page and VS Code's file-level Back/Forward. No native or Vim shortcut changes.

Each open PDF pane keeps up to 100 locations in extension-host memory: page,
point offsets, zoom, page layout and scrolling mode/direction. Open Location,
internal links, outline entries, page-number entry and explicit Next/Previous
search-match actions record jumps. Live search previews, ordinary scrolling,
page stepping and zoom changes do not add stops. Back/Forward refresh the place
being left, suppress replay recording, and commit only after the viewer
acknowledges restoration. A new jump drops the forward branch.
Pressing Enter or a match-step button commits the first search preview with its
pre-search origin, even when the sole match is already visible.

Two panes of the same PDF have separate stacks. A stack survives webview
recreation and file refresh while its pane remains open; closing the pane or
restarting the extension host clears it. History is not written to disk or
shared with Markdown. New input supersedes delayed startup/history restoration.

Open Location checks that its target is a PDF file, asks when a relative path
matches multiple workspace roots, and reports invalid page destinations instead
of silently opening somewhere else.

```sh
pnpm install
pnpm build            # dist/extension.js and dist/webview/
pnpm check            # lint, typecheck, unit tests
pnpm test:browser     # the viewer in Chromium, with a stand-in for VS Code
pnpm test:vscode      # the packaged extension in a real VS Code window (local only, not in CI)
pnpm check:full       # check, test:browser and test:vscode, in that order
pnpm package          # production build and .vsix
```

`test:vscode` downloads VS Code into `.vscode-test/`, installs the extension
into a throwaway profile and home folder under `/tmp`, and drives the window
with Playwright. It never touches your own VS Code settings or extensions. Set
`VSCODE_EXECUTABLE` to test another build, or Cursor (its `cursor` executable,
for example `…/usr/share/cursor/cursor` in an extracted AppImage). On Linux
without a display, run it under `xvfb-run -a`.

Set `VSCODE_TEST_USE_SOURCE=1` to load the built extension and test fixtures
through VS Code's extension development paths without installing any VSIX.
For example, `VSCODE_TEST_USE_SOURCE=1 xvfb-run -a pnpm check:full` runs all
local checks in this mode; `pnpm package` separately verifies packaging.

On macOS, an empty test home can prompt for Keychain access. For credential-free
synthetic runs, `VSCODE_TEST_MOCK_KEYCHAIN=1` opts into Chromium's mock Keychain.
It is off by default; never use it with real accounts or personal profiles.
The native harness requests custom rendered menus for its DOM driver. Some forks
(including Cursor 3.23 on macOS) still use native menus; verify those paths with
native computer-use rather than replacing menu assertions with palette commands.

`pnpm test:vscode:restricted` is an additional focused local check for changes
to Restricted Mode support. It starts a fresh isolated profile with workspace
trust enabled and proves that the viewer renders while workspace settings cannot
override the user's disabled bridge and clipboard-only agent target. The normal
`test:vscode` suite disables workspace trust, so it cannot establish this. Run
the two native suites sequentially; both use the same throwaway test directory.

**Before every push run `pnpm check` and `pnpm test:browser`. Before merging a
pull request, and before pushing a change to editor integration, run the full
local check, `pnpm check:full`** (on headless Linux:
`xvfb-run -a pnpm check:full`). It runs `pnpm check`, `pnpm test:browser` and
`pnpm test:vscode` sequentially, stopping at the first failure. `pnpm check`
already includes unit tests; no separate unit run is needed. The full local
check does not include the separate CI packaging/size, secret-scan or advisory
audit gates listed below. GitHub Actions does not run the real-VS Code specs
(`test/vscode`): they were flaky under load. AGENTS.md says what counts as
editor integration.

On a shared machine, run one heavy suite at a time and use a private X display
for the VS Code tests. The browser harness uses port 8990 and can reuse an
existing server locally: set `PORT` to isolate concurrent worktrees, check that
the port is free before starting, or verify
that its server belongs to this checkout and serves the current build. Do not
stop another session's server or editor to free it.

Test PDFs are generated by `test/fixtures/make-fixtures.mjs`, so every
coordinate in the tests is known.

## CI and quality gates

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull
request and on pushes to `main`. Each job, and how to run it locally:

| Job                       | What it proves                                                                                                                                                                                         | Locally                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `check`                   | Lint, typecheck and unit tests pass                                                                                                                                                                    | `pnpm check`                                                  |
| `browser`                 | The webview suite in Chromium; on failure, `test-results/` is uploaded                                                                                                                                 | `pnpm test:browser`                                           |
| `package`                 | `pnpm package` builds the VSIX, leaves committed files unchanged, and the VSIX is under 8 MB with no tests, sources, source maps or secret-shaped strings; the VSIX is uploaded as the `vsix` artifact | `pnpm package && bash .github/scripts/check-vsix.sh *.vsix 8` |
| `secret-scan`             | gitleaks finds no secrets in the git history                                                                                                                                                           | `gitleaks git --redact .`                                     |
| `audit (advisory)`        | `pnpm audit --prod`; a warning, never a failure                                                                                                                                                        | `pnpm audit --prod`                                           |

The real-VS Code specs (`pnpm test:vscode`) are not a CI job: run them locally
before merging (see Development). Cursor cannot run in CI either, so test it
by hand with
`VSCODE_EXECUTABLE=<cursor executable> xvfb-run -a pnpm test:vscode`. CI never
uses API keys or other secrets. Dependabot proposes grouped npm and
GitHub Actions updates weekly.

Pushing a tag `v<version>` that matches `package.json` runs
[`release.yml`](.github/workflows/release.yml): `pnpm check`, `pnpm package`,
and a GitHub Release with the VSIX attached. Publishing stays manual: with a
Marketplace PAT run `pnpm exec vsce publish --packagePath <file>.vsix`, and
for Open VSX `pnpm dlx ovsx publish <file>.vsix -p <token>`. Do not store
these tokens in the repository.

## License

MIT. Third-party licenses (EmbedPDF, PDFium, React) are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

### Precise links from the built-in Markdown editor

Cmd-click (Ctrl-click on Windows/Linux) on an inline local link such as
`[Excerpt](docs/paper.pdf#page=9&viewrect=72,130,100,30)` opens the PDF in the source
editor group and delivers the page/region to that exact pane, including a reused
pane. Native Back returns to the Markdown source location. Each PDF pane retains
its separate precise-jump history.

The document-link provider handles only valid PDF location fragments in local
workspace Markdown files. It verifies signed source/version tickets and real-path
workspace containment, including in Restricted Mode. External links, ordinary
files and unsupported Markdown link syntax stay with VS Code. A newer click,
unrelated editor departure or source edit cancels pending delivery. The public
command-link callback has no side-open modifier context, so this route uses the
source group. A manual switch to the exact expected target is indistinguishable
from VS Code's concurrent built-in definition gesture.
