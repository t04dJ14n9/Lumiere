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
 *   workspace-pdf.ts  which PDF a path argument may name (the workspace's only)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeDeps } from "../deps";
import { registerIdeContext } from "./ide-context";
import { registerOpenLocation } from "./pdf-open";
import { registerPdfInfo } from "./pdf-info";
import { registerNotesCitingPdf } from "./pdf-notes";
import { registerSelectionTools } from "./selection";

/** A fresh server for one request (the bridge is stateless). */
export function createBridgeServer(deps: BridgeDeps): McpServer {
  const server = new McpServer({ name: "agent-pdf-viewer", version: "0.1.0" });
  registerSelectionTools(server, deps);
  registerOpenLocation(server);
  registerPdfInfo(server, deps);
  registerNotesCitingPdf(server, deps);
  registerIdeContext(server, deps);
  return server;
}
