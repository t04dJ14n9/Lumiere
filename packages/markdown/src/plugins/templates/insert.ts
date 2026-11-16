import { templateInsertion } from "../../markdown/template-insert";
import type { HostDocuments, TextEdit } from "../../shared/host";
import type { EditorPanel } from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";

/** What to change for a selection, in the editor's `\n` offsets. */
type Plan = (
  selection: { from: number; to: number },
  note: string,
) => { edits: TextEdit[]; caret: number };

/**
 * Replaces the panel's selection (or inserts at its caret) with `text`, then
 * puts the caret after it, as Obsidian does. False when the edit was refused.
 */
export async function insertAtSelection(
  documents: Pick<HostDocuments, "apply">,
  panel: EditorPanel,
  text: string,
): Promise<boolean> {
  const lines = text.replace(/\r\n?/g, "\n");
  return applyAtSelection(documents, panel, (selection) => ({
    edits: [{ ...selection, insert: lines }],
    caret: selection.from + lines.length,
  }));
}

/**
 * Inserts an expanded template: its properties join the note's and its body
 * replaces the selection (`templateInsertion`). `invalidProperties` names
 * whose properties were not valid YAML when they could not be merged.
 */
export async function insertTemplate(
  documents: Pick<HostDocuments, "apply">,
  panel: EditorPanel,
  template: string,
): Promise<{ isInserted: boolean; invalidProperties?: "note" | "template" }> {
  let invalidProperties: "note" | "template" | undefined;
  const isInserted = await applyAtSelection(
    documents,
    panel,
    (selection, note) => {
      const insertion = templateInsertion(
        note,
        template.replace(/\r\n?/g, "\n"),
        selection,
      );
      invalidProperties = insertion.invalidProperties;
      return insertion;
    },
  );
  return invalidProperties ? { isInserted, invalidProperties } : { isInserted };
}

async function applyAtSelection(
  documents: Pick<HostDocuments, "apply">,
  panel: EditorPanel,
  plan: Plan,
): Promise<boolean> {
  const caret = await panel.session.withAction(async () => {
    await panel.session.flush();
    const range = await panel.rpc.call(editorProtocol, "captureSelection", {});
    if (range.version !== panel.session.version) {
      throw new Error("The note changed while inserting. Try again.");
    }
    const note = panel.document.getText().replace(/\r\n?/g, "\n");
    const planned = plan({ from: range.from, to: range.to }, note);
    const isCrlf = panel.document.eol === "\r\n";
    // `apply` takes the editor's offsets and maps them onto the note's own
    // line breaks; mapping them here as well would shift a CRLF edit twice.
    const edits = planned.edits
      .map((edit) => ({
        ...edit,
        insert: isCrlf ? edit.insert.replace(/\n/g, "\r\n") : edit.insert,
      }))
      .sort((a, b) => a.from - b.from);
    const isApplied = await documents.apply(panel.document, edits);
    return isApplied ? planned.caret : undefined;
  });
  if (caret === undefined) {
    return false;
  }
  // The edit reaches the webview before this call on the same channel; if
  // it has not synchronized yet the reveal declines and the caret stays put.
  await panel.rpc
    .call(editorProtocol, "reveal", {
      from: caret,
      to: caret,
      focus: true,
      version: panel.session.version,
    })
    .catch(() => false);
  return true;
}
