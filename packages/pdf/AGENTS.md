# Agent instructions: Lumia PDF

Lumia PDF is one half of the "Lumia: Markdown Editor and PDF Reader" extension: a
PDF viewer built on EmbedPDF that copies selections with exact page-and-box
locations. The repository's [AGENTS.md](../../AGENTS.md) applies; these rules
are specific to the PDF code. Read README.md for the layout.

- `src/shared` must run anywhere: no DOM, VS Code or Node APIs. The package's
  `tsconfig.json` enforces this.
- The webview is untrusted. Every message from it goes through
  `parseViewerMessage`; add a validator when adding a message.
- Track editors per panel (`PdfPanels`), never by file path: the same PDF can
  be open twice.
- Keep the Copy link clipboard Quote-first: blockquote then
  `basename · p.N` with Chrome `#page=` / `#:~:text=` (and `viewrect=` only when
  regions are enabled; never `#hl-`) — see `packages/agents/docs/agent-handoff-format.md`.
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

Run the checks from the repository root (`pnpm check`, then
`pnpm test:browser` and `pnpm test:vscode`).
