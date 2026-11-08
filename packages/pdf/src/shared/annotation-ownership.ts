/**
 * Which annotations on the open PDF are Lumia's own, kept in its annotation
 * file (`annotation-store`), and which are part of the PDF itself. Lumia's
 * are the ones it imported from that file and the ones made since; anything
 * else came with the PDF, and a change to it is kept only by saving into
 * the PDF.
 */
export class AnnotationOwnership {
  private readonly own = new Set<string>();
  /** The PDF's own annotations deleted here: Undo brings them back as a "create". */
  private readonly deletedFromPdf = new Set<string>();

  /** Annotations read back from Lumia's file. */
  imported(ids: Iterable<string>): void {
    for (const id of ids) {
      this.own.add(id);
    }
  }

  isOwn(id: string): boolean {
    return this.own.has(id);
  }

  /** Whether a committed change is to Lumia's annotations ("store") or to the PDF's ("pdf"). */
  change(type: "create" | "update" | "delete", id: string): "store" | "pdf" {
    if (type === "create") {
      if (this.deletedFromPdf.delete(id)) {
        return "pdf";
      }
      this.own.add(id);
      return "store";
    }
    if (!this.own.has(id)) {
      if (type === "delete") {
        this.deletedFromPdf.add(id);
      }
      return "pdf";
    }
    if (type === "delete") {
      this.own.delete(id);
    }
    return "store";
  }

  /** Every annotation shown is now part of the PDF: it was saved into it. */
  savedIntoPdf(): void {
    this.own.clear();
    this.deletedFromPdf.clear();
  }
}
