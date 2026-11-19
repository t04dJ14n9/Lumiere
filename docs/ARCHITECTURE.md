# Lumiere architecture

How the whole repository fits together: the two products, the plugin core,
the plugin trees, the hosts and the contracts between them, and how a note
travels from disk to the screen and back. It also records where the design
is sound, where it has drifted, and what to change next.

State: `main` at 0.1.17 (#774). Update this document when the structure it
describes changes.

Read this first, then the detailed documents it points to:

| For | Read |
| --- | --- |
| The Markdown editor in depth: plugin API, document sync, Live Preview, vault, settings, public API | [packages/markdown/DESIGN.md](../packages/markdown/DESIGN.md) |
| The plugin core and its lifecycle guarantees | [packages/core/README.md](../packages/core/README.md) |
| Hosts other than VS Code: layers, contracts, milestones | [HOSTS_PLAN.md](HOSTS_PLAN.md), [IPAD_PLAN.md](IPAD_PLAN.md) |
| The PDF product | [packages/pdf/README.md](../packages/pdf/README.md), [packages/pdf/AGENTS.md](../packages/pdf/AGENTS.md) |
| One plugin | its `README.md` under `packages/markdown/src/plugins/<id>/` or `packages/pdf/src/extension/plugins/<id>/` |
| Rules for changing code | [AGENTS.md](../AGENTS.md), [REVIEW.md](../REVIEW.md) |

## Contents

1. [The products](#1-the-products)
2. [Repository layout and dependency direction](#2-repository-layout-and-dependency-direction)
3. [The plugin core](#3-the-plugin-core)
4. [Plugin trees at run time](#4-plugin-trees-at-run-time)
5. [Anatomy of a plugin](#5-anatomy-of-a-plugin)
6. [Host services: the seam between plugins and a host](#6-host-services-the-seam-between-plugins-and-a-host)
7. [Hosts](#7-hosts)
8. [Services shared by the two products](#8-services-shared-by-the-two-products)
9. [The document: who owns the text](#9-the-document-who-owns-the-text)
10. [The vault index and link resolution](#10-the-vault-index-and-link-resolution)
11. [Parsing and rendering](#11-parsing-and-rendering)
12. [Links end to end](#12-links-end-to-end)
13. [The PDF product](#13-the-pdf-product)
14. [Agent handoff](#14-agent-handoff)
15. [Opening a note: the path and its cost](#15-opening-a-note-the-path-and-its-cost)
16. [Security boundaries](#16-security-boundaries)
17. [Testing layers](#17-testing-layers)
18. [Assessment: what holds, what drifted](#18-assessment-what-holds-what-drifted)
19. [Recommended changes](#19-recommended-changes)

## 1. The products

One VS Code and Cursor extension, "Lumiere: Markdown Editor and PDF Reader",
ships two products that share one plugin tree:

- **Lumiere (Markdown).** Obsidian's editing experience on a VS Code custom
  editor: Live Preview that reveals syntax at the caret, wikilinks resolved
  as Obsidian resolves them, embeds, callouts, properties, tables, math,
  diagrams, tasks, tags, backlinks, outline and graph. VS Code keeps the
  text, saving and undo.
- **Lumiere PDF.** A PDF viewer on EmbedPDF 3 (PDFium compiled to WebAssembly).
  Its signature feature is **Copy link to this**: an `@paper.pdf#page=3`
  locator and the quote, for agents. A note's deep link to a passage
  (`paper.pdf#page=3#:~:text=…`) paints a backlink overlay back onto the PDF.

The Markdown product also runs outside VS Code, on the same plugins:

| Host | Package | Where it runs |
| --- | --- | --- |
| VS Code, Cursor | `packages/markdown/src/host` | the extension host (Node) plus one webview per editor |
| DeepSeek Harness | `packages/dsh` on `packages/host-node` | DSH's server and preview sidebar |
| Lumiere's own server and window | `packages/app` on `packages/host-node` | a local server and a browser page |
| Desktop app | `apps/desktop` (Tauri) around `packages/app` | a native window |
| Web app | `apps/web` on `packages/host-web` | a static, offline site |
| iPad | `apps/ipad` (Capacitor) on `packages/host-web` | a native app with no server |

The PDF product runs only in VS Code and Cursor today (see
[section 13](#13-the-pdf-product)).

## 2. Repository layout and dependency direction

```text
packages/core          plugin core (Cordis underneath). Pure: no DOM, Node or VS Code.
packages/agents        what both products hand to coding agents. Pure.
packages/ink           sketch format, outlines and the ink service. Pure + a web canvas.
packages/markdown      the Markdown plugins, their webview, and VS Code's host services
packages/pdf           the PDF plugins (VS Code only), its portable host code and React webview
packages/host-node     host services outside VS Code; the shared host core has no Node
packages/host-web      the shared host on a browser's or the iPad's folders
packages/dsh           DSH embedder
packages/app           Lumiere's server and window
apps/desktop, web, ipad
src/extension.ts       the composition root of the VS Code extension
```

Imports point one way:

```text
core, agents, ink  ◄── markdown, pdf ◄── markdown/src/host (VS Code) ◄── src/extension.ts
                                    ◄── host-node ◄── host-web ◄── apps/web, apps/ipad
                                                 ◄── dsh
                                                 ◄── app ◄── apps/desktop
```

Inside each product, `src/shared` and `src/markdown` are pure too. The
tsconfig projects and the `architecture/boundaries` lint rule enforce all of
this, so a forbidden import fails `pnpm check`, not a review.

## 3. The plugin core

`packages/core` (about 1,500 lines) is the API every plugin programs
against. Underneath it runs [Cordis](https://github.com/cordiverse/cordis)
4.0.0-rc.13, pinned exactly.

### 3.1 Concepts

- **Plugin.** An object with a `name`, an `inject` list (`required` and
  `optional` services), a `provides` list and an `apply(ctx, config)`
  function. Everything a plugin acquires in `apply` (listeners, editor
  extensions, commands, child plugins, services) goes through `ctx`, so it is
  released when the plugin stops.
- **Service.** A plain value published with `ctx.provide(name, value)` and
  typed by declaration merging on `Services`. A plugin may read only what it
  injects and publish only what it declares; anything else throws. That
  makes the dependency graph a property of the definitions: tools and tests
  build it without running anything (`plugins/plugin-graph.ts`).
- **Fiber.** One started plugin. It starts when every required service
  exists, restarts when one is replaced or an optional one comes or goes,
  and stops only after the plugins that depend on its services have stopped.
- **Events.** A ranked bus (`event-bus.ts`): `emit` (all listeners),
  `bail` (first non-undefined answer wins, synchronous) and `pipeline`.
  Listeners run in plugin rank, so a restarted plugin keeps its place, and
  a throwing listener is logged and skipped.

### 3.2 What the core adds to Cordis, and why

| Guarantee | Why the products need it |
| --- | --- |
| Release is last-first, one at a time, and joined: a stop resolves only when every cleanup has settled | Editor extensions reconfigure CodeMirror as they are removed; overlapping releases corrupted editor state |
| An `apply` still running when its plugin stops is abandoned; what it acquires afterwards is undone at once | Async starts (index loads, chunk fetches) would otherwise leak into a closed panel |
| Optional services | Most cross-feature links are "use it if present" (`vim`, `pdfOutlines`, `hostDocuments.registerCompletions`) |
| Ranked, error-isolated events | Link clicks and opens are claimed by the first plugin that wants them, in a stable order |
| Ownership tree and a resource ledger | Leak tests count live resources per owner after a stop |
| Declared `inject`/`provides`, enforced | The graph is checkable statically; undeclared reads fail loudly |

The core's conformance suite (`packages/core/test/conformance`, 23
lifecycle scenarios) is the contract; stock Cordis passes 6 of them, which
is why the layer exists. In practice Cordis serves as a service-gated fiber
scheduler: its `Service` classes, `isolate`, `extend`, `intercept` and
`mixin` are unused, and every fiber is created on one Cordis root with
ownership tracked by the core.

### 3.3 Cost

Starting plugins is cheap: on warm Node about 0.15 ms per plugin (41
trivial plugins in 6.3 ms). Opening a note starts about 50 fibers across
two trees, so the machinery costs single-digit milliseconds. What plugins
do in `apply`, and fetching their webview chunks, is what costs time
([section 15](#15-opening-a-note-the-path-and-its-cost)).

## 4. Plugin trees at run time

A VS Code window holds several trees. Services do not flow between trees by
themselves; the bootstrap hands them over explicitly.

```text
Extension root (src/extension.ts) ─ createRoot()
│  provides: extensionContext, outputChannel, noteSelections, pdfOutlines
│
├─ PDF plugins (startPdf): pdf (pdfPanels hub), pdfToolbar, pdfOutline, pdfHistory,
│     pdfBacklinks, pdfRegions, pdfAnnotations, pdfLookUp, pdfZen, pdfSettings,
│     agentBridge, ideContext
│
└─ Markdown (startMarkdown → host/bootstrap.ts)
   ├─ host services (VS Code adapters), vaults (vaultsHost)
   ├─ core host plugins: document, editor, dialect, settings, commands, links, …
   ├─ window features (startWindowFeatures): nativeLinks, nativeSuggest, outline,
   │     backlinks, outgoingLinks, quickSwitcher, wordCount, linkUpdates, graph, …
   │     (17 of them deferred until the first editor is ready)
   │
   └─ one panel root per open editor (editor/panel.ts → createRoot)
        re-provided: host services, vaults, pdfOutlines
        vaultHost (this note's vault), resourcesHost
        critical hosts:  links, tasks, properties, tags, cursorBridgePanel
        deferred hosts:  gitGutter, gitBlame, suggest, search, onlineVideos, lookUp
              (started after the webview's ready handshake has been answered)

Webview (one per panel, its own JavaScript realm) ─ createRoot()
   core: document (collab), editor (EditorView), dialect, livePreview, render, …
   features: the ones the host says are on for this note, each a lazy chunk
```

Points that matter when changing code:

- **Panel trees are separate roots.** Because the core does not use Cordis's
  `isolate`, each editor panel gets its own root, and the bootstrap
  re-provides what panel plugins need (`bootstrap.ts` `configure`,
  `editor/host.ts`). A new root service that panel plugins need must be
  added there too, and to `ROOT_SERVICES` in `plugins/plugin-graph.ts`.
- **Critical and deferred.** Panel hosts that must answer before the first
  paint (links, properties, tags, tasks) start with the panel. Hosts that
  only answer later requests start after the webview's `ready` has been
  answered, so they never delay first paint (`host/features.ts`).
- **Order.** `plugins/plugin-order.ts` sets precedence (event rank and start
  order where it is meaningful). Real start order still comes from service
  gating.
- **Optional services restart their consumers.** When an optional service
  appears after its consumer started, the consumer restarts. For a panel's
  `editor` host that would close the editor, which is why services such as
  `noteSelections` and `pdfOutlines` are provided on the root before either
  product starts (`bootstrap.ts`, `src/extension.ts`).
- **Feature switches.** Every plugin has `lumiere.markdown.plugins.<id>.enabled`
  (resource-scoped). `PluginSwitch` starts and stops the halves as settings
  change. The same id is the user's unit of control and the unit of fault
  isolation: a plugin that throws is stopped and reported; the others go on.

## 5. Anatomy of a plugin

A Markdown plugin lives in `packages/markdown/src/plugins/<id>/`:

| File | Holds |
| --- | --- |
| `manifest.ts` | id, title, kind (core or feature), default on/off, surfaces (`host`, `webview`), capabilities, settings schema, commands and keys. `package.json` contributions are generated from manifests |
| `host.ts` | the extension-host half (Node; no `vscode` import) |
| `webview.ts` | the webview half (CodeMirror extensions, DOM) |
| `protocol.ts` | the RPC between the halves: requests and notifications, each with a schema validated on both sides |
| `api.ts` | the types and service shapes other plugins may import |
| `README.md` | what it does, how it works, files, services, limits and differences from Obsidian |
| `*.css` | styles, bundled through `src/webview/styles/index.css` |

Rules: another plugin is reached through its `api.ts` (types and services)
or its `protocol.ts`, never its internals. Of 276 cross-plugin imports, 259
are `api` and 17 `protocol`; there are no imports of internals. The one
import cycle is `livePreview` ↔ `links`: `livePreview/inline.ts` reads a
CodeMirror state field exported by `links/api.ts`.

Registering a plugin today touches six or seven shared files:
`plugins/catalog.ts`, `plugin-order.ts`, `plugins/host.ts` and
`plugins/webview.ts`, `webview/features.ts` (lazy loader map and the
chrome, render and paint sets), `host/features.ts` or `host/bootstrap.ts`
(critical, deferred and `defer` lists), then the generated `package.json`.
See [section 19](#19-recommended-changes) for making this manifest-driven.

PDF plugins (`packages/pdf/src/extension/plugins/<id>/`) follow the same core
but are simpler: one `plugin.ts` each, most of them injecting the `pdfPanels`
hub that owns the viewer panels; the viewer itself is one React application
rather than plugin halves.

## 6. Host services: the seam between plugins and a host

Markdown plugins never import `vscode`. They inject host services, declared
in `packages/markdown/src/shared/host`:

| Service | What plugins get |
| --- | --- |
| `hostDocuments` | open, read and edit text documents; optional `registerCompletions` for the native text editor |
| `hostCommands` | run and register commands |
| `clipboard`, `dialogs` | clipboard; pickers, input boxes, messages |
| `views` | tree views (outline, backlinks, tags, …) |
| `activeEditor` | the focused editor and its selection |
| `settings` | per-note settings (`forNote`), effective settings, `prepare(uri)` |
| `workspace` | folders, workspace trust, files |
| `storage` | workspace storage (snapshots, recents) |
| `extensions` | other extensions (public API v1) |
| `navigation` | open a link target, create notes, native document links |
| `customEditors` | the custom editor registration |
| `agentHost`, `git`, `diffViews` | agent bridge, git data, diff editors |

They have two implementations:

- **VS Code:** `packages/markdown/src/host/services` (about 1,000 lines).
- **Everything else:** `packages/host-node/src/host/services.ts`, on a
  `HostPlatform` (Node files, or a browser's mounted folders through
  host-web). Services a host cannot offer are inert stubs
  (`host-node/src/host/inert.ts`), and a manifest's `needs` keeps the plugin
  off there.

Both hosts run the same `bootstrap`, which is what lets DSH, the app, the
web app and the iPad use the plugins unchanged. Tests fake the seam with
`fakeHost(overrides)`.

Known duplication: the vault's file listing, stat and watch are written
twice (`host/vault-system.ts` and `host-node/src/host/vault.ts`), each with
its own concurrent tree walk. Two link-resolution helpers had already
drifted between the hosts before they were unified in
`shared/link-location.ts`.

## 7. Hosts

```text
packages/core, agents, markdown, pdf   the plugins: the same in every host
        │
        ├─ packages/markdown/src/host  VS Code's host services
        └─ packages/host-node          the shared host (src/core.ts has no Node)
             ├─ packages/host-web      on a browser's or the iPad's folders
             ├─ packages/dsh           on DSH's server and preview sidebar
             └─ packages/app           the window over a WindowBackend (HTTP, or host-web in-page)
                  ├─ apps/desktop      Tauri: native window, menu, picker
                  └─ apps/web          a static, offline site
```

The editor page is the same webview bundle in every host. Outside VS Code a
page shim stands in for the webview API and talks to host-node over a socket
or a `MessagePort` (`host-node/src/protocol.ts`). Each contract between the
layers is written once in code and changed on both sides in one PR; the full
table is [HOSTS_PLAN.md section 4](HOSTS_PLAN.md#4-the-contracts).

Where a change belongs: how a note edits, renders or links goes in the
plugin, for every host at once; never patch one host for a Markdown bug
([HOSTS_PLAN.md section 3](HOSTS_PLAN.md#3-architecture)).

## 8. Services shared by the two products

Both products start on one root in `src/extension.ts`. They share services
through it, with the consumer owning the interface and the root wiring the
provider:

| Service | Provider | Consumer | Interface |
| --- | --- | --- | --- |
| `noteSelections` | Markdown's public API | PDF agent bridge | `src/note-selections.ts` |
| `pdfOutlines` | PDF's outline reader (PDFium in the extension host, loaded on first use) | Markdown suggestions (`[[paper.pdf#`) | `packages/markdown/src/shared/pdf-outlines.ts` |

Neither product imports the other. Hosts that lack a provider simply lack
the feature (no PDF sections outside VS Code).

The PDF backlink index does not use Markdown's vault index: it scans notes
itself (`pdf/src/shared/pdf-backlink-index.ts`, `pdfBacklinks/plugin.ts`),
from the first PDF opened in the window, so a reader of Markdown alone pays
nothing for it, and has had to copy the editor's path rules to stay
consistent. See
[section 19](#19-recommended-changes).

## 9. The document: who owns the text

VS Code's `TextDocument` owns the text, saving and undo. A webview never
writes a file; it edits a local CodeMirror copy and synchronizes.

- The host keeps an **authority** per document (`plugins/document/`): a
  version number and a log of recent revisions.
- The webview sends its changes as versioned updates with its client id
  (collab-style). The host applies them to the `TextDocument` as a
  `WorkspaceEdit`, assigns the next version, and broadcasts the accepted
  changes to every panel of that document (one file can be open in several
  panels; editors are tracked per panel, never by path).
- Changes from elsewhere (another editor, git, an agent writing the file)
  arrive as `TextDocument` changes and are broadcast the same way.
- When a panel falls behind (its base version is older than the host's), it
  asks for the revisions it missed (`catchUp`) and replays them, rebasing
  its unsent edits on top. (Before #508, a version skew replaced the panel's
  text with the host's full text and could drop unsent typing.)
- Undo and redo are VS Code's: the webview forwards the commands; the host
  runs them on the document; the result comes back as an ordinary change.
- Save is VS Code's; plugins may contribute to a flush before save
  (`document/save.ts`).

Details: [DESIGN.md section 8](../packages/markdown/DESIGN.md#8-document-model-and-synchronization-document-plugin).

## 10. The vault index and link resolution

A **vault** is the workspace folder that contains a note (or the note's
folder outside a workspace). `vaults.forDocument(uri)` indexes it on first
use; `vaults.locate(uri)` gives the vault and the vault path.

- **Indexing** runs in a worker (`workers/vault-worker.ts`; a web variant for
  host-web): it parses each note's metadata (headings, blocks, links,
  embeds, tags, frontmatter, aliases) with the same parser the editor uses.
  A snapshot in workspace storage lets the next window start warm. Open
  notes are re-indexed from their unsaved text.
- **The index** (`plugins/vault/api.ts`, `VaultIndex`) answers files,
  metadata, resolved and unresolved links, backlinks, and change events.
  Suggestions, backlinks, outline, graph, link updates, search and the
  quick switcher all read it.
- **Resolution** (`plugins/vault/resolve.ts`, `shared/link-location.ts`)
  follows Obsidian's `getLinkpathDest`: case-insensitive, `.md` optional,
  `./` and `../` from the note's folder, a leading `/` from the vault root,
  other foldered paths from the root then the note's folder, attachments
  included. Aliases are not destinations, as in Obsidian.

When a name matches in several folders, the candidates under the source
note's folder come first, then the rest, each group shortest path first, as in
Obsidian; ties go by path.

## 11. Parsing and rendering

- **One parser.** The `dialect` plugin extends CodeMirror's Lezer Markdown
  with Obsidian's syntax (wikilinks, embeds, callouts, highlights, comments,
  math, tags, block ids, footnotes). The editor, the metadata collector and
  the HTML renderer all use it, so they agree on what a link or a heading
  is ([DESIGN.md section 10](../packages/markdown/DESIGN.md#10-markdown-dialect-and-rendering-dialect-and-render-plugins)).
- **Live Preview** (`livePreview` plugin) decorates the syntax tree in view:
  replaced ranges, widgets and line classes, through a renderer registry
  feature plugins add to. The reveal rule shows a construct's source when
  the caret or selection touches it. Block widgets (tables, embeds,
  callouts, properties) keep measured heights so remounts do not jump.
- **HTML rendering** (`render` plugin) serves embeds, hover previews and
  callout bodies with the same dialect.

## 12. Links end to end

| Step | Where |
| --- | --- |
| Parse `[[…]]`, `![[…]]`, `[](…)` | `markdown/dialect/wiki.ts`, `html/helpers.ts` |
| Index outgoing links, resolve them, keep unresolved sets | `plugins/vault` (worker + `resolve.ts`) |
| Render in Live Preview, dim unresolved | `plugins/links/webview.ts`, `livePreview/inline.ts` |
| Follow (click, Mod+Enter), navigate to heading or block | `plugins/links` (webview → RPC → host `navigation`) |
| Open in the host: note, PDF page, external URL (with scheme policy), create a missing note | `host/navigation.ts`, `host-node` equivalent |
| Suggest while typing in Lumiere's editor | `plugins/suggest` (`SuggestionIndex`, Obsidian's fuzzy ranking) via `links/suggestions.ts` |
| Suggest while typing in VS Code's own text editor | `suggest/native-host.ts` → `hostDocuments.registerCompletions` → `host/text-completions.ts` |
| Suggest a PDF's sections after `[[paper.pdf#` | `pdfOutlines` → `SuggestionIndex.prepare`; inserts `[[paper.pdf#page=N\|Title]]` |
| Update links on rename | `plugins/linkUpdates` |
| Backlinks, outgoing links, unlinked mentions, graph | their plugins, all on the vault index |
| Native document links in VS Code's text editor | `host/source-links.ts` (inline Markdown links only) |

Both suggestion paths share one trigger parser (`src/markdown/link-trigger.ts`)
and one index, ranking and insertion, so they offer the same entries and
write the same text.

## 13. The PDF product

```text
extension host                                   webview (React, EmbedPDF 3 + PDFium wasm)
  pdf plugin (pdfPanels hub) ── messages.ts ──►    viewer.tsx, pages, selection, search,
  pdfToolbar, pdfOutline, pdfHistory, …            outline, backlink overlays, annotations
  pdfBacklinks (scans notes, matches quotes)
  outlines/ (PDFium in Node, on demand)
src/host (no vscode): portable viewer logic, reused by host-node
```

- The extension plugins are VS Code-only: 43 of 73 production files import
  `vscode`, and 10 of 12 plugins inject the `pdfPanels` hub.
  `packages/pdf/src/host` (no `vscode` imports) holds the portable part,
  already reused by host-node's PDF pages.
- Links into PDFs are plain fragments (`#page=N`, `#:~:text=`), so Obsidian
  and browsers open them too. A note's link may add a text fragment for a
  passage, in the standard form (`[prefix-,]start[,end][,-suffix]`, as a
  browser's Copy link to highlight writes it); the backlink index matches it
  against the page text (folding case, whitespace and hyphenated line
  breaks, across page edges) and paints an overlay that opens the note. Copy
  link to this writes an `@` locator and the quote for agents, never a text
  fragment (`packages/agents/docs/agent-handoff-format.md`).
- Bookmarks are read in the webview for the viewer's outline, and in the
  extension host by the `pdfOutlines` reader (one PDFium instance, started
  on first use, cached per file by mtime and size, PDFs over 200 MB skipped).
- **EmbedPDF 3.0.0** (`@embedpdf/*`, pinned exactly) runs the viewer. The
  plugins in `webview/plugins.ts` are `stage` (one surface that lays out,
  scrolls and zooms the pages, in single, spread, paged and horizontal
  flows), `render` (a quick picture of each page, then sharp tiles),
  `interaction` (the active tool), `selection`, `search`, `history`,
  `annotation`, `link` and `outline`, plus Lumiere's own `lumiere-text`, which
  gives the other layers each page's text and glyph boxes. Pages are laid out
  by the Stage, so the webview never reads a scroll offset: it moves and
  reads the view with Stage verbs (`webview/stage-*.ts`). Zoom is the Stage's
  (a wheel notch is ×1.2; the buttons and keys walk Lumiere's ladder).
- **One engine per viewer page** (`webview/engine-host.ts`): PDFium runs in a
  web worker, with the main thread as a fallback when the worker fails or
  does not answer in 15 s (a locked or damaged PDF is an answer, shown as
  such, never a reason to start the main-thread engine). An engine that
  dies after the PDF opened (a worker error, a call rejected because the
  runtime is gone or PDFium trapped: `webview/engine-health.ts`) is shown as
  stopped, with Reload, which starts a new engine and asks for the PDF
  again. A reload of the file keeps the engine; the page
  leaving stops it. `embedpdf.wasm` (7.9 MB) is fetched while the host sends
  the bytes, and the page names it in `data-pdfium-wasm`. The extension host's
  bookmark reader runs the same engine in Node
  (`dist/pdf/outline-engine.js`), and Markdown's PDF embeds run it in the
  editor webview's thread (that page's CSP allows no worker), so a rotated
  page embeds the way it reads. Both bundle the engine through
  `scripts/embedpdf-stubs.mjs`, which leaves out what they never use.
- **Annotations stay outside the PDF**, as `{ "version": 2, "bundle": … }`
  files named by the PDF's SHA-256 (`shared/annotation-store.ts`); version 1
  files are converted when read. A save is merged into the file by
  annotation, three-way against what that pane last had
  (`shared/annotation-merge.ts`), so two panes or windows of one PDF never
  overwrite each other's marks; the host then sends the file to its other
  panes of that file, and a pane in another window (another extension
  host) is sent it when the file's watcher sees a write this host did not
  make. **Dark paper** is drawn by the engine:
  EmbedPDF 3 has no page colour-scheme option, so the viewer runs EmbedPDF's
  engine host with Lumiere's own page reader in its worker and in the
  main-thread fallback (`packages/pdf/docs/embedpdf-page-colors-patch.md`).

## 14. Agent handoff

`packages/agents` defines, once, what both products hand to coding agents:
the Copy Link for Agent reference (`@notes/a.md#12-18`, compatible with LLM
Wiki), the quoted payload, and the IDE context packet (active note or PDF,
selection, visible range) that bridges such as Cursor's and Claude Code's
read. The `agentBridge`, `ideContext`, `cursorBridge` and `bridge` plugins
deliver them.

## 15. Opening a note: the path and its cost

The path from "open `Note.md`" to an editable note:

1. VS Code activates the extension (once per window, at window start through
   `workspaceContains:**/*.md`; about 15–20 ms of our own time) and resolves
   the custom editor. **Use Lumiere for Markdown in This Workspace** associates
   `*.md` and `*.markdown` with `lumiere.markdown.editor` itself, so VS Code
   hands the note straight to Lumiere. A workspace set up the old way
   (`"default"`, then take over the text tab) is migrated on activation;
   the takeover (`host/reclaim.ts`) remains for text tabs opened another
   way, and waits 40 ms after the text editor reports.
2. The editor host creates the panel root, its vault (indexed on first use,
   or loaded from a snapshot), and the critical panel hosts.
3. The host builds the page's HTML with the note's first screen already in
   it: inert, escaped HTML under the editor's own classes and gutters
   (`firstPaintSnapshot`, on by default). VS Code shows a webview only after
   its `load` event, so the editor entry loads by `import()` from a nonce'd
   inline script, and the first view's feature chunks are listed as
   `<link rel="modulepreload">` (`feature-chunks.json`).
4. The webview loads its entry (one file; the build merges the entry graph
   into `editor.js`), starts its core plugins and sends `ready`. Messages
   that arrive before the transport is up are kept and replayed through
   the same origin check.
5. The host answers `ready` with the text, version, settings and the list of
   active features. Deferred panel hosts start after this answer.
6. The webview builds the CodeMirror state, runs the first Live Preview pass
   and replaces the snapshot without moving it; feature phases start one
   task after that paint. A jump (Search match, outline, heading link) is
   held below the sticky bar until the layout settles.

Measured on the production build in VS Code 1.144 on Apple Silicon (November
2026), installed VSIX, from the Enter key in Quick Open to the note's text
on screen; medians of interleaved runs. Cold means the first open in a new
VS Code process.

| Note | Cold, before #513 | Cold, now | Warm, now |
| --- | --- | --- | --- |
| Small (56 lines) | 613 ms | 329 ms | ~150 ms |
| Large (5,032 lines) | 632 ms | 331 ms | ~180 ms |
| 100 properties | 516 ms | 294 ms | ~170 ms |

A note with 381 properties, which often never finished loading, settles in
about 2 s cold.

Findings:

- **Most of a cold open is now VS Code's.** Creating the webview's iframe
  and inner document takes about 195 ms cold, which the extension cannot
  shorten. Lumiere's host side is about 10 ms.
- **Vault size does not slow opening.** With 3,000 notes, `forDocument`
  takes 7–23 ms because opening does not wait for indexing.
- **Frontmatter was quadratic** and is fixed: each document flush asked
  every Properties list input to commit, and an empty one rebuilt the whole
  sheet. Empty inputs are skipped and one DOMPurify instance is reused per
  window (a flush with 100 properties: 551 → 17 ms). The quality budgets
  cover a frontmatter flush.
- **Loading rounds.** With the merged entry and preload hints, an open makes
  49 requests instead of 105, and features are ready 25–190 ms sooner.

Not done:

- On a Search click the snapshot shows the top of the note for a moment
  before the editor appears at the match; the host does not know the match
  when it builds the page.
- On a fresh profile Markdown Outline starts collapsed. Opening a note no
  longer focuses it, because focusing reveals the Explorer and replaced
  the Search sidebar. The PDF viewer's outline still does
  (`pdfOutline/focus.ts`).
- `test/vscode/perf.spec.ts` starts its clock after Reopen With, so it
  misses VS Code's own wait, and it reads a log file name that no longer
  exists (`Workshop.log`, now `Lumiere.log`).

## 16. Security boundaries

- **Webviews are untrusted.** Every message has a schema and is validated
  in both directions (`shared/rpc/endpoint.ts`); the host re-checks paths
  and containment (symlinks included) before opening, creating or writing.
- **Link schemes.** External application schemes ask first; script, data,
  command and file schemes are refused.
- **Vault code.** No host runs a vault's own code: the Obsidian community
  plugin runtime and the trust question that gated it were removed (#414).
- **Native links** in VS Code's text editor carry a signed ticket that is
  checked against the clicked text, the document version and containment.

## 17. Testing layers

| Layer | Command | What it proves |
| --- | --- | --- |
| Unit (Node) | `pnpm test` | pure logic, plugins against `fakeHost`, the core's conformance suite, parity tables against recovered Obsidian behaviour |
| Browser (Chromium) | `pnpm test:browser` | the webview with a fake host: rendering, selection, keys, layout |
| Quality budgets | `pnpm test:quality` | first paint, scroll and large-vault budgets (`test/quality/budgets.ts`) |
| Real VS Code / Cursor | `pnpm test:vscode` (`VSCODE_EXECUTABLE=…` for Cursor) | the packaged extension in the real workbench over CDP: native editors, the command palette, settings, clipboard |
| Everything | `pnpm check:full` | all of the above |

The real-VS Code specs share one workspace per suite; each spec must restore
what it changes, or a later spec fails for the wrong reason.

## 18. Assessment: what holds, what drifted

### 18.1 The plugin model: keep it

- The boundaries hold. Cross-plugin imports go only through `api` and
  `protocol`; the host seam is respected (no `vscode` in plugins); pure code
  is lint-enforced.
- The runtime cost is negligible (section 3.3); lazy webview chunks are
  already in place.
- One plugin per user-visible feature is right: the plugin id is a setting
  users toggle and the unit of fault isolation. Merging plugins into larger
  modules would lose both.
- The core's divergences from Cordis are justified by the conformance suite.
  The cost is that panels need separate roots and manual re-provision of
  services (section 4).

### 18.2 Where the structure strains

- **The `editor` plugin is a hub.** About 8,100 lines in 67 files; 63 plugin
  halves depend on its services. About 730 lines in 13 files are syntax
  knowledge that belongs to the owning plugins (callout, footnote, math,
  fence, setext, heading, link-reference and quote handling), and the Vim
  caret profiles are hard-coded in `editor/caret.ts`.
- **Registration is hand-maintained** in six or seven files (section 5),
  and whether a plugin is enabled is computed at eight sites.
- **Back-channels.** `shared/vim-hooks.ts` and `shared/completion-hooks.ts`
  are module singletons used instead of optional services.
- **One cycle**, `livePreview` ↔ `links` (section 5).
- **Name clashes across products.** Both products have plugins named
  `agentBridge` and `ideContext` on the same root, which conflates ranks,
  ledger entries and log tags.
- **PDF sits outside the seam.** Its extension plugins import `vscode`
  directly, and its backlink index re-scans the vault instead of reading
  Markdown's index. The last two backlink fixes were both drift repairs.

### 18.3 Wikilinks

Common wikilinks work end to end: parsing, embeds (notes, headings, blocks,
sized images, PDF pages, media), Live Preview, Obsidian's resolution rules,
following, creating missing notes, suggestions (notes, aliases, headings,
blocks, PDF sections), link format settings, rename updates, backlinks and
the graph. Gaps, most important first:

| Gap | Effect | Size |
| --- | --- | --- |
| VS Code's own text editor has `[[` suggestions but no wikilink following, hover or unresolved marks | Cmd+click on `[[Note]]` does nothing there | M |
| `%` in a wikilink (`[[100% Done]]`, `#50% done`) is URI-decoded | following throws or reports "heading not found" | S |
| Links to PDFs and images are styled as unresolved | resolved links look broken | S |
| `\|` escaped pipe in raw source | Mod+Enter fails; a rename drops the backslash and breaks the table | S |
| `[[Note#Heading]]` displays `Note#Heading`; Obsidian shows `Note > Heading` | cosmetic | S–M |
| Nested heading paths that skip a level; block ids are case-sensitive | some valid links miss | S |
| `![[img.png\|alt\|300]]` loses its width | sizing | S |
| Mod+click opens in place; no middle-click, no new-tab key | differs from Obsidian (an owner decision, BH-020) | S |
| Markdown-link suggestions ignore `newLinkFormat`; link updates only rewrite `.md` sources and lack "Always" | minor | S each |

## 19. Recommended changes

Ranked by value for effort. S, M and L are rough sizes.

| # | Change | Size | Why |
| --- | --- | --- | --- |
| 0 | Stop the Properties sheet's quadratic re-renders on open (section 15) and add frontmatter budgets | S | notes with large frontmatter take seconds, or never settle |
| 1 | Fix the small wikilink bugs: `%` decoding, PDF/image unresolved styling, escaped pipes | S | silent wrong behaviour for users coming from Obsidian |
| 2 | One `isEnabled(manifest, settings)` helper replacing the eight sites | S | removes a class of "on here, off there" bugs |
| 3 | Rename PDF's `agentBridge` and `ideContext` | S | clean ranks, ledger and logs |
| 4 | Wikilink document links, hover and unresolved diagnostics in VS Code's text editor | M | completes the text-editor story that `[[` suggestions began |
| 5 | Manifest-driven registration: each manifest declares its phase (critical, paint, deferred) and loaders; the catalog, host and webview lists, loader map and defer lists are generated; keep one explicit precedence list | M | adding a plugin touches one folder |
| 6 | Shrink the `editor` hub: an extension point for syntax-specific editing, so callout, footnote, math and other handlers move to their plugins; turn `vim-hooks` and `completion-hooks` into optional services; move the `links` state field behind a `livePreview` API | S–M | restores "core knows no features" |
| 7 | PDF backlinks read Markdown's vault index through a root service instead of scanning | M | ends the path-rule drift |
| 8 | Build VS Code's vault file system on the shared `HostFiles` walk | S–M | removes the duplicated listing and watch code |
| 9 | Late-bound optional services (watch a service without restarting) | S–M | retires the "provide it on the root first" ordering workarounds |
| 10 | A panel scope in the core that inherits the parent's services and events | M–L | only if a third manual bridge appears |

Not recommended now:

- Porting every PDF plugin behind host services before a second host needs
  the PDF viewer.
- Moving the vault index to a shared worker service: budgets already guard
  it; measure first.
- Lazy-loading host halves: activation is already 15–20 ms.
- Merging plugins into larger modules.
