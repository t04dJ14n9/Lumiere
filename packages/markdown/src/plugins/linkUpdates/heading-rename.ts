import { metadata } from "../../markdown/metadata";
import { noteFragment } from "../../markdown/metadata/fragments";
import { linkSyntax } from "../../markdown/metadata/linkpaths";
import type { TextEdit } from "../../shared/host";
import {
  isExternalLink,
  splitLinktext,
  splitMarkdownDestination,
  type LinkSyntax,
} from "../../shared/vault-path";
import { linkSource, type LinkSource } from "./link-source";
import { linkRewriteEdits, type LinkRewrite } from "./yaml-safe-edits";

/** A heading to rename: where it starts, its name and where the name is. */
export interface HeadingToRename {
  from: number;
  name: string;
  nameFrom: number;
  nameTo: number;
}

/** The ATX heading on the line holding `offset`, if there is one. */
export function headingAt(
  text: string,
  offset: number,
): HeadingToRename | undefined {
  const lineFrom = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = text.indexOf("\n", offset);
  const line = text
    .slice(lineFrom, lineEnd < 0 ? undefined : lineEnd)
    .replace(/\r$/u, "");
  const match = /^( {0,3}#{1,6}[ \t]+)(.*?)(?:[ \t]+#+)?[ \t]*$/u.exec(line);
  // Only a heading the note's metadata has: not a `#` line in code.
  const known = metadata(text).headings.some(
    (heading) => heading.position.start.offset === lineFrom,
  );
  if (!match || !known || !match[2]) {
    return undefined;
  }
  const nameFrom = lineFrom + match[1]!.length;
  return {
    from: lineFrom,
    name: match[2],
    nameFrom,
    nameTo: nameFrom + match[2].length,
  };
}

/** The note holding the renamed heading, as links to it are resolved. */
export interface RenamedHeading {
  /** The note's vault path and text before the rename. */
  path: string;
  text: string;
  heading: HeadingToRename;
  name: string;
}

/**
 * The edits that keep one note's links to a renamed heading working, as in
 * Obsidian: each link whose `#subpath` names the heading (as links resolve,
 * so case does not matter) gets the new name, keeping its path, form and
 * alias. Nested subpaths (`#Parent#Heading`) are left, as Obsidian leaves
 * them.
 */
export function headingLinkEdits(
  text: string,
  sourcePath: string,
  renamed: RenamedHeading,
  resolve: (
    linkpath: string,
    sourcePath: string,
    syntax: LinkSyntax,
  ) => string | undefined,
): TextEdit[] {
  const rewrites: LinkRewrite[] = [];
  const note = metadata(text);
  // Links within the note (`[[#Heading]]`) count too: they have no path.
  const links = [...note.links, ...note.embeds, ...note.frontmatterLinks];
  for (const link of links) {
    if (isExternalLink(link.link)) {
      continue;
    }
    const syntax = linkSyntax(link);
    const { path, subpath } =
      syntax === "wikilink"
        ? splitLinktext(link.link)
        : splitMarkdownDestination(link.link);
    const target = path ? resolve(path, sourcePath, syntax) : sourcePath;
    const fragment = subpath.slice(1);
    if (
      target !== renamed.path ||
      !fragment ||
      fragment.includes("#") ||
      noteFragment(renamed.text, fragment)?.from !== renamed.heading.from
    ) {
      continue;
    }
    rewrites.push({
      from: link.position.start.offset,
      to: link.position.end.offset,
      rewrite: (original) => withSubpath(original, renamed.name),
    });
  }
  return linkRewriteEdits(text, rewrites);
}

/**
 * What a link to a heading named `name` holds after its `#`, as Obsidian
 * writes it: the characters a link cannot carry (`:`, `#`, `|`, `^`, `\`,
 * line breaks, `%%`, `[[`, `]]`) become spaces, and runs of spaces one.
 * Links still reach the heading: they are matched with punctuation read as
 * spaces. Empty when nothing of the name is left for a link.
 */
export function headingSubpath(name: string): string {
  return name
    .replace(/[:#|^\\\r\n]|%%|\[\[|\]\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Characters a Markdown destination cannot hold as written, percent-encoded
 * (links are decoded before they resolve): a bare one ends at a space and
 * breaks on an unbalanced parenthesis, an angled one ends at `>`; a `%` is
 * encoded so it is not read as the start of an escape.
 */
const BARE_UNSAFE = /[% ()]/gu;
const ANGLED_UNSAFE = /[%<>]/gu;

function percentEncoded(text: string, unsafe: RegExp): string {
  return text.replace(
    unsafe,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** A link's source text with its `#subpath` replaced by heading `name`'s. */
function withSubpath(original: string, name: string): string {
  const source = linkSource(original);
  if (!source) {
    return original;
  }
  const subpath = headingSubpath(name);
  const written = source.opening.endsWith("[[")
    ? subpath
    : percentEncoded(subpath, source.isAngled ? ANGLED_UNSAFE : BARE_UNSAFE);
  return `${source.opening}${destinationOf(source, `#${written}`)}${source.closing}`;
}

/** The path as written followed by `subpath`, in the link's own brackets. */
function destinationOf(source: LinkSource, subpath: string): string {
  const written = `${source.path}${subpath}`;
  return source.isAngled ? `<${written}>` : written;
}
