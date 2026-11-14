# Vault Graph

Draws a vault's notes as a directed graph in its own panel, similar to
Obsidian's graph view.

## How it works

**Open Vault Graph** draws the active note's vault. With no active note it
uses the only open vault, or asks which one. **Choose Vault for Graph** always
asks. The host builds a graph from every Markdown note in the vault and
aggregates body links, note embeds and frontmatter wikilinks. A worker lays
the drawing out. The panel reads the worker script from the extension and
starts it from a blob URL, which a webview is allowed to do. Filters narrow
the drawing by type, tag, folder and text; **Orphans** (on by default, as
Obsidian's `showOrphans`) hides notes with no links when off. Filtering and
later edits keep coordinates; a large change waits for **Re-layout**.
Clicking a node asks the host to open that note. The host checks the scope, the
snapshot generation and that the id is still in the drawing.

## Files

- `manifest.ts`: caps, mode, depth, color and the two commands.
- `protocol.ts`: snapshot, view, ready and open RPC.
- `project.ts`: directed note graph, with title, description, `type` and tags
  from frontmatter.
- `filters.ts`: facet filters and the local neighbourhood.
- `admission.ts`: hard caps on nodes, edges and payload bytes.
- `view.ts`: color, legend and the drawn view.
- `facets.ts`: unfiltered type, tag and folder choices.
- `scope.ts`: which vault to use, with no workspace-folder guess.
- `choose.ts`: the picker around that decision.
- `collect.ts`: the vault's notes and indexing completeness.
- `snapshot.ts`: the payload the panel is allowed to receive.
- `settings.ts`: clamped window settings.
- `session.ts`: one panel, its endpoint and rebuilds.
- `host.ts`: commands and vault listeners.
- `html.ts`: the panel document and its content security policy.
- `project.test.ts`, `scope.test.ts`, `snapshot.test.ts`: builder, scope and admission.

The panel script and layout worker live in `src/webview/graph/` and are not
part of the editor bundle.

## Services, events and settings

Injects the host services `hostCommands`, `dialogs`, `views`, `activeEditor`
and `settings`, and `vaults`. Provides nothing. Listens to `vault/changed` and
`vault/resolved`. Commands are `lumiere.markdown.graph.open` and
`lumiere.markdown.graph.chooseVault` (vault picker). Settings:
`lumiere.markdown.graph.maxNodes` (2000), `maxEdges` (20000), `defaultMode`
(`global`), `localDepth` (2) and `colorBy` (`type`).

## Limits and differences from Obsidian

The graph scope is one whole vault. Edges are directed and come from body
links, note embeds and frontmatter wikilinks. Coloring and filtering by
`type` read the frontmatter `type` property; Obsidian has no such option.
Caps are hard: 2000 notes, 20000 aggregated edges and 1.5 MB. A larger graph
is refused, not sampled. There is no 3D view, saved layout or trust badge,
and no "only orphans" view (the old `orphans` filter was removed, and a saved
panel that has it opens with all notes). Layout is a bounded force pass in a
worker that stops while the panel is hidden and when the panel closes.
