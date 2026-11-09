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
  let file: string;
  try {
    file = await realpath(fileURLToPath(uri));
  } catch {
    return false;
  }
  for (const folder of folders) {
    try {
      if (isInside(await realpath(folder), file)) {
        return true;
      }
    } catch {
      // A folder that cannot be resolved holds nothing.
    }
  }
  return false;
}

function isInside(folder: string, file: string): boolean {
  const relative = path.relative(folder, file);
  return !(
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  );
}
