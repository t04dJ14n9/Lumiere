/**
 * A note's undo and redo outside VS Code, as its TextDocument keeps them
 * there. One step is one change to the note's text: one `apply` (a page's
 * push), one link update, or another program's change taken from disk. The
 * Markdown plugins' `UndoGroups` (packages/markdown/src/plugins/document)
 * joins steps into what the reader undoes at once (a run of typing, a table
 * edit) by calling Undo once per step, so a step here must never join two
 * pushes: VS Code's `workspace.applyEdit` makes each one its own step too.
 */
import type { SourceEdit } from "@workshop/markdown/portable";

/**
 * Non-overlapping edits to one text, last first, each in the offsets of the
 * text before any of them (so applying them in order is applying them at once).
 */
export type Edits = readonly SourceEdit[];

interface Step {
  /** The edits that made the step, from the text before it. */
  readonly forward: Edits;
  /** The edits that take it back, from the text after it. */
  readonly backward: Edits;
}

export class NoteHistory {
  private done: Step[] = [];
  private undone: Step[] = [];

  /**
   * `edits` turned `before` into the note's text: a new step, after which
   * there is nothing to redo. Edits that change nothing make no step.
   */
  record(before: string, edits: Edits): void {
    const step = invertible(before, edits);
    if (!step) {
      return;
    }
    this.done.push(step);
    this.undone = [];
  }

  /** The edits that take the last step back, or undefined with none left. */
  undo(): Edits | undefined {
    const step = this.done.pop();
    if (!step) {
      return undefined;
    }
    this.undone.push(step);
    return step.backward;
  }

  /** The edits that make the last undone step again, or undefined. */
  redo(): Edits | undefined {
    const step = this.undone.pop();
    if (!step) {
      return undefined;
    }
    this.done.push(step);
    return step.forward;
  }
}

/**
 * The step `edits` make from `before`, each edit trimmed to what it changes
 * (a link update or a reload replaces the whole text, but a step keeps only
 * the lines it changed), or undefined when nothing changes.
 */
function invertible(before: string, edits: Edits): Step | undefined {
  const forward = edits
    .map((edit) => trimmed(before, edit))
    .filter((edit) => edit.from !== edit.to || edit.insert !== "");
  if (!forward.length) {
    return undefined;
  }
  // First to last: each edit's place after the step moves by what the edits
  // before it in the text added or removed.
  const backward: SourceEdit[] = [];
  let shift = 0;
  for (const edit of [...forward].reverse()) {
    const from = edit.from + shift;
    backward.push({
      from,
      to: from + edit.insert.length,
      insert: before.slice(edit.from, edit.to),
    });
    shift += edit.insert.length - (edit.to - edit.from);
  }
  return { forward, backward: backward.reverse() };
}

/** `edit` without the start and end it leaves as they were. */
function trimmed(text: string, edit: SourceEdit): SourceEdit {
  const removed = text.slice(edit.from, edit.to);
  const { insert } = edit;
  const shorter = Math.min(removed.length, insert.length);
  let start = 0;
  while (start < shorter && removed[start] === insert[start]) {
    start++;
  }
  // Never between the halves of a surrogate pair: listeners get the edits.
  if (start > 0 && isHighSurrogate(removed.charCodeAt(start - 1))) {
    start--;
  }
  let end = 0;
  while (
    end < shorter - start &&
    removed[removed.length - 1 - end] === insert[insert.length - 1 - end]
  ) {
    end++;
  }
  if (end > 0 && isLowSurrogate(removed.charCodeAt(removed.length - end))) {
    end--;
  }
  return {
    from: edit.from + start,
    to: edit.to - end,
    insert: insert.slice(start, insert.length - end),
  };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
