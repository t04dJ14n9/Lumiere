/**
 * A real workspace folder on disk behind the fake VS Code, for the code that
 * resolves paths: PDFs inside it, a symbolic link out of it, and a PDF
 * beside it. `install` points the fake's file system and path helpers at it
 * and returns what undoes that.
 */
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as vscode from "./fake-vscode";

export interface WorkspaceFixture {
  /** The workspace folder: its real path. */
  root: string;
  /** A link to `root`, beside it: the path a window can have opened it by. */
  link: string;
  /** A PDF beside the workspace, not in it. */
  outside: string;
  /** A file of the workspace, by the real path of the folder. */
  uri(relative: string): vscode.Uri;
  /** The same file, by the link. */
  linkUri(relative: string): vscode.Uri;
  /** Make the window's workspace folder the link, as when `~/vault` is a symbolic link. */
  openThroughLink(): void;
  /** Restore the fake and delete the folders. */
  remove(): Promise<void>;
}

const PDF = "%PDF-1.4\n%%EOF\n";

export async function installWorkspace(): Promise<WorkspaceFixture> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "bridge-ws-")));
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside.pdf");
  await mkdir(path.join(root, "papers"), { recursive: true });
  await mkdir(path.join(root, ".raw"), { recursive: true });
  for (const file of ["papers/a.pdf", "papers/b.pdf", ".raw/c.pdf"]) {
    await writeFile(path.join(root, file), PDF);
  }
  await writeFile(path.join(root, "papers", "notes.txt"), "x");
  // A folder that is named like a PDF.
  await mkdir(path.join(root, "papers", "archive.pdf"));
  const link = path.join(base, "workspace-link");
  // A junction needs no privilege on Windows; POSIX ignores the type.
  await symlink(root, link, "junction");
  await writeFile(outside, PDF);
  await symlink(outside, path.join(root, "papers", "escape.pdf"));

  const original = {
    folders: vscode.workspace.workspaceFolders,
    stat: vscode.workspace.fs.stat,
    relative: vscode.workspace.asRelativePath,
  };
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(root) }];
  vscode.workspace.fs.stat = (async (uri: vscode.Uri) => {
    const found = await stat(uri.fsPath);
    return {
      type: found.isDirectory() ? 2 : 1,
      ctime: 0,
      mtime: found.mtimeMs,
      size: found.size,
    };
  }) as never;
  // Relative to the folder that holds the file, as VS Code answers.
  vscode.workspace.asRelativePath = ((value: vscode.Uri | string) => {
    const file = typeof value === "string" ? value : value.path;
    const folder = vscode.workspace.workspaceFolders?.find(({ uri }) =>
      file.startsWith(`${uri.path}/`),
    );
    return folder ? file.slice(folder.uri.path.length + 1) : file;
  }) as never;
  return {
    root,
    link,
    outside,
    uri: (relative) => vscode.Uri.file(path.join(root, relative)),
    linkUri: (relative) => vscode.Uri.file(path.join(link, relative)),
    openThroughLink() {
      vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(link) }];
    },
    async remove() {
      vscode.workspace.workspaceFolders = original.folders;
      vscode.workspace.fs.stat = original.stat;
      vscode.workspace.asRelativePath = original.relative;
      await rm(base, { recursive: true, force: true });
    },
  };
}
