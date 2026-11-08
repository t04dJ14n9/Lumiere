import {
  useAnnotationCapability,
  type AnnotationTransferItem,
} from "@embedpdf/plugin-annotation/react";
import { useRegistry } from "@embedpdf/core/react";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { PdfDocumentObject } from "@embedpdf/models";
import { AnnotationOwnership } from "../shared/annotation-ownership";
import {
  parseAnnotations,
  serializeAnnotations,
  type StoredAnnotation,
} from "../shared/annotation-store";
import {
  acceptAnnotationSave,
  annotationLoadState,
} from "./annotation-load-state";
import { postToHost } from "./host";

type Annotations = NonNullable<
  ReturnType<typeof useAnnotationCapability>["provides"]
>;
type Engine = NonNullable<
  ReturnType<
    NonNullable<ReturnType<typeof useRegistry>["registry"]>["getEngine"]
  >
>;

/** Told when the open file now holds every annotation (Save into This PDF worked). */
const savedIntoPdf = new Set<() => void>();

/**
 * Lumia's own annotations live in a file outside the PDF, named by its hash
 * (`annotation-store`), never in the PDF: a vault records the hash of the
 * sources it keeps. On open they are imported over the PDF's own; on each
 * committed change they are exported and sent to the host. Writing the PDF
 * (`write`) happens only when the reader asks for it.
 */
export function useAnnotationSaveSession(document: PdfDocumentObject): {
  retry: () => void;
  write: (to: "pdf" | "copy") => void;
} {
  const { provides: annots } = useAnnotationCapability();
  const { registry } = useRegistry();
  const chain = useRef(Promise.resolve());
  const ownership = useRef(new AnnotationOwnership());
  const documentRef = useRef(document);
  documentRef.current = document;

  const enqueue = useCallback((run: () => Promise<void>): void => {
    chain.current = chain.current.then(run).catch(() => undefined);
  }, []);
  const saveStore = useCallback((): void => {
    if (annots) {
      enqueue(() =>
        saveStoreNow(annots, documentRef.current.id, ownership.current),
      );
    }
  }, [annots, enqueue]);
  const write = useCallback(
    (to: "pdf" | "copy"): void => {
      const engine = registry?.getEngine();
      if (engine) {
        enqueue(() => writePdfNow(engine, documentRef.current, to));
      }
    },
    [registry, enqueue],
  );

  useStoreImport(annots, document, ownership);
  useCommittedChanges(annots, document.id, ownership, saveStore);
  useEffect(() => {
    const listener = (): void => ownership.current.savedIntoPdf();
    savedIntoPdf.add(listener);
    return () => {
      savedIntoPdf.delete(listener);
    };
  }, []);

  return { retry: saveStore, write };
}

/**
 * Bring back Lumia's annotations for these bytes, once per opened document.
 * EmbedPDF queues an import until the PDF's own annotations have loaded.
 */
function useStoreImport(
  annots: Annotations | null,
  document: PdfDocumentObject,
  ownership: MutableRefObject<AnnotationOwnership>,
): void {
  const imported = useRef<PdfDocumentObject | undefined>(undefined);
  useEffect(() => {
    if (!annots || imported.current === document) {
      return;
    }
    imported.current = document;
    ownership.current = new AnnotationOwnership();
    const text = annotationLoadState()?.annotations;
    if (text === undefined) {
      return;
    }
    const items = parseAnnotations(text);
    if (!items) {
      postToHost({
        type: "error",
        message: "The annotation file kept for this PDF could not be read.",
      });
      return;
    }
    ownership.current.imported(items.map((item) => item.annotation.id));
    annots
      .forDocument(document.id)
      .importAnnotations(items as unknown as AnnotationTransferItem[]);
  }, [annots, document, ownership]);
}

/** Each committed change: save Lumia's annotations, or say a PDF's own changed. */
function useCommittedChanges(
  annots: Annotations | null,
  documentId: string,
  ownership: MutableRefObject<AnnotationOwnership>,
  saveStore: () => void,
): void {
  useEffect(() => {
    if (!annots) {
      return;
    }
    return annots.onAnnotationEvent((event) => {
      if (
        event.type === "loaded" ||
        event.documentId !== documentId ||
        !event.committed
      ) {
        return;
      }
      if (
        ownership.current.change(event.type, event.annotation.id) === "store"
      ) {
        saveStore();
        return;
      }
      const load = annotationLoadState()?.load;
      if (load !== undefined) {
        postToHost({ type: "annotationEmbeddedEdit", load });
      }
    });
  }, [annots, documentId, ownership, saveStore]);
}

async function saveStoreNow(
  annots: Annotations,
  documentId: string,
  ownership: AnnotationOwnership,
): Promise<void> {
  const state = annotationLoadState();
  if (!state) {
    return;
  }
  try {
    const items = await annots
      .forDocument(documentId)
      .exportAnnotations()
      .toPromise();
    const own = items.filter((item) => ownership.isOwn(item.annotation.id));
    postToHost({
      type: "annotationStoreSave",
      load: state.load,
      text: serializeAnnotations(own as unknown as StoredAnnotation[]) ?? null,
    });
  } catch (error) {
    failed(state.load, error);
  }
}

async function writePdfNow(
  engine: Engine,
  document: PdfDocumentObject,
  to: "pdf" | "copy",
): Promise<void> {
  const state = annotationLoadState();
  if (!state) {
    return;
  }
  try {
    const data = await engine.saveAsCopy(document).toPromise();
    postToHost(
      to === "pdf"
        ? {
            type: "annotationSave",
            load: state.load,
            baseSha256: state.sha256,
            data,
          }
        : { type: "annotationExport", load: state.load, data },
    );
  } catch (error) {
    failed(state.load, error);
  }
}

function failed(load: number, error: unknown): void {
  postToHost({
    type: "annotationSaveFailed",
    load,
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Apply host annotation save replies to the remembered base hash. */
export function applyAnnotationHostMessage(message: {
  type: string;
  ok?: boolean;
  sha256?: string;
}): void {
  if (
    message.type === "annotationSaveResult" &&
    message.ok === true &&
    typeof message.sha256 === "string"
  ) {
    acceptAnnotationSave(message.sha256);
    for (const listener of savedIntoPdf) {
      listener();
    }
  }
}
