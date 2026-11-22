/** `get_ide_context` and the `lumiere://ide-context` resource: where the user is in Lumiere. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeDeps } from "../deps";
import { collectIdeContext } from "../ide-context";
import { jsonResult } from "./results";

/** The resource's URI: an agent that can @-mention MCP resources reads the same JSON. */
export const IDE_CONTEXT_URI = "lumiere://ide-context";

const WHAT_IT_HOLDS =
  "Where the user is in Lumiere: the active note (path, selected lines and text, the headings above the " +
  "selection, unsaved or not), the PDF viewed last (path, page, page count, zoom, the selected passage or region " +
  "with a locator such as path#page=3#:~:text=…, SHA-256), and the Lumiere tabs open (notes and PDFs, with " +
  "visible, active and dirty flags). Limits: a note's caret is reported only when text is selected (Lumiere's " +
  "API has no caret for a collapsed selection), and the lines a note shows are not reported.";

export function registerIdeContext(server: McpServer, deps: BridgeDeps): void {
  server.registerTool(
    "get_ide_context",
    {
      title: "Lumiere IDE context",
      description:
        `${WHAT_IT_HOLDS} Call this when the user says "this note", "this page", "here" or "what I'm reading" ` +
        "and no text-editor selection answers it.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(await collectIdeContext(deps)),
  );
  server.registerResource(
    "ide-context",
    IDE_CONTEXT_URI,
    {
      title: "Lumiere IDE context",
      description: WHAT_IT_HOLDS,
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await collectIdeContext(deps)),
        },
      ],
    }),
  );
}
