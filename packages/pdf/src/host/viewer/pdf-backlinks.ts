import type { PdfBacklinkHit } from "../../shared/pdf-backlink-index";
import type { HostMessage } from "../../shared/messages";

/** Holds vault backlink hits for one panel and (re)posts them to the viewer. */
export class PdfBacklinkOutlet {
  private hits: PdfBacklinkHit[] | null = null;

  constructor(
    private readonly post: (message: HostMessage) => void,
    private readonly loadNumber: () => number,
  ) {}

  set(hits: PdfBacklinkHit[] | null): void {
    this.hits = hits;
    this.post({
      type: "pdfBacklinks",
      load: this.loadNumber(),
      hits: hits ?? [],
    });
  }

  /** Re-send after a load; the rebuilt page starts with empty overlays. */
  rehydrate(): void {
    if (!this.hits) {
      return;
    }
    this.post({
      type: "pdfBacklinks",
      load: this.loadNumber(),
      hits: this.hits,
    });
  }
}
