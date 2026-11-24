import { annotationKey } from "@embedpdf/engine-core/public";
import type {
  Annotation,
  AnnotationCapability,
} from "@embedpdf/react/annotation";
import { useEffect, type RefObject } from "react";
import type { NoteHover } from "../shared/note-hover";
import { lookUpPageAt } from "./look-up-pages";
import {
  isInNoteCard,
  noteKeyOfBadge,
  scrollsNoteCard,
} from "./note-card-target";

/** The note a mark carries, or "" for none. */
export function noteOf(mark: Annotation): string {
  return typeof mark.contents === "string" ? mark.contents : "";
}

/**
 * Tell the hover which mark with a note is under the pointer, once a frame.
 * A press, a wheel that moves the pages, Escape or the pointer leaving the
 * viewer closes the card; a drag (a selection being made) shows none. A left
 * press on a note icon shows that mark's note at once instead. While a note
 * is being written, a press outside the card keeps what was written.
 */
export function usePointerOverMarks(
  annotation: AnnotationCapability | null,
  hover: NoteHover,
  commit: RefObject<(() => void) | null>,
): void {
  useEffect(() => {
    if (!annotation) {
      return;
    }
    const { listeners, stop } = cardListeners(annotation, hover, commit);
    for (const [type, listener] of listeners) {
      document.addEventListener(type, listener as EventListener, {
        capture: true,
        passive: true,
      });
    }
    return () => {
      stop();
      for (const [type, listener] of listeners) {
        document.removeEventListener(type, listener as EventListener, true);
      }
    };
  }, [annotation, hover, commit]);
}

/** The document listeners `usePointerOverMarks` adds, and how to stop a waiting frame. */
export function cardListeners(
  annotation: AnnotationCapability,
  hover: NoteHover,
  commit: RefObject<(() => void) | null>,
): { listeners: [string, (event: never) => void][]; stop: () => void } {
  let last: PointerEvent | undefined;
  let frame = 0;
  const check = (): void => {
    frame = 0;
    if (last && !isInNoteCard(last.target)) {
      hover.pointerOver(keyUnderPointer(annotation, hover, last));
    }
  };
  const onMove = (event: PointerEvent): void => {
    last = event;
    frame ||= requestAnimationFrame(check);
  };
  const onPress = (event: PointerEvent): void => {
    if (isInNoteCard(event.target)) {
      return;
    }
    (hover.editing() ? commit.current : null)?.();
    const icon = event.button === 0 ? noteKeyOfBadge(event.target) : undefined;
    if (icon === undefined) {
      hover.dismiss();
    } else {
      hover.open(icon);
    }
  };
  const onWheel = (event: WheelEvent): void => {
    if (!scrollsNoteCard(event)) {
      hover.dismiss();
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !hover.editing()) {
      hover.dismiss();
    }
  };
  const onLeave = (event: PointerEvent): void => {
    if (!event.relatedTarget) {
      // A frame still waiting would read the last move and put the pointer
      // back on the mark it just left, arming the open timer again.
      last = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
      hover.pointerOver(undefined);
    }
  };
  return {
    listeners: [
      ["pointermove", onMove],
      ["pointerdown", onPress],
      ["wheel", onWheel],
      ["keydown", onKey],
      ["pointerout", onLeave],
    ],
    stop: () => cancelAnimationFrame(frame),
  };
}

/**
 * What a moving pointer rests on. A held button is a drag (a selection being
 * made), which shows no card; only the press that opened a note from its icon
 * keeps it, however the pointer slips while it is held.
 */
function keyUnderPointer(
  annotation: AnnotationCapability,
  hover: NoteHover,
  event: PointerEvent,
): string | undefined {
  if (!event.buttons) {
    return noteKeyAt(annotation, event);
  }
  const icon = noteKeyOfBadge(event.target);
  return icon === hover.shown() ? icon : undefined;
}

/** The key of the mark with a note under the pointer (or its note icon), if there is one. */
function noteKeyAt(
  annotation: AnnotationCapability,
  event: PointerEvent,
): string | undefined {
  const badge = noteKeyOfBadge(event.target);
  if (badge !== undefined) {
    return badge;
  }
  const found = lookUpPageAt(event.clientX, event.clientY);
  const mark = found ? annotation.getAt(found.page.ref, found.point) : null;
  return mark && noteOf(mark).trim() ? annotationKey(mark.ref) : undefined;
}
