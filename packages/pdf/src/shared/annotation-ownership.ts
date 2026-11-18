/**
 * Which annotations on the open PDF are Lumiere's own, kept in its annotation
 * file (`annotation-store`), and which are part of the PDF itself. Lumiere's
 * are the ones it imported from that file and the ones made since; anything
 * else came with the PDF, and a change to it is kept only by saving into
 * the PDF.
 *
 * Annotations are named by `annotationKey(ref)`. A PDF's own keep their key
 * for the same bytes; Lumiere's get new ones in every session (the import
 * gives each its key), so ownership is never carried across opens.
 */
export class AnnotationOwnership {
  private readonly own = new Set<string>();

  /** Annotations read back from Lumiere's file. */
  imported(keys: Iterable<string>): void {
    for (const key of keys) {
      this.own.add(key);
    }
  }

  isOwn(key: string): boolean {
    return this.own.has(key);
  }

  /**
   * Whether a committed change is to Lumiere's annotations ("store") or to the
   * PDF's ("pdf"). Deleting does not disown: Undo restores an annotation
   * under the same key, and it is then Lumiere's again.
   */
  change(type: "create" | "update" | "delete", key: string): "store" | "pdf" {
    if (type === "create") {
      this.own.add(key);
      return "store";
    }
    return this.own.has(key) ? "store" : "pdf";
  }

  /** Lumiere's annotations now. */
  keys(): string[] {
    return [...this.own];
  }

  /**
   * These were saved into the PDF and are part of it now. True when Lumiere
   * still owns others: ones made after the PDF was taken for that save.
   */
  savedIntoPdf(keys: Iterable<string>): boolean {
    for (const key of keys) {
      this.own.delete(key);
    }
    return this.own.size > 0;
  }
}
