import type {
  ChangeSpec,
  EditorState,
  TransactionSpec,
} from "@codemirror/state";
import type { Suggestion } from "./protocol";

export type BlockId = NonNullable<Suggestion["blockId"]>;

/** What accepting a suggestion needs of the host, for the id of a picked block. */
export interface BlockIdHost {
  /** Has the host write the id into the other note; false if it could not. */
  write(blockId: BlockId): Promise<boolean>;
  /** Tells the user the block of this note changed before it got its id. */
  changed(): void;
  warn(message: string, error: unknown): void;
}

/** The part of an `EditorView` that accepting a suggestion uses. */
export interface AcceptView {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
}

/**
 * Applies the edit of an accepted suggestion. A picked block without an id
 * gets one, as Obsidian adds it: in this note, in the same transaction as the
 * link; in another note, written by the host after the link is inserted. A
 * link to a block that did not get its id would point at nothing, so it is
 * never left: in another note it becomes a link to the note, and in this one
 * no link is inserted.
 */
export function acceptSuggestion(options: {
  view: AcceptView;
  edit: TransactionSpec;
  blockId: BlockId | undefined;
  host: BlockIdHost;
}): void {
  const { view, edit, blockId, host } = options;
  if (!blockId) {
    view.dispatch(edit);
    return;
  }
  if (!blockId.here) {
    view.dispatch(edit);
    void linkToNoteIfNotWritten(view, blockId, host);
    return;
  }
  const withId = withBlockId(view.state, edit, blockId);
  if (withId) {
    view.dispatch(withId);
  } else {
    host.changed();
  }
}

/**
 * The host says why it could not write the id; here the link loses its block
 * part. That is an undo step of its own, so undoing it and the pick restores
 * the typed text exactly.
 */
async function linkToNoteIfNotWritten(
  view: AcceptView,
  blockId: BlockId,
  host: BlockIdHost,
): Promise<void> {
  const written = await host.write(blockId).catch((error: unknown) => {
    host.warn("Block id not added", error);
    return false;
  });
  const repair = written ? undefined : withoutBlockPart(view.state, blockId);
  if (repair) {
    view.dispatch(repair);
  }
}

/**
 * Removes `#^id` from the link just inserted. The id was made for this pick,
 * so its text is found wherever typing has moved it; if it is gone, or appears
 * twice, the user has been at the link and it is left alone.
 */
export function withoutBlockPart(
  state: EditorState,
  blockId: BlockId,
): TransactionSpec | undefined {
  const part = `#^${blockId.insert.slice(-6)}`;
  const text = state.doc.toString();
  const from = text.indexOf(part);
  if (from < 0 || text.indexOf(part, from + 1) >= 0) {
    return undefined;
  }
  return { changes: { from, to: from + part.length } };
}

/**
 * `edit` with the id of a picked block of this note added where it goes, as
 * Obsidian adds it; nothing if the text there has changed since the list was
 * made, as the id would land in the wrong place.
 */
function withBlockId(
  state: EditorState,
  edit: TransactionSpec,
  blockId: BlockId,
): TransactionSpec | undefined {
  if (
    state.sliceDoc(blockId.at - blockId.before.length, blockId.at) !==
    blockId.before
  ) {
    return undefined;
  }
  const link = edit.changes as { from: number };
  const { anchor } = edit.selection as { anchor: number };
  // The id goes elsewhere in the note; it moves the caret when it is before.
  const shift = blockId.at <= link.from ? blockId.insert.length : 0;
  return {
    ...edit,
    changes: [
      edit.changes as ChangeSpec,
      { from: blockId.at, insert: blockId.insert },
    ],
    selection: { anchor: anchor + shift },
  };
}
