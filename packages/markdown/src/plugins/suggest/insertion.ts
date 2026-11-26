import type { VaultFile, VaultIndex } from "../vault/api";
import type { Candidate, Value } from "./candidates";
import type { Suggestion } from "./protocol";
import { folderOf, relativeLinkPath } from "../../shared/vault-path";
export function materialize(options: {
  vault: VaultIndex;
  source: string;
  entry: Candidate;
  globalBlock: boolean;
  /** `^` was typed without `#`: the link's `#` comes with the id. */
  bare?: boolean;
  useWikilinks: boolean;
  /** Typed inside `[text](`: only the destination, or the fragment, is inserted. */
  destination?: "relative" | "root";
}): Suggestion {
  const { vault, source, entry, globalBlock, useWikilinks } = options;
  const base = {
    label: entry.label,
    detail: entry.detail,
    ...blockIdOf(entry, source),
  };
  if (options.destination) {
    const isRoot = options.destination === "root";
    return {
      ...base,
      insert: destinationText(vault, entry, { source, isRoot }),
    };
  }
  if (!useWikilinks) {
    return {
      ...base,
      insert: markdownLink(vault, entry, source),
      replaceLink: true,
    };
  }
  const text = wikiText(vault, source, entry.value, globalBlock);
  const bare = options.bare && entry.value.kind === "block" && !globalBlock;
  return { ...base, insert: bare ? `#^${text}` : text };
}

/** The id a picked block without one gets, as Obsidian adds it. */
function blockIdOf(entry: Candidate, source: string) {
  const value = entry.value;
  if (value.kind !== "block" || !value.newId) {
    return {};
  }
  return {
    blockId: {
      uri: value.target.uri,
      ...value.newId,
      here: value.target.path === source,
    },
  };
}
function wikiText(
  vault: VaultIndex,
  source: string,
  value: Value,
  globalBlock: boolean,
): string {
  if (value.kind === "literal" || value.kind === "heading") {
    return value.text;
  }
  if (value.kind === "pdfSection") {
    // The alias cannot hold brackets: `]]` would end the link early.
    return `page=${value.page}|${value.title.replace(/[[\]]/gu, "")}`;
  }
  if (value.kind === "block") {
    return globalBlock
      ? `${vault.linkText(value.target, source)}#^${value.id}`
      : value.id;
  }
  return (
    vault.linkText(value.target, source) +
    (value.alias ? `|${value.alias}` : "")
  );
}
function markdownLink(
  vault: VaultIndex,
  entry: Candidate,
  source: string,
): string {
  const path = markdownPath(vault, entry.value, { source, isRoot: false });
  const fragment = fragmentOf(entry.value);
  const label = entry.label.replace(/([\\[\]])/g, "\\$1");
  return `[${label}](${path}${fragment === undefined ? "" : `#${fragment}`})`;
}

/**
 * What a link needs inside its parentheses when its text is written already:
 * a note's or file's path, or, once `#` is typed (and `^` for a block), the
 * heading, block id or PDF page. A path is relative to the note, as new
 * Markdown links are written, or from the vault's root after a typed `/`.
 */
function destinationText(
  vault: VaultIndex,
  entry: Candidate,
  where: { source: string; isRoot: boolean },
): string {
  const value = entry.value;
  if (value.kind === "block") {
    return encodeDestination(value.id);
  }
  return fragmentOf(value) ?? markdownPath(vault, value, where);
}

function markdownPath(
  vault: VaultIndex,
  value: Value,
  where: { source: string; isRoot: boolean },
): string {
  let path: string;
  if (value.kind === "literal") {
    path = /\.[^/]+$/.test(value.text) ? value.text : `${value.text}.md`;
  } else if (where.isRoot) {
    path = `/${value.target.path}`;
  } else {
    path = relativeLinkPath(
      folderOf(where.source),
      value.target.path,
      (candidate) => hasFileIgnoringCase(vault, candidate),
    );
  }
  return path.split("/").map(encodeDestination).join("/");
}
/**
 * Whether the vault has a file at `path` in any case: links resolve without
 * case, so a root `x.md` captures `X.md` as surely as a root `X.md` does.
 */
function hasFileIgnoringCase(vault: VaultIndex, path: string): boolean {
  return (
    vault.file(path) !== undefined ||
    lowerCasePaths(vault.files()).has(path.toLowerCase())
  );
}

const lowerCaseSets = new WeakMap<readonly VaultFile[], Set<string>>();

/**
 * The vault's paths lower-cased, built once per file list: the index hands
 * out the same array until a file is added or removed.
 */
function lowerCasePaths(files: readonly VaultFile[]): Set<string> {
  let set = lowerCaseSets.get(files);
  if (!set) {
    set = new Set(files.map((file) => file.path.toLowerCase()));
    lowerCaseSets.set(files, set);
  }
  return set;
}
/** The encoded text after `#` for a heading, block or PDF page; none for a note. */
function fragmentOf(value: Value): string | undefined {
  if (value.kind === "heading") {
    return encodeDestination(value.text);
  }
  if (value.kind === "pdfSection") {
    return `page=${value.page}`;
  }
  return value.kind === "block" ? `^${encodeDestination(value.id)}` : undefined;
}
function encodeDestination(value: string): string {
  return encodeURIComponent(value).replace(
    /[()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
