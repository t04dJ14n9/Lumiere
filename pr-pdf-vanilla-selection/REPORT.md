# Host GUI report — PR #503 @ 2e4695de (vanilla SelectionLayer)

**When:** 2026-11-05 ~15:52–15:57 Asia/Singapore
**Display:** DISPLAY=:73 (agent desktop), Cursor AppImage via harness launch.sh
**Fixture:** synthetic `selection-cover.pdf` only (no vault)
**Extension:** `/workspace/lumiere-0.1.10-pr503-2e4695de.vsix` @ head `2e4695de`
**Zoom:** **300%** (status bar). Not Fit Width.
**Page colors:** Dark for shots 01–03; Normal for 04–05.

## Verdict

Vanilla EmbedPDF SelectionLayer restored (no #490 normal-blend / opacity / scaleY overrides). Dark paper selection tint is subtle/short multiply over glyph ink — expected for stock EmbedPDF. Light paper shows stock gray selection boxes. Lumia PDF viewer confirmed (status bar Dark/Normal, Page 1/1, 300%).

## Shots (full window, 1920×1200)

| File | What |
|---|---|
| 01-dark-paper-open.png | Dark paper, no selection |
| 02-dark-multiline-selection.png | Dark, three body lines through gypsy |
| 03-dark-descenders-bullets.png | Dark, gypsy + Temporal/Spatial lines |
| 04-light-paper-selection.png | Normal, three body lines |
| 05-light-paper-open.png | Normal, no selection |
