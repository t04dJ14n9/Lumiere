import type { EffectivePageColors } from "../shared/page-colors";
import { renderablePageColors } from "../shared/page-colors-engine";

let effective: "normal" | "dark" = "normal";
const listeners = new Set<() => void>();
/** The live engine's way to be told the page colours (browser-render-environment.ts). */
let engine: ((mode: EffectivePageColors) => void) | undefined;

/** Host-posted effective mode after fail-closed engine gating. */
export function currentPageColors(): "normal" | "dark" {
  return effective;
}

/**
 * Tell `apply` the page colours now and whenever they change: the engine
 * draws the pages in them. A newer engine replaces the one before, which is
 * being let go.
 */
export function connectEnginePageColors(
  apply: (mode: EffectivePageColors) => void,
): void {
  engine = apply;
  apply(effective);
}

/** Apply host effective mode; missing EmbedPDF hook fails closed to Normal. */
export function rememberPageColors(
  value: "normal" | "dark",
): "normal" | "dark" {
  effective = renderablePageColors(value);
  applyOverlayTokens(effective);
  // Before the listeners, one of which has the viewer draw its pictures
  // again: the engine must already be drawing them in the new colours.
  engine?.(effective);
  for (const listener of listeners) {
    listener();
  }
  return effective;
}

export function onPageColorsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Contrast-aware overlay tokens for white vs dark paper. */
function applyOverlayTokens(mode: "normal" | "dark"): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  root.dataset.pageColors = mode;
}
