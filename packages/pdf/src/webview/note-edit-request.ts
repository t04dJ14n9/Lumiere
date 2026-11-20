import type { Annotation, AnnotationRef } from "@embedpdf/react/annotation";

/**
 * Asks the note card (note-card.tsx) to open a mark's note for writing:
 * Edit Note… on the mark the context menu was opened on, or a mark just made
 * by Highlight with Note. `onSaved` hears the mark with its new note.
 */
export interface NoteEditRequest {
  ref: AnnotationRef;
  onSaved?: (mark: Annotation) => void;
}

let listener: ((request: NoteEditRequest) => void) | undefined;

export function requestNoteEdit(request: NoteEditRequest): void {
  listener?.(request);
}

/** The card listens while it is mounted; returns how to stop. */
export function onNoteEditRequest(
  handle: (request: NoteEditRequest) => void,
): () => void {
  listener = handle;
  return () => {
    if (listener === handle) {
      listener = undefined;
    }
  };
}
