import type { HostDocuments } from "../../shared/host";
import type { EditorPanel } from "../editor/api";
import { protocol as editorProtocol } from "../editor/protocol";

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
  const inserted = await panel.session.withAction(async () => {
    await panel.session.flush();
    const range = await panel.rpc.call(editorProtocol, "captureSelection", {});
    if (range.version !== panel.session.version) {
      throw new Error("The note changed while inserting. Try again.");
    }
    const insert =
      panel.document.eol === "\r\n" ? lines.replace(/\n/g, "\r\n") : lines;
    // `apply` takes the editor's offsets and maps them onto the note's own
    // line breaks; mapping them here as well would shift a CRLF edit twice.
    const isApplied = await documents.apply(panel.document, [
      { from: range.from, to: range.to, insert },
    ]);
    return isApplied ? range.from + lines.length : undefined;
  });
  if (inserted === undefined) {
    return false;
  }
  // The edit reaches the webview before this call on the same channel; if
  // it has not synchronized yet the reveal declines and the caret stays put.
  await panel.rpc
    .call(editorProtocol, "reveal", {
      from: inserted,
      to: inserted,
      focus: true,
      version: panel.session.version,
    })
    .catch(() => false);
  return true;
}
