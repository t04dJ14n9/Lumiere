import {
  AnnotationToken,
  useAnnotationEvent,
  useAnnotationState,
} from "@embedpdf/react/annotation";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import { useCallback, useEffect, useMemo } from "react";
import {
  acceptAnnotationSave,
  annotationLoadState,
} from "./annotation-load-state";
import { StoreSession } from "./annotation-store-session";
import { postToHost } from "./host";

/** Told when the open file now holds every annotation (Save into This PDF worked). */
const savedIntoPdf = new Set<() => void>();

/**
 * Lumiere's own annotations live in a file outside the PDF, named by its hash
 * (`annotation-store`), never in the PDF: a vault records the hash of the
 * sources it keeps. On open they are imported over the PDF's own; on each
 * committed change they are exported and sent to the host. Writing the PDF
 * (`write`) happens only when the reader asks for it.
 */
export function useAnnotationSaveSession(): {
  retry: () => void;
  write: (to: "pdf" | "copy") => void;
} {
  // One session per opened document: the capability is new for each, and
  // annotation keys, unlike a PDF's own, do not survive an open.
  const annotation = useOptionalCapability(AnnotationToken);
  const status = useAnnotationState((state) => state.status);
  const documents = useDocuments();
  const session = useMemo(
    () =>
      annotation
        ? new StoreSession(annotation, {
            post: postToHost,
            loadState: annotationLoadState,
          })
        : undefined,
    [annotation],
  );

  useEffect(() => {
    if (session && status !== "loading") {
      session.restore(status === "ready");
    }
  }, [session, status]);
  useCommittedChanges(session);
  useEffect(() => {
    if (!session) {
      return;
    }
    const listener = (): void => session.savedIntoPdf();
    savedIntoPdf.add(listener);
    return () => {
      savedIntoPdf.delete(listener);
    };
  }, [session]);

  const retry = useCallback(() => session?.saveStore(), [session]);
  const write = useCallback(
    (to: "pdf" | "copy") => session?.writePdf(documents, to),
    [session, documents],
  );
  return { retry, write };
}

/** Each committed change: save Lumiere's annotations, or say a PDF's own changed. */
function useCommittedChanges(session: StoreSession | undefined): void {
  useAnnotationEvent(
    (a) => a.onCreated,
    (event) =>
      session?.committed("create", [event.annotation.ref], event.origin),
  );
  useAnnotationEvent(
    (a) => a.onUpdated,
    (event) =>
      session?.committed("update", [event.annotation.ref], event.origin),
  );
  useAnnotationEvent(
    (a) => a.onDeleted,
    (event) => session?.committed("delete", event.refs, event.origin),
  );
  // Undo of a delete and redo of a create bring annotations back as a page
  // read again, not as a create.
  useAnnotationEvent(
    (a) => a.onResynced,
    () => session?.resynced(),
  );
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
