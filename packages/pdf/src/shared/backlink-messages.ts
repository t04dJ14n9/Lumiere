/**
 * Host ↔ viewer messages for vault Markdown → PDF backlink overlays.
 * Validation lives here so messages.ts stays under the file size limit.
 */
import type { PdfBacklinkHit } from "./pdf-backlink-index";

export type OpenBacklinkNoteMessage = {
  type: "openBacklinkNote";
  noteUri: string;
  linkOffset: number;
};

export type PdfBacklinksHostMessage = {
  type: "pdfBacklinks";
  load: number;
  hits: PdfBacklinkHit[];
};

const MAX_NOTE_URI = 8_192;

/** An `openBacklinkNote` from the viewer, if every field holds. */
export function parseOpenBacklinkNote(
  message: Record<string, unknown>,
): OpenBacklinkNoteMessage | undefined {
  if (
    typeof message.noteUri !== "string" ||
    message.noteUri.length < 1 ||
    message.noteUri.length > MAX_NOTE_URI ||
    typeof message.linkOffset !== "number" ||
    !Number.isSafeInteger(message.linkOffset) ||
    message.linkOffset < 0
  ) {
    return undefined;
  }
  return {
    type: "openBacklinkNote",
    noteUri: message.noteUri,
    linkOffset: message.linkOffset,
  };
}
