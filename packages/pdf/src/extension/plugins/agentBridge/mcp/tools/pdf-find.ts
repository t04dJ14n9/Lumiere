/** `find_in_pdf`: where a text occurs in a PDF of the workspace. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  foldText,
  rawRangeOf,
  type FoldedText,
  type TextRange,
} from "../../../../../shared/page-text-fold";
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

export const DEFAULT_MATCHES = 20;
export const MAX_MATCHES = 50;
/** The text of a match and what is around it, in a snippet. */
const SNIPPET_CHARS = 160;

export interface TextMatch {
  /** 1-based. */
  page: number;
  /** The match and its surroundings, on one line. */
  snippet: string;
  /** The matched text as the page has it, on one line. */
  text: string;
}

export function registerFindInPdf(server: McpServer, deps: BridgeDeps): void {
  server.registerTool(
    "find_in_pdf",
    {
      title: "Find text in a PDF",
      description:
        "Search the text of a PDF in the workspace, read from the file, so the PDF need not be open. " +
        "Case and whitespace differences (line breaks included) do not matter. Returns " +
        "{ file, count, matches: [{ page, snippet, link }] } in page order: `count` is every occurrence, " +
        "`matches` the first maxResults (default 20, at most 50) with `truncated` true when there are more. " +
        "`snippet` is about 160 characters around the match on one line. `link` opens the page at the " +
        "matched text (path#page=N#:~:text=…, usable with open_pdf_location); several occurrences on one page " +
        "have the same link, because a link finds the first occurrence on its page. Plain text only, no patterns. " +
        `${REFUSED_PDFS} ` +
        "Omit `path` for the PDF the user viewed last.",
      inputSchema: {
        path: pathArgument,
        query: z
          .string()
          .min(1)
          .max(500)
          .describe("The text to find, as it reads on the page."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(MAX_MATCHES)
          .optional()
          .describe(`Matches to return (default ${DEFAULT_MATCHES}).`),
      },
      annotations: { readOnlyHint: true },
    },
    ({ path, query, maxResults }) =>
      guarded(async () => {
        if (foldText(query).text === "") {
          throw new ToolError("The query is blank.");
        }
        const { file, pages } = await readPdfPages(path, deps);
        const { count, matches } = findInPages(
          pages,
          query,
          maxResults ?? DEFAULT_MATCHES,
        );
        return jsonResult({
          file,
          count,
          matches: matches.map(({ page, snippet, text }) => ({
            page,
            snippet,
            link: formatPdfDeepLink(file, {
              page,
              text: text.slice(0, LINK_QUOTE_CHARS),
            }),
          })),
          ...(count > matches.length ? { truncated: true } : {}),
          ...(count === 0 && hasNoText(pages) ? { note: NO_TEXT_NOTE } : {}),
        });
      }),
  );
}

/**
 * Every occurrence of `query` in the pages (index 0 is page 1), matched the
 * way Chrome matches a text fragment, with the first `limit` described.
 * Occurrences do not overlap.
 */
export function findInPages(
  pages: readonly string[],
  query: string,
  limit: number,
): { count: number; matches: TextMatch[] } {
  const needle = foldText(query).text;
  const matches: TextMatch[] = [];
  let count = 0;
  if (needle === "") {
    return { count, matches };
  }
  pages.forEach((raw, index) => {
    const folded = foldText(raw);
    for (
      let at = folded.text.indexOf(needle);
      at >= 0;
      at = folded.text.indexOf(needle, at + needle.length)
    ) {
      count++;
      if (matches.length < limit) {
        matches.push(
          matchAt(
            folded,
            index + 1,
            rawRangeOf(folded, at, at + needle.length),
          ),
        );
      }
    }
  });
  return { count, matches };
}

function matchAt(
  { raw }: FoldedText,
  page: number,
  range: TextRange,
): TextMatch {
  const length = Math.min(range.end - range.start, SNIPPET_CHARS);
  const side = Math.floor((SNIPPET_CHARS - length) / 2);
  const from = Math.max(0, range.start - side);
  const to = Math.min(raw.length, range.start + length + side);
  const snippet = flat(raw.slice(from, to));
  return {
    page,
    snippet: `${from > 0 ? "…" : ""}${snippet}${to < raw.length ? "…" : ""}`,
    text: flat(raw.slice(range.start, range.end)),
  };
}
