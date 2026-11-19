/** An image that was found (or is remote) but whose bytes did not load. */
export class ImageLoadError extends Error {
  constructor(target: string) {
    super(`Could not load ${target}`);
  }
}

/**
 * What an embed that can't be resolved says, as in Obsidian: a missing file
 * (an image included, local or not) by its path, a missing heading or block in
 * a note by the note's name (the current note's for `![[#Heading]]`). Only an
 * image whose bytes failed to load says `failed to fetch image`: the file
 * itself is there, so "could not be found" would be wrong.
 */
export function missingEmbedText(
  target: string,
  missing: {
    note?: string | undefined;
    section?: boolean | undefined;
    fetchFailed?: boolean | undefined;
    /** The note is there, but showing it would loop or nest too deep. */
    refused?: "circular" | "too deep" | undefined;
  } = {},
): string {
  const path = target.split("|")[0]!.trim();
  if (missing.refused === "circular") {
    return `“${path}” embeds itself, so it is not shown again.`;
  }
  if (missing.refused === "too deep") {
    return `“${path}” is nested too deeply to show.`;
  }
  const hash = path.indexOf("#");
  if (missing.section && hash >= 0) {
    const note = path.slice(0, hash).split("/").at(-1) || missing.note;
    return `Unable to find “${path.slice(hash + 1)}” in ${note ?? "this note"}`;
  }
  if (missing.fetchFailed) {
    return "failed to fetch image";
  }
  return `“${path}” could not be found.`;
}

/** A note's name from its URI, without `.md`. */
export function noteName(uri: string | undefined): string | undefined {
  const name = uri?.split("/").at(-1);
  return name && decodeURIComponent(name).replace(/\.md$/iu, "");
}
