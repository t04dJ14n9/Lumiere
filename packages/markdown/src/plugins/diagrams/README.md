# Diagrams

Renders Mermaid code fences as diagrams, like Obsidian's Mermaid support in
Live Preview. As in Obsidian, the diagram stays rendered on clicks and
double-clicks, including transparent gaps between nodes and the margin beside
it. The Edit button reveals the source with the diagram's code selected, as
does moving the caret into the fence.

Nodes styled with `class NodeName internal-link;` (or `:::internal-link`) become
clickable internal links that open the vault note matching the node's label text
(or node ID fallback when the label is empty).

## How it works

The block renderer recognizes Mermaid fences and delegates display to the shared
render service. A fence listener queues the diagram, which renders as soon as
CodeMirror mounts its widget (the viewport plus a margin of about a screen), as
in Obsidian. So a reader usually meets diagrams already drawn, and their height
changes off screen, where scroll anchoring hides it. Renders run one at a time,
a frame apart, nearest the note's view first, because Mermaid keeps shared
state; a diagram scrolled past before its turn waits until it is mounted again.
While the reader scrolls, diagrams behind them wait until the scroll has been
still for 150 ms: drawing one changes the height above the view, and holding
the text still then moves the scroll position under a scroll in flight. An SVG
cache paints a source rendered before at once, keyed by source, trust and editor palette.
Queued renders capture that appearance before waiting for their frame. Strict security; HTML labels off
until Allow. Sanitized SVG replaces the original fence,
and any `.internal-link` SVG nodes are wired to the `links` protocol.
Pass and plugin disposal restore the source and prevent late results from writing.

## Files

- `manifest.ts`: feature metadata and default enablement.
- `webview.ts`: language recognition, block and fence registrations, and link opening.
- `sankey.ts` / `sankey.test.ts`: normalized Sankey node defaults through Mermaid configuration, preserving authored precedence.
- `theme.ts` / `theme.test.ts`: editor-derived neutral defaults, palette identity and theme-change observation.
- `mermaid-session.ts`: serializes complete Mermaid configuration/render transactions across renderer disposal and recreation, retaining only owner tokens.
- `renderer.ts`: Mermaid engine calls, `.internal-link` node wiring, per-render cancellation and cleanup.
- `mount-queue.ts`: the render queue (start on mount, one at a time, ahead of the reader and nearest first) and the SVG cache.
- `diagrams.test.ts` / `mount-queue.test.ts`: language recognition, editing, and render-queue coverage.
- `clone-svg.ts` / `clone-svg.test.ts`: lightbox SVG clone keeps a unique id and rewrites Mermaid `#id`-scoped theme CSS.
- `diagram-dialog.ts`: inspect lightbox (zoom/pan); clones via `cloneDiagramSvg`.
- `diagrams.css`: the plugin's styles, bundled through `src/webview/styles/index.css`.

## Services, events and settings

Injects `livePreview` and `render`, and optionally `rpc`; provides no services. Listens to `render/fence`;
emits `render/changed` when the editor palette changes. `lumiere.markdown.plugins.diagrams.enabled` defaults to true.
No commands or default keybindings.

## Limits and differences from Obsidian

HTML labels are disabled until Allow and SVG is always sanitized. Mermaid's
base theme receives neutral defaults from the editor's actual foreground and
background, including dark and high-contrast themes. Authored `classDef`, `style`
and `linkStyle` colors are left to Mermaid; no SVG inversion changes them.
The inspector clones the same sanitized SVG. A theme change refreshes inline
renders and closes an open inspector; reopen it for the refreshed palette.
Sankey node defaults are supplied through Mermaid’s per-node configuration using
its parsed, normalized CSV IDs; authored `nodeColors` and other frontmatter/init
styles keep their normal precedence. Temporary per-diagram defaults are restored
after rendering or failure.
Preparation observes Mermaid’s effective text-size budget. Raw-large documents
first use the normal capped renderer; only a successfully identified Sankey is
prepared and redrawn, preserving long comments/frontmatter without bypassing the
cleaned-input limit. The complete initialization/preparation/render/restore
transaction is serialized across plugin lifetimes, so a disposed renderer cannot
reset its replacement’s theme or trust configuration.
`--font-mermaid` follows the note text font (`--text-font`, Obsidian `--font-text`). A failed render uses Obsidian's
`mermaid-wrapper.is-guarded` chrome (title, error, Allow, source). Allow persists vault trust (`lumiere.mermaid-vault-trust`, Obsidian `mermaid-vault-trust`) and retries with `htmlLabels: true`; SVG output is still sanitized. Untrusted renders keep `htmlLabels: false`.
Inline Mermaid sizing follows Obsidian per-type `useMaxWidth` (false for flowchart/sequence/git/er; true for gantt/journey/class/state/pie). The fence is contained to the column (`contain: inline-size`) and scrolls horizontally when the native SVG is wider; height grows with the diagram. Do not shrink the SVG via CSS `max-width: 100%`, and do not let the SVG widen the note (the pane would clip it).

The Obsidian behaviour above is 1.14.4's, which drew diagrams with Mermaid
11.13.0. Obsidian 1.15.0 no longer ships Mermaid: it renders Mermaid syntax
with its own Pele 1.8.0 (`lib/pele.min.js`), without the guarded-render
chrome, the vault trust prompt or the dark-theme invert filter, and colours
diagrams from new `--mermaid-*` theme variables (static read, 2026-11-21).
Lumiere still renders with Mermaid as described here; its output has not been
compared with 1.15.0's.

Live-reference visual parity remains for the owner's manual comparison.
