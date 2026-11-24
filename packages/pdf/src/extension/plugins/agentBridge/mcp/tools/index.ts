/**
 * The MCP tools the agent bridge serves. They read live editor state, so
 * every MCP client (Cursor, Claude Code, Codex, VS Code chat) sees what the
 * user sees right now, without the clipboard.
 *
 *   selection.ts      the PDF and Markdown selections
 *   ide-context.ts    where the user is in notes and PDFs (also a resource)
 *   pdf-open.ts       open a PDF at a page
 *   pdf-info.ts       page count, position, bookmarks, hash
 *   pdf-notes.ts      the notes that cite a PDF
 *   pdf-page-text.ts  the text of pages, read by the host's own PDFium
 *   pdf-find.ts       where a text occurs in a PDF
 *   pdf-quote.ts      which page holds a quoted passage
 *   pdf-annotations.ts  Lumiere's marks on a PDF, with the text they mark
 *   pdf-text-source.ts  what those four share: `path`, and the PDF's text
 *   workspace-pdf.ts  which PDF a path argument may name (the workspace's only)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeDeps } from "../deps";
import { registerIdeContext } from "./ide-context";
import { registerListPdfAnnotations } from "./pdf-annotations";
import { registerFindInPdf } from "./pdf-find";
import { registerOpenLocation } from "./pdf-open";
import { registerPdfInfo } from "./pdf-info";
import { registerNotesCitingPdf } from "./pdf-notes";
import { registerPdfPageText } from "./pdf-page-text";
import { registerLocatePdfQuote } from "./pdf-quote";
import { registerSelectionTools } from "./selection";

/** A fresh server for one request (the bridge is stateless). */
export function createBridgeServer(deps: BridgeDeps): McpServer {
  const server = new McpServer({ name: "agent-pdf-viewer", version: "0.1.0" });
  registerSelectionTools(server, deps);
  registerOpenLocation(server);
  registerPdfInfo(server, deps);
  registerNotesCitingPdf(server, deps);
  registerPdfPageText(server, deps);
  registerFindInPdf(server, deps);
  registerLocatePdfQuote(server, deps);
  registerListPdfAnnotations(server, deps);
  registerIdeContext(server, deps);
  return server;
}
