import { difference, textDocument } from "../../shared/document/wire";

/** The three texts that share one note's history at a dirty external rewrite. */
export interface DirtyMergeInput {
  /** Disk content at the last successful save — the common ancestor. */
  lastSaved: string;
  /** Current editor buffer, which may hold edits made since that save. */
  authority: string;
  /** The note as the host just rewrote it on disk. */
  hostText: string;
}

/**
 * Rebase the editor's unsaved edits onto a fresh host rewrite of the note.
 *
 * `lastSaved` is what the last successful save put on disk; `authority` is the
 * buffer now (which may contain edits made since); `hostText` is the file after
 * another program rewrote it. Returning `hostText` outright — the old "slim:
 * no merge" behaviour — drops everything the user typed since the last save.
 * Instead we take the diff `lastSaved -> authority` and replay it over
 * `hostText`, so the external changes and the unsaved edits both survive.
 *
 * This is the pure core of "Dirty external merge" (implementation-plan.md
 * item 1, step 2). Keeping it free of a VS Code document and a collab session
 * makes the rule testable on its own; `Session.changed` is responsible for
 * storing `lastSaved`, recording the merged result and broadcasting it.
 *
 * Known limitation: two edits to the exact same span are concatenated (both
 * kept, host first) rather than resolved with a conflict marker. Non-overlap
 * is the case this first step targets; a full diff3 with conflict markers is
 * future work.
 */
export function mergeExternalChange(input: DirtyMergeInput): string {
  const base = normalize(input.lastSaved);
  const ours = normalize(input.authority);
  const theirs = normalize(input.hostText);

  // The buffer already shows what is on disk: nothing to reconcile. Rebasing
  // the diff over an identical diff would double-apply its inserts.
  if (ours === theirs) {
    return theirs;
  }
  // Clean buffer: no unsaved edits to protect, so the host rewrite wins.
  if (ours === base) {
    return theirs;
  }
  // No external rewrite (an own-save echo bounced the saved text back): keep
  // the unsaved edits exactly as they are.
  if (theirs === base) {
    return ours;
  }

  const unsaved = difference(base, ours);
  const external = difference(base, theirs);
  // `map` rebases `unsaved` (authored against `base`) over `external`, so each
  // edit follows the host's inserts and deletes instead of landing at a stale
  // offset. The result applies to `external`'s output, i.e. `theirs`.
  const rebased = unsaved.map(external);
  return rebased.apply(textDocument(theirs)).toString();
}

/** The host document and the collab buffer can disagree on line endings. */
function normalize(text: string): string {
  return textDocument(text).toString();
}
