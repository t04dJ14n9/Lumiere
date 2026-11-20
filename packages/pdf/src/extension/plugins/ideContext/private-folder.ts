import * as fs from "node:fs/promises";

/**
 * Make `folder` (and its parents) and check it is a real folder this user
 * owns, closed to everyone else; throw rather than write into anything else.
 * The IDE context packets go in the shared system temp folder, where a fixed
 * name could already be another user's folder, or a link to one. Windows has
 * no user ids here: its temp folder is the user's own. Lumiere's twin is
 * packages/markdown/src/host/private-temp.ts; both products share the folder.
 */
export async function makePrivateFolder(folder: string): Promise<void> {
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const info = await fs.lstat(folder);
  const uid = process.getuid?.();
  if (!info.isDirectory() || (uid !== undefined && info.uid !== uid)) {
    throw new Error(
      `${folder} is not a folder of this user's, so nothing was written there.`,
    );
  }
  if (uid !== undefined && (info.mode & 0o077) !== 0) {
    await fs.chmod(folder, 0o700);
  }
}
