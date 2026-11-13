# Lumière in DeepSeek Harness (`@workshop/dsh`)

Opens the Markdown notes of a [DeepSeek Harness](https://www.deepseek.com/en/harness/)
(DSH) workspace in Lumière's editor, in DSH's preview sidebar, instead of
DSH's read-only preview: the same Obsidian-style Live Preview, wikilinks,
embeds, properties, math, Mermaid and callouts as in VS Code and Cursor.
Notes save as you type. DSH's own preview stays in the viewer menu above a
note.

## How it works

DSH, like Lumière, is built on Cordis with "everything is a plugin", and a
DSH bundle has a host half (Node) and a browser half. Lumière's Markdown
plugins already reach their editor only through the host services in
`packages/markdown/src/shared/host`, so the host half here implements those
services over Node and DSH, and starts the plugins with the same `bootstrap`
VS Code uses (`@workshop/markdown/portable`). Lumière's plugin tree runs on
its own Cordis; DSH's context objects never enter it.

The browser half registers Lumière as the Markdown renderer of DSH's
document previews (`ctx.documentPreviews`, at the `extension` band, which
outranks DSH's own). Its body is an iframe of the editor page, the same
webview bundle VS Code shows, served by the host half from DSH's web server
behind DSH's browser authentication. A shim in the page stands in for VS
Code's webview API: `acquireVsCodeApi().postMessage` and the page's
`message` events travel over a WebSocket to the panel on the host, and DSH's
theme tokens become the `--vscode-*` variables the editor's styles read.

Following a link to a note that is not open asks DSH to open it in a new
tab (`ctx.sidebarRight.openResource`); the host reveals the heading or block
once the new page connects. If the page's first `ready` handshake fails (for
example, HMR restarts the Host while it is connecting), the body recreates the
iframe once so the retry runs against the live Host.

### Manifest

The built `dist/bundle` is a DSH plugin bundle by virtue of its
`package.json`, which `scripts/build.mjs` writes inline (there is no
`scripts/manifest.json` template). `dsh.bundle.patch` points at
`cordis.patch.yml`, which inserts the Host row `lumiere` ->
`@lumiere/dsh` into DSH's plugin tree. The Node half's `webServer` and
`connection` inject list is declared in `src/host/index.ts`, not in that
package file.

`dsh.client` is `{ platform: "web" }` only; it does not set `immediately`
or a client `inject` list. The `./client` export exposes `client.js`;
`./locale/*.json` exports the locale metadata. A top-level `icon` field
names `./icon.png`, which the builder copies from `media/icon.png`. Preview
and sidebar registration live in the client source, not the package
manifest. The generated package.json has no `files` list.

## Files

The Node host itself (documents, panels, settings, navigation, the page shim
and the routes) is `@workshop/host-node`, shared with Lumière's desktop app.
What is DSH's:

- `src/host/index.ts`: the DSH plugin: starts Lumière and mounts its routes.
- `src/host/routes.ts`: host-node's routes on DSH's web server, behind DSH's authentication.
- `src/host/dsh.ts`: the parts of DSH's plugin context used here.
- `src/host/workspace.ts`: a session's workspace, read from DSH, registered with the host.
- `src/client/index.ts`: the browser half: registers the Markdown and PDF document previews.
- `src/client/note-frame.ts`: the editor iframe: load and ready handling, one retry after a failed handshake, theme and following links.
- `src/client/address.ts`: DSH's file addresses.
- `src/client/theme.ts`: DSH's theme tokens as host-node's palette.
- `bundle/`: `cordis.patch.yml`, the locale metadata and the bundle's README.
- `scripts/build.mjs`: writes the bundle `package.json` and builds `dist/bundle`.

## Services, routes and settings

The host half injects DSH's `webServer`, `connection` and `sessions`; the
browser half `documentPreviews`, `slots` and `sidebarRight`. Routes, all behind DSH's
authentication: `/lumiere/editor` (a note's page), `/lumiere/m/*` (the
editor), `/lumiere/page/shim.js` (the shim), `/lumiere/file` (a note's images,
inside its workspace only — `..` and a symbolic link that leaves the workspace
are refused), `/lumiere/pdf` (a PDF's viewer page), `/lumiere/pdf/viewer/*`
(the viewer's files), `/lumiere/pdf/bytes` (that page's PDF) and the
`/lumiere/socket` upgrade. The JSON routes
(`/lumiere/settings`, `/lumiere/commands` and `/lumiere/views/*`) answer a
method none of them uses with 405 and a family-level
`Allow: GET, POST, HEAD`. host-node's `createEditorRoutes` and its
`settings-routes.ts`, `command-routes.ts` and `view-routes.ts` handlers own each
resource's exact method dispatch; a method the family advertises can still be
a 404 on one subpath. DSH does not copy that table here. The PDF page, its
viewer files and its bytes use real-path containment: a symlink that resolves
outside the PDF's workspace or the viewer's folder is refused.

Settings use the `lumiere.markdown.*` keys and defaults of the VS Code extension
and are kept in `$DSH_HOME/lumiere/settings.json` (`~/.dsh` by default), beside
the vault snapshots and editor state.

## Build and install

```sh
pnpm --filter @workshop/dsh build          # dist/bundle
dsh plugin --profile "${DSH_PROFILE:-web}" add link:$PWD/packages/dsh/dist/bundle
dsh web
```

`web` is the usual profile for `dsh web`; a Desktop-launched Harness uses
`desktop` instead. `$DSH_PROFILE` is set in a shell launched by either, and
the `${DSH_PROFILE:-web}` fallback covers a plain terminal.

Or install the built directory with DSH's plugin manager: call
`plugin_manager` with action `install_bundle` and `target` set to the absolute
path of `packages/dsh/dist/bundle`. The manager writes the profile's
`package.json` and `cordis.patch.yml` itself and enables the bundle.

Verified against DeepSeek Harness 0.2.2-rc.1; needs 0.2.1 or later, whose
document previews accept plugins. A new bundle can activate through HMR, but
after rebuilding the Host JavaScript you must restart DSH, and reload the
browser page to pick up a rebuilt `client.js`. HMR does not remount a preview
body that is already open: one still showing a failed first handshake needs a
page reload, or disabling and re-enabling the `lumiere` plugin row. A body
opened afterwards starts clean; if its `ready` call times out (an HMR restart
of the Host mid-handshake), it recreates the iframe once, and DSH's Reload and
"Read the file again" controls also recreate a failed iframe.

## Limits and differences from VS Code

- Markdown and PDF notes open in Lumière; DSH's own PDF renderer is not used
  for them. The engine file the editor ships is `embedpdf.wasm`, not
  `pdfium.wasm`; the host routes that name to the editor's own webview
  directory.
- Git blame and the change gutter work for notes in a repository, through
  the `git` on DSH's PATH; the rendered diff does not.
- No graph panel and no status bar: DSH has no counterpart yet.
- Outline, Backlinks and Tags are served by the host (`/lumiere/views`) but
  not yet shown in DSH: each would be a DSH sidebar tab drawing a tree from
  `@workshop/host-node/views`, as the desktop app's sidebar does.
- Commands have no palette or keybindings in DSH yet; what Lumière does
  through clicks, links, the editor and its context menus works.
- Copy Link for Agent copies to the clipboard: paste into DSH's chat.
- Renaming a note from its inline title is not available.
- The editor page is same-origin with DSH, so its strict content security
  policy (scripts by nonce only) is what keeps a note's scripts from running.
  The page can still read DSH's DOM, which is how it follows the theme.
- A workspace that is the filesystem root is refused. The workspace is the
  working directory DSH records for the session whose address opened the note
  (`?session=` on the page's URL; the host reads it from `ctx.sessions`, or
  `ctx.sessionPersistence` for a stored session, as DSH's own file service
  does) and registers it with host-node before the page is served. A page
  cannot name a folder of its own: host-node refuses any `root` that is not
  inside a registered one. A note outside its session's workspace (named by an
  absolute address) is therefore refused: the tab reports that Lumière could
  not open it, and DSH's own preview, in the viewer menu, still shows it. DSH's
  file reads are not contained to a workspace, so the server has nothing to
  check such a folder against. The host re-checks every path against the
  workspace.
- Copying a file into the vault from outside the workspace is refused.
  DSH has no file picker for that yet.
