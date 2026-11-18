import * as vscode from "vscode";
import { MAX_NOTE_LENGTH } from "../../../shared/view-state";
import type { PdfPanels } from "../pdf/panels";

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
