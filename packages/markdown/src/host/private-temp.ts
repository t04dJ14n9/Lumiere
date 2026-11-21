/**
 * Folders of this user's in the system temp folder, for the files Lumiere
 * hands to agents. On a multi-user machine that temp folder is shared: a
 * fixed name there could already be another user's folder, or a link to one,
 * and a note's text written into it could be read or a file of ours replaced.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** `name` in the system temp folder, with the user's id where there is one. */
export function userTempFolder(name: string): string {
  const uid = process.getuid?.();
  return path.join(os.tmpdir(), uid === undefined ? name : `${name}-${uid}`);
}

/**
 * Make `folder` (and its parents) and check it is a real folder this user
 * owns, closed to everyone else; throw rather than write into anything else.
 * Windows has no user ids here: its temp folder is the user's own.
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

/**
 * Write `text` as `name` in a folder of its own under the private `folder`;
 * its path. The name repeats (`a.md-12-18.md` for lines 12 to 18 of any
 * `a.md`), and the folder is one for every VS Code window of this user's: a
 * fixed path would let a later copy, in another project's window perhaps,
 * replace the passage an agent was already handed.
 */
export async function writeOwnFile(
  folder: string,
  name: string,
  text: string,
): Promise<string> {
  await makePrivateFolder(folder);
  const own = await fs.mkdtemp(path.join(folder, "copy-"));
  const file = path.join(own, path.basename(name));
  await fs.writeFile(file, text, { mode: 0o600 });
  return file;
}
