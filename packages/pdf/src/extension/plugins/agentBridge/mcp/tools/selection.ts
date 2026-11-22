/** The tools that hand over what the user has selected right now. */
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { notePayload, noteReference } from "@workshop/agents/handoff";
import type { AgentHandoff } from "../../handoff";
import type { LastPdf } from "../../last-pdf";
import type { NoteSelections } from "../../note-selections";
import type { BridgeDeps } from "../deps";
import type { Content } from "./results";

export function registerSelectionTools(
  server: McpServer,
  deps: BridgeDeps,
): void {
  registerPdfSelection(server, deps);
  registerNoteSelection(server, deps.notes);
}

function registerPdfSelection(
  server: McpServer,
  { lastPdf, handoff }: BridgeDeps,
): void {
  server.registerTool(
    "get_current_pdf_selection",
    {
      title: "Current PDF selection",
      description:
        "The text or region the user has selected in the PDF open in their editor (Lumiere PDF): " +
        "the quoted text, a link to the page and box (path#page=N&viewrect=left,top,width,height, RFC 8118), " +
        "the file's SHA-256 and, for a region, a PNG snapshot. Call this when the user refers to " +
        '"this", "the selection", "the highlighted passage", "this figure", or similar in a PDF.',
      inputSchema: {
        includeImage: z
          .boolean()
          .optional()
          .describe(
            "Include a region's PNG snapshot as an image (default true).",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ includeImage }) => ({
      content: await pdfSelection(lastPdf, handoff, includeImage !== false),
    }),
  );
}

/** The selection's agent text, a region's snapshot, and its facts as JSON. */
async function pdfSelection(
  lastPdf: LastPdf,
  handoff: AgentHandoff,
  includeImage: boolean,
): Promise<Content[]> {
  const panel = lastPdf.panel;
  const snapshot = panel && (await handoff.snapshot(panel));
  if (!snapshot) {
    const text = panel
      ? `No selection in ${vscode.workspace.asRelativePath(panel.uri, false)}. Ask the user to select text or drag a region in the PDF.`
      : "No PDF is open in Lumiere PDF.";
    return [{ type: "text", text }];
  }
  const content: Content[] = [{ type: "text", text: snapshot.agentText }];
  const png =
    snapshot.regionImage && includeImage
      ? await readFile(snapshot.regionImage).catch(() => undefined)
      : undefined;
  if (png) {
    content.push({
      type: "image",
      data: png.toString("base64"),
      mimeType: "image/png",
    });
  }
  content.push({
    type: "text",
    text: JSON.stringify({
      file: snapshot.file,
      uri: snapshot.uri,
      sha256: snapshot.sha256,
      kind: snapshot.selection.kind,
      ...(snapshot.regionImage ? { regionImage: snapshot.regionImage } : {}),
    }),
  });
  return content;
}

function registerNoteSelection(
  server: McpServer,
  notes: NoteSelections | undefined,
): void {
  server.registerTool(
    "get_current_note_selection",
    {
      title: "Current Markdown note selection",
      description:
        "The text the user has selected in the Markdown note open in Lumiere, with an " +
        "@path#start-end line reference. Call this when the user refers to the selection in their note.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ({
      content: [{ type: "text", text: await noteSelection(notes) }],
    }),
  );
}

/** The note selection as Copy Link for Agent writes it, or why there is none. */
async function noteSelection(
  notes: NoteSelections | undefined,
): Promise<string> {
  if (!notes) {
    return "Lumiere is not running.";
  }
  const selection = await notes.current();
  if (!selection) {
    return notes.hasOpenNotes()
      ? "No text is selected in the open Lumiere notes."
      : "No note is open in Lumiere.";
  }
  const { uri } = selection;
  const relative = vscode.workspace.asRelativePath(uri, false);
  const inWorkspace =
    uri.scheme === "file" &&
    relative !== uri.fsPath &&
    (vscode.workspace.workspaceFolders?.length ?? 0) === 1;
  // Unsaved notes have no stable line reference.
  const reference = noteReference(
    inWorkspace ? relative : uri.toString(),
    selection.startLine,
    selection.endLine,
    selection.isDirty,
  );
  return notePayload(reference, selection.text);
}
