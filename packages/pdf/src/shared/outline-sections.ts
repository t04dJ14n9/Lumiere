/** One bookmark that opens a page of the PDF itself. */
export interface OutlineSection {
  title: string;
  /** 1-based. */
  page: number;
  /** 0 for a top-level bookmark. */
  depth: number;
}

/** A PDF with more bookmarks than this is cut off, as a suggestion list could not use them. */
export const MAX_OUTLINE_SECTIONS = 5000;
