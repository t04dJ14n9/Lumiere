import { annotationKey } from "@embedpdf/engine-core/public";
import {
  AnnotationToken,
  useAnnotationEvent,
  useAnnotationState,
  type AnnotationRef,
} from "@embedpdf/react/annotation";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import { useCallback, useEffect, useMemo } from "react";
import type { HostMessage } from "../shared/messages";
import {
  annotationLoadState,
  rememberStoreText,
  settlePdfWrite,
  type SaveResult,
} from "./annotation-load-state";
import { StoreSession } from "./annotation-store-session";
import { postToHost } from "./host";

/** Told how each Save into This PDF ended, by the viewer's number for its write. */
const pdfWriteResults = new Set<(write: number, ok: boolean) => void>();

interface StoreChange {
  sha256: string;
  revision: number;
  text: string | undefined;
}

/** Told what another editor of this PDF left in its annotation file. */
const storeChanges = new Set<(change: StoreChange) => void>();

/** Another editor saved the annotations of the bytes this viewer shows. */
export function applyStoreChange(
  message: Extract<HostMessage, { type: "annotationStoreChanged" }>,
): void {
  const state = annotationLoadState();
  if (message.load !== state?.load || message.sha256 !== state.sha256) {
    return;
  }
  for (const listener of storeChanges) {
    listener({
      sha256: message.sha256,
      revision: message.revision,
      text: message.text ?? undefined,
    });
  }
}

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
  /** Whether an annotation is Lumiere's own, kept in its file, not the PDF's. */
  isOwn: (ref: AnnotationRef) => boolean;
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
            keepStoreText: rememberStoreText,
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
    const listener = (write: number, ok: boolean): void => {
      if (ok) {
        session.savedIntoPdf(write);
      } else {
        session.pdfWriteFailed(write);
      }
    };
    pdfWriteResults.add(listener);
    const showChange = (change: StoreChange): void =>
      session.showStoreFile(change);
    storeChanges.add(showChange);
    return () => {
      pdfWriteResults.delete(listener);
      storeChanges.delete(showChange);
    };
  }, [session]);

  const retry = useCallback(() => session?.saveStore(), [session]);
  const write = useCallback(
    (to: "pdf" | "copy") => session?.writePdf(documents, to),
    [session, documents],
  );
  const isOwn = useCallback(
    (ref: AnnotationRef) =>
      session?.ownership.isOwn(annotationKey(ref)) ?? false,
    [session],
  );
  return { retry, write, isOwn };
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
export function applyAnnotationHostMessage(
  message: SaveResult & { type: string },
): void {
  if (message.type !== "annotationSaveResult") {
    return;
  }
  const settled = settlePdfWrite(message);
  if (settled) {
    for (const listener of pdfWriteResults) {
      listener(settled.write, settled.ok);
    }
  }
}
