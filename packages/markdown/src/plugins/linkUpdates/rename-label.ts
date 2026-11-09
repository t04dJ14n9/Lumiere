import { isMarkdownPath, nameOf, stemOf } from "../../shared/vault-path";
import type { LinkSource } from "./link-source";

/**
 * `source` with its shown text following a rename, as Obsidian updates it:
 * a wikilink alias that is the old file's name when the link spells a
 * folder (`[[f/Old|Old]]`), a Markdown link's text that is the old note's
 * name (`[Old](Old.md)`) or, when it spells a folder, its old path. Any
 * other alias or text is the writer's own and is kept.
 *
 * `oldPath` is the link's path as written, decoded and without its
 * subpath; `newPath` is the path written in its place, with a note's `.md`
 * for Markdown links.
 */
export function withRenamedLabel(
  source: LinkSource,
  oldPath: string,
  newPath: string,
): LinkSource {
  return source.opening.endsWith("[[")
    ? renamedAlias(source, newPath)
    : renamedText(source, oldPath, newPath);
}

function renamedAlias(source: LinkSource, newPath: string): LinkSource {
  const alias = /^(\\?\|)(.*)(\]\])$/su.exec(source.closing);
  // Obsidian compares with the written path and subpath together.
  const written = `${source.path}${source.subpath}`;
  // Only the path can end in `.md`; a dot in the subpath is part of it.
  const shown = `${shownName(source.path)}${source.subpath}`;
  if (!alias || !written.includes("/") || shown !== alias[2]!.trim()) {
    return source;
  }
  // A wikilink writes a note without `.md`, so what follows the last dot of
  // `newPath` belongs to the name and is never an extension to strip.
  return { ...source, closing: `${alias[1]}${nameOf(newPath)}${alias[3]}` };
}

function renamedText(
  source: LinkSource,
  oldPath: string,
  newPath: string,
): LinkSource {
  const opening = /^(!?\[)(.*)(\]\(\s*)$/su.exec(source.opening);
  if (!opening) {
    return source;
  }
  const text = unescapeLabel(
    opening[2]!.replace(/\u00A0|\u202F/gu, " ").trim(),
  );
  let renamed: string | undefined;
  if (text === shownName(oldPath)) {
    renamed = shownName(newPath);
  } else if (text.includes("/") && text === shownPath(oldPath)) {
    renamed = shownPath(newPath);
  }
  return renamed === undefined
    ? source
    : {
        ...source,
        opening: `${opening[1]}${escapeLabel(renamed)}${opening[3]}`,
      };
}

/** A file name written as link text must not end it or escape its end. */
function escapeLabel(text: string): string {
  return text.replace(/[\\[\]]/gu, "\\$&");
}

/** The text a label shows: its escaped `\`, `[` and `]` taken literally. */
function unescapeLabel(text: string): string {
  return text.replace(/\\([\\[\]])/gu, "$1");
}

/** A note's name without `.md`; any other file's name with its extension. */
function shownName(path: string): string {
  return isMarkdownPath(path) ? stemOf(path) : nameOf(path);
}

/** A note's path without `.md`; any other file's path as it is. */
function shownPath(path: string): string {
  return isMarkdownPath(path) ? path.replace(/\.[^./]*$/u, "") : path;
}
