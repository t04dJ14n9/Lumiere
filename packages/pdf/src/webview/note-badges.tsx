import { annotationKey } from "@embedpdf/engine-core/public";
import {
  useAnnotationAnchor,
  useAnnotationList,
  type Annotation,
} from "@embedpdf/react/annotation";
import { Anchored } from "@embedpdf/react/anchored";
import React, { useMemo } from "react";
import { showsNoteBadge } from "../shared/mark-note";
import { NOTE_KEY_ATTRIBUTE } from "./note-card-target";

/**
 * A small note icon by the top right corner of each text mark that has a
 * note, so a note is found without hovering every mark. Resting the pointer
 * on it shows the note, as on the mark, and a left click shows it at once
 * (note-card.tsx reads its key).
 *
 * Pinned `Anchored` UI in the Stage's overlay: it keeps its size while the
 * pages zoom, and only the marks on pages on screen are drawn.
 */
export function NoteBadges(): React.JSX.Element {
  const marks = useAnnotationList();
  const noted = useMemo(() => marks.filter(showsNoteBadge), [marks]);
  return (
    <>
      {noted.map((mark) => (
        <NoteBadge key={annotationKey(mark.ref)} mark={mark} />
      ))}
    </>
  );
}

function NoteBadge({ mark }: { mark: Annotation }): React.JSX.Element | null {
  const anchor = useAnnotationAnchor(mark.ref);
  if (!anchor) {
    return null;
  }
  return (
    <Anchored anchor={anchor} placement="right-start" gap={2} pinned>
      <span
        className="note-badge"
        {...{ [NOTE_KEY_ATTRIBUTE]: annotationKey(mark.ref) }}
        aria-hidden="true"
      >
        <i className="codicon codicon-note" />
      </span>
    </Anchored>
  );
}
