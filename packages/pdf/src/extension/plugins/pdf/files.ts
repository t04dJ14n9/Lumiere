import { createHash, randomBytes } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { PdfFiles } from "../../../shared/host";
import {
  annotationFolder,
  annotationStoreName,
} from "../../../shared/annotation-store";
import type { PdfFile } from "../../../shared/pdf-backlink-index";
import { writeAtomicFile } from "../../../host/atomic-write";
import { isProtectedPdf, PROTECTED_FOLDERS } from "../../protected-folders";

/** PDF files through VS Code's file system, so remote and virtual files open too. */
export const vscodePdfFiles: PdfFiles = {
  read: (uri) =>
    Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.parse(uri))),
  watch: (uri, onChange) => watchFile(vscode.Uri.parse(uri), onChange),
  displayPath: (uri) => displayPath(vscode.Uri.parse(uri)),
  hash: async (uri) => {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
    return createHash("sha256").update(bytes).digest("hex");
  },
  writeAtomic: async (uri, bytes) => {
    const parsed = vscode.Uri.parse(uri);
    if (parsed.scheme !== "file") {
      throw new Error("In-place annotation save requires a local file URI");
    }
    // Checked here as well as in the command: this is the last step before
    // the disk, whatever asked for the write.
    if (isProtectedPdf(parsed)) {
      throw new Error(
        `${displayPath(parsed)} is in a protected folder (${PROTECTED_FOLDERS}), so Lumiere does not write it`,
      );
    }
    return writeAtomicFile(parsed.fsPath, bytes);
  },
  annotations: {
    read: async (uri, sha256) => {
      const file = annotationFile(vscode.Uri.parse(uri), sha256);
      return file ? readText(file) : undefined;
    },
    write: async (uri, sha256, text) => {
      const file = annotationFile(vscode.Uri.parse(uri), sha256);
      if (!file) {
        throw new Error("There is no folder to keep this PDF's annotations in");
      }
      if (text === undefined) {
        await vscode.workspace.fs
          .delete(file)
          .then(undefined, (error: unknown) => {
            if (!isNotFound(error)) {
              throw error;
            }
          });
        return;
      }
      // Saving after every change: leave the file alone when nothing changed.
      if ((await readText(file)) === text) {
        return;
      }
      const folder = vscode.Uri.joinPath(file, "..");
      await vscode.workspace.fs.createDirectory(folder);
      const temp = vscode.Uri.joinPath(
        folder,
        `.${path.posix.basename(file.path)}.${randomBytes(8).toString("hex")}.tmp`,
      );
      await vscode.workspace.fs.writeFile(temp, new TextEncoder().encode(text));
      await vscode.workspace.fs.rename(temp, file, { overwrite: true });
    },
    key: (uri, sha256) =>
      annotationFile(vscode.Uri.parse(uri), sha256)?.toString() ?? sha256,
    // Another VS Code window has its own extension host: only the disk
    // tells this one that it saved the file.
    watch: (uri, sha256, onChange) => {
      const file = annotationFile(vscode.Uri.parse(uri), sha256);
      return file ? watchFile(file, onChange) : () => undefined;
    },
  },
};

/**
 * Where the annotations of a PDF with this hash are kept, as
 * `lumiere.pdf.annotations.folder` says: by default under the PDF's
 * workspace folder, else (a local file outside every folder) the home
 * folder. Never beside the PDF, which may sit among sources that must not
 * change.
 */
function annotationFile(
  pdf: vscode.Uri,
  sha256: string,
): vscode.Uri | undefined {
  const name = annotationStoreName(sha256);
  const folder = annotationFolder(
    vscode.workspace
      .getConfiguration("lumiere.pdf.annotations", pdf)
      .get<unknown>("folder"),
  );
  if (folder.from === "absolute") {
    return vscode.Uri.joinPath(vscode.Uri.file(folder.path), name);
  }
  const home =
    pdf.scheme === "file" ? vscode.Uri.file(os.homedir()) : undefined;
  const root =
    folder.from === "home"
      ? home
      : (vscode.workspace.getWorkspaceFolder(pdf)?.uri ?? home);
  return root ? vscode.Uri.joinPath(root, ...folder.segments, name) : undefined;
}

async function readText(file: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileNotFound"
  );
}

/**
 * Watch the folder's files and pick this one: a pattern is a glob, so the
 * name itself as the pattern never matches `Smith [2020].pdf`. A delete
 * counts too: an atomic replace may arrive as one, and a PDF really
 * deleted then fails its reload and says so, rather than showing the old
 * bytes as if nothing happened.
 */
function watchFile(uri: vscode.Uri, onChange: () => void): () => void {
  if (uri.scheme !== "file") {
    return () => undefined;
  }
  const folder = path.dirname(uri.fsPath);
  const name = path.basename(uri.fsPath);
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(folder), "*"),
  );
  const ifThisFile = (changed: vscode.Uri): void => {
    if (
      changed.scheme === "file" &&
      path.basename(changed.fsPath) === name &&
      path.dirname(changed.fsPath) === folder
    ) {
      onChange();
    }
  };
  const subscriptions = [
    watcher.onDidChange(ifThisFile),
    watcher.onDidCreate(ifThisFile),
    watcher.onDidDelete(ifThisFile),
  ];
  return () => {
    for (const subscription of subscriptions) {
      subscription.dispose();
    }
    watcher.dispose();
  };
}

/** The path agents should use: workspace-relative when possible. */
export function displayPath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
}

/**
 * Where a file is for the backlink index: its workspace folder, and its path
 * in it (`displayPath`). That path alone names two files in a multi-root
 * workspace whose folders both hold `papers/a.pdf`. A file outside every
 * folder has no folder (`""`) and its absolute path.
 */
export function workspaceLocation(uri: vscode.Uri): PdfFile {
  return {
    folder: vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? "",
    path: displayPath(uri),
  };
}
