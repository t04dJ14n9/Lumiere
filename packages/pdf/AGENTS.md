# Agent instructions: Lumiere PDF

Lumiere PDF is one half of the "Lumiere: Markdown Editor and PDF Reader" extension: a
PDF viewer built on EmbedPDF 3 that copies selections with exact page-and-box
locations. The repository's [AGENTS.md](../../AGENTS.md) applies; these rules
are specific to the PDF code. Read README.md for the layout and CAPABILITIES.md for the plugin table.

- `src/shared` must run anywhere: no DOM, VS Code or Node APIs. The package's
  `tsconfig.json` enforces this.
- The webview is untrusted. Every message from it goes through
  `parseViewerMessage`; add a validator when adding a message.
- Track editors per panel (`PdfPanels`), never by file path: the same PDF can
  be open twice.
- Keep the Copy link clipboard Quote-first: blockquote then
  `basename · p.N` with Chrome `#page=` / `#:~:text=` (and `viewrect=` only when
  regions are enabled) — see `packages/agents/docs/agent-handoff-format.md`.
  Clipboard only (no `openAgentChat`); with no selection, copy a page-only link
  for the reading page. UI entry is webview context menu (enabled whenever the
  PDF is active). The structured selection envelope is a separate contract
  (`docs/bridge-envelope.md`, command `vscodeEmbedPdf.bridge.envelope`).
- Features are plugins (`src/extension/plugins/<id>/`, listed in
  `catalog.ts`). Register every VS Code resource through the plugin's scope
  so it is released when the plugin stops; `test/unit/plugin-leaks.test.ts`
  fails otherwise. Names: plugin `agentBridge`, service `AgentHandoff`,
  command `copyLinkForAgent`.
- Prefer EmbedPDF's components and events over re-implementing them.
- The pages live in EmbedPDF's Stage: it lays out, scrolls and zooms them, and
  there is no scroll element to read `scrollTop` from. Move and read the view
  with Stage verbs (`goToPage`, `reveal`, `scrollTo`, `zoomTo`, reached with
  `useStageApi()`), never by DOM scrolling; page layers read their page with
  `usePage()`. Lumiere's shared types keep 1-based page numbers; convert to
  EmbedPDF's 0-based indexes and `PageRef`s only inside the webview.
- Annotations are kept outside the PDF as `{ version: 2, bundle }`
  (`shared/annotation-store.ts`); raise the version, and keep reading the old
  one, when the format changes.
- Dark paper is off while `PAGE_COLORS_ENGINE_AVAILABLE` is false
  (`docs/embedpdf-page-colors-patch.md`): do not draw it by CSS invert.
- The viewer bundle stubs EmbedPDF's bundled fallback fonts, its
  `import.meta.url` wasm path and, where no worker starts, its worker source
  (`scripts/embedpdf-stubs.mjs`); a new EmbedPDF import that reaches those
  must still build under that plugin.

Run the checks from the repository root (`pnpm check`, then
`pnpm test:browser` and `pnpm test:vscode`).
