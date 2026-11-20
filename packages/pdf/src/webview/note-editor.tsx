import React, { useEffect, useRef } from "react";
import { MAX_NOTE } from "../shared/selection";

const MAC = /Mac|iPhone|iPad/u.test(navigator.userAgent);

export interface NoteEditorProps {
  /** The note as it is: what the field starts from. */
  initial: string;
  /**
   * The edit ends: with the text to keep (Cmd/Ctrl+Enter, or the focus or
   * the pointer going elsewhere), or undefined to keep the note as it was
   * (Escape). Called once.
   */
  onDone: (text: string | undefined) => void;
  /** Where the card puts how to end the edit keeping the text, for a press outside it. */
  commit: React.RefObject<(() => void) | null>;
}

/**
 * A mark's note being written, in the note card: a plain field for Markdown,
 * like the input boxes of VS Code's own widgets. Keys typed here are the
 * field's: the viewer's own (paging, Find, Escape) never see them.
 */
export function NoteEditor({
  initial,
  onDone,
  commit,
}: NoteEditorProps): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (text: string | undefined): void => {
    if (!done.current) {
      done.current = true;
      onDone(text);
    }
  };
  const keep = (): void => finish(field.current?.value ?? initial);
  commit.current = keep;
  useEffect(() => {
    const input = field.current;
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    return () => {
      commit.current = null;
    };
  }, [commit]);
  const onKeyDown = (event: React.KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finish(undefined);
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      keep();
    }
  };
  return (
    <>
      <textarea
        ref={field}
        className="note-card-input"
        aria-label="Note"
        placeholder="Write a note in Markdown"
        defaultValue={initial}
        maxLength={Math.max(MAX_NOTE, initial.length)}
        spellCheck
        onKeyDown={onKeyDown}
        onBlur={keep}
      />
      <div className="note-card-hint">
        {MAC ? "⌘Enter" : "Ctrl+Enter"} to save · Escape to cancel
      </div>
    </>
  );
}
