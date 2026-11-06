import { SourceCoordinates } from "../../shared/document/coordinates";
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
    const coordinates = new SourceCoordinates(panel.document.getText());
    const insert =
      panel.document.eol === "\r\n" ? lines.replace(/\n/g, "\r\n") : lines;
    const isApplied = await documents.apply(panel.document, [
      {
        from: coordinates.toSource(range.from),
        to: coordinates.toSource(range.to),
        insert,
      },
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
