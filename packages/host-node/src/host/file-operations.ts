/**
 * What an embedder's file tree does to a vault's files (the app's): new
 * notes and folders, renames and moves that update links (NoteDocuments,
 * note-renames.ts) and deletion. Every path is checked against the
 * workspace roots first, as the plugins' own file access is (workspace.ts).
 */
import type { NoteDocuments } from "./documents";
import type { Rename } from "./note-renames";
import { containInRoots, type HostFiles } from "./platform";
import { joinUri } from "./uris";
import { createWorkspaceFiles } from "./workspace";

export interface VaultFileOperations {
  /** A new, empty note; an existing file is refused. */
  createNote(uri: string): Promise<void>;
  /** A new folder (and those above it); an existing one is refused. */
  createFolder(uri: string): Promise<void>;
  /**
   * Rename or move a file or folder, updating the links to it as VS Code
   * does; a target that exists is refused. The notes whose links were left.
   */
  rename(from: string, to: string): Promise<readonly string[]>;
  /** Delete a file, or a folder with everything in it, for good. */
  remove(uri: string): Promise<void>;
  /**
   * The platform's path of a file or folder that exists inside the roots,
   * also through symbolic links, to hand another program (the system's
   * trash); rejects otherwise.
   */
  contain(uri: string): Promise<string>;
  /**
   * A file or folder went away by other means (the system's trash): notes
   * open there are not written back when their pages close.
   */
  forget(uri: string): void;
  /** A file or folder was renamed or moved (here, or by a note's title). */
  onDidRename(listener: (rename: Rename) => void): () => void;
}

export function createFileOperations(parts: {
  readonly files: HostFiles;
  readonly roots: () => readonly string[];
  readonly documents: NoteDocuments;
}): VaultFileOperations {
  const { files, roots, documents } = parts;
  const workspace = createWorkspaceFiles(files, roots);
  const inside = (uri: string) => containInRoots(files, roots(), uri);
  return {
    async createNote(uri) {
      if (!(await workspace.createText(uri, ""))) {
        throw new Error("A file with that name already exists");
      }
    },
    async createFolder(uri) {
      await inside(uri);
      if (await files.stat(uri)) {
        throw new Error("A file or folder with that name already exists");
      }
      await workspace.mkdir(uri);
    },
    rename: async (from, to) =>
      documents.renames.renameFiles([{ oldUri: from, newUri: to }]),
    async remove(uri) {
      await inside(uri);
      const link = await files.linkStat(uri);
      if (!link) {
        throw new Error("There is no such file or folder");
      }
      if (link.symbolicLink) {
        await files.remove(uri);
      } else {
        await removeTree(files, uri);
      }
      documents.forget(uri);
    },
    async contain(uri) {
      await inside(uri);
      if (!(await files.linkStat(uri))) {
        throw new Error("There is no such file or folder");
      }
      return files.toPath(uri);
    },
    forget: (uri) => documents.forget(uri),
    onDidRename: (listener) => documents.renames.onDidRename(listener),
  };
}

/**
 * A file, or a folder with everything in it. A symbolic link inside is
 * listed as neither file nor folder and removed itself, never what it
 * points at (`remove` checks the one it is given).
 */
async function removeTree(files: HostFiles, uri: string): Promise<void> {
  for (const entry of (await files.list(uri)) ?? []) {
    const child = joinUri(files, uri, entry.name);
    if (entry.kind === "folder") {
      await removeTree(files, child);
    } else {
      await files.remove(child);
    }
  }
  await files.remove(uri);
}
