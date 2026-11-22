import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OutlineFiles } from "./reader";

/**
 * `files`, except that a local PDF whose real path is outside every one of
 * `folders` reads as missing. The vault lists a symbolic link to a file
 * wherever it points, so without this `[[paper.pdf#` would offer the
 * bookmarks of a PDF that is not in the workspace. A URI that is not a
 * `file:` one has no real path to resolve: the editor's file system answers.
 */
export function insideFolders(
  files: OutlineFiles,
  folders: () => readonly string[],
): OutlineFiles {
  const isAllowed = (uri: string) =>
    !uri.startsWith("file:") || isRealPathInside(folders(), uri);
  return {
    async stat(uri) {
      return (await isAllowed(uri)) ? files.stat(uri) : undefined;
    },
    async read(uri) {
      // The file can change between the two calls.
      if (!(await isAllowed(uri))) {
        throw new Error("The PDF is outside the workspace");
      }
      return files.read(uri);
    },
  };
}

async function isRealPathInside(
  folders: readonly string[],
  uri: string,
): Promise<boolean> {
  return (await containingFolder(folders, uri)) !== undefined;
}

/**
 * The first of `folders` whose real path holds the real path of the local
 * file `uri`, and where in it the file is (`relative`, from that folder's
 * real path, with the platform's separators). A window can open a folder
 * through a link (`~/vault`), while a file is named by its real path:
 * `relative` lets a caller put the file back under the folder as the window
 * has it. Undefined when no folder holds it, or the file cannot be resolved.
 */
export async function containingFolder(
  folders: readonly string[],
  uri: string,
): Promise<{ folder: string; relative: string } | undefined> {
  let file: string;
  try {
    file = await realpath(fileURLToPath(uri));
  } catch {
    return undefined;
  }
  for (const folder of folders) {
    try {
      const real = await realpath(folder);
      if (isInside(real, file)) {
        return { folder, relative: path.relative(real, file) };
      }
    } catch {
      // A folder that cannot be resolved holds nothing.
    }
  }
  return undefined;
}

function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return !(
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  );
}
