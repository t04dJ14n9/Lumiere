/** `find_notes_citing_pdf`: the notes of the workspace that link to a PDF, and where. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PdfBacklinkHit } from "../../../../../shared/pdf-backlink-index";
import {
  displayPath,
  isWorkspaceFile,
  workspaceLocation,
} from "../../../pdf/files";
import type { BridgeDeps } from "../deps";
import { clip, guarded, jsonResult } from "./results";
import { pdfSubject } from "./workspace-pdf";

/** Links returned at most; a PDF cited everywhere is cut, with a flag. */
export const MAX_NOTE_LINKS = 100;
const MAX_QUOTE_CHARS = 200;

export function registerNotesCitingPdf(
  server: McpServer,
  deps: BridgeDeps,
): void {
  server.registerTool(
    "find_notes_citing_pdf",
    {
      title: "Notes citing a PDF",
      description:
        "The Markdown notes in the workspace that link to a PDF with a page (`[p. 3](papers/paper.pdf#page=3)`), " +
        "each with the page, the quoted passage when the link carries one, and the region when it names a box. " +
        "Use it to see what the user already wrote about a paper. Lumiere indexes the notes in the background " +
        "once a PDF is open in the window, so a list can be incomplete right after startup. Omit `path` for " +
        "the PDF the user viewed last.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .max(4096)
          .optional()
          .describe(
            "A PDF inside the workspace (relative to a workspace folder, or absolute). Default: the last PDF viewed.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    ({ path }) =>
      guarded(async () => {
        const { uri } = await pdfSubject(path, deps);
        const hits = await deps.backlinks.hitsFor(
          workspaceLocation(uri),
          isWorkspaceFile,
        );
        const links = hits.sort(byNoteThenPage).map(linkOf);
        return jsonResult({
          file: displayPath(uri),
          count: links.length,
          links: links.slice(0, MAX_NOTE_LINKS),
          ...(links.length > MAX_NOTE_LINKS ? { truncated: true } : {}),
        });
      }),
  );
}

function byNoteThenPage(a: PdfBacklinkHit, b: PdfBacklinkHit): number {
  return (
    a.notePath.localeCompare(b.notePath) ||
    a.page - b.page ||
    a.linkOffset - b.linkOffset
  );
}

function linkOf(hit: PdfBacklinkHit) {
  const { textFragment, viewRect } = hit;
  const quote = textFragment
    ? [textFragment.textStart, textFragment.textEnd].filter(Boolean).join(" … ")
    : undefined;
  return {
    note: hit.notePath,
    page: hit.page,
    ...(quote ? { quote: clip(quote, MAX_QUOTE_CHARS) } : {}),
    ...(viewRect ? { region: viewRect } : {}),
  };
}
