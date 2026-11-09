import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { SourceCoordinates } from "../../shared/document/coordinates";
import { MARKDOWN_EDITOR } from "../../shared/editor-provider";
import type { FileTextEdits, HostDocuments } from "../../shared/host";
import { renameFile } from "../file-rename";
import { applyLineColEdits, cleanEditedUris, renamesKey } from "../rename-save";
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

const onWillRename: HostDocuments["onWillRename"] = (listener) =>
  toDisposer(
    vscode.workspace.onWillRenameFiles((event) => {
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
          await scheduleLinkUpdatesAfterRename(files, renames);
          return workspaceEdit(files.filter((file) => !lumiere.has(file.uri)));
        }),
      );
    }),
  );

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
 * files may run it, and planning that rename again replaces it.
 */
const pendingLinkUpdates = new Map<string, vscode.Disposable>();

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
 */
async function scheduleLinkUpdatesAfterRename(
  files: readonly FileTextEdits[],
  renames: readonly { oldUri: string; newUri: string }[],
): Promise<void> {
  const key = renamesKey(renames);
  pendingLinkUpdates.get(key)?.dispose();
  pendingLinkUpdates.delete(key);
  const targets = files.filter((file) => file.edits.length > 0);
  if (targets.length === 0) {
    return;
  }
  const clean = new Set(
    cleanEditedUris(targets, (uri) =>
      vscode.workspace.textDocuments.some(
        (document) => document.uri.toString() === uri && document.isDirty,
      ),
    ).map((uri) => postRenameUri(uri, renames)),
  );
  const expected = new Map<string, string>();
  const postTargets: FileTextEdits[] = [];
  for (const file of targets) {
    const text = await noteTextForLinkUpdate(file.uri);
    const uri = postRenameUri(file.uri, renames);
    expected.set(uri, applyLineColEdits(text, file.edits));
    postTargets.push({ uri, edits: file.edits });
  }
  const done = vscode.workspace.onDidRenameFiles((event) => {
    if (renamesKey(renamePairs(event.files)) !== key) {
      return;
    }
    done.dispose();
    pendingLinkUpdates.delete(key);
    void settleLinkUpdates(postTargets, expected, clean);
  });
  pendingLinkUpdates.set(key, done);
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

/** Open buffer text, or the file on disk without stamping a TextDocument version. */
async function noteTextForLinkUpdate(uri: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri,
  );
  if (open) {
    return open.getText();
  }
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
  return Buffer.from(bytes).toString("utf8");
}

// Preview → Apply can lag well after onDidRenameFiles; keep trying so a slow
// Apply (or a dropped Apply) still ends with disk matching the planned text.
const SETTLE_ATTEMPTS = 300;
const SETTLE_GAP_MS = 100;

/**
 * After the rename: if the note does not yet match the planned text (waitUntil
 * OK path not run, or Preview Apply still pending/dropped), apply the edits
 * ourselves and save clean notes to disk.
 */
async function settleLinkUpdates(
  files: readonly FileTextEdits[],
  expected: ReadonlyMap<string, string>,
  clean: ReadonlySet<string>,
): Promise<void> {
  const settled = new Set<string>();
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await wait(SETTLE_GAP_MS);
    }
    if (await ensureLinkUpdates(files, expected, clean, settled)) {
      return;
    }
  }
  await ensureLinkUpdates(files, expected, clean, settled);
}

/**
 * @returns true when every target matches expected and clean notes are saved.
 * A note added to `settled` is left alone on later attempts, so what the user
 * types into it while another note is still retried is not overwritten.
 */
async function ensureLinkUpdates(
  files: readonly FileTextEdits[],
  expected: ReadonlyMap<string, string>,
  clean: ReadonlySet<string>,
  settled: Set<string>,
): Promise<boolean> {
  let done = true;
  for (const file of files) {
    const want = expected.get(file.uri);
    if (want === undefined || settled.has(file.uri)) {
      continue;
    }
    const uri = vscode.Uri.parse(file.uri);
    let document = await vscode.workspace.openTextDocument(uri);
    if (document.getText() !== want) {
      // Full-document replace: line/col from onWill stay valid only against the
      // pre-rename snapshot. Preview may have mutated the buffer first.
      const edit = new vscode.WorkspaceEdit();
      const end = document.positionAt(document.getText().length);
      edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), end), want);
      if (!(await vscode.workspace.applyEdit(edit))) {
        done = false;
        continue;
      }
      document = await vscode.workspace.openTextDocument(uri);
    }
    if (document.getText() !== want) {
      done = false;
      continue;
    }
    if (clean.has(file.uri) && document.isDirty) {
      if (!(await document.save())) {
        done = false;
        continue;
      }
    }
    settled.add(file.uri);
  }
  return done;
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
