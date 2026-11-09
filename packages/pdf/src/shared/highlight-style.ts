import type { EffectivePageColors } from "./page-colors";

/**
 * Annotate highlight appearance (EmbedPDF tool defaults). Defaults depend on
 * effective paper (`lumiere.pdf.pageColors` → normal | dark). Opaque hex +
 * separate opacity only — never bake alpha into the hex.
 *
 * Light paper (normal): translucent classic highlighter, multiplied into the
 * page so body text stays readable (`user-cursor-highlight-too-dark.png` was
 * too opaque/dark).
 * Dark paper: lighter chroma + a bit more opacity under blend `normal`
 * (multiply would vanish on dark paper). EmbedPDF 3 stores the blend mode in
 * the annotation itself, so a mark made on dark paper stays `normal`.
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

/** EmbedPDF `tools.updateDefaults` payload for the highlight tool / colour picks. */
export function highlightToolDefaults(
  paper: EffectivePageColors = "normal",
  color?: string,
): { color: string; opacity: number; blendMode: "multiply" | "normal" } {
  const style = highlightStyleForPaper(paper);
  return {
    color: color ?? style.color,
    opacity: style.opacity,
    blendMode: paper === "dark" ? "normal" : "multiply",
  };
}
