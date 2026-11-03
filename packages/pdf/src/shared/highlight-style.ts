import type { EffectivePageColors } from "./page-colors";

/**
 * Shared Annotate highlight appearance for EmbedPDF (PDF-embedded) and sidecar
 * marks. Defaults depend on effective paper (`lumiere.pdf.pageColors` →
 * normal | dark). Opaque hex + separate opacity only — never bake alpha into
 * the hex (page.css also applies `opacity`, which would double-dim).
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

/** Fallback when paper mode is unknown (parse / legacy): light-paper pair. */
export const BUILTIN_HIGHLIGHT_COLOR = HIGHLIGHT_BY_PAPER.normal.color;
export const BUILTIN_HIGHLIGHT_OPACITY = HIGHLIGHT_BY_PAPER.normal.opacity;

/**
 * EmbedPDF's built-in highlight tool default before Lumia `setToolDefaults`.
 * CVM dark-paper bands measured median rgb(255,205,69) = this stock @ opacity 1.
 */
export const EMBEDPDF_STOCK_HIGHLIGHT_COLOR = "#FFCD45";
export const EMBEDPDF_STOCK_HIGHLIGHT_OPACITY = 1;

export function highlightStyleForPaper(
  paper: EffectivePageColors,
): HighlightAppearance {
  return HIGHLIGHT_BY_PAPER[paper];
}

/**
 * Colour and opacity from an EmbedPDF tool's defaults, else paper fallback.
 * Stock `#FFCD45` (and any opacity 1 left by EmbedPDF) is replaced with the
 * paper-aware pair so a missed `setToolDefaults` cannot write solid yellow.
 */
export function highlightStyleOf(
  defaults: {
    strokeColor?: unknown;
    color?: unknown;
    opacity?: unknown;
  },
  paper: EffectivePageColors = "normal",
): HighlightAppearance {
  const fallback = highlightStyleForPaper(paper);
  const color = [defaults.strokeColor, defaults.color].find(
    (value): value is string =>
      typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value),
  );
  const opacity = Number(defaults.opacity);
  const resolved: HighlightAppearance = {
    color: (color ?? fallback.color).toUpperCase(),
    opacity: opacity > 0 && opacity <= 1 ? opacity : fallback.opacity,
  };
  if (resolved.color === EMBEDPDF_STOCK_HIGHLIGHT_COLOR) {
    return fallback;
  }
  if (resolved.opacity === EMBEDPDF_STOCK_HIGHLIGHT_OPACITY) {
    return { color: resolved.color, opacity: fallback.opacity };
  }
  return resolved;
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

/**
 * Pre-#482 sidecar default. Dark paper CSS multiplied by 0.4, so 0.45 rendered
 * ~0.18. New writes use paper-aware 0.3 / 0.4 with no CSS factor.
 */
export const LEGACY_SIDECAR_OPACITY = 0.45;
/** Former `#root[data-page-colors="dark"]` factor on `--highlight-opacity`. */
export const LEGACY_DARK_OPACITY_FACTOR = 0.4;

/**
 * Opacity applied when painting a sidecar mark. On dark paper, legacy 0.45
 * keeps its old effective look (~0.18); new 0.4 (and other values) pass through.
 */
export function displayHighlightOpacity(
  stored: number,
  paper: EffectivePageColors,
): number {
  if (paper === "dark" && stored === LEGACY_SIDECAR_OPACITY) {
    // Exact former effective opacity (0.45 * 0.4); avoid float noise.
    return 0.18;
  }
  return stored;
}

/**
 * Paint-time colour + opacity for a stored sidecar mark. Remaps EmbedPDF stock
 * `#FFCD45` / opacity 1 to the current paper pair so legacy opaque yellow does
 * not dazzle on dark paper even when the sidecar file was never rewritten.
 */
export function displayHighlightAppearance(
  stored: { color: string; opacity: number },
  paper: EffectivePageColors,
): HighlightAppearance {
  const color = stored.color.toUpperCase();
  if (color === EMBEDPDF_STOCK_HIGHLIGHT_COLOR) {
    return highlightStyleForPaper(paper);
  }
  if (stored.opacity === EMBEDPDF_STOCK_HIGHLIGHT_OPACITY) {
    return {
      color,
      opacity: highlightStyleForPaper(paper).opacity,
    };
  }
  return {
    color,
    opacity: displayHighlightOpacity(stored.opacity, paper),
  };
}
