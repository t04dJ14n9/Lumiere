/**
 * What the PDF text tools share: the `path` argument, and the text of the PDF
 * it names read by the host's own PDFium, so the PDF need not be open.
 */
import { z } from "zod";
import {
  MAX_TEXT_PDF_BYTES,
  REFUSAL_MESSAGES,
  type PdfRefusal,
} from "../../../../pdf-text/reader";
import { displayPath } from "../../../pdf/files";
import type { BridgeDeps } from "../deps";
import { ToolError } from "./results";
import { pdfSubject } from "./workspace-pdf";

export const pathArgument = z
  .string()
  .min(1)
  .max(4096)
  .optional()
  .describe(
    "A PDF inside the workspace (relative to a workspace folder, or absolute). Default: the last PDF viewed.",
  );

export interface PdfPages {
  /** The path to name the PDF by in answers and links (`displayPath`). */
  file: string;
  /** The text of each page; index 0 is page 1. */
  pages: readonly string[];
}

/** The text of the PDF in `path`; a `ToolError` says why when there is none. */
export async function readPdfPages(
  path: string | undefined,
  deps: BridgeDeps,
): Promise<PdfPages> {
  const subject = await pdfSubject(path, deps);
  const file = displayPath(subject.uri);
  const reading = await deps.text.pages(subject.uri.toString());
  if (!reading.ok) {
    throw refusal(file, reading.reason);
  }
  return { file, pages: reading.value };
}

export function refusal(file: string, reason: PdfRefusal): ToolError {
  return new ToolError(`${file} ${REFUSAL_MESSAGES[reason]}`);
}

/** What every tool description says about the PDFs that are not read. */
export const REFUSED_PDFS = `A PDF that needs a password, forbids copying its text, or is larger than ${MAX_TEXT_PDF_BYTES / 2 ** 20} MB is refused.`;

/** How much of a text a link quotes: enough to be found, short enough to read (as `get_ide_context`). */
export const LINK_QUOTE_CHARS = 120;

/** Said when no page has any text: a scan, where the page images hold the words. */
export const NO_TEXT_NOTE =
  "This PDF has no text layer (a scan?), so there is nothing to read or search.";

export function hasNoText(pages: readonly string[]): boolean {
  return pages.every((text) => text.trim() === "");
}

/** `text` on one line. */
export function flat(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}
