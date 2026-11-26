/** A footnote reference `[^label]` ending the text: `[^30]` before `[^31]`. */
const REFERENCE_AT_END = /\[\^[^\s[\]^]+\]$/;

/**
 * Whether a reference starting after `textBefore` directly follows another
 * reference. Two superscript numbers with nothing between them read as one
 * number ("3031"), so the second is drawn after a comma, as papers write
 * consecutive footnotes ("30,31").
 */
export function followsReference(textBefore: string): boolean {
  return REFERENCE_AT_END.test(textBefore);
}

/** How far back to look: one reference label, with room to spare. */
export const REFERENCE_LOOKBEHIND = 128;
