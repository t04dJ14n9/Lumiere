import { annotationKey } from "@embedpdf/engine-core/public";
import {
  AnnotationToken,
  useAnnotationAnchor,
  useAnnotationList,
  type Annotation,
  type AnnotationCapability,
  type AnnotationRef,
} from "@embedpdf/react/annotation";
import { Anchored } from "@embedpdf/react/anchored";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { isNoteLink, renderNote } from "../shared/mark-note";
import { createNoteHover, type NoteHover } from "../shared/note-hover";
import { postToHost } from "./host";
import { lookUpPageAt } from "./look-up-pages";
import {
  isInNoteCard,
  NOTE_CARD_CLASS,
  noteKeyOfBadge,
  scrollsNoteCard,
} from "./note-card-target";
import { onNoteEditRequest } from "./note-edit-request";
import { NoteEditor } from "./note-editor";

type Shown = { key: string | undefined; editing: boolean };

/**
 * A mark's note, shown in a card beside the mark when the pointer rests on
 * it, as VS Code shows a hover (`note-hover.ts` decides when). The note is
 * Markdown (`mark-note.ts`); its links open through the extension. Both
 * Lumiere's marks and the PDF's own annotations show theirs; only
 * Lumiere's can be written, from the card's Edit button or Edit Note… in
 * the context menu, in the same card (`note-editor.tsx`).
 *
 * Mounted once, in the Stage's overlay: `Anchored` keeps the card beside the
 * mark while the pages scroll and zoom.
 */
export function NoteCard({
  isOwn,
}: {
  /** Whether a mark is Lumiere's own, kept in its annotation file. */
  isOwn: (ref: AnnotationRef) => boolean;
}): React.JSX.Element | null {
  const annotation = useOptionalCapability(AnnotationToken);
  const [shown, setShown] = useState<Shown>({ key: undefined, editing: false });
  const hover = useNoteHover(setShown);
  const commit = useRef<(() => void) | null>(null);
  usePointerOverMarks(annotation, hover, commit);
  const onSaved = useEditRequests(hover);
  const mark = useShownMark(shown.key);
  const anchor = useAnnotationAnchor(mark?.ref ?? null);
  if (!anchor || !mark || !annotation) {
    return null;
  }
  const note = noteOf(mark);
  const html = renderNote(note);
  if (!shown.editing && !html) {
    return null;
  }
  const writable = isOwn(mark.ref) || annotation.isPending(mark.ref);
  const save = (text: string | undefined): void => {
    const kept = text ?? note;
    hover.endEdit({ close: !kept.trim() });
    if (text !== undefined && text !== note) {
      saveNote(annotation, mark, text, onSaved.current);
    }
    onSaved.current = undefined;
  };
  return (
    <Anchored anchor={anchor} placement="bottom-start" gap={4}>
      <div
        ref={keepWheelInCard}
        className={`${NOTE_CARD_CLASS}${shown.editing ? " editing" : ""}`}
        role={shown.editing ? "dialog" : "tooltip"}
        aria-label="Note"
        onPointerEnter={() => hover.cardEntered()}
        onPointerLeave={() => hover.cardLeft()}
      >
        {shown.editing ? (
          <NoteEditor
            key={shown.key}
            initial={note}
            onDone={save}
            commit={commit}
          />
        ) : (
          <NoteBody
            html={html!}
            onEdit={writable ? () => hover.edit(shown.key!) : undefined}
          />
        )}
      </div>
    </Anchored>
  );
}

/**
 * A wheel over the card scrolls the card: a long note or the field it is
 * written in. The Stage pans on the wheel events that bubble up to it, so
 * they stop here (as EmbedPDF's own list boxes stop theirs).
 */
function keepWheelInCard(card: HTMLDivElement | null): (() => void) | void {
  if (!card) {
    return;
  }
  const keep = (event: WheelEvent): void => {
    if (scrollsNoteCard(event)) {
      event.stopPropagation();
    }
  };
  card.addEventListener("wheel", keep, { passive: true });
  return () => card.removeEventListener("wheel", keep);
}

/** The note as Markdown, and the Edit button on Lumiere's own marks. */
function NoteBody({
  html,
  onEdit,
}: {
  html: string;
  onEdit: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <>
      {onEdit && (
        <button
          type="button"
          className="note-card-edit"
          title="Edit Note"
          aria-label="Edit Note"
          onClick={onEdit}
        >
          <i className="codicon codicon-edit" aria-hidden="true" />
        </button>
      )}
      <div
        className="note-card-body"
        onClick={openLink}
        // Rendered with raw HTML off, images off and only web links: see mark-note.ts.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

/** The note a mark carries, or "" for none. */
export function noteOf(mark: Annotation): string {
  return typeof mark.contents === "string" ? mark.contents : "";
}

/** Keep the written note on the mark; an empty one removes it. */
function saveNote(
  annotation: AnnotationCapability,
  mark: Annotation,
  text: string,
  onSaved: ((mark: Annotation) => void) | undefined,
): void {
  annotation
    .update(mark.ref, { contents: text.trim() ? text : "" })
    .then(({ annotation: updated }) => onSaved?.(updated))
    .catch((error: unknown) =>
      postToHost({
        type: "error",
        message: `Could not change the note: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
    );
}

/** The shown mark, read from the list so a note changed while it shows is drawn anew. */
function useShownMark(key: string | undefined): Annotation | null {
  const marks = useAnnotationList();
  return useMemo(
    () =>
      key === undefined
        ? null
        : (marks.find((item) => annotationKey(item.ref) === key) ?? null),
    [marks, key],
  );
}

function useNoteHover(onChange: (shown: Shown) => void): NoteHover {
  const hover = useMemo(
    () =>
      createNoteHover({
        schedule: (run, ms) => {
          const handle = window.setTimeout(run, ms);
          return { cancel: () => window.clearTimeout(handle) };
        },
        onChange: (key, editing) => onChange({ key, editing }),
      }),
    [onChange],
  );
  useEffect(() => () => hover.dispose(), [hover]);
  return hover;
}

/** Edit Note… and Highlight with Note open a mark's note to write it. */
function useEditRequests(
  hover: NoteHover,
): React.RefObject<((mark: Annotation) => void) | undefined> {
  const onSaved = useRef<((mark: Annotation) => void) | undefined>(undefined);
  useEffect(
    () =>
      onNoteEditRequest((request) => {
        onSaved.current = request.onSaved;
        hover.edit(annotationKey(request.ref));
      }),
    [hover],
  );
  return onSaved;
}

/**
 * Tell the hover which mark with a note is under the pointer, once a frame.
 * A press, a wheel that moves the pages, Escape or the pointer leaving the
 * viewer closes the card; a drag (a selection being made) shows none. A left
 * press on a note icon shows that mark's note at once instead. While a note
 * is being written, a press outside the card keeps what was written.
 */
function usePointerOverMarks(
  annotation: AnnotationCapability | null,
  hover: NoteHover,
  commit: React.RefObject<(() => void) | null>,
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
function cardListeners(
  annotation: AnnotationCapability,
  hover: NoteHover,
  commit: React.RefObject<(() => void) | null>,
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
