import * as vscode from "vscode";
import type { WorkspaceFiles } from "../shared/workspace-files";
import { contained } from "./navigation";

/** VS Code file operations behind `Workshop.files`. Missing files are undefined, not throws. */
export function createWorkspaceFiles(): WorkspaceFiles {
  return {
    authorize: (root, target) => contained(parse(root), parse(target)),
    readText,
    writeText,
    createText: (uri, text) => createFile(uri, new TextEncoder().encode(text)),
    writeBytes,
    createBytes: createFile,
    list,
    mkdir,
    copy,
    move,
    remove,
    isSymbolicLink,
    pickFile,
  };
}

async function readText(uri: string): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(parse(uri));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function writeText(uri: string, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(
    parse(uri),
    new TextEncoder().encode(text),
  );
}

async function createFile(uri: string, contents: Uint8Array): Promise<boolean> {
  const target = parse(uri);
  const edit = new vscode.WorkspaceEdit();
  // VS Code refuses to create over a file that is there and checks that in
  // the same step, so a file made meanwhile is never overwritten.
  edit.createFile(target, { overwrite: false, contents });
  if (await vscode.workspace.applyEdit(edit)) {
    return true;
  }
  if (await exists(target)) {
    return false;
  }
  throw new Error(`Could not create ${target.toString()}`);
}

async function exists(target: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function writeBytes(uri: string, data: Uint8Array): Promise<void> {
  await vscode.workspace.fs.writeFile(parse(uri), data);
}

async function list(uri: string): Promise<readonly string[] | undefined> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(parse(uri));
    return entries.map(([name]) => name);
  } catch {
    return undefined;
  }
}

async function mkdir(uri: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(parse(uri));
}

async function copy(from: string, to: string): Promise<void> {
  await vscode.workspace.fs.copy(parse(from), parse(to), { overwrite: true });
}

async function move(from: string, to: string): Promise<void> {
  await vscode.workspace.fs.rename(parse(from), parse(to), {
    overwrite: false,
  });
}

async function remove(uri: string): Promise<void> {
  await vscode.workspace.fs.delete(parse(uri), { recursive: false });
}

async function isSymbolicLink(uri: string): Promise<boolean> {
  try {
    const info = await vscode.workspace.fs.stat(parse(uri));
    return Boolean(info.type & vscode.FileType.SymbolicLink);
  } catch {
    return false;
  }
}

async function pickFile(title: string): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
  });
  return picked?.[0]?.toString();
}

function parse(uri: string): vscode.Uri {
  return vscode.Uri.parse(uri);
}
