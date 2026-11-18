import {
  AnnotationToken,
  type Annotation,
  type AnnotationCapability,
  type AnnotationRef,
} from "@embedpdf/react/annotation";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  annotationQuoteText,
  selectionFromAnnotation,
} from "../shared/annotation-handoff";
import { markColorPatch, type MarkToolId } from "../shared/annotation-tools";
import { postToHost } from "./host";
import { lookUpPageAt } from "./look-up-pages";
import { currentPageColors } from "./page-colors";
import type { SetAnnotationRegion } from "./selection";

/** What the context menu does with marks, and how it finds the one it was opened on. */
export interface MarkMenu {
  /**
   * A context menu opens: remember the mark under it, if it is one of
   * Lumiere's, and report it as the selection so Copy Link for Agent hands
   * it over. Returns whether there is one.
   */
  openAt(event: MouseEvent): boolean;
  /** Mark the selected text. */
  markSelection(tool: MarkToolId): void;
  /** Change the note of the mark the menu was opened on; empty removes it. */
  setNote(note: string): void;
  /** Change the colour of the mark the menu was opened on. */
  setColor(color: string): void;
  /** Delete the mark the menu was opened on. */
  deleteMark(): void;
}

export interface MarkMenuOptions {
  /** Whether a mark is Lumiere's own (kept in its annotation file), not the PDF's. */
  isOwn: (ref: AnnotationRef) => boolean;
  setAnnotationRegion: SetAnnotationRegion;
  /** A highlight was recoloured: new highlights take that colour. */
  setHighlightColor: (color: string) => void;
}

/**
 * Marks are made and changed from the context menu, never by a tool: select
 * text and pick Highlight, Underline, Strikeout or Squiggly; right-click
 * a mark for Edit Note…, Change Color or Delete Annotation. Only Lumiere's
 * own marks answer a right-click: the PDF's own annotations came with the
 * file and stay as they are.
 *
 * The mark the menu was opened on stays the target until the next left
 * press or Escape, so the command the menu runs (after a note is typed,
 * perhaps) still finds it.
 */
export function useMarkMenu(options: MarkMenuOptions): MarkMenu {
  const annotation = useOptionalCapability(AnnotationToken);
  const documents = useDocuments();
  const target = useRef<Annotation | undefined>(undefined);
  const latest = useRef(options);
  latest.current = options;

  const forget = useCallback((): void => {
    if (target.current) {
      target.current = undefined;
      latest.current.setAnnotationRegion(undefined);
    }
  }, []);
  const remember = useCallback(
    (mark: Annotation): void => {
      const pageIndex = documents.getPageIndex(mark.page);
      if (pageIndex < 0) {
        forget();
        return;
      }
      target.current = mark;
      latest.current.setAnnotationRegion(regionOf(mark, pageIndex));
    },
    [documents, forget],
  );
  useForgetOnPress(forget);

  return useMemo<MarkMenu>(
    () => menuOver({ annotation, target, latest, remember, forget }),
    [annotation, remember, forget],
  );
}

/** What the menu works with: the annotations, its mark, and how to change which it is. */
interface MenuState {
  annotation: AnnotationCapability | null;
  target: { current: Annotation | undefined };
  latest: { current: MarkMenuOptions };
  remember: (mark: Annotation) => void;
  forget: () => void;
}

function menuOver(state: MenuState): MarkMenu {
  const { annotation, latest, remember, forget } = state;
  return {
    openAt: (event) => {
      const mark = annotation ? ownMarkAt(annotation, event, latest) : null;
      if (mark) {
        remember(mark);
      } else {
        forget();
      }
      return mark !== null;
    },
    markSelection: (tool) => {
      if (annotation) {
        void report("mark the text", annotation.createFromSelection(tool));
      }
    },
    setNote: (note) =>
      withMark(state, (mark, api) => setNote(state, mark, api, note)),
    setColor: (color) =>
      withMark(state, (mark, api) => setColor(state, mark, api, color)),
    deleteMark: () =>
      withMark(state, (mark, api) => {
        forget();
        void report("delete the annotation", api.delete(mark.ref));
      }),
  };
}

/** Run `act` on the menu's mark; nothing when there is none. */
function withMark(
  state: MenuState,
  act: (mark: Annotation, annotation: AnnotationCapability) => void,
): void {
  const mark = state.target.current;
  if (state.annotation && mark) {
    act(mark, state.annotation);
  }
}

function setNote(
  state: MenuState,
  mark: Annotation,
  annotation: AnnotationCapability,
  note: string,
): void {
  const change = annotation
    .update(mark.ref, { contents: note })
    .then(({ annotation: updated }) => {
      // The reported mark carries the new note, for the next Edit Note….
      if (state.target.current === mark) {
        state.remember(updated);
      }
    });
  void report("change the note", change);
}

function setColor(
  state: MenuState,
  mark: Annotation,
  annotation: AnnotationCapability,
  color: string,
): void {
  const patch = markColorPatch(mark.subtype, color, currentPageColors());
  if (Object.keys(patch).length === 0) {
    return;
  }
  if (mark.subtype === "highlight") {
    state.latest.current.setHighlightColor(color);
  }
  void report("change the colour", annotation.update(mark.ref, patch));
}

/**
 * Lumiere's own mark under the pointer, or null. A mark shows before the
 * engine has written it, and only then is it counted as Lumiere's: one still
 * waiting for the engine was just made here, from this menu (the reading
 * tool changes no annotation), so it is Lumiere's too.
 */
function ownMarkAt(
  annotation: AnnotationCapability,
  event: MouseEvent,
  options: { current: MarkMenuOptions },
): Annotation | null {
  const found = lookUpPageAt(event.clientX, event.clientY);
  if (!found) {
    return null;
  }
  const mark = annotation.getAt(found.page.ref, found.point);
  return mark &&
    (options.current.isOwn(mark.ref) || annotation.isPending(mark.ref))
    ? mark
    : null;
}

/**
 * A mark as the selection the extension is told about. Its note is the
 * quote Copy Link for Agent hands over until the page text in its box is
 * read, and stays the quote when the box has none (a figure, a scanned
 * page, a note or ink mark over blank paper).
 */
function regionOf(mark: Annotation, pageIndex: number) {
  const { x, y, width, height } = mark.rect;
  const note = typeof mark.contents === "string" ? mark.contents : undefined;
  const quote = annotationQuoteText(note ? { contents: note } : {});
  return selectionFromAnnotation({
    pageIndex,
    rect: { origin: { x, y }, size: { width, height } },
    ...(quote ? { text: quote } : {}),
    ...(note ? { note } : {}),
  });
}

/** A left press anywhere, or Escape, puts the menu's mark down. */
function useForgetOnPress(forget: () => void): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button === 0) {
        forget();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        forget();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [forget]);
}

function report(what: string, work: Promise<unknown>): Promise<void> {
  return work.then(
    () => undefined,
    (error: unknown) => {
      postToHost({
        type: "error",
        message: `Could not ${what}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    },
  );
}
