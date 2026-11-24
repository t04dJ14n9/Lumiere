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
import { NOTE_CARD_CLASS, scrollsNoteCard } from "./note-card-target";
import { noteOf, usePointerOverMarks } from "./note-card-pointer";
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
  const commit = useRef<(() => void) | null>(null);
  const hover = useNoteHover(setShown, commit);
  usePointerOverMarks(annotation, hover, commit);
  const onSaved = useEditRequests(hover);
  const mark = useShownMark(shown.key);
  const anchor = useAnnotationAnchor(mark?.ref ?? null);
  useCloseWhenMarkGone(hover, { key: shown.key, drawable: !!anchor && !!mark });
  useForgetSavedCallback(shown.key, onSaved);
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

function useNoteHover(
  onChange: (shown: Shown) => void,
  commit: React.RefObject<(() => void) | null>,
): NoteHover {
  const hover = useMemo(
    () =>
      createNoteHover({
        schedule: (run, ms) => {
          const handle = window.setTimeout(run, ms);
          return { cancel: () => window.clearTimeout(handle) };
        },
        onChange: (key, editing) => onChange({ key, editing }),
        commitEdit: () => commit.current?.(),
      }),
    [onChange, commit],
  );
  useEffect(() => () => hover.dispose(), [hover]);
  return hover;
}

/**
 * A card whose mark is removed (by another editor of the same PDF, or an
 * undo) closes. The card draws nothing without its mark, so the note being
 * written in it would be gone with no way to keep it, and left in writing mode
 * the hover would shut every other note out.
 */
function useCloseWhenMarkGone(
  hover: NoteHover,
  card: { key: string | undefined; drawable: boolean },
): void {
  const { key, drawable } = card;
  useEffect(() => {
    hover.markPresent(key, drawable);
  }, [hover, key, drawable]);
}

/**
 * The callback of an edit request belongs to the mark it opened. A card that
 * closes without saving (its mark was removed) must not hand it to the next
 * edit, which the card's own Edit button starts with none.
 */
function useForgetSavedCallback(
  key: string | undefined,
  onSaved: React.RefObject<((mark: Annotation) => void) | undefined>,
): void {
  useEffect(() => {
    if (key === undefined) {
      onSaved.current = undefined;
    }
  }, [key, onSaved]);
}

/** Edit Note… and Highlight with Note open a mark's note to write it. */
function useEditRequests(
  hover: NoteHover,
): React.RefObject<((mark: Annotation) => void) | undefined> {
  const onSaved = useRef<((mark: Annotation) => void) | undefined>(undefined);
  useEffect(
    () =>
      onNoteEditRequest((request) => {
        // Edit first: a note still being written is saved by `commitEdit`
        // inside it, and that save must take the callback of its own request,
        // which this one replaces.
        hover.edit(annotationKey(request.ref));
        onSaved.current = request.onSaved;
      }),
    [hover],
  );
  return onSaved;
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
