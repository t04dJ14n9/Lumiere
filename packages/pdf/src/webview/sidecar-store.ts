import type { SidecarHighlight } from "../shared/sidecar-format";

/**
 * The sidecar highlights of the open PDF, as the host last sent them (see
 * shared/sidecar-messages.ts), with the viewer's own changes applied at once
 * so a new highlight shows before the file is written; and which one the
 * reader selected in Annotate mode. `highlights` is null while this host
 * keeps no sidecar: the highlight tool then writes the PDF.
 */
export interface SidecarState {
  readonly highlights: readonly SidecarHighlight[] | null;
  readonly selectedId: string | undefined;
}

let state: SidecarState = { highlights: null, selectedId: undefined };
const listeners = new Set<() => void>();

export function sidecarState(): SidecarState {
  return state;
}

export function onSidecarChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The host's highlights replace the list; a selection whose mark is gone ends. */
export function rememberSidecar(
  highlights: readonly SidecarHighlight[] | null,
): void {
  const kept = highlights?.some(({ id }) => id === state.selectedId);
  update({ highlights, selectedId: kept ? state.selectedId : undefined });
}

/** Show a highlight the viewer just made (or changed) before the host confirms it. */
export function showSidecarHighlight(highlight: SidecarHighlight): void {
  const others = (state.highlights ?? []).filter(
    ({ id }) => id !== highlight.id,
  );
  update({ ...state, highlights: [...others, highlight] });
}

export function hideSidecarHighlight(id: string): void {
  update({
    highlights: (state.highlights ?? []).filter(
      (highlight) => highlight.id !== id,
    ),
    selectedId: state.selectedId === id ? undefined : state.selectedId,
  });
}

export function selectSidecarHighlight(id: string | undefined): void {
  if (id !== state.selectedId) {
    update({ ...state, selectedId: id });
  }
}

export function selectedSidecarHighlight(): SidecarHighlight | undefined {
  const { highlights, selectedId } = state;
  return highlights?.find(({ id }) => id === selectedId);
}

function update(next: SidecarState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}
