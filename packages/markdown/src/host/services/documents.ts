import { createHash } from "node:crypto";
import path from "node:path";
import * as vscode from "vscode";
import { SourceCoordinates } from "../../shared/document/coordinates";
import { MARKDOWN_EDITOR } from "../../shared/editor-provider";
import type { FileTextEdits, HostDocuments } from "../../shared/host";
import { renameFile } from "../file-rename";
import {
  cleanEditedUris,
  isSameText,
  planLinkUpdates,
  renamesKey,
  type PlannedNote,
} from "../rename-save";
import { registerTextCompletions } from "../text-completions";
import type { NativeDocuments } from "./native-documents";

/** VS Code's text documents, wrapped as `HostDocument`s by `documents`. */
export function createHostDocuments(documents: NativeDocuments): HostDocuments {
  return {
    fingerprint: (text) => createHash("sha256").update(text).digest("hex"),
    apply: async (document, edits) => {
      const native = documents.native(document);
      const coordinates = new SourceCoordinates(native.getText());
      const edit = new vscode.WorkspaceEdit();
      for (const change of edits) {
        edit.replace(
          native.uri,
          new vscode.Range(
            native.positionAt(coordinates.toSource(change.from)),
            native.positionAt(coordinates.toSource(change.to)),
          ),
          change.insert,
        );
      }
      return vscode.workspace.applyEdit(edit);
    },
    onChange: (listener) =>
      toDisposer(
        vscode.workspace.onDidChangeTextDocument((event) =>
          listener(
            documents.wrap(event.document),
            event.contentChanges.map((change) => ({
              from: change.rangeOffset,
              to: change.rangeOffset + change.rangeLength,
              insert: change.text,
            })),
          ),
        ),
      ),
    onSave: (listener) =>
      toDisposer(
        vscode.workspace.onDidSaveTextDocument((document) =>
          listener(documents.wrap(document)),
        ),
      ),
    onWillSave: (listener) =>
      toDisposer(
        vscode.workspace.onWillSaveTextDocument((event) => {
          event.waitUntil(listener(documents.wrap(event.document)));
        }),
      ),
    open: async (uri) =>
      documents.wrap(
        await vscode.workspace.openTextDocument(vscode.Uri.parse(uri)),
      ),
    rename: renameFile,
    text: (uri) =>
      vscode.workspace.textDocuments
        .find((document) => document.uri.toString() === uri)
        ?.getText(),
    onWillRename,
    registerCompletions: (provider) =>
      toDisposer(registerTextCompletions(provider)),
  };
}

const onWillRename: HostDocuments["onWillRename"] = (listener) => {
  const pending: PendingLinkUpdates = new Map();
  const subscription = vscode.workspace.onWillRenameFiles((event) => {
    const renames = renamePairs(event.files);
    event.waitUntil(
      listener(renames).then(async (files) => {
        // BH-014: VS Code applies onWill edits in a participant that may
        // Show Preview. onDidRenameFiles often fires before Apply, and
        // Preview Apply can drop the edit (stale version) — leaving disk
        // unchanged and not dirty. Capture expected text now; after rename
        // apply+save every note ourselves (Obsidian writes to disk). Still
        // return closed-note edits for Preview listing / OK undo grouping;
        // Lumiere-open tabs stay out of waitUntil so a failed custom-editor
        // apply cannot abort the whole batch.
        const lumiere = lumiereOpenUris();
        const current = await scheduleLinkUpdatesAfterRename(
          files,
          renames,
          pending,
        );
        return workspaceEdit(current.filter((file) => !lumiere.has(file.uri)));
      }),
    );
  });
  return () => {
    subscription.dispose();
    for (const plan of pending.values()) {
      plan.dispose();
    }
    pending.clear();
  };
};

/** A rename event's files as URI strings, the form the host services use. */
function renamePairs(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
): { oldUri: string; newUri: string }[] {
  return files.map(({ oldUri, newUri }) => ({
    oldUri: oldUri.toString(),
    newUri: newUri.toString(),
  }));
}

/**
 * Link updates planned for renames that have not finished yet, by
 * `renamesKey`. VS Code has no "rename cancelled" event, so a rename dropped
 * in Refactor Preview leaves its plan here: only a did-rename for the same
 * files may run it, planning that rename again replaces it, and stopping the
 * listener that planned it drops it. Each listener keeps its own plans.
 */
type PendingLinkUpdates = Map<string, vscode.Disposable>;

/** URIs that currently have a Lumiere custom editor tab. */
function lumiereOpenUris(): Set<string> {
  const uris = new Set<string>();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.viewType === MARKDOWN_EDITOR.viewType
      ) {
        uris.add(input.uri.toString());
      }
    }
  }
  return uris;
}

/**
 * Plan post-rename apply+save for every note the link update touches.
 * Expected text is captured here (open buffer or on-disk bytes) so a delayed
 * Preview → Apply cannot leave disk on the old name; targets are mapped to
 * their post-rename URIs because `onDidRenameFiles` runs after the move.
 *
 * @returns the files whose edits still fit their text. A note that changed
 * since its edits were computed is named in a warning and left as it is.
 */
async function scheduleLinkUpdatesAfterRename(
  files: readonly FileTextEdits[],
  renames: readonly { oldUri: string; newUri: string }[],
  pending: PendingLinkUpdates,
): Promise<FileTextEdits[]> {
  const key = renamesKey(renames);
  pending.get(key)?.dispose();
  pending.delete(key);
  const targets = files.filter((file) => file.edits.length > 0);
  if (targets.length === 0) {
    return [];
  }
  const clean = new Set(
    cleanEditedUris(targets, (uri) =>
      vscode.workspace.textDocuments.some(
        (document) => document.uri.toString() === uri && document.isDirty,
      ),
    ).map((uri) => postRenameUri(uri, renames)),
  );
  const { planned: byUri, stale } = await planLinkUpdates(
    targets,
    noteTextForLinkUpdate,
    (uri) =>
      vscode.workspace.textDocuments
        .find((document) => document.uri.toString() === uri)
        ?.getText(),
  );
  warnLinksNotUpdated(stale.map((file) => file.uri));
  const planned = new Map<string, PlannedNote>(
    [...byUri].map(([uri, note]) => [postRenameUri(uri, renames), note]),
  );
  if (planned.size > 0) {
    const done = vscode.workspace.onDidRenameFiles((event) => {
      if (renamesKey(renamePairs(event.files)) !== key) {
        return;
      }
      done.dispose();
      pending.delete(key);
      void settleLinkUpdates(planned, clean);
    });
    pending.set(key, done);
  }
  return targets.filter((file) => !stale.includes(file));
}

/**
 * Map a pre-rename file URI to its URI after `renames` (an exact file rename
 * or a renamed parent folder).
 */
function postRenameUri(
  uri: string,
  renames: readonly { oldUri: string; newUri: string }[],
): string {
  for (const { oldUri, newUri } of renames) {
    if (uri === oldUri) {
      return newUri;
    }
    const prefix = oldUri.endsWith("/") ? oldUri : `${oldUri}/`;
    if (uri.startsWith(prefix)) {
      const target = newUri.endsWith("/") ? newUri.slice(0, -1) : newUri;
      return `${target}/${uri.slice(prefix.length)}`;
    }
  }
  return uri;
}

/**
 * Open buffer text, or the file on disk without stamping a TextDocument
 * version. Disk bytes are decoded as the vault decodes them, which drops a
 * BOM as VS Code does, so both read as a document's text would.
 */
async function noteTextForLinkUpdate(uri: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri,
  );
  if (open) {
    return open.getText();
  }
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
  return new TextDecoder().decode(bytes);
}

// Preview → Apply can lag well after onDidRenameFiles; keep trying so a slow
// Apply (or a dropped Apply) still ends with disk matching the planned text.
const SETTLE_ATTEMPTS = 300;
const SETTLE_GAP_MS = 100;

/**
 * After the rename: if the note does not yet match the planned text (waitUntil
 * OK path not run, or Preview Apply still pending/dropped), apply the edits
 * ourselves and save clean notes to disk. Notes that could not be updated are
 * named in one warning at the end.
 */
async function settleLinkUpdates(
  planned: ReadonlyMap<string, PlannedNote>,
  clean: ReadonlySet<string>,
): Promise<void> {
  const settled = new Set<string>();
  const changed = new Set<string>();
  const ensure = () => ensureLinkUpdates(planned, clean, settled, changed);
  let isDone = false;
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS && !isDone; attempt++) {
    if (attempt > 0) {
      await wait(SETTLE_GAP_MS);
    }
    isDone = await ensure();
  }
  if (!isDone) {
    await ensure();
  }
  warnLinksNotUpdated(
    [...planned.keys()].filter((uri) => changed.has(uri) || !settled.has(uri)),
  );
}

/**
 * @returns true when every planned note matches its planned text and clean
 * notes are saved. A note added to `settled` is left alone on later attempts,
 * so what the user types into it while another note is still retried is not
 * overwritten. `changed` collects the notes left alone because their text
 * changed after the plan was made. A note whose open, edit or save throws is
 * retried like one whose edit is refused, so the notes after it still settle.
 */
async function ensureLinkUpdates(
  planned: ReadonlyMap<string, PlannedNote>,
  clean: ReadonlySet<string>,
  settled: Set<string>,
  changed: Set<string>,
): Promise<boolean> {
  let done = true;
  for (const [uri, note] of planned) {
    if (settled.has(uri)) {
      continue;
    }
    const outcome = await ensureNoteUpdated(uri, note, clean.has(uri)).catch(
      (): NoteOutcome => "retry",
    );
    if (outcome === "retry") {
      done = false;
      continue;
    }
    settled.add(uri);
    if (outcome === "changed") {
      changed.add(uri);
    }
  }
  return done;
}

/**
 * How a note ended: `changed` when its text differs from the plan since it was
 * made, `retry` when it could not be brought to the planned text yet.
 */
type NoteOutcome = "updated" | "changed" | "retry";

/**
 * Brings one note to its planned text and saves it when it was clean. Only a
 * note that still reads as it did when planned is replaced as a whole: any
 * other text was written since (typing, another extension), and replacing it
 * would discard that.
 */
async function ensureNoteUpdated(
  uri: string,
  note: PlannedNote,
  isClean: boolean,
): Promise<NoteOutcome> {
  const target = vscode.Uri.parse(uri);
  let document = await vscode.workspace.openTextDocument(target);
  if (!isSameText(document.getText(), note.after)) {
    if (!isSameText(document.getText(), note.before)) {
      return "changed";
    }
    // Full-document replace: line/col from onWill stay valid only against the
    // pre-rename snapshot.
    const edit = new vscode.WorkspaceEdit();
    const end = document.positionAt(document.getText().length);
    edit.replace(
      target,
      new vscode.Range(new vscode.Position(0, 0), end),
      note.after,
    );
    if (!(await vscode.workspace.applyEdit(edit))) {
      return "retry";
    }
    document = await vscode.workspace.openTextDocument(target);
    if (!isSameText(document.getText(), note.after)) {
      return "retry";
    }
  }
  if (isClean && document.isDirty && !(await document.save())) {
    return "retry";
  }
  return "updated";
}

/** Tells the user which notes kept their old links. */
function warnLinksNotUpdated(uris: readonly string[]): void {
  if (uris.length === 0) {
    return;
  }
  const names = uris.map((uri) =>
    path.posix.basename(vscode.Uri.parse(uri).path),
  );
  void vscode.window.showWarningMessage(
    `Links in ${names.join(", ")} were not updated. Check them after the rename.`,
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function workspaceEdit(files: readonly FileTextEdits[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  for (const file of files) {
    for (const change of file.edits) {
      edit.replace(
        vscode.Uri.parse(file.uri),
        new vscode.Range(
          change.start.line,
          change.start.col,
          change.end.line,
          change.end.col,
        ),
        change.text,
      );
    }
  }
  return edit;
}

export function toDisposer(disposable: vscode.Disposable): () => void {
  return () => disposable.dispose();
}
