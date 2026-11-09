/**
 * Whether the viewer's engine can draw a page on dark paper. EmbedPDF 3 has no
 * page colour-scheme option: its render options end at size, rotation,
 * background and the layers drawn, so a page comes out white whatever the
 * Page colours setting says. (EmbedPDF 2.15.1 had it through a patch of its
 * engines; the runtime behind 3 still exports PDFium's colour-scheme render,
 * but nothing public reaches it. See packages/pdf/docs/embedpdf-page-colors-patch.md.)
 * Flip this when a render path that honours `FORCED_PAGE_COLORS`
 * (shared/dark-page.ts) is back.
 */
export const PAGE_COLORS_ENGINE_AVAILABLE = false;

/**
 * Effective mode the viewer may apply to bitmaps and overlays. When the
 * engine cannot draw it, always Normal regardless of the host's intent.
 */
export function renderablePageColors(
  effective: "normal" | "dark",
): "normal" | "dark" {
  return PAGE_COLORS_ENGINE_AVAILABLE ? effective : "normal";
}
