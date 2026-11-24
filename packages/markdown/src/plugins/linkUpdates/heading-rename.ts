import { metadata } from "../../markdown/metadata";
import { noteFragment } from "../../markdown/metadata/fragments";
import { linkSyntax } from "../../markdown/metadata/linkpaths";
import type { TextEdit } from "../../shared/host";
import { noteLineFragment } from "../../shared/native-links";
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
  /** What links to the heading hold after its `#` (`renamedHeadingFragment`). */
  subpath: string;
}

/**
 * The edits that keep one note's links to a renamed heading working, as in
 * Obsidian: each link whose `#subpath` names the heading (as links resolve,
 * so case does not matter) gets the new name, keeping its path, form and
 * alias. Nested subpaths (`#Parent#Heading`) are left, as Obsidian leaves
 * them.
 */
/**
 * Whether a link's fragment (what follows its `#`) names the renamed heading:
 * it is one level of text, and the heading it finds is this one. Shared by
 * note links and canvas file nodes.
 */
export function namesRenamedHeading(
  renamed: RenamedHeading,
  fragment: string,
): boolean {
  return (
    fragment !== "" &&
    !fragment.includes("#") &&
    noteFragment(renamed.text, fragment)?.from === renamed.heading.from
  );
}

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
    if (
      target !== renamed.path ||
      !namesRenamedHeading(renamed, subpath.slice(1))
    ) {
      continue;
    }
    rewrites.push({
      from: link.position.start.offset,
      to: link.position.end.offset,
      rewrite: (original) => withSubpath(original, renamed.subpath),
    });
  }
  return linkRewriteEdits(text, rewrites);
}

/**
 * What a link to a heading whose text is `text` holds after its `#`, as
 * Obsidian writes it: the characters a link cannot carry (`:`, `#`, `|`, `^`,
 * `\`, line breaks, `%%`, `[[`, `]]`) become spaces, and runs of spaces one.
 * Links still reach the heading: they are matched with punctuation read as
 * spaces. Empty when nothing of the text is left for a link.
 */
export function headingSubpath(text: string): string {
  return text
    .replace(/[:#|^\\\r\n]|%%|\[\[|\]\]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The subpath links to a renamed heading get, or why none can reach it. */
export type HeadingFragment = { subpath: string } | { problem: string };

/**
 * What links to `heading` hold after its `#` once it is named `name`, or why
 * no link could reach it by that name. Links resolve against the heading's
 * text as the note's metadata reads it, which drops formatting
 * (`New [[Target|Alias]]` is `New Alias`, `[Label](url)` is `Label`), so the
 * subpath is written from that text, and kept only if a link holding it
 * names this heading as links are followed (`noteFragment`, and not read as
 * a `#L12` line range). As in Obsidian, a name an earlier heading has is
 * kept: links then reach the first heading with it. Obsidian 1.15 writes
 * the name as typed (`#New Target Alias`).
 */
export function renamedHeadingFragment(
  text: string,
  heading: HeadingToRename,
  name: string,
): HeadingFragment {
  const note =
    text.slice(0, heading.nameFrom) + name + text.slice(heading.nameTo);
  const shown = metadata(note).headings.find(
    (entry) => entry.from === heading.from,
  )?.heading;
  if (shown === undefined) {
    return { problem: "With this name the line would no longer be a heading." };
  }
  const subpath = headingSubpath(shown);
  if (!subpath) {
    return {
      problem:
        "Links could not reach a heading with only formatting or : # | ^ \\ [[ ]] in its name.",
    };
  }
  if (noteLineFragment(subpath)) {
    return {
      problem: `Links would read #${subpath} as a line number, not as this heading.`,
    };
  }
  // Checked against the heading's line alone, so an earlier heading with
  // the same text (which links reach first, as in Obsidian) does not count.
  const lineEnd = note.indexOf("\n", heading.from);
  const line = note.slice(heading.from, lineEnd < 0 ? undefined : lineEnd);
  if (noteFragment(line, subpath)?.from !== 0) {
    return { problem: "Links could not reach a heading with this name." };
  }
  return { subpath };
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

/** A link's source text with its `#subpath` replaced by `subpath`. */
function withSubpath(original: string, subpath: string): string {
  const source = linkSource(original);
  if (!source) {
    return original;
  }
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
