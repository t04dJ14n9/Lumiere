import { annotationKey } from "@embedpdf/engine-core/public";
import type {
  AnnotationCapability,
  AnnotationRef,
} from "@embedpdf/react/annotation";
import { annotationEntries } from "../shared/annotation-merge";
import type { AnnotationOwnership } from "../shared/annotation-ownership";
import {
  exportStoreText,
  restoreStoredAnnotations,
} from "./annotation-persist";

/**
 * Show what another editor of the same PDF left in the annotation file:
 * `previous` is the file as this viewer last had it from the host, `next`
 * as it is now. Lumiere's annotations shown here that this viewer has not
 * changed since `previous` take the file's version: one gone from it was
 * deleted there, one that differs was changed there (deleted here and put
 * back as the file has it). One changed here as well keeps this viewer's
 * change, which its next save merges. New ones are imported as at open,
 * under `opId`, out of the undo history. Resolves how many the file held
 * that could not be shown.
 */
export async function showStoreFile(
  annotation: AnnotationCapability,
  ownership: AnnotationOwnership,
  file: { previous: string | undefined; next: string | undefined },
  opId: string,
): Promise<number> {
  const before = annotationEntries(file.previous) ?? new Map();
  const after = annotationEntries(file.next);
  const shown = annotationEntries(
    (await exportStoreText(annotation, ownership)) ?? undefined,
  );
  if (!after || !shown) {
    return 0;
  }
  for (const [id, entry] of shown) {
    const untouched = before.get(id)?.content === entry.content;
    const theirs = after.get(id)?.content;
    if (untouched && theirs !== entry.content) {
      // Deleting it with its popup and replies; one of those may be gone already.
      await annotation
        .delete(entry.ref as AnnotationRef)
        .catch(() => undefined);
    }
  }
  if (file.next === undefined) {
    return 0;
  }
  // Those still shown are dropped as name conflicts: only what is missing comes in.
  const restored = await restoreStoredAnnotations(annotation, file.next, opId);
  if (restored.kind !== "restored") {
    return 0;
  }
  ownership.imported(
    restored.annotations.map((found) => annotationKey(found.ref)),
  );
  return restored.lost;
}
