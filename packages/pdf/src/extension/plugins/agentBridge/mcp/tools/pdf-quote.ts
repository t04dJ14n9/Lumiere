/** `locate_pdf_quote`: which page of a PDF of the workspace a quoted passage is on. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { foldText } from "../../../../../shared/page-text-fold";
import {
  findTextFragment,
  type TextFragmentQuery,
} from "../../../../../shared/pdf-backlink-resolve";
import { formatPdfDeepLink } from "../../../../../shared/text-fragment";
import type { BridgeDeps } from "../deps";
import { guarded, jsonResult, ToolError } from "./results";
import {
  flat,
  hasNoText,
  LINK_QUOTE_CHARS,
  NO_TEXT_NOTE,
  pathArgument,
  readPdfPages,
  REFUSED_PDFS,
} from "./pdf-text-source";

/** Pages listed at most; a passage that is everywhere is cut, with a flag. */
export const MAX_QUOTE_PAGES = 10;
/** How much of the page's own wording of a match is returned. */
const MAX_MATCH_CHARS = 200;

export interface QuoteMatch {
  /** 1-based. */
  page: number;
  /** The passage as the page has it, on one line. */
  text: string;
}

const DESCRIPTION =
  "Find the page of a PDF in the workspace that holds a quoted passage, read from the file, so the PDF " +
  "need not be open. Case and whitespace differences (line breaks included) do not matter, as in a " +
  "browser's text fragment. Returns { file, found, ambiguous, count, matches: [{ page, text, link }] }: " +
  "one match per page, at the first place on it, up to " +
  `${MAX_QUOTE_PAGES} pages (\`truncated\` when more match); \`count\` is the pages that match. ` +
  "`ambiguous` is true when more than one page matches: pass `prefix` and `suffix` (the words right " +
  "before and after the passage) or `page` to pin it. A passage that occurs twice on one page is " +
  "reported once. `text` is the passage as the page words it, `link` opens the page at it " +
  "(usable with open_pdf_location). Nothing found is `found: false`, not an error. " +
  `${REFUSED_PDFS} ` +
  "Omit `path` for the PDF the user viewed last.";

const INPUT = {
  path: pathArgument,
  quote: z
    .string()
    .min(1)
    .max(2000)
    .describe("The passage, as quoted: it may span lines."),
  prefix: z
    .string()
    .max(500)
    .optional()
    .describe("Text that must come right before the passage."),
  suffix: z
    .string()
    .max(500)
    .optional()
    .describe("Text that must come right after the passage."),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Look on this page only (1-based)."),
};

export function registerLocatePdfQuote(
  server: McpServer,
  deps: BridgeDeps,
): void {
  server.registerTool(
    "locate_pdf_quote",
    {
      title: "Locate a quote in a PDF",
      description: DESCRIPTION,
      inputSchema: INPUT,
      annotations: { readOnlyHint: true },
    },
    (args) => guarded(() => locatePdfQuote(args, deps)),
  );
}

async function locatePdfQuote(
  { path, quote, prefix, suffix, page }: z.infer<z.ZodObject<typeof INPUT>>,
  deps: BridgeDeps,
) {
  if (foldText(quote).text === "") {
    throw new ToolError("The quote is blank.");
  }
  const { file, pages } = await readPdfPages(path, deps);
  if (page !== undefined && page > pages.length) {
    throw new ToolError(
      `${file} has ${pages.length} pages: page ${page} is past the end.`,
    );
  }
  const found = locateQuote(
    pages,
    {
      textStart: quote,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    },
    page,
  );
  return jsonResult({
    file,
    found: found.length > 0,
    ambiguous: found.length > 1,
    count: found.length,
    matches: found.slice(0, MAX_QUOTE_PAGES).map((match) => ({
      ...match,
      link: formatPdfDeepLink(file, {
        page: match.page,
        text: match.text.slice(0, LINK_QUOTE_CHARS),
      }),
    })),
    ...(found.length > MAX_QUOTE_PAGES ? { truncated: true } : {}),
    ...(found.length === 0 && hasNoText(pages) ? { note: NO_TEXT_NOTE } : {}),
  });
}

/**
 * The pages (index 0 is page 1) where the fragment matches, or only `page`'s,
 * each at its first match: `findTextFragment` finds the first place on a page.
 */
export function locateQuote(
  pages: readonly string[],
  query: TextFragmentQuery,
  page?: number,
): QuoteMatch[] {
  const found: QuoteMatch[] = [];
  pages.forEach((raw, index) => {
    if (page !== undefined && page !== index + 1) {
      return;
    }
    const range = findTextFragment(raw, query);
    if (range) {
      found.push({
        page: index + 1,
        text: flat(raw.slice(range.start, range.end)).slice(0, MAX_MATCH_CHARS),
      });
    }
  });
  return found;
}
