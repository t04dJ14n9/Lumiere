import { SourceCoordinates } from "../../shared/document/coordinates";
import type { Dialogs, HostDocuments } from "../../shared/host";
import type { Editors } from "../editor/api";
import { moveSectionEdit } from "./move-section";
import type { SectionDrops } from "./tree";

interface Services {
  editors: Pick<Editors, "all">;
  hostDocuments: Pick<HostDocuments, "apply">;
  dialogs: Pick<Dialogs, "inform">;
}

/**
 * Applies a dropped outline row to the note's `TextDocument`, so the move is
 * one undo step and every panel of the note follows. The rows were built
 * from the text in `drop`; if the note changed since (typing between the
 * last refresh and the drop), their offsets no longer fit and nothing moves.
 * The outline refuses rows of a text it has already replaced (an edit by
 * another writer, then a refresh, during the drag) the same way.
 */
export function sectionMover(services: Services): SectionDrops {
  const informChanged = () =>
    services.dialogs.inform(
      "The note changed while the heading was dragged. Try again.",
    );
  return {
    refuseStale: informChanged,
    move: async (drop) => {
      const document = services.editors
        .all()
        .find((panel) => panel.document.uri === drop.uri)?.document;
      if (!document) {
        return;
      }
      if (document.getText() !== drop.text) {
        informChanged();
        return;
      }
      // The outline's offsets are the file's; edits take the editor's, where
      // a CRLF line break counts once.
      const coordinates = new SourceCoordinates(drop.text);
      const edit = moveSectionEdit(coordinates.editor.toString(), {
        heading: coordinates.toEditor(drop.heading),
        beforeHeading:
          drop.beforeHeading === undefined
            ? undefined
            : coordinates.toEditor(drop.beforeHeading),
      });
      if (edit) {
        await services.hostDocuments.apply(document, [edit]);
      }
    },
  };
}
