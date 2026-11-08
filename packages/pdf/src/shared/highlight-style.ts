import type { EffectivePageColors } from "./page-colors";

/**
 * Annotate highlight appearance for EmbedPDF (PDF-embedded) marks. Defaults
 * depend on effective paper (`lumiere.pdf.pageColors` → normal | dark). Opaque
 * hex + separate opacity only — never bake alpha into the hex.
 *
 * Light paper (normal): translucent classic highlighter so body text stays
 * readable (`user-cursor-highlight-too-dark.png` was too opaque/dark).
 * Dark paper: lighter chroma + a bit more opacity under mix-blend normal
 * (multiply would vanish on dark paper).
 *
 * Alternate dark candidate: `#FFEC8A` @ 0.38 — similar; locked `#FFF59D` @ 0.4.
 */
export type HighlightAppearance = { color: string; opacity: number };

export const HIGHLIGHT_BY_PAPER: Record<
  EffectivePageColors,
  HighlightAppearance
> = {
  normal: { color: "#FFE566", opacity: 0.3 },
  dark: { color: "#FFF59D", opacity: 0.4 },
};

export function highlightStyleForPaper(
  paper: EffectivePageColors,
): HighlightAppearance {
  return HIGHLIGHT_BY_PAPER[paper];
}

/** EmbedPDF `setToolDefaults` payload for the highlight tool / colour picks. */
export function highlightToolDefaults(
  paper: EffectivePageColors = "normal",
  color?: string,
): { strokeColor: string; color: string; opacity: number } {
  const style = highlightStyleForPaper(paper);
  const resolved = color ?? style.color;
  return {
    strokeColor: resolved,
    color: resolved,
    opacity: style.opacity,
  };
}
