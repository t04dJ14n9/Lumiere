import { metadata } from "../../markdown/metadata";
import type { LinkMetadata } from "../../markdown/metadata";
import {
  linkpathOf,
  linkSyntax,
  vaultLinks,
} from "../../markdown/metadata/linkpaths";
import type { FileTextEdits } from "../../shared/host";
import { formatLinkSource, linkSource } from "./link-source";
import { withRenamedLabel } from "./rename-label";
import { linkRewriteEdits, pointAt } from "./yaml-safe-edits";
import {
  folderOf,
  isMarkdownPath,
  lookupKey,
  nameOf,
  relativeLinkPath,
  withoutNoteExtension,
  type LinkSyntax,
} from "../../shared/vault-path";

export type LinkFormat = "shortest" | "relative" | "absolute";

export interface RewriteContext {
  /** Old vault path → new vault path, for every file being renamed. */
  renames: ReadonlyMap<string, string>;
  /** Resolve a link path from a note, before the rename. */
  resolve(
    linkpath: string,
    sourcePath: string,
    syntax: LinkSyntax,
  ): string | undefined;
  /** Every vault path after the rename, to tell whether a name is unique. */
  pathsAfter: readonly string[];
  format: LinkFormat;
}

type Edit = FileTextEdits["edits"][number];

/** A link a rename changes, and the vault path it points at afterwards. */
export interface LinkChange {
  link: LinkMetadata;
  newTarget: string;
  /**
   * The link's written path when its target was renamed; `undefined` when
   * only the source note moved, so its own links keep their text.
   */
  oldPath: string | undefined;
}

/**
 * The links of a note that renaming files changes: those to a renamed file,
 * and a renamed note's own path-style links when its folder changes. It
 * needs only link resolution, so the index's parsed links answer it as well
 * as a note's text does.
 */
export function changedLinks(
  links: readonly LinkMetadata[],
  sourcePath: string,
  context: Pick<RewriteContext, "renames" | "resolve">,
): LinkChange[] {
  const newSource = context.renames.get(sourcePath) ?? sourcePath;
  const sourceMoved =
    newSource !== sourcePath && folderOf(newSource) !== folderOf(sourcePath);
  const changes: LinkChange[] = [];
  for (const link of links) {
    const linkpath = linkpathOf(link)!;
    const target = context.resolve(linkpath, sourcePath, linkSyntax(link));
    if (!target) {
      continue;
    }
    const newTarget = context.renames.get(target) ?? target;
    const isPathStyle = linkpath.includes("/") || linkpath.startsWith(".");
    if (newTarget !== target || (sourceMoved && isPathStyle)) {
      changes.push({
        link,
        newTarget,
        oldPath: newTarget === target ? undefined : linkpath,
      });
    }
  }
  return changes;
}

/**
 * Whether renaming files changes the text of any of a note's links, from its
 * parsed links alone. A link to a moved file can keep its text (a link by
 * name to a note moved to another folder), and then is no change.
 */
export function changesLinkText(
  links: readonly LinkMetadata[],
  sourcePath: string,
  context: RewriteContext,
): boolean {
  const newSource = context.renames.get(sourcePath) ?? sourcePath;
  return changedLinks(links, sourcePath, context).some((change) => {
    const { original } = change.link;
    return rewriterOf(change, newSource, context)(original) !== original;
  });
}

/**
 * Edits that keep a note's links pointing at renamed files, as Obsidian's
 * **Automatically update internal links**. Each link keeps its form
 * (wikilink or Markdown link), its `#subpath` and its alias; the path is
 * written in the new-link format. A renamed note's own path-style links are
 * also rewritten when its folder changes. A link whose text stays the same
 * gets no edit, so a note with none is not touched.
 */
export function rewriteLinks(
  text: string,
  sourcePath: string,
  context: RewriteContext,
): Edit[] {
  const newSource = context.renames.get(sourcePath) ?? sourcePath;
  const changes = changedLinks(vaultLinks(metadata(text)), sourcePath, context);
  const rewrites = changes.map((change) => ({
    from: change.link.position.start.offset,
    to: change.link.position.end.offset,
    rewrite: rewriterOf(change, newSource, context),
  }));
  return linkRewriteEdits(text, rewrites)
    .filter((edit) => edit.insert !== text.slice(edit.from, edit.to))
    .map((edit) => ({
      start: pointAt(text, edit.from),
      end: pointAt(text, edit.to),
      text: edit.insert,
    }));
}

/** The link's new source text from its current one. */
function rewriterOf(
  { newTarget, oldPath }: LinkChange,
  newSource: string,
  context: RewriteContext,
): (original: string) => string {
  return (original) =>
    rewritten(original, targetText(newTarget, newSource, context), {
      target: newTarget,
      oldPath,
    });
}

/** The new path text for a link, without the `.md` of notes. */
function targetText(
  target: string,
  source: string,
  context: RewriteContext,
): string {
  const withoutNote = (path: string) =>
    isMarkdownPath(path) ? withoutNoteExtension(path) : path;
  if (context.format === "relative") {
    const after = lowerCasePaths(context.pathsAfter);
    return withoutNote(
      relativeLinkPath(folderOf(source), target, (path) =>
        after.has(path.toLowerCase()),
      ),
    );
  }
  const isUnique = () =>
    lookupKeyCounts(context.pathsAfter).get(lookupKey(target)) === 1;
  if (context.format === "shortest" && isUnique()) {
    return withoutNote(nameOf(target));
  }
  return withoutNote(target);
}

const keyCounts = new WeakMap<readonly string[], Map<string, number>>();

/**
 * How many of `paths` share each lookup key, counted once per rename rather
 * than once per link: a hub note's backlinks would otherwise scan the whole
 * vault for each link, inside VS Code's rename timeout.
 */
function lookupKeyCounts(paths: readonly string[]): Map<string, number> {
  let counts = keyCounts.get(paths);
  if (!counts) {
    counts = new Map();
    for (const path of paths) {
      const key = lookupKey(path);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    keyCounts.set(paths, counts);
  }
  return counts;
}

const lowerCaseSets = new WeakMap<readonly string[], Set<string>>();

/** `paths` lower-cased, built once per rename rather than once per link. */
function lowerCasePaths(paths: readonly string[]): Set<string> {
  let set = lowerCaseSets.get(paths);
  if (!set) {
    set = new Set(paths.map((path) => path.toLowerCase()));
    lowerCaseSets.set(paths, set);
  }
  return set;
}

/**
 * The link's source text with its path replaced, and with an alias or text
 * that showed the renamed file's name (`oldPath`) following it.
 */
function rewritten(
  original: string,
  path: string,
  { target, oldPath }: { target: string; oldPath: string | undefined },
): string {
  const source = linkSource(original);
  if (!source) {
    return original;
  }
  const isWikilink = source.opening.endsWith("[[");
  const extension = !isWikilink && isMarkdownPath(target) ? ".md" : "";
  const newPath = `${path}${extension}`;
  const labelled =
    oldPath === undefined ? source : withRenamedLabel(source, oldPath, newPath);
  return formatLinkSource(labelled, newPath, source.subpath);
}
