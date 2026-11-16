import type { FileTextEdits } from "../shared/host";

/** Files a link update edits that had no unsaved changes of their own. */
export function cleanEditedUris(
  files: readonly FileTextEdits[],
  isDirty: (uri: string) => boolean,
): string[] {
  return files
    .filter((file) => file.edits.length > 0 && !isDirty(file.uri))
    .map((file) => file.uri);
}

/**
 * Identity of a rename batch, independent of the order VS Code lists its
 * files in: a will-rename plan and its did-rename event share one key.
 */
export function renamesKey(
  renames: readonly { oldUri: string; newUri: string }[],
): string {
  return renames
    .map(({ oldUri, newUri }) => `${oldUri}\n${newUri}`)
    .sort()
    .join("\n");
}

type LineEdit = FileTextEdits["edits"][number];

/** UTF-16 offset of `(line, col)` in `text` (0-based, LF/CRLF line breaks). */
export function offsetAt(text: string, line: number, col: number): number {
  let start = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf("\n", start);
    if (next < 0) {
      return text.length;
    }
    start = next + 1;
  }
  return Math.min(start + col, text.length);
}

/**
 * Apply line/column replacements to a note's text. Later ranges are applied
 * first so earlier offsets stay valid — the same order WorkspaceEdit uses.
 */
export function applyLineColEdits(
  text: string,
  edits: readonly LineEdit[],
): string {
  const ordered = edits
    .map((edit) => ({
      from: offsetAt(text, edit.start.line, edit.start.col),
      to: offsetAt(text, edit.end.line, edit.end.col),
      insert: edit.text,
    }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  let result = text;
  for (const edit of ordered) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

/**
 * Whether two texts of one note are the same. VS Code keeps a document in one
 * line-ending style, so a note read from a file with mixed endings differs
 * from its document only in them.
 */
export function isSameText(a: string, b: string): boolean {
  return a.replace(/\r\n?/g, "\n") === b.replace(/\r\n?/g, "\n");
}

/** A note a rename's link updates change: its text before and after them. */
export interface PlannedNote {
  before: string;
  after: string;
}

/**
 * The text each note will have after its link updates, from its text now.
 * The edits are line and column positions in the text they were computed
 * from (`source`); a note that changed since (the user typing in it while
 * the rename was prompting) is left out and listed as `stale`, because those
 * positions no longer point at its links.
 */
export async function planLinkUpdates(
  files: readonly FileTextEdits[],
  currentText: (uri: string) => Promise<string>,
  openText: (uri: string) => string | undefined = () => undefined,
): Promise<{ planned: Map<string, PlannedNote>; stale: FileTextEdits[] }> {
  const planned = new Map<string, PlannedNote>();
  const stale: FileTextEdits[] = [];
  for (const file of files) {
    const before = await currentText(file.uri);
    if (file.source !== undefined && !isSameText(before, file.source)) {
      stale.push(file);
      continue;
    }
    planned.set(file.uri, {
      before,
      after: applyLineColEdits(before, file.edits),
    });
  }
  // Checked again once every read is done, with nothing awaited before the
  // edits go out: a note typed into while a later one was read (a whole
  // canvas is replaced) would otherwise get its older text back.
  for (const file of files) {
    const note = planned.get(file.uri);
    const now = openText(file.uri);
    if (note && now !== undefined && !isSameText(now, note.before)) {
      planned.delete(file.uri);
      stale.push(file);
    }
  }
  return { planned, stale };
}

/**
 * Planned final text for notes open in a Lumiere custom editor. Used after
 * the rename to apply link updates that VS Code's onWill WorkspaceEdit does
 * not land on CustomTextEditor buffers (BH-014).
 */
export function expectedOpenEditorText(
  files: readonly FileTextEdits[],
  openText: (uri: string) => string | undefined,
): Map<string, string> {
  const expected = new Map<string, string>();
  for (const file of files) {
    if (file.edits.length === 0) {
      continue;
    }
    const text = openText(file.uri);
    if (text === undefined) {
      continue;
    }
    expected.set(file.uri, applyLineColEdits(text, file.edits));
  }
  return expected;
}

/**
 * Split link-update edits into notes open in Lumiere (apply+save ourselves)
 * and closed notes (waitUntil WorkspaceEdit + saveAfterRename so disk is
 * written without a manual Save — Obsidian parity).
 */
export function partitionLinkUpdateFiles(
  files: readonly FileTextEdits[],
  lumiereOpenUris: ReadonlySet<string>,
  openText: (uri: string) => string | undefined,
): {
  open: Map<string, string>;
  closed: FileTextEdits[];
} {
  const open = expectedOpenEditorText(files, (uri) =>
    lumiereOpenUris.has(uri) ? openText(uri) : undefined,
  );
  return {
    open,
    closed: files.filter((file) => !open.has(file.uri)),
  };
}
