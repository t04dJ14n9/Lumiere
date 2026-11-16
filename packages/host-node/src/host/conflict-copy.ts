/**
 * Where another program's version of a note goes when unsaved typing is
 * written over it: a new file beside the note, so neither text is lost.
 */
import type { HostFiles } from "./platform";

/** Names tried before giving up: `Note (conflict).md`, then `Note (conflict 2).md`, … */
const MAX_COPIES = 100;

/** The URI of copy `n` (from 1) of the note at `uri`. */
export function conflictCopyUri(uri: string, n: number): string {
  const slash = uri.lastIndexOf("/");
  const name = uri.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  const suffix = encodeURIComponent(
    n === 1 ? " (conflict)" : ` (conflict ${n})`,
  );
  return `${uri.slice(0, slash + 1)}${stem}${suffix}${extension}`;
}

/**
 * Write `text` to the first conflict copy of `uri` that does not exist yet,
 * and return that copy's URI. Created exclusively, so a copy (or anything
 * else) already there is never overwritten.
 */
export async function writeConflictCopy(
  files: Pick<HostFiles, "create" | "save">,
  uri: string,
  text: string,
): Promise<string> {
  for (let n = 1; n <= MAX_COPIES; n++) {
    const copy = conflictCopyUri(uri, n);
    if (await files.create(copy)) {
      await files.save(copy, text);
      return copy;
    }
  }
  throw new Error(
    "The note changed on disk and no conflict copy could be made",
  );
}
