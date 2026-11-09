/**
 * Host ↔ viewer messages about annotations: Lumiere's own kept in a file
 * beside the PDF (`annotation-store`), and the PDF written with them only
 * when the reader asks. Validation lives here so messages.ts stays under
 * the file size limit.
 */

export type AnnotationViewerMessage =
  /** The PDF with its annotations, to overwrite the open file (Save into This PDF). */
  | {
      type: "annotationSave";
      load: number;
      baseSha256: string;
      data: ArrayBuffer;
    }
  | { type: "annotationSaveFailed"; load: number; message: string }
  /** Lumiere's own annotations as the store file's text; null when there are none. */
  | { type: "annotationStoreSave"; load: number; text: string | null }
  /** The PDF with its annotations, for a new file (Export Annotated Copy). */
  | { type: "annotationExport"; load: number; data: ArrayBuffer }
  /** An annotation that is part of the PDF changed: only saving into it keeps that. */
  | { type: "annotationEmbeddedEdit"; load: number };

export type AnnotationHostMessage =
  | { type: "annotationSaveResult"; load: number; ok: true; sha256: string }
  | {
      type: "annotationSaveResult";
      load: number;
      ok: false;
      reason: "conflict" | "error";
      message: string;
    }
  | { type: "annotationRetry"; load: number }
  /** Send the PDF with its annotations: to overwrite the open file, or for a copy. */
  | { type: "annotationWrite"; load: number; to: "pdf" | "copy" };

type Fields = Record<string, unknown>;

const MAX_ANNOTATION_SAVE_BYTES = 512_000_000;
/** Stamps carry their images, so a store can be large; still far below a PDF. */
const MAX_ANNOTATION_STORE_LENGTH = 64_000_000;

/** One parser per annotation message from the viewer; each checks every field. */
export const ANNOTATION_VIEWER_PARSERS: Readonly<
  Record<string, (message: Fields) => AnnotationViewerMessage | undefined>
> = {
  annotationSave: parseAnnotationSave,
  annotationSaveFailed: (message) =>
    isLoad(message.load) &&
    typeof message.message === "string" &&
    message.message.length <= 2000
      ? {
          type: "annotationSaveFailed",
          load: message.load,
          message: message.message,
        }
      : undefined,
  annotationStoreSave: (message) =>
    isLoad(message.load) &&
    (message.text === null ||
      (typeof message.text === "string" &&
        message.text.length <= MAX_ANNOTATION_STORE_LENGTH))
      ? {
          type: "annotationStoreSave",
          load: message.load,
          text: message.text,
        }
      : undefined,
  annotationExport: (message) => {
    const data = asStandaloneArrayBuffer(message.data);
    return isLoad(message.load) &&
      data &&
      data.byteLength <= MAX_ANNOTATION_SAVE_BYTES
      ? { type: "annotationExport", load: message.load, data }
      : undefined;
  },
  annotationEmbeddedEdit: (message) =>
    isLoad(message.load)
      ? { type: "annotationEmbeddedEdit", load: message.load }
      : undefined,
};

function parseAnnotationSave(
  message: Fields,
): AnnotationViewerMessage | undefined {
  if (
    !isLoad(message.load) ||
    typeof message.baseSha256 !== "string" ||
    message.baseSha256.length < 1 ||
    message.baseSha256.length > 128
  ) {
    return undefined;
  }
  const data = asStandaloneArrayBuffer(message.data);
  if (!data || data.byteLength > MAX_ANNOTATION_SAVE_BYTES) {
    return undefined;
  }
  return {
    type: "annotationSave",
    load: message.load,
    baseSha256: message.baseSha256,
    data,
  };
}

/** A load number: the host numbers loads 1, 2, 3… (see messages.ts). */
function isLoad(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function asStandaloneArrayBuffer(value: unknown): ArrayBuffer | undefined {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (!ArrayBuffer.isView(value)) {
    return undefined;
  }
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

/** Whether a (parsed) viewer message is about annotations. */
export function isAnnotationViewerMessage<T extends { type: string }>(
  message: T,
): message is Extract<T, AnnotationViewerMessage> {
  return Object.hasOwn(ANNOTATION_VIEWER_PARSERS, message.type);
}
