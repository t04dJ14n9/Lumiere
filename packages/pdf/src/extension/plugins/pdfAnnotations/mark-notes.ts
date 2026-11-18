import * as vscode from "vscode";
import { MAX_NOTE_LENGTH } from "../../../shared/view-state";
import type { PdfPanels } from "../pdf/panels";

/**
 * Add Annotation…: ask for a note, then highlight the selected text with it.
 * Escape adds nothing; an empty note makes a plain highlight. The viewer
 * keeps its text selection while the input box has the focus (EmbedPDF draws
 * it, not the browser), and marks the selection it has then.
 *
 * The menu showed the command because the viewer had text selected as it
 * opened; the extension hears of that text only once the viewer has read
 * it, which may not have happened yet, and may still hold an older
 * selection. So the viewer is asked for its selection first, and the prompt
 * quotes it only when that report came.
 */
export async function addAnnotation(panels: PdfPanels): Promise<void> {
  const panel = panels.active;
  if (!panel) {
    return;
  }
  const reported = await panel.refreshSelection();
  const selection = reported ? panel.selection : undefined;
  const note = await askNote({
    title: "Add Annotation",
    prompt:
      selection?.kind === "text"
        ? `Note for “${excerpt(selection.text)}”`
        : "Note for the selected text",
    value: "",
  });
  if (note !== undefined && panels.all.includes(panel)) {
    panel.act({
      action: "markSelection",
      tool: "highlight",
      ...(note.trim() ? { note } : {}),
    });
  }
}

/** Edit Note…: change the note of the mark the context menu was opened on. */
export async function editAnnotationNote(panels: PdfPanels): Promise<void> {
  const panel = panels.active;
  const selection = panel?.selection;
  if (!panel || selection?.kind !== "region" || !selection.mark) {
    return;
  }
  if (selection.noteTooLong) {
    // Starting from an empty box would replace the note with what is typed.
    void vscode.window.showWarningMessage(
      `This annotation's note is longer than ${MAX_NOTE_LENGTH} characters; Lumiere cannot edit it without losing it.`,
    );
    return;
  }
  const note = await askNote({
    title: "Edit Note",
    prompt: "Note for this annotation (empty removes it)",
    value: selection.note ?? "",
  });
  if (note !== undefined && panels.all.includes(panel)) {
    panel.act({ action: "setMarkNote", note: note.trim() ? note : "" });
  }
}

function askNote(options: {
  title: string;
  prompt: string;
  value: string;
}): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    ...options,
    placeHolder: "Note",
    validateInput: (text) =>
      text.length > MAX_NOTE_LENGTH
        ? `A note can be at most ${MAX_NOTE_LENGTH} characters.`
        : undefined,
  });
}

/** The start of the selected text, for the prompt. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
}
