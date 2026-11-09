import type { EffectivePageColors } from "./page-colors";

/**
 * Whether the viewer's engine can draw a page on dark paper. It can: EmbedPDF
 * 3 has no page colour-scheme option of its own, so the viewer runs the
 * engine's host with Lumiere's page reader (src/engine-worker), which draws a
 * dark page as `darkenPage` (shared/dark-page.ts) makes it from PDFium's two
 * renders. See packages/pdf/docs/embedpdf-page-colors-patch.md.
 * Flip this to false to fall back to white pages whatever the Page colours
 * setting says.
 */
export const PAGE_COLORS_ENGINE_AVAILABLE = true;

/**
 * Effective mode the viewer may apply to bitmaps and overlays. When the
 * engine cannot draw it, always Normal regardless of the host's intent.
 */
export function renderablePageColors(
  effective: EffectivePageColors,
): EffectivePageColors {
  return PAGE_COLORS_ENGINE_AVAILABLE ? effective : "normal";
}

/**
 * What the viewer posts to its engine worker to change the page colours.
 * The mode is the worker's state, not a field of each render request:
 * EmbedPDF's render plugin does not forward options it does not know.
 */
export interface PageColorsMessage {
  readonly kind: "lumiere.pageColors";
  readonly mode: EffectivePageColors;
}

/** The message's mode, or undefined when `data` is some other message. */
export function parsePageColorsMessage(
  data: unknown,
): EffectivePageColors | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { kind, mode } = data as { kind?: unknown; mode?: unknown };
  if (kind !== "lumiere.pageColors") {
    return undefined;
  }
  return mode === "dark" || mode === "normal" ? mode : undefined;
}
