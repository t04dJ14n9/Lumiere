# Design: PDF backlink overlays (Chrome-aligned deep links)

**Date:** 2026-11-04  
**Approved:** user (Asia/Singapore, 2026-11-04) — locked decisions below; PDF++ / Chrome-aligned direction  
**Amendments:** none yet  
**Repo:** `t04dJ14n9/Lumia` (checkout historically `lumiere`)  
**Package:** `packages/pdf` (`@workshop/pdf`), with Markdown link resolution for any `.md`  
**Risk:** Low for this docs PR; product/UI Medium when implemented  
**Ancestry:** supersedes `2026-11-01-pdf-sidecar-highlights-design.md` as the **highlight store** default (sidecar Markdown as highlight persistence / `#hl-` as store). Keeps direct-to-PDF Annotate for built-in EmbedPDF Note / freeText (and other burn-in tools). Builds on #457 / #464 / #469 / #482 for Annotate, hit-test, Delete, and **Copy link to this**. Region / box selection moves to opt-in Cordis plugin `pdfRegions` (default off).

## Goal

Replace **sidecar-as-highlight-store** with **Chrome-aligned deep links** plus **backlink overlays** in the Lumia PDF viewer.

- Highlights live **only** as ordinary Markdown links in notes (any vault note). Workspace Markdown is the **source of truth**; an optional in-memory index is a **derived cache** only.
- **Copy link to this** puts a Quote on the clipboard (no auto-paste, no Add notes).
- Built-in EmbedPDF Note / freeText stay **hard-written into the PDF**; Del deletes those; overlays ignore Del.
- Region / box selection becomes an **opt-in Cordis plugin** (`pdfRegions`), **default off**.

## Non-goals (v1)

- Cite / bibliography Slice 3.
- Obsidian core plugins.
- Lumia id rename (product / package ids stay as today for this work).
- Broader startup optimization beyond vault pre-index for PDF backlinks.
- Region plugin UX polish when the plugin is on.
- Auto-migrate or auto-delete old sidecar highlight files.

## Standards note (fragments)

| Spec / product | Text range? | Page / rect? |
|----------------|-------------|--------------|
| **RFC 8118** (PDF URI fragment) | **No** text-range fragment | `page=`, `viewrect=`, `highlight=`, … |
| **Chrome** (PDF viewer / open-in-browser) | **`#:~:text=`** (Text Fragments) | Lacks `viewrect` / `highlight` support for this workflow |
| **PDF++** (Obsidian) | Often `selection=`-style | Own conventions |
| **This design (Lumia)** | Align with Chrome: **`#:~:text=`** | `#page=N`; `viewrect=` only when region plugin is on |

Do **not** use PDF++ `selection=` or RFC-style `search=` for new Copy link text ranges. Normative text fragment for new links is Chrome Text Fragments `#:~:text=…`.

## Decisions (locked)

| Topic | Decision |
|--------|----------|
| Highlight store | **Not** sidecar layout A / `#hl-` as store. Highlights = Markdown links in vault notes. |
| Source of truth | Workspace Markdown. Optional in-memory index = derived cache only. |
| Copy link | Clipboard **Quote only** — no auto-paste, no Add notes. |
| Context menu | **Copy link to this** only (remove Add notes). |
| Text selected | Quote: `> selected text` then blank quote line then `[path.pdf · p.N](path.pdf#page=N#:~:text=…)`. |
| No text | Page link only: `[path.pdf · p.N](path.pdf#page=N)`. |
| Text fragment | Chrome `#:~:text=` (not PDF++ `selection=`, not RFC `search=`). |
| Region plugin off | No empty-page region drag; only text select / page link. |
| Built-in Note / freeText | Stay hard-written into PDF; Del deletes those. |
| Overlays + Del | Overlays **ignore** Del / Backspace. |
| Discovery | Pre-index vault on startup / idle; opening a PDF = fast per-file lookup (not full vault scan at open). |
| Index refresh | On Markdown save that affects PDF links. |
| Overlay paint | From `#page=` + `#:~:text=` — resolve text → glyph boxes in Lumia viewer. |
| Paint order | Hard-written PDF annotations first; Lumia overlays on top. |
| Overlay hover | Note preview. |
| Overlay click | Open that note at the link. |
| Sidecar teardown | Drop sidecar highlight store. User deletes old sidecar files by hand — **no** auto-migrate / delete in the extension. |
| Legacy `#hl-` / `viewrect=` | Open if we still can; new Copy link **never** emits `#hl-`; emits `viewrect=` only when region plugin is on. |
| `pdfRegions` | Opt-in region plugin, **default off** (not always-on). |

## Problem

Sidecar-as-highlight-store (`paper.pdf.lumiere.md`, `#hl-<id>`, EmbedPDF `importAnnotations` overlay) keeps highlight geometry in a Lumière-private store beside the PDF. That diverges from how users already cite PDFs in notes and from what Chrome can open (`#page=` + `#:~:text=`).

Research workflows want:

1. Highlights that are just Markdown deep links anyone can edit, paste, and sync with the vault.
2. Copy link that matches Chrome Text Fragments so the same URL works in Lumia and in Chrome where possible.
3. Opening a PDF and seeing which notes point at which passages (backlink overlays), without scanning the whole vault at open time.
4. Clear separation: burn-in Annotate tools still write the PDF; passage “highlights” do not.

## Model

```
Vault .md notes
  └─ Markdown links: path.pdf#page=N#:~:text=…
        │
        ▼
  Derived in-memory index (cache)
        │  keyed by PDF path / identity → list of { noteUri, page, textFragment, … }
        ▼
  Open paper.pdf → per-file lookup → resolve #:~:text= → glyph boxes → paint overlays
```

- **Write path for a new “highlight”:** user selects text (or page) → **Copy link to this** → clipboard Quote → user pastes into any note.
- **Read path:** index + viewer resolve links → overlays. No sidecar write on highlight create.
- Built-in Note / freeText continue through the existing direct-to-PDF Annotate pipeline.

## Copy link to this and selection

### Context menu

- Offer **Copy link to this** only.
- **Remove** Add notes (no auto-paste into a note from this command).

### Clipboard payloads

**Text selected** — Quote only:

```markdown
> selected text
>
> [path.pdf · p.N](path.pdf#page=N#:~:text=…)
```

**No text** (page link) —:

```markdown
[path.pdf · p.N](path.pdf#page=N)
```

Rules:

- Align the text fragment with Chrome Text Fragments (`#:~:text=`), not PDF++ `selection=` and not RFC `search=`.
- When the region plugin is **off**: no empty-page region drag; selection is text select or page link only.
- When the region plugin is **on**: Copy link may emit `viewrect=` for a region (see [Region plugin](#region-plugin-pdfregions)); still no `#hl-` from new Copy link.

## Discovery and overlays

### Index

- **Pre-index** the vault on startup / idle so opening a PDF is a **fast per-file lookup**, not a full vault scan at open.
- **Refresh** the index when a Markdown save affects PDF links (add / edit / remove links that target `.pdf` with `#page=` / `#:~:text=` / legacy fragments we still recognize).
- The index is **derived cache only**. If it is cold or wrong, rebuild from Markdown; never treat the index as authoritative over note files.

### Paint

- Paint overlays from `#page=` + `#:~:text=` by resolving the text fragment to **glyph boxes** in the Lumia viewer.
- **Paint order:** hard-written PDF annotations first, then Lumia backlink overlays on top.
- **Hover** overlay → note preview (which note / link).
- **Click** overlay → open that note at the link.
- **Del / Backspace:** ignore overlays; still delete built-in (hard-written) annotations.

## Region plugin (`pdfRegions`)

- `pdfRegions` is the **opt-in** Cordis region / box-selection plugin.
- **Default: off.**
- When off: no empty-page region drag; only text select / page link for Copy link.
- When on: region selection may use `viewrect=` in new Copy link payloads; UX polish for the on state is **out of scope** for this design.

## Migration and teardown

| Item | Behaviour |
|------|-----------|
| Sidecar highlight store | **Drop** (pdfSidecar layout A / `#hl-` as store). |
| Old `*.pdf.lumiere.md` files | User deletes by hand. Extension does **not** auto-migrate or auto-delete. |
| Legacy `#hl-` / `viewrect=` links | **Open** if we still can (best-effort). |
| New Copy link | **Never** emits `#hl-`. Emits `viewrect=` only when the region plugin is on. |
| `pdfRegions` | Becomes opt-in region plugin (default off), not always-on. |

Existing PDFs with hard-written Annotate marks continue to show those marks from the file. Backlink overlays are additive from vault Markdown.

## Out of scope

- Cite / bib Slice 3.
- Obsidian core plugins.
- Lumia id rename.
- Broader startup optimization beyond vault pre-index for this feature.
- Region plugin UX polish when on.
- Auto-migrate old sidecars.

## Testing

- **Unit:** Quote payload with / without selection; `#page=` + `#:~:text=` serialization (Chrome Text Fragment shape); no `#hl-` / no `selection=` / no `search=` from new Copy link; `viewrect=` only when region plugin flag on; index build / refresh on Markdown save that touches PDF links; per-file lookup (no full scan API on open); Del ignores overlay ids and still deletes built-in annots; paint-order helpers (embedded then overlay).
- **Browser:** Copy link with text → clipboard Quote; Copy link with no text → page link; open PDF with vault notes linking `#page=` + `#:~:text=` → overlays; hover preview; click opens note; Del on overlay no-op; Del on freeText / Note still removes; region drag absent when plugin off.
- **Host GUI:** same Copy link / overlay / Del split; screenshots in the impl PR (not required for this docs PR).

## Risks

| Risk | Mitigation |
|------|------------|
| Text fragment fails to resolve (OCR-less / odd encoding) | Soft-fail: skip or mark unresolved overlay; still honor `#page=`. |
| Index stale after external vault edits | Rebuild on idle / known Markdown save hooks; treat cache as disposable. |
| Users expect sidecar `#hl-` create path | Docs + CAPABILITIES: highlight store is vault Markdown; legacy open only. |
| Accidental Del of overlays | Ignore Del/Backspace for overlays; only built-in annots delete. |
| Region drag surprises | Plugin default off; no empty-page region when off. |
| Chrome vs Lumia fragment edge cases | Stick to Chrome `#:~:text=` encoding rules; fixture tests against known strings. |

## Related work (non-goals here)

- Cite / bibliography Slice 3.
- Full Lumia rename.
- Startup opt beyond pre-index.
- W3C Web Annotation export.
- Auto extract embedded highlights ↔ notes.

## Success criteria

- New Copy link never writes sidecar highlight blocks and never emits `#hl-`.
- Text selection → clipboard Quote with `#page=N#:~:text=…`; no selection → `#page=N` only.
- Vault Markdown links are the only highlight source of truth; index is cache-only.
- Opening a PDF uses precomputed per-file index lookup (not full vault scan).
- Overlays paint from `#page=` + `#:~:text=` above hard-written annots; hover preview; click opens note.
- Del / Backspace ignore overlays; still delete built-in Note / freeText.
- Region / box selection off by default (`pdfRegions` opt-in); no empty-page region drag when off.
- No auto-migrate / auto-delete of old sidecar files.
- No TBD placeholders or contradictions left in this document; implementation plan is the next step after this spec is squash-merged.

## Open questions

None for v1 — decisions above are locked. Implementation may choose the in-memory index data structures (and how aggressively to rebuild the derived cache), exact Text Fragment encoding helpers, and note-preview chrome, without a new design pass, as long as source-of-truth, Copy link payloads, overlay behaviour, Del split, region default-off, and migration rules above hold. The index remains a derived cache only — never a second store beside vault Markdown.
