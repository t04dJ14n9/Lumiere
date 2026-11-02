# Sidecar highlights

Highlights made with the **Highlight** tool in Annotate mode are kept in a
Markdown file beside the PDF, never in the PDF: the file on disk stays
byte-for-byte as it was. Design:
[docs/superpowers/specs/2026-11-01-pdf-sidecar-highlights-design.md](../../../docs/superpowers/specs/2026-11-01-pdf-sidecar-highlights-design.md).

## Using them

1. Open a PDF, enter Annotate mode (status bar), pick **Highlight**, and drag
   over text. The highlight shows at once and is written to
   `paper.pdf.lumiere.md` beside `paper.pdf` (created on the first one).
2. Click a highlight in Annotate mode to select it. **Copy link to this**
   (right-click) copies `[paper.pdf · p.3](papers/paper.pdf#hl-a1b2c3d4)` and
   the quote; Delete or Backspace (or **Delete Annotation** in the menu)
   removes it from the sidecar.
3. Paste the link into any note. Following it opens the PDF, scrolls to the
   highlight and flashes it. **PDF: Open Location…** takes the same link.
4. Write notes in the sidecar itself, around the highlight blocks: edits to
   highlights touch only their own block, so the prose is kept. Editing or
   deleting a block by hand updates the open viewer when the file is saved.

## The file

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
opacity: 0.45
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
Strings are JSON-quoted with `>` escaped, so no quote can end the comment.
Sidecars kept in a folder also record the PDF's workspace-relative `path`.

## Where sidecars live

| `lumiere.pdf.sidecar.location` | Sidecar of `papers/attn/paper.pdf` |
| --- | --- |
| `sibling` (default) | `papers/attn/paper.pdf.lumiere.md` |
| `directory` | `<workspace>/<lumiere.pdf.sidecar.directory>/paper.pdf.lumiere.md` |

- The folder must be inside the PDF's workspace folder. An empty, absolute or
  escaping (`..`) value, or a PDF outside the workspace, keeps the sidecar
  beside the PDF (with a warning for a bad value, once per session).
- After switching to `directory`, an existing sidecar beside the PDF is still
  the one read and written, until you move it, so notes are never split
  between two files.
- Folder sidecars are flat, named by the PDF's file name: a second PDF of the
  same name finds the first one's sidecar, which is neither shown nor
  overwritten (its `source`/`path` do not match); a warning says so.

## How it works

- `src/shared/sidecar-format.ts`, `sidecar-path.ts`, `sidecar-messages.ts`:
  pure parsing, writing, placement and message validation (unit tested).
- `src/extension/plugins/pdfSidecar`: the plugin. It finds each editor's
  sidecar, reads it (from the open editor, unsaved edits included, or the
  file), watches it, writes highlights (through a workspace edit of just the
  changed text when the note is open, so the TextDocument keeps owning it),
  and opens `#hl-` links through the `pdfPanels` fragment hook.
- `src/webview/sidecar-highlight-tool.ts`: EmbedPDF's highlight tool with our
  `selectionHandler`. No EmbedPDF annotation is created for a sidecar
  highlight, so none can reach `saveAsCopy` when another tool saves the PDF;
  the browser test checks the saved bytes. In a host without the plugin (the
  desktop app for now), the tool marks the PDF as before.
- `src/webview/sidecar-layer.tsx`, `sidecar-selection.ts`, `sidecar-store.ts`:
  drawing, Annotate-mode selection and the viewer's copy of the highlights.

## When the PDF changes

Each highlight keeps its quote and a little text on either side. When the
PDF is replaced by a version whose layout moved (a new arXiv version), the
viewer checks every highlight once: if its boxes no longer lie over its
quote, the quote is found again on its page (the text around it decides
between repeats), the highlight moves there, and its block in the sidecar is
rewritten with the new boxes and `modified` time. A quote that is no longer
on its page leaves the highlight where it was, drawn dashed and fainter as
stale. Highlights written by hand without a quote are left alone.
(`src/shared/sidecar-reattach.ts`, `src/webview/sidecar-reattach.ts`.)

## Not done yet

See the plan's status (`docs/superpowers/plans/2026-11-01-pdf-sidecar-highlights.md`):
citation paragraph auto-highlights, the references list and cite/reference
jumps, and sidecars in the desktop app and DSH.
