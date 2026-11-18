import { annotationKey } from "@embedpdf/engine-core/public";
import type {
  Annotation,
  AnnotationCapability,
} from "@embedpdf/react/annotation";
import type { DocumentsCapability } from "@embedpdf/react/runtime";
import type { AnnotationOwnership } from "../shared/annotation-ownership";
import {
  keepOwned,
  parseAnnotations,
  serializeAnnotations,
} from "../shared/annotation-store";

/** What bringing back Lumiere's annotations from the store file did. */
export type Restored =
  | { kind: "unreadable" }
  | {
      kind: "restored";
      annotations: readonly Annotation[];
      /** Annotations, or parts of them, the file held that could not be restored. */
      lost: number;
    };

/**
 * Put the annotations of the store file's text into the open document. They
 * go in as one write named `opId`, whose events say they came from the file;
 * the write is not in the undo history, so Undo cannot remove them.
 */
export async function restoreStoredAnnotations(
  annotation: AnnotationCapability,
  text: string,
  opId: string,
): Promise<Restored> {
  const stored = await parseAnnotations(text);
  if (!stored) {
    return { kind: "unreadable" };
  }
  const result = await annotation.import(stored.bundle, {
    pages: stored.pages,
    opId,
  });
  // A name the page already has was restored by an earlier import: nothing lost.
  const dropped = result.dropped.filter(
    (drop) => drop.reason !== "name-conflict",
  );
  return {
    kind: "restored",
    annotations: result.annotations,
    lost: stored.skipped + dropped.length,
  };
}

/** Lumiere's annotations as the store file's text, or null when there are none. */
export async function exportStoreText(
  annotation: AnnotationCapability,
  ownership: Pick<AnnotationOwnership, "isOwn">,
): Promise<string | null> {
  const bundle = await annotation.export();
  const own = keepOwned(bundle, (ref) => ownership.isOwn(annotationKey(ref)));
  return serializeAnnotations(own) ?? null;
}

/**
 * The PDF with every annotation shown, Lumiere's and its own. Incremental
 * (EmbedPDF's default): the original bytes stay as they were and the changes
 * are appended, so a signed PDF stays valid.
 */
export async function downloadPdf(
  documents: DocumentsCapability,
): Promise<ArrayBuffer> {
  return standaloneBuffer(await documents.download());
}

/** The bytes as an ArrayBuffer of their own, which the host's message check requires. */
function standaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer instanceof ArrayBuffer &&
    byteOffset === 0 &&
    byteLength === buffer.byteLength
    ? buffer
    : new Uint8Array(bytes).buffer;
}
