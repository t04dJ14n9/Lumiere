# Lumière's Node host (`@workshop/host-node`)

Runs Lumière's Markdown plugins in a Node process other than VS Code and
serves their editor pages to a web page that embeds them. It knows no
embedder. Its embedders are:

- `packages/dsh`, a DeepSeek Harness plugin;
- `packages/app`, Lumière's own server, which the desktop app
  (`apps/desktop`) runs.

## How it works

The Markdown plugins reach their editor only through the host services in
`packages/markdown/src/shared/host`. This package implements those services
over Node, then starts the plugins with the same `bootstrap` VS Code uses
(`@workshop/markdown/portable`). `startLumiere()` returns the running host:

- `panels`: the open editor pages;
- `trees`: the plugins' tree views (Outline, Backlinks, Tags, Outgoing
  Links);
- `stop()`.

`createEditorRoutes()` serves everything a page needs, below `/lumiere`, on
any Node web server:

- `/lumiere/editor?path=&root=`: a note's page, from its workspace `root`
  (without one, the note's folder), which must lie inside a workspace the
  embedder registered (below); the page registers none;
- `/lumiere/pdf?path=&root=`: a PDF's page, Lumière PDF's viewer
  (`/lumiere/pdf/viewer/*`), which fetches the PDF from `/lumiere/pdf/bytes`.
  That route answers a `Range` request with the one range, and lets the
  page's copy of the bytes go once it has sent them whole: the viewer's
  engine cannot read a PDF by range, so it fetches it once, whole
  (`packages/pdf/docs/large-pdfs.md`). The pages of one workspace share
  each read of a file.
  It runs only when the embedder passes the built viewer (`EditorAssets.pdf`);
- `/lumiere/m/*`: the built editor. Its files carry an `ETag` and answer a
  request that names it with 304, so each page that opens the editor again
  revalidates them; esbuild's content-hashed chunks are cached as `immutable`;
- `/lumiere/page/shim.js`: the page shim;
- `/lumiere/file`: a note's images. A vault's file is someone else's content
  on the embedder's origin: it is served with `Content-Security-Policy:
  sandbox` (a PDF excepted) and `nosniff`, and a script as text, so it never
  runs as a page or a script there;
- `/lumiere/socket`: the page's socket;
- `/lumiere/views`: the tree views;
- `/lumiere/settings`: Lumière's settings, for a settings page. A plugin
  declares what it needs from its host (`needs` in its manifest: VS Code's
  window, Git, panels); this host offers Git (`NODE_HOST_OFFERS`), so the
  settings of a plugin that needs the window or panels are left out.

The embedder puts its own authentication in front of them. A page runs in
the embedder's iframe. Its shim stands in for VS Code's webview API: what
VS Code would carry between webview and extension travels over the page's
socket to its panel here.

A page whose socket breaks (the connection drops without the page closing
it) keeps its panel for 30 seconds: the page shows a dialog that pauses
typing and reconnects, and frames sent meanwhile wait on both sides; the
editor recovers any revision it missed through the document's `catchUp`.
When the host no longer knows the panel (it restarted), the page stops
trying and offers to reload. A page that closes its socket (its tab closed)
closes its panel at once.

A page's URL names a note and the workspace it is shown from, but a page
decides nothing about which folders are workspaces. The embedder registers
each one with `host.addRoot` (by real path) before it serves the page: the app
for each vault, DSH for each session's workspace; `host.removeRoot` stops
trusting one (the app's closed vault). A note's or PDF's page answers 403 for
a `root` that is not inside a registered one, and a registered filesystem
root counts for nothing.

A right-click in a page shows Lumière's `webview/context` menu as VS Code
does (`context-menu.ts`): the page reports the clicked element's
`data-vscode-context`, the host keeps the context keys the plugins set
(`setContext`) and evaluates each item's when-clause (`when.ts`), the page
draws the items it is sent with Cut, Copy and Paste, and the host runs the
chosen command. A submenu (`contributes.submenus`) is a row that opens its
own items beside it, on a tap, a click or Right, showing each command's
short title (Format, then Bold); it shows only with an item to show, as in
VS Code. `menus.json`, written at build time (`scripts/menus.mjs`), lists
the items.

Paths are checked as VS Code's host checks them (`paths.ts`): inside the
workspace after `..` is resolved, and still inside through symbolic links.
The workspace may not be the filesystem root.

The host itself is shared with host-web: `@workshop/host-node/core`
(`src/core.ts`) starts the plugins on a `HostPlatform` (`src/host/platform.ts`)
and reaches no Node built-in, which `test/unit/core-layers.test.ts` checks.
`startLumiere` gives it Node's platform (`src/host/node-platform.ts`).

## The contracts it defines

| Module | Between | What |
| --- | --- | --- |
| `src/protocol.ts` | page ↔ host (socket) | `rpc` frames (the editor's own RPC) and `ui` frames (prompts, toasts, focus, the right-click menu) |
| `src/embedding.ts` | embedder ↔ page (`postMessage`) | the theme, "open this file", "you are shown" |
| `src/palette.ts` | embedder → page | an embedder's colour roles as the `--vscode-*` variables |
| `src/views.ts` | embedder ↔ host (HTTP) | tree snapshots, clicks, visibility, events |
| `src/settings.ts` | embedder ↔ host (HTTP) | every setting with its value, group and title; changes, checked as VS Code's commands check them |

The last four are browser-safe entries (`@workshop/host-node/embedding`,
`/palette`, `/views`, `/settings`) for an embedder's page. Its Node half imports the main
entry. The `architecture/boundaries` lint rule allows no other import, and
forbids this package from importing `vscode` or any embedder.

## Files

- `src/host/start.ts`: starts the plugins over the services below.
- `src/host/services.ts`: every host service the plugins inject.
- `src/host/documents.ts`: notes on disk, edited in memory, saved after a pause (at once when the page is hidden or goes away); a change another program makes to the file is merged into unsaved text.
- `src/host/conflict-copy.ts`: where another program's version of a note goes when unsaved typing on the same lines is saved over it.
- `src/host/panels.ts`, `src/host/panel.ts`: editor pages as panels, and their sockets.
- `src/host/routes.ts`, `src/host/page.ts`, `src/host/static.ts`: the routes above.
- `src/host/pdf-pages.ts`, `src/host/pdf-routes.ts`: PDF tabs, on Lumière PDF's viewer core (`@workshop/pdf/portable`) and the same page shim and socket as notes.
- `src/host/trees.ts`, `src/host/view-routes.ts`: the plugins' tree views and their routes.
- `src/host/settings-routes.ts`: the settings for a settings page, and changes to them.
- `src/host/context-menu.ts`, `src/host/when.ts`: the right-click menu's items and their when-clauses.
- `src/page/context-menu.ts`, `src/page/page-menu.ts`, `src/page/menu-model.ts`: reporting a right-click, drawing the menu and its submenus, and what keys do in it.
- `src/host/vault.ts`: the vault index's file system: listing and watching.
- `src/host/navigation.ts`: following links, creating notes, revealing in an open page.
- `src/host/settings.ts`: settings from the contributed defaults and a JSON file.
- `src/host/ui-services.ts`: dialogs, the clipboard and the active editor, drawn by the page. A paste reads the browser's clipboard through the page; one the browser refuses gives what Lumière last copied.
- `src/host/workspace.ts`, `src/host/watch.ts`: workspace files and state, and file watching.
- `src/host/paths.ts`, `src/host/atomic-write.ts`: containment, and writes that never leave a file half written.
- `src/host/git.ts`, `src/host/git-blobs.ts`, `src/host/git-program.ts`: Git from the `git` command line (blame, a note at HEAD or in the index, staging, each repository's changes), and which `git` to run.
- `src/host/inert.ts`: diffs, status entries and panels, which have no counterpart yet.
- `src/page/shim.ts`, `src/page/ui.ts`, `src/page/theme.ts`: the page's stand-in for VS Code.
- `src/page/connection.ts`, `src/page/disconnected.ts`: the page's socket, reconnected when it drops, and the dialog shown while it is down.
- `scripts/assets.mjs`, `scripts/menus.mjs`: what every embedder ships beside its code (the editor, the shim, the settings, the menu).

## Limits

- Another program's change reloads a note with nothing unsaved, and is
  merged line by line into unsaved typing (`mergeDiskChange`). Where both
  changed the same lines, unsaved typing wins: the next save, which also
  checks whether the file changed since it was last read or written, keeps
  the other version beside the note, as `Note (conflict).md` (then
  `(conflict 2)`, …), merges the rest, writes the typing, and tells the
  reader. A change made between that check and the write is not seen.
  Saves write a temporary file beside the note and rename it over the note
  (`atomic-write.ts`), so a crash or a full disk leaves the old text, never
  an empty note. The note keeps its permissions, and a symbolic link to it
  stays a link (the file it names is replaced, when that file is inside the
  workspace); another hard link to the note keeps the old text. A note in a
  folder that takes no new file is still written in place.
  Notes are UTF-8: a byte order mark is kept, and a note whose bytes are not
  UTF-8 is not opened (VS Code would show and save U+FFFD in their place).

- Containment is checked, then the file is opened, and Node has no `openat`
  to bind the two. A local process that swaps a folder for a symlink in
  between is caught afterwards, not prevented: a workspace write or read
  verifies the descriptor it opened is the file inside the root before it
  writes or returns anything (`paths.ts`, `atomic-write.ts`). Folders made through
  the link can stay behind, empty. Notes' autosave and their conflict
  copies, copy, move, remove and the file and PDF routes still trust the
  path checked just before.

- Git is blame, the change gutter and staging, through the `git` on the
  PATH (`git.ts`), for notes inside the workspace. On macOS, Xcode's
  `/usr/bin/git` stand-in is used only when the command-line tools are
  installed, so no install dialog appears. A repository is watched once a
  note in it was asked about; a `git init` is seen on the next question.
  Every command turns off the programs a repository's own configuration
  can name for it to run that can be turned off by key (`core.fsmonitor`,
  hooks, transports: `HARDENED_GIT_CONFIG`). Its filters and diff drivers
  (a `clean` filter for staging) cannot be, by name, so git waits for
  trust, as VS Code's git extension does in Restricted Mode: an embedder
  may pass `gitTrust` (`GitTrust`, `StartOptions.gitTrust`), and git then
  runs only in the workspace roots it says are trusted, answering
  unavailable elsewhere. The app asks the reader per vault
  (`packages/app/src/server/git-trust.ts`). DSH passes none: registering a
  session's workspace (`addRoot`) is its trust.
- No rendered or native diffs, no status bar entries and no extra panels
  (the vault graph) yet: `inert.ts` answers for them as VS Code does when
  they are unavailable.
- No text editor of its own, so `HostDocuments.registerCompletions` is left
  out: typing `[[` suggests notes in the Lumiere editor only.
- No command palette or keybindings: commands run from clicks, links and the
  editor's own menus.
- `TreeHandle.clearSelection` emits `deselect` (the Outline when the reader is
  above the first heading); the app's tree panel unmarks the current row.
- `TreeHandle.expand` / `collapse` emit `expand` / `collapse` events (and
  record the override on the next snapshot) for accordion outlines. They do
  not emit `changed`. Embedders that ignore those events leave expansion at
  the snapshot's `expanded` flags only.
