/** `get_pdf_page_text`: the text of some pages of a PDF of the workspace. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeDeps } from "../deps";
import { guarded, jsonResult, ToolError } from "./results";
import {
  hasNoText,
  NO_TEXT_NOTE,
  pathArgument,
  readPdfPages,
  REFUSED_PDFS,
} from "./pdf-text-source";

/** Pages returned at most in one call; the agent asks again for the next ones. */
export const MAX_PAGES = 20;
/** Characters returned at most in one call, over all its pages. */
export const MAX_CHARS = 50_000;

export interface PageText {
  page: number;
  text: string;
  /** The page is longer than the call may return, and this is its start. */
  cut?: true;
}

export interface PageRange {
  pages: PageText[];
  /** Pages or text were left out, because of the caps. */
  truncated: boolean;
  /** The first page that was left out, to ask for next. */
  nextPage?: number;
}

export function registerPdfPageText(server: McpServer, deps: BridgeDeps): void {
  server.registerTool(
    "get_pdf_page_text",
    {
      title: "PDF page text",
      description:
        "The text of pages of a PDF in the workspace, as PDFium extracts it (reading order, line breaks as \\n), " +
        "read from the file, so the PDF need not be open. Returns { file, pageCount, pages: [{ page, text }] }. " +
        `A call returns at most ${MAX_PAGES} pages and about ${MAX_CHARS / 1000}k characters; when it cuts, ` +
        "`truncated` is true and `nextPage` is the first page left out (a single page longer than the limit is " +
        "returned cut, marked `cut`). Pages are 1-based. A scanned PDF has no text layer and returns empty pages. " +
        `${REFUSED_PDFS} ` +
        "Omit `path` for the PDF the user viewed last.",
      inputSchema: {
        path: pathArgument,
        firstPage: z.number().int().min(1).describe("The first page, 1-based."),
        lastPage: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("The last page (default: firstPage)."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ path, firstPage, lastPage }) =>
      guarded(async () => {
        const { file, pages } = await readPdfPages(path, deps);
        const last = lastPage ?? firstPage;
        if (last < firstPage) {
          throw new ToolError("lastPage is before firstPage.");
        }
        if (firstPage > pages.length) {
          throw new ToolError(
            `${file} has ${pages.length} pages: firstPage ${firstPage} is past the end.`,
          );
        }
        return jsonResult({
          file,
          pageCount: pages.length,
          ...takePages(pages, firstPage, last),
          ...(hasNoText(pages) ? { note: NO_TEXT_NOTE } : {}),
        });
      }),
  );
}

/**
 * Pages `first` to `last` (1-based, `last` clamped to the PDF's end), within
 * the caps. Only the first page is ever cut: a later page that does not fit
 * is left for the next call, whole.
 */
export function takePages(
  pages: readonly string[],
  first: number,
  last: number,
): PageRange {
  const end = Math.min(last, pages.length);
  const taken: PageText[] = [];
  let budget = MAX_CHARS;
  for (let page = first; page <= end; page++) {
    const text = normalizeLines(pages[page - 1] ?? "");
    const full = taken.length === 0 && text.length > budget;
    if (taken.length >= MAX_PAGES || (!full && text.length > budget)) {
      return { pages: taken, truncated: true, nextPage: page };
    }
    taken.push(
      full ? { page, text: text.slice(0, budget), cut: true } : { page, text },
    );
    budget -= taken.at(-1)!.text.length;
  }
  return { pages: taken, truncated: taken.some((entry) => entry.cut) };
}

/** PDFium writes "\r\n" between lines, and the engine "\n"; agents get "\n". */
function normalizeLines(text: string): string {
  return text.replace(/\r\n?/gu, "\n").trimEnd();
}
