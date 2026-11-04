# Sidecar highlights (legacy)

> **Superseded as the highlight store** by vault Markdown deep links and
> Chrome-aligned backlink overlays. See the design:
> [docs/superpowers/specs/2026-11-04-pdf-backlink-overlays-chrome-design.md](../../../docs/superpowers/specs/2026-11-04-pdf-backlink-overlays-chrome-design.md).
>
> **Source of truth for passage highlights** is ordinary Markdown links in
> notes (`path.pdf#page=N#:~:text=…`). **Copy link to this** puts a Quote on
> the clipboard; paste it into any note. The viewer paints **backlink
> overlays** from those links. Annotate **Highlight** burns into the PDF
> again (with Note / freeText / underline / ink).

## What still works (legacy)

- Existing `*.pdf.lumiere.md` sidecar files are **not** auto-migrated or
  auto-deleted. Delete them by hand when you no longer need them.
- Opening a legacy `paper.pdf#hl-<id>` link still jumps to that highlight and
  flashes it **when the sidecar file is present** (best-effort read + `goTo`).
- Settings `lumiere.pdf.sidecar.location` / `.directory` remain for that
  legacy `#hl-` lookup only. New Copy link never emits `#hl-`.

## What no longer happens

- Annotate **Highlight** does **not** create or rewrite sidecar files.
- The viewer does **not** paint `.sidecar-highlight` overlays from a sidecar
  list. Passage marks come from vault Markdown backlinks instead.
- New **Copy link to this** never copies `paper.pdf#hl-…`.

## File format (unchanged for old files)

```markdown
---
lumiere-pdf-sidecar: 1
source: "paper.pdf"
---

<!-- lumiere-highlight
id: hl-a1b2c3d4
page: 3
subtype: highlight
color: "#FFE566"
opacity: 0.3
segmentRects:
  - { x: 72, y: 410, w: 220, h: 12 }
quote: "scaled dot-product attention"
contextBefore: "We propose "
contextAfter: " as the core of the Transformer."
created: 2026-11-01T18:00:00.000Z
modified: 2026-11-01T18:00:00.000Z
-->

## Notes
```

Rectangles are in points from the page's top-left corner, like `viewrect`.

## Where sidecars lived

| `lumiere.pdf.sidecar.location` | Sidecar of `papers/attn/paper.pdf` |
| --- | --- |
| `sibling` (default) | `papers/attn/paper.pdf.lumiere.md` |
| `directory` | `<workspace>/<lumiere.pdf.sidecar.directory>/paper.pdf.lumiere.md` |

## Code map (legacy keep vs unhooked)

**Still used for `#hl-` open / format / host push:**

- `src/shared/sidecar-format.ts`, `sidecar-path.ts`, `sidecar-messages.ts`
- `src/extension/plugins/pdfSidecar` — read / relocate / `reveal` for `#hl-`;
  all sidecarWrite ops (upsert and delete) are ignored
- `src/webview/sidecar-store.ts` + `host-messages.ts` — may still receive a
  sidecar list from the host (paint layer is unmounted)

**Unhooked create/paint modules** (left in tree; not imported by
`plugins.ts` / `mark-selection.ts` / `page.tsx`):

- `src/webview/sidecar-highlight-tool.ts`
- `src/webview/sidecar-writing.ts`
- `src/webview/sidecar-layer.tsx`
- `src/webview/sidecar-selection.ts`
- `src/webview/sidecar-reattach.ts`

Do not re-wire these without a product decision. Prefer deleting them in a
follow-up once Host GUI coverage for burn-in Highlight + vault overlays is
stable.

## Related

- Vault backlinks: `src/extension/plugins/pdfBacklinks/`,
  `src/webview/backlink-layer.tsx`
- Copy link Quote: `src/shared/agent-text.ts`,
  `packages/agents/docs/agent-handoff-format.md`
- Regions opt-in: `lumiere.pdf.regions.enabled` (default off)
