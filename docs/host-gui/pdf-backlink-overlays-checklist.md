# Host GUI checklist — PDF backlink overlays (Chrome)

**Risk:** Medium (product/UI). Capture on real Cursor / VS Code before merge
ask. Do **not** commit PNGs here — upload to the PR body (see
[README.md](README.md)). Synthetic fixtures only (e.g. `outline.pdf`); never
WorkVault / personal notes.

PR bot / Host GUI pass must capture evidence for:

1. **Text select → Copy link to this** → clipboard Quote with `#page=` +
   `#:~:text=` (Chrome Text Fragment; dashes as `%2D`).
2. **No selection → Copy link** → `#page=N` only (command enabled whenever the
   PDF is active).
3. **Note with deep link** → open PDF → backlink overlay → hover preview →
   click opens the note.
4. **Del split:** Del on overlay is a no-op; Del on Note / freeText (embedded)
   deletes.
5. **Regions off (default):** at Fit Width with the page taller than the
   viewer, empty-page drag pans (page counter stays put) and creates no
   region; **Select Region** absent from menus / slim toolbar / shortcut.

Suggested shot labels for the PR body: `Copy link Quote`, `overlays`,
`Del split`, `regions off`.
