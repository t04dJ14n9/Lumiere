# Search

Shows matching vault files inside fenced `query` blocks, corresponding to
Obsidian's embedded search results, and searches the vault from **Search
Vault…** into the Explorer's **Vault Search** view, Obsidian's search pane.

## How it works

A query-specific block renderer precedes generic code blocks. Each rendered fence
owns an RPC subscription; refresh, source exposure and disposal cancel old work.
The host lists eligible indexed files, reads current text through the shared
vault service, and sends each document to a worker. A conservative query plan
uses indexed tags/properties and file paths without reading note content when
possible; mixed content predicates read one coherent current text snapshot. Per-document parse errors are
counted; a document past its deadline is skipped and named, and the search goes on
in a fresh worker (ten skips end the search); cancellation terminates the worker. Index resolution refreshes
live subscriptions once it has been quiet for a second (it resolves after every
typing pause), and a block keeps its results until the new ones arrive. Result links use encoded relative paths and normal navigation.

**Search Vault…** (palette, or the view's search button) asks for a query in
the same syntax, with the last one filled in, and runs it over the active
note's vault (the workspace's when no note is open) in a worker, as a block
does (`vault-search.ts`, the window half in `view.ts`). The view lists a row
per matching file, named without `.md`, with its folder and how many lines
match, open on its match lines; clicking the file opens it, clicking a line
opens the note at the match (`results-tree.ts`). The message above the rows
says how many files match, or why nothing could be searched. A new query
cancels the one running. While the view is visible the query runs again
once the vault index has been quiet for a second, keeping the rows until the
new ones replace them; a hidden view catches up when it is shown. **Clear
Search Results** empties it. The view shows beside a Lumiere editor, and
anywhere while it holds results.

## Files

- `manifest.ts`: enablement and surfaces.
- `protocol.ts`: query, response and change-notification schemas.
- `worker-protocol.ts`: validated worker startup, submissions and replies.
- `runner.ts`: worker startup, deadlines, pending requests and termination.
- `query.ts`: indexed file eligibility, cached metadata/live reads and result ordering.
- `read-ahead.ts`: bounded, in-order read-ahead of the notes a query evaluates.
- `match-lines.ts`: content-needle scan for Obsidian-style match-line snippets (run in the worker: it runs user regexes).
- `open.ts`: resolve result path to vault open (offset / beside).
- `../../markdown/search/plan.ts`: scope-aware content/metadata requirements.
- `host.ts`: RPC handlers and index change notification.
- `client.ts`: subscriptions, refresh generations and cancellation.
- `blocks.ts`: accessible status, refresh button, result links and clickable match lines.
- `webview.ts`: query renderer and rendered-fence ownership.
- `view.ts`: the window half: Search Vault…, Clear Search Results, the view
  and its refresh.
- `vault-search.ts`: one query at a time over a vault, laid out in the view.
- `results-tree.ts`: the view's file and match-line rows.
- `view-ids.ts`: the view, command and context-key identifiers.
- `../../workers/search.ts`, `search-worker.ts`: isolated query compilation, evaluation and match lines.
- `search.css`: the plugin's styles, bundled through `src/webview/styles/index.css`.

## Services, events and settings

Host injects `rpc`, `vault`, `vaults` and the host service `extensions`; the
window half injects `vaults`, `views`, `hostCommands`, `dialogs`,
`activeEditor` and `extensions` and listens to `vault/resolved`; webview injects `editor`,
`rpc`, `render` and `livePreview`. Provides no service. Listens to `render/fence`
and the index's resolution subscription. The `search/changed` RPC notification
refreshes active queries. `lumiere.markdown.plugins.search.enabled` defaults to
true and switches both halves. Commands: `lumiere.markdown.search.vault`
(Search Vault…, no key) and `lumiere.markdown.search.clearResults`; the
context key `lumiere.markdown.search.hasResults` keeps the view shown.

## Limits and differences from Obsidian

Uses the documented pure search grammar; no Dataview scripting. Worker startup
has a 15-second deadline and each document has a 5-second evaluation deadline.
A document past its deadline is skipped and named (the search does not stop), and
a failed worker affects its query only, and the block keeps listing what it found
before the failure. A search stops at 1000 matching notes and says so; the notes
after its last match are not searched. Results reflect the index's eligible files
and unsaved text available through the host. Large vault searches may be slow:
the query has no RPC deadline (refresh or disposal cancels it), up to eight notes
are read ahead of the one being evaluated, and
new matches stream over RPC (throttled) and are appended while the query runs, then the
final sorted set replaces them. Excluded files are omitted. Content hits nest up to
25 match lines per file (highlighted substring, truncated around the hit); file /
path / tag / property-only queries stay path-only. Match rows call `search/open` with the vault path and content offset (Cmd/Ctrl+Alt opens beside). File titles still use relative href links. No Dataview.

The Vault Search view is a native tree, not Obsidian's pane: the query is
typed in VS Code's input box and runs on Enter, not as it is typed; there
are no match-case, explain, sort, more-context or copy-results controls; a
match line is plain text, without its match highlighted; Obsidian's Search
in all files fills in the editor's selection, this the last query. It has
no key: Obsidian's Mod+Shift+F is VS Code's Find in Files. A tag clicked in
the Tags view still opens a quick pick rather than this view.
