/**
 * The bookmarks of a PDF, which Lumia offers after `[[paper.pdf#`. The
 * extension's composition root provides this service from Lumia PDF
 * (`createPdfOutlines`), so a host without a PDF engine simply lacks it.
 * Lumia owns the interface and Lumia PDF's reader satisfies it, as
 * `NoteSelections` does the other way round.
 */
export interface PdfSection {
  readonly title: string;
  /** 1-based. */
  readonly page: number;
  /** 0 for a top-level bookmark. */
  readonly depth: number;
}

export interface PdfOutlines {
  /**
   * The bookmarks of the PDF at `uri` that open one of its pages, in
   * document order. Empty when there are none or the PDF cannot be read.
   */
  sections(uri: string): Promise<readonly PdfSection[]>;
}

declare module "@workshop/core" {
  interface Services {
    /** The root: bookmarks of PDFs in the workspace, where a PDF engine exists. */
    pdfOutlines: PdfOutlines;
  }
}
