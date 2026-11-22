/** `get_pdf_info`: what Lumiere knows about a PDF of the workspace, without opening it. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OutlineItem } from "../../../../../shared/messages";
import { displayPath } from "../../../pdf/files";
import { isProtectedPdf } from "../../../../protected-folders";
import type { PdfPanel } from "../../../pdf/panel";
import type { BridgeDeps } from "../deps";
import { clip, guarded, jsonResult } from "./results";
import { pdfSubject } from "./workspace-pdf";

/** Bookmarks returned at most; a long book's table of contents is cut, with a flag. */
export const MAX_OUTLINE_ENTRIES = 200;
const MAX_TITLE_CHARS = 200;

export function registerPdfInfo(server: McpServer, deps: BridgeDeps): void {
  server.registerTool(
    "get_pdf_info",
    {
      title: "PDF information",
      description:
        "What Lumiere knows about a PDF: whether it is open, its page count, the page and zoom the user is at, " +
        "its bookmarks (title, page, depth), its SHA-256, and whether it is in a protected folder " +
        "(lumiere.pdf.annotations.protectedFolders: Lumiere never writes it). Page count, position, bookmarks and " +
        "hash come from the open viewer, so a PDF that is not open reports only that. Omit `path` for the PDF " +
        "the user viewed last.",
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
        const { uri, panel } = await pdfSubject(path, deps);
        return jsonResult({
          file: displayPath(uri),
          open: panel !== undefined,
          protectedFolder: isProtectedPdf(uri),
          ...(panel ? openFacts(panel) : { note: NOT_OPEN }),
        });
      }),
  );
}

const NOT_OPEN =
  "Not open in Lumiere: page count, position, bookmarks and hash are known only for an open PDF (open_pdf_location opens it).";

/** What the open viewer reports; a part it has not reported yet is left out. */
function openFacts(panel: PdfPanel): Record<string, unknown> {
  const { view, outline, sha256 } = panel;
  return {
    ...(view
      ? {
          pageCount: view.pageCount,
          page: view.page,
          zoomPercent: view.zoomPercent,
        }
      : { note: "The viewer is still loading the PDF." }),
    ...(sha256 ? { sha256 } : {}),
    ...(outline ? flattenOutline(outline) : {}),
  };
}

/** The bookmarks in document order with their depth, cut at `MAX_OUTLINE_ENTRIES`. */
export function flattenOutline(outline: readonly OutlineItem[]): {
  outline: { title: string; page?: number; depth: number }[];
  outlineTruncated?: true;
} {
  const entries: { title: string; page?: number; depth: number }[] = [];
  let truncated = false;
  const visit = (items: readonly OutlineItem[], depth: number): void => {
    for (const item of items) {
      if (entries.length >= MAX_OUTLINE_ENTRIES) {
        truncated = true;
        return;
      }
      entries.push({
        title: clip(item.title, MAX_TITLE_CHARS),
        ...(item.page === undefined ? {} : { page: item.page }),
        depth,
      });
      visit(item.children, depth + 1);
    }
  };
  visit(outline, 0);
  return { outline: entries, ...(truncated ? { outlineTruncated: true } : {}) };
}
