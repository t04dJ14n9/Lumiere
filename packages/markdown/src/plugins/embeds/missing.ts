import { t } from "@workshop/l10n";

/** An image that was found (or is remote) but whose bytes did not load. */
export class ImageLoadError extends Error {
  constructor(target: string) {
    super(t("Could not load {0}", target));
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
    return t("“{0}” embeds itself, so it is not shown again.", path);
  }
  if (missing.refused === "too deep") {
    return t("“{0}” is nested too deeply to show.", path);
  }
  const hash = path.indexOf("#");
  if (missing.section && hash >= 0) {
    const note = path.slice(0, hash).split("/").at(-1) || missing.note;
    const section = path.slice(hash + 1);
    return note === undefined
      ? t("Unable to find “{0}” in this note", section)
      : t("Unable to find “{0}” in {1}", section, note);
  }
  if (missing.fetchFailed) {
    return t("failed to fetch image");
  }
  return t("“{0}” could not be found.", path);
}

/** A note's name from its URI, without `.md`. */
export function noteName(uri: string | undefined): string | undefined {
  const name = uri?.split("/").at(-1);
  return name && decodeURIComponent(name).replace(/\.md$/iu, "");
}
