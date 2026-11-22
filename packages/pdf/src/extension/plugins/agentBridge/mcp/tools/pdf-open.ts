/** `open_pdf_location`: show the user a place in a PDF of their workspace. */
import * as vscode from "vscode";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OPEN_LOCATION_COMMAND_ID } from "../../../../../shared/command-ids";
import { parseLocationFragment } from "../../../../../shared/pdf-location";
import { displayPath } from "../../../pdf/files";
import { guarded, textResult, ToolError } from "./results";
import { resolveWorkspacePdf } from "./workspace-pdf";

export function registerOpenLocation(server: McpServer): void {
  server.registerTool(
    "open_pdf_location",
    {
      title: "Open PDF at location",
      description:
        "Open a PDF in the user's editor at a page and box, to show them a citation. Accepts a link such as " +
        '"papers/paper.pdf#page=3&viewrect=72,83,134,21" (a path relative to a workspace folder, or an absolute path inside ' +
        "the workspace), or a Markdown link to one. The editor opens it without taking the keyboard focus.",
      inputSchema: {
        link: z
          .string()
          .min(1)
          .max(4096)
          .describe("PDF path with optional #page=…&viewrect=… fragment."),
      },
    },
    ({ link }) => guarded(() => openLocation(link)),
  );
}

async function openLocation(link: string) {
  const { uri, fragment } = await resolveWorkspacePdf(link);
  const location = fragment ? parseLocationFragment(fragment) : undefined;
  if (fragment && !location) {
    throw new ToolError(
      "The location is invalid: use #page=N with a positive whole page number, optionally &viewrect=left,top,width,height.",
    );
  }
  const opened = await vscode.commands.executeCommand<boolean>(
    OPEN_LOCATION_COMMAND_ID,
    uri.with({ fragment }),
    undefined,
    { preserveFocus: true },
  );
  const file = displayPath(uri);
  if (!opened) {
    throw new ToolError(
      `Could not open ${file}: the editor did not show it (another open may have replaced this one).`,
    );
  }
  return textResult(
    location
      ? `Opened ${file} at page ${location.page}.`
      : `Opened ${file} (no page given, so it is at the page it was on).`,
  );
}
