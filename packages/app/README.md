# Lumière's own server and window (`@workshop/app`)

Lumière's editor in a window of its own. This package is what the desktop
app (`apps/desktop`) runs, and it also works on its own in a browser:

```bash
pnpm --filter @workshop/app build
node packages/app/dist/app/server.js --vault /path/to/notes
```

Open the `url` from the line it prints.

## How it works

The **server** (`src/server`) starts Lumière's Markdown plugins through
`@workshop/host-node` and serves three things on a loopback port:

- the window's page;
- its API;
- the editor pages.

Every request must come from the window it was started for (`auth.ts`):

- The launch token arrives once in the URL. It is moved into an HttpOnly,
  SameSite=Strict cookie named for the port (`lumiere_token_<port>`: a
  cookie is shared by every port of a host, so two servers would replace each
  other's), and the URL is cleaned by a redirect. A process that is no
  browser may send it as `lumiere_token`.
- The Host header must name this server, so a DNS-rebinding page is
  refused.
- A request that has an Origin must come from this server, and one the
  browser marks as made by another site's page (`Sec-Fetch-Site`
  `same-site` or `cross-site`) is refused: a page on another local port
  is the same site, and its `<img>` or link would carry the cookie with no
  Origin.

A page of a note or PDF is same-origin with the window and carries the same
cookie, and the server reads and writes whatever its vaults hold. Its scripts
run by nonce only, and its frame has a `sandbox` (`src/shell/editor-sandbox.ts`)
that takes away top navigation, downloads and dialogs; it keeps
`allow-same-origin`, so it is no wall against script in the page (that file
says what dropping the origin needs). Isolating the page (per-page tokens
with CORS, or an origin of its own) is deferred by the owner (2026-11-21,
#744; `docs/HOSTS_PLAN.md`, risk 4). So the two
routes that can add a folder as a vault (`POST /api/vaults`, `POST /api/open`)
answer only the window itself (`fromShell` in `auth.ts`):

- The server gives each run a random shell key and puts it in the window's page
  (`GET /`, a `<meta>` tag), and only when the request is a load of the page
  itself: a browser's `Sec-Fetch-Dest` says a `fetch` or a frame is not, and a
  page's script cannot change it. The window sends the key back in
  `x-lumiere-shell` (`src/shell/api.ts`).
- A request with no Origin and no fetch metadata is not a page (a browser sends
  an Origin with every POST): it is a process that holds the launch token, such
  as the desktop app's open request, and passes.
- A page that is not the window cannot read the key from a `fetch` or a frame.
  Script that can open the window's page in a window of its own and read it can
  still take it; and the window forwards a page's request to follow a link to a
  note outside the open vaults to `POST /api/open` with its own key. This
  closes the direct request, not those.

The **window** (`src/shell`, React) is meant to feel like Typora: light,
with the note in front.

Laid out as VS Code:

- The vault's files on the left, the shown note's outline on the right.
  As in VS Code's Explorer, folders start closed, and the ones on the way
  to the shown note open whenever it changes (`folders.ts`). New Note and
  New Folder sit above the files and in the right-click menu, with Rename
  (typed in the row) and Delete; dragging a file or folder onto a folder
  moves it. A rename or move updates the links to it, and its tabs follow
  it; Delete goes to the system's trash, or, where the host has none (a
  browser, the iPad), asks before deleting for good (`file-actions.ts`,
  `tree-editing.ts`, `tree-edits.ts`).
- Notes open as tabs in the middle. Each tab is an editor page in an
  iframe, sent the theme and told when it is shown
  (`@workshop/host-node/embedding`). Only the pages of the five tabs used
  last stay loaded (`MAX_LIVE_EDITORS`, `tabs.ts`); an older tab's page goes,
  its note written as it does, and loads again at its scroll position when
  the tab is shown.
- The outline is the Outline plugin's own tree, served by host-node
  (`@workshop/host-node/views`). Backlinks and Tags can join it the same way
  (`components/OutlinePanel.tsx`).
- Settings opens as a tab, as VS Code's Settings editor: search, groups and a
  control per setting. Lumière's settings come from host-node
  (`@workshop/host-node/settings`), and every write passes the same check as
  in VS Code. Color Theme (Follow System, Light, Dark) is the window's own.

VS Code's keys (`commands.ts`, `KEYS`): ⌘, Settings, ⌘W the shown tab (the
window when it is the last), ⌃⇥ back to the last tab, ⇧⌘] and ⇧⌘[ (or ⌥⌘→
and ⌥⌘←) the next and previous tab, ⌘B the files sidebar, ⌥⌘B the outline,
⌘O Open Folder. The app menu runs the same commands. A key the
editor uses itself, such as ⌘B for Bold while typing, stays the editor's.

The layout (the panels, each vault's open folders, and the notes open in tabs,
which open again at launch) and Color Theme are
kept by the server (`/api/ui`), because the window's own storage does not
last: its port changes every launch.

Sketches are drawn on the window's canvas (`@workshop/ink/canvas`), while
the plugins that ask for them run in the server. The server's `ink` service
(`src/server/ink.ts`) keeps the drawing waiting, as a vault's question
about its plugins waits: the window hears `{"type":"ink"}`, reads the
drawing with `GET /api/ink`, opens its canvas over everything, and posts
the drawing (or nothing, when cancelled) to `POST /api/ink`
(`src/shell/ink.ts`). A window reloaded mid-drawing opens it again. The
pencil beside the layout buttons starts Insert Sketch in the note last
focused (`POST /api/sketch`); Lumière's right-click menu has it too.

From the desktop app the window uses only the folder picker, menu commands
and the app's light or dark appearance (`tauri.ts`). In a browser it falls
back to a path field.

## The server's contract

`src/server/contract.ts` is the one place it is written in code: the
arguments, the ready line, logs and stopping. `apps/desktop` depends on it.
Change both sides together.

```text
lumiere-server [--vault <dir>]... [--port <n>|0] [--host 127.0.0.1]
               [--token <t>] [--data <dir>] [--assets <dir>] [--version]
```

With no `--vault`, the vault used last opens again, if it is still there.

- **Ready.** Once ready, one JSON line goes to stdout:
  `{"lumiere":"ready","url":…,"port":…,"pid":…,"version":…}`. Nothing else
  ever goes to stdout. Logs go to stderr, as JSON lines.
- **Stopping.** SIGTERM, SIGINT or stdin closing make the server write
  unsaved notes and exit 0, within 5 seconds (exit 1 if stopping hangs).

| Method and path | What |
| --- | --- |
| `GET /` | the window, with the shell key for a load of the page |
| `GET /api/health` | `{"ok":true,"version":…}` |
| `GET /api/vaults`, `POST /api/vaults` `{"path"}` | the open and recent vaults; open one (the window only: `x-lumiere-shell`) |
| `GET /api/files?vault=` | `{"files","partial"}`: a vault’s files, sorted, with their kind (read from its folders, no file stat-ed), at most 20,000 notes and 20,000 other files; `partial` when there are more, which the file tree says |
| `POST /api/open` `{"path"}` | show a note or folder (Finder, a second launch; the window only, or a process with no Origin) |
| `GET /api/ui`, `POST /api/ui` | the window's layout, open folders, open tabs and Color Theme (`src/shared/ui-state.ts`) |
| `GET /api/events`, `?only=ink` | server-sent events: vaults changed, a note to open, a drawing started or ended waiting (`{"type":"ink"}`); `only` keeps the listed types. Notes to open that come before a stream that takes them wait for one |
| `GET /api/ink`, `POST /api/ink` `{"id","sketch"?}` | the drawing the plugins wait for (`{"id","title","sketch"}`, the sketch as its file's metadata JSON), or `{}`; the window's drawing, or none when cancelled, accepted only for the drawing waiting |
| `POST /api/sketch` | start Insert Sketch in the note last focused |
| `POST /api/files/note`, `POST /api/files/folder` `{"vault","path"}` | a new, empty note or a new folder, by its path in an open vault (the window only) |
| `POST /api/files/rename` `{"vault","from","to"}` | rename or move a file or folder, updating the links to it as VS Code does; `{"notUpdated"}` names the notes left as they were (the window only). The event stream then says `{"type":"renamed","from","to"}`, by absolute paths, as it does for a note renamed by its title |
| `POST /api/files/delete` `{"vault","path","permanently"?}` | to the system's trash (`src/server/trash.ts`): `{"deleted":true,"trashed":true}`; where there is none, `{"deleted":false}` and nothing is deleted until the window, once the reader confirms, sends `permanently` (the window only) |
| `GET /api/git-trust`, `POST /api/git-trust` `{"vault","allow"}` | `{"waiting"}`: the vaults git waits to be trusted in (`{"type":"git-trust"}` on the event stream when it changes); the reader's answer for one (the window only) |
| `/lumiere/*` | the editor pages and tree views (`@workshop/host-node`) |

## Files

- `src/server/contract.ts`: arguments, the ready line, logs, exit codes.
- `src/server/cli.ts`: the `lumiere-server` process: start, ready line, stop.
- `src/server/server.ts`: the web server: auth, then the API, editor routes or the window.
- `src/server/auth.ts`: the token, Host and Origin checks, and the shell key that adds a folder.
- `src/server/shell-page.ts`: the window's page, with the shell key.
- `src/shared/shell-key.ts`: the key's header and meta tag, for both sides.
- `src/server/api.ts`: the API above.
- `src/server/vaults.ts`: open and recent vaults, and their files.
- `src/server/files-api.ts`, `src/server/trash.ts`: the file tree's new notes and folders, renames and moves, and deletion to the system's trash (`trash` on macOS 15 and later, `gio trash` on Linux, the Recycle Bin on Windows), through host-node's `LumiereHost.files`.
- `src/shell/App.tsx`, `src/shell/components/`: the window.
- `src/shell/opening.ts`: opening vaults and notes from the picker, menu, links and the server.
- `src/shell/commands.ts`: the window's commands and VS Code's keys for them.
- `src/server/ink.ts`: the `ink` service: drawings waiting for the window's canvas.
- `src/server/git-trust.ts`, `src/shell/git-trust.ts`, `src/shell/components/GitTrustPrompt.tsx`: which vaults git may run in, and the window's question.
- `src/server/json-file.ts`: writing the data folder's JSON files without leaving half a file.
- `src/shell/ink.ts`: drawing what the server's plugins ask for, on the window's canvas.
- `src/shell/settings.ts`, `src/shell/settings-view.ts`: the settings, and how the Settings tab lays them out.
- `src/shell/ui-state.ts`, `src/shared/ui-state.ts`, `src/server/ui-state.ts`: the layout and Color Theme, kept by the server.
- `src/shell/tabs.ts`, `src/shell/tree.ts`, `src/shell/tree-state.ts`: tabs and tree state, as pure functions.
- `src/shell/editor-sandbox.ts`: the `sandbox` of a tab's editor frame, and why it keeps the window's origin.
- `src/shell/file-actions.ts`, `src/shell/tree-editing.ts`, `src/shell/tree-edits.ts`, `src/shell/components/TreeRowItem.tsx`, `src/shell/components/TreeMenu.tsx`: the file tree's new notes and folders, renames, moves by dragging, and deletion.
- `src/shell/tree-rows.ts`: the file tree as the rows it shows; only those in view are drawn, so a vault of tens of thousands of files scrolls as a small one does.
- `src/shell/saved-tabs.ts`: the open tabs kept with the layout, and opened again at launch.
- `src/shell/folders.ts`: which of the file list's folders are open, kept with the layout.
- `src/shell/api.ts`, `src/shell/views.ts`: the server's API and the tree views, from the window.
- `src/shell/theme.ts`: the window's light and dark palettes, and which one shows.
- `src/shell/tauri.ts`: everything the window asks of the desktop app.
- `scripts/build.mjs`: builds `dist/app/` (the server, the window and host-node's assets).

## Limits

- PDFs open in Lumière PDF's viewer: scroll, zoom, find and select. Its
  plugins (Copy Link for Agent, look up, the outline view) and the PDF
  settings work only in VS Code for now, and links in a PDF do not open.
- One window per server.
- Deferred by the owner (2026-11-21; `docs/HOSTS_PLAN.md`, section 2):
  - Search Vault… is in the Command Palette, but the window has no Vault
    Search view, so its results fill a view nobody sees (#792).
  - The outline's rows cannot be dragged: moving a section by dragging its
    heading works in VS Code only, as host-node never calls a tree's `drop`
    (#788).
  - A note's page keeps the window's origin (above, #744).
- The file list names files only, so an empty folder shows only while the
  window that made it is open.
- Git blame and the change gutter start off in the app (`src/server/defaults.ts`):
  git runs with the repository's own configuration, which can name programs
  to run, so the owner turns them on in Settings for their own repositories.
  Even then git runs in a vault only once the reader allows it there: the
  first time git is wanted in a vault, the window asks (`git-trust.ts`).
  Allow is kept in `git-trust.json` in the data folder; Not Now lasts until
  the app restarts.
- Git blame and the change gutter use the `git` on the server's PATH. The
  desktop app started from Finder sees only the system's PATH, so on macOS
  that is Xcode's git, and Git is off without the command-line tools.
