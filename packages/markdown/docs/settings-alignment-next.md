# Settings alignment — next steps for issue #701

This commit reserves schema keys for the first two of the five settings that
Obsidian 1.15.0 exposes and Lumia did not
(`/tmp/obsidian-115/SETTINGS-ALIGNMENT.md`, issue #701):

- `lumiere.markdown.links.focusNewTab` (boolean, default `true`) — Obsidian's
  "Always focus new tabs" (`app.pretty.js:150360`).
- `lumiere.markdown.vault.showUnsupportedFiles` (boolean, default `false`) —
  Obsidian's "Show all file types" (`app.pretty.js:150487`).

The declarations are verified by `test/unit/settings/contributed-defaults.test.ts`.
They are **not yet read by the plugins** — wiring is a later change.
`package.json` Settings contributions are withheld until that wiring lands.

## Remaining wiring

1. `links.focusNewTab` — `plugins/links/host.ts` `openInternal()` calls
   `navigation.open(root, uri, fragment, placeOf(request), request.at, intent)`
   (~line 202). When `placeOf(request) === "tab"`, the navigation service must
   focus the new tab. `Navigation.open` currently takes no focus argument, so
   this needs a typed contract change on both sides (`shared/host` Navigation
   and its VS Code / host-node adapters) plus a unit test with a fake
   navigation service.
2. `vault.showUnsupportedFiles` — Quick Switcher membership is
   `ranking.ts` `noteCandidates` (Markdown plus a hardcoded attachments
   list), not a `VaultRegistry` extension filter to widen. When this key is
   wired, read it from settings and include other extensions in that
   candidate list; keep Markdown and attachments always indexed. Add a unit
   test with a fake listing that includes a `.txt` file.

## Remaining three settings

- `attachments.deleteUnlinkedAttachments` (enum `ask|always|never`, default
  `ask`) — also backlog item 41; add with the behaviour, not before.
- `spellcheck.languages` (array, default `[]` = OS dictionaries) — host
  dependent; decide explicitly against VS Code's spellchecker first.
- `editor.quickFontSizeAdjustment` (boolean, default `false`) — overlaps VS
  Code's `editor.mouseWheelZoom`; decide explicitly.

## Keep (do not add)

`promptDelete`, `trashOption`, `hotkeys`, `theme`, `accentColor`, the three font
settings are VS Code-owned (`DESIGN.md` §15.3). `defaultViewMode` is blocked on
Reading view. All 95 Lumia-only settings — including `gitDiffEditor.diffEditor`
— stay. `types` is `.obsidian/types.json`, not a setting.
