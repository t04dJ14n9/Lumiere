import type { PdfBacklinkHit } from "../shared/pdf-backlink-index";

/**
 * Vault Markdown backlink hits for the open PDF, as the host last sent them
 * (`pdfBacklinks`). Derived cache only — never written from the viewer.
 */
export interface BacklinkState {
  readonly hits: readonly PdfBacklinkHit[];
}

let state: BacklinkState = { hits: [] };
const listeners = new Set<() => void>();

export function backlinkState(): BacklinkState {
  return state;
}

export function onBacklinkChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Host hits replace the list (empty clears overlays). */
export function rememberBacklinks(hits: readonly PdfBacklinkHit[]): void {
  state = { hits: [...hits] };
  for (const listener of listeners) {
    listener();
  }
}
