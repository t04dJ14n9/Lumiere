import * as vscode from "vscode";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/** All navigation paths are checked again in the native adapter, including symlinks. */
export async function contained(
  root: vscode.Uri,
  target: vscode.Uri,
): Promise<void> {
  const relative = path.posix.relative(root.path, target.path);
  if (
    root.scheme !== target.scheme ||
    root.authority !== target.authority ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative)
  ) {
    throw new Error("Link escapes the vault");
  }
  if (root.scheme === "file") {
    await containedLocalPath(root, target);
  } else {
    await containedVirtualPath(root, relative);
  }
}

async function containedLocalPath(
  root: vscode.Uri,
  target: vscode.Uri,
): Promise<void> {
  const base = await realpath(root.fsPath);
  let candidate = target.fsPath;
  while (true) {
    try {
      const actual = await realpath(candidate);
      const rel = path.relative(base, actual);
      if (
        rel === ".." ||
        rel.startsWith(".." + path.sep) ||
        path.isAbsolute(rel)
      ) {
        throw new Error("Link symlink escapes the vault");
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // `realpath` throws ENOENT for a dangling symlink as well as a missing
      // path; a symlink whose target is missing could point outside the vault.
      if (await isSymbolicLink(candidate)) {
        throw new Error("Link symlink escapes the vault", { cause: error });
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      candidate = parent;
    }
  }
}

async function isSymbolicLink(candidate: string): Promise<boolean> {
  try {
    return (await lstat(candidate)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function containedVirtualPath(
  root: vscode.Uri,
  relative: string,
): Promise<void> {
  let current = root;
  for (const component of relative.split("/").filter(Boolean)) {
    current = vscode.Uri.joinPath(current, component);
    try {
      const stat = await vscode.workspace.fs.stat(current);
      if (stat.type & vscode.FileType.SymbolicLink) {
        throw new Error("Symbolic link refused");
      }
    } catch (error) {
      if (
        !(error instanceof vscode.FileSystemError) ||
        error.code !== "FileNotFound"
      ) {
        throw error;
      }
    }
  }
}
