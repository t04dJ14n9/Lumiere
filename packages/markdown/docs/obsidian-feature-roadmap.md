# Missing Obsidian features — roadmap for issue #699

Issue #699 lists features Obsidian 1.15.0 has and Lumia does not. This commit
delivers the smallest testable first step: `src/markdown/search-reveal.ts`,
a pure `revealRangesWithMatches()` that merges search-match ranges into the
Live Preview reveal ranges (`DESIGN.md` §11.3 "Later: search matches reveal
source"). Its unit tests are in `src/markdown/search-reveal.test.ts`.

It is **not wired yet**. The search plugin's matches live in the host/sidebar;
`revealRanges()` in `src/webview/ui/pointer-selection.ts` needs a StateField
(or Facet) that the search plugin updates, and `revealed()` in
`src/plugins/livePreview/registry.ts` must read it. That crosses a plugin
boundary and belongs in its own commit with a unit test in
`reveal-rules.test.ts`.

## Remaining items, with acceptance criteria

| Feature | Shipped reference | Acceptance criterion |
| --- | --- | --- |
| Reading view | `DESIGN.md` §25.8 | One command switches the same panel to fully rendered, read-only HTML; caret and scroll position survive |
| Search matches reveal source | §11.3 | A hit shows its source syntax; wire `revealRangesWithMatches()` |
| Hotkeys / command palette | `DESIGN.md` §13 | Every Lumia command has a bindable key; no hardcoded Ctrl/Cmd+E conflict |
| MathJax user macros (`\newcommand`) | already wired (`manifest.ts` `config.macros`; `mathjax.ts` `setUserMacros`) | Not remaining implementation. `CAPABILITIES.md:35` (“No user macros”) is stale and can be corrected in a separate docs change. |
| Outline drag moves a section | backlog item 33 | Dragging an outline row reorders the section and updates headings |
| Page preview of external links | `DESIGN.md` §13 | Mod-hover over an external URL shows a preview card |
| PDF inline embed | `CAPABILITIES.md` embeds row | A PDF embed renders more than one page with its own controls |
| Slash menu / Note composer / Backlinks bottom / Templates / Daily notes | backlog items 16–21 | Separate phases; each its own PR |

## Rules for the follow-up commits

- One feature per PR, with a unit test; browser/native coverage needs owner
  approval (testing policy in `IMPLEMENTATION_PLAN.md`).
- Keep the two-product plugin boundary: markdown features live in
  `packages/markdown/src/plugins/<id>/`.
- Obsidian is a behaviour reference only — never copy its code, CSS or assets.
- Gates: `pnpm check`, `pnpm test:browser`, `pnpm test:quality`; add
  `pnpm test:vscode` for editor-integration and contribution changes.
