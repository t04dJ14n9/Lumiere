import { annotationKey } from "@embedpdf/engine-core/public";
import {
  AnnotationToken,
  useAnnotationAnchor,
  useAnnotationList,
  type Annotation,
  type AnnotationCapability,
} from "@embedpdf/react/annotation";
import { Anchored } from "@embedpdf/react/anchored";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import React, { useEffect, useMemo, useState } from "react";
import { isNoteLink, renderNote } from "../shared/mark-note";
import { createNoteHover, type NoteHover } from "../shared/note-hover";
import { postToHost } from "./host";
import { lookUpPageAt } from "./look-up-pages";
import { isInNoteCard, NOTE_CARD_CLASS } from "./note-card-target";

/**
 * A mark's note, shown in a card beside the mark when the pointer rests on
 * it, as VS Code shows a hover (`note-hover.ts` decides when). The note is
 * Markdown (`mark-note.ts`); its links open through the extension. Both
 * Lumiere's marks and the PDF's own annotations show theirs.
 *
 * Mounted once, in the Stage's overlay: `Anchored` keeps the card beside the
 * mark while the pages scroll and zoom.
 */
export function NoteCard(): React.JSX.Element | null {
  const annotation = useOptionalCapability(AnnotationToken);
  const [shownKey, setShownKey] = useState<string | undefined>();
  const hover = useNoteHover(setShownKey);
  usePointerOverMarks(annotation, hover);
  // Read from the list, so a note changed while it shows is drawn anew.
  const marks = useAnnotationList();
  const mark = useMemo(
    () => marks.find((item) => annotationKey(item.ref) === shownKey) ?? null,
    [marks, shownKey],
  );
  const anchor = useAnnotationAnchor(mark?.ref ?? null);
  const html = mark ? renderNote(noteOf(mark)) : undefined;
  if (!anchor || !html) {
    return null;
  }
  return (
    <Anchored anchor={anchor} placement="bottom-start" gap={4}>
      <div
        className={NOTE_CARD_CLASS}
        role="tooltip"
        onPointerEnter={hover.cardEntered}
        onPointerLeave={hover.cardLeft}
        onClick={openLink}
        // Rendered with raw HTML off, images off and only web links: see mark-note.ts.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Anchored>
  );
}

/** The note a mark carries, or "" for none. */
export function noteOf(mark: Annotation): string {
  return typeof mark.contents === "string" ? mark.contents : "";
}

function useNoteHover(onChange: (key: string | undefined) => void): NoteHover {
  const hover = useMemo(
    () =>
      createNoteHover({
        schedule: (run, ms) => {
          const handle = window.setTimeout(run, ms);
          return { cancel: () => window.clearTimeout(handle) };
        },
        onChange,
      }),
    [onChange],
  );
  useEffect(() => () => hover.dispose(), [hover]);
  return hover;
}

/**
 * Tell the hover which mark with a note is under the pointer, once a frame.
 * A press, a wheel, Escape or the pointer leaving the viewer closes the
 * card; a drag (a selection being made) shows none.
 */
function usePointerOverMarks(
  annotation: AnnotationCapability | null,
  hover: NoteHover,
): void {
  useEffect(() => {
    if (!annotation) {
      return;
    }
    let last: PointerEvent | undefined;
    let frame = 0;
    const check = (): void => {
      frame = 0;
      if (last && !isInNoteCard(last.target)) {
        hover.pointerOver(
          last.buttons ? undefined : noteKeyAt(annotation, last),
        );
      }
    };
    const onMove = (event: PointerEvent): void => {
      last = event;
      frame ||= requestAnimationFrame(check);
    };
    const onPress = (event: Event): void => {
      if (!isInNoteCard(event.target)) {
        hover.dismiss();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && hover.shown() !== undefined) {
        hover.dismiss();
      }
    };
    const onLeave = (event: PointerEvent): void => {
      if (!event.relatedTarget) {
        hover.pointerOver(undefined);
      }
    };
    const listeners: [string, (event: never) => void][] = [
      ["pointermove", onMove],
      ["pointerdown", onPress],
      ["wheel", onPress],
      ["keydown", onKey],
      ["pointerout", onLeave],
    ];
    for (const [type, listener] of listeners) {
      document.addEventListener(type, listener as EventListener, {
        capture: true,
        passive: true,
      });
    }
    return () => {
      cancelAnimationFrame(frame);
      for (const [type, listener] of listeners) {
        document.removeEventListener(type, listener as EventListener, true);
      }
    };
  }, [annotation, hover]);
}

/** The key of the mark with a note under the pointer, if there is one. */
function noteKeyAt(
  annotation: AnnotationCapability,
  event: PointerEvent,
): string | undefined {
  const found = lookUpPageAt(event.clientX, event.clientY);
  const mark = found ? annotation.getAt(found.page.ref, found.point) : null;
  return mark && noteOf(mark).trim() ? annotationKey(mark.ref) : undefined;
}

/** A link in a note opens in the browser, through the extension. */
function openLink(event: React.MouseEvent): void {
  const link =
    event.target instanceof Element ? event.target.closest("a") : null;
  if (!link) {
    return;
  }
  event.preventDefault();
  const url = link.getAttribute("href");
  if (isNoteLink(url)) {
    postToHost({ type: "openExternal", url });
  }
}
