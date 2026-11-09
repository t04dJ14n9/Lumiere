import {
  extensionOf,
  folderOf,
  joinVaultPath,
  linkLookupKey,
} from "../../shared/vault-path";
import type { VaultFile } from "./api";
import type { FileTable } from "./file-table";

export interface ResolveOptions {
  /** `lumiere.markdown.links.folderNote`, for example `_index.md`; empty to disable. */
  folderNote: string;
}

/**
 * Obsidian's `getLinkpathDest` (DESIGN §12.3), for a link's path without its
 * `#subpath`. Returns every candidate in preference order; the first one is
 * the link's destination.
 */
export function resolveCandidates(
  files: FileTable,
  written: string,
  sourcePath: string,
  options: ResolveOptions,
): readonly VaultFile[] {
  if (written === "") {
    const source = files.get(sourcePath);
    return source ? [source] : [];
  }
  const path = relativeToVault(written, sourcePath);
  const direct = directMatch(files, path);
  if (direct) {
    return [direct];
  }
  // Rooted (absolute) links: a miss is final — no suffix or folder-note fuzzy.
  if (written.startsWith("/")) {
    return [];
  }
  const suffix = suffixMatches(files, path, sourcePath);
  if (suffix.length > 0) {
    return suffix;
  }
  const folderNote = folderNoteMatch(files, path, options);
  return folderNote ? [folderNote] : [];
}

/**
 * A `./` or `../` link as a vault path, as Obsidian takes it: joined to the
 * source note's folder, with any `..` above the vault root dropped. The
 * result then resolves like any other link (`../B/Same` from a note at the
 * root finds `dup/B/Same.md`).
 */
function relativeToVault(path: string, sourcePath: string): string {
  if (!path.startsWith("./") && !path.startsWith("../")) {
    return path;
  }
  const segments: string[] = [];
  for (const segment of `${folderOf(sourcePath)}/${path}`.split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment && segment !== ".") {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

/** Steps 2 to 5: exact path, unique basename, root path. */
function directMatch(files: FileTable, path: string): VaultFile | undefined {
  if (path.startsWith("/")) {
    const rooted = joinVaultPath(path);
    return rooted === undefined ? undefined : withExtension(files, rooted);
  }
  const exact = withExtension(files, path);
  if (exact) {
    return exact;
  }
  if (path.includes("/")) {
    return undefined;
  }
  const named = files.withKey(linkLookupKey(path));
  return named.length === 1 ? named[0] : undefined;
}

/** A link without an extension names a note: `Note` finds `Note.md`. */
function withExtension(files: FileTable, path: string): VaultFile | undefined {
  if (extensionOf(path)) {
    return (
      files.find(path) ??
      files.find(`${path}.md`) ??
      files.find(`${path}.markdown`)
    );
  }
  return (
    files.find(`${path}.md`) ??
    files.find(`${path}.markdown`) ??
    files.find(path)
  );
}

/**
 * Step 6: files whose path ends with the link path. Candidates under the
 * source note's folder (or a descendant) come first; within each group the
 * shortest path wins, as in Obsidian, so a link from `notes/daily/` to a name
 * in both `notes/` and `y/` opens `y/x.md`, not the nearer folder. Path order
 * breaks ties so the result does not depend on index order. Only files
 * sharing the link's basename can match, so the lookup table bounds the
 * search instead of a scan of the vault.
 */
function suffixMatches(
  files: FileTable,
  path: string,
  sourcePath: string,
): VaultFile[] {
  const wanted = path.replace(/^\/+/, "").toLowerCase();
  const wantedMd = extensionOf(wanted) ? wanted : `${wanted}.md`;
  const wantedMarkdown = extensionOf(wanted) ? wanted : `${wanted}.markdown`;
  const sourceFolder = folderOf(sourcePath);
  const matched = files
    .withKey(linkLookupKey(path))
    .filter((file) => {
      const candidate = file.path.toLowerCase();
      return (
        endsWithSegments(candidate, wantedMd) ||
        endsWithSegments(candidate, wantedMarkdown) ||
        endsWithSegments(candidate, wanted)
      );
    })
    .sort(byLengthThenPath);
  const isUnderSource = (file: VaultFile) =>
    isUnderSourceFolder(folderOf(file.path), sourceFolder);
  return [
    ...matched.filter(isUnderSource),
    ...matched.filter((file) => !isUnderSource(file)),
  ];
}

/** Source folder itself, or a descendant; empty sourceFolder is the vault root. */
function isUnderSourceFolder(
  candidateFolder: string,
  sourceFolder: string,
): boolean {
  if (sourceFolder === "") {
    // Every vault path is under the root; treat all as under-source.
    return true;
  }
  return (
    candidateFolder === sourceFolder ||
    candidateFolder.startsWith(`${sourceFolder}/`)
  );
}

function endsWithSegments(path: string, suffix: string): boolean {
  return path === suffix || path.endsWith(`/${suffix}`);
}

function byLengthThenPath(a: VaultFile, b: VaultFile): number {
  return a.path.length - b.path.length || compare(a.path, b.path);
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** A link to a folder opens its folder note when one is configured. */
function folderNoteMatch(
  files: FileTable,
  path: string,
  options: ResolveOptions,
): VaultFile | undefined {
  if (!options.folderNote) {
    return undefined;
  }
  // `path` is already a vault path (a relative link was joined to its note).
  const folder = joinVaultPath(path);
  if (folder === undefined) {
    return undefined;
  }
  return files.find(`${folder}/${options.folderNote}`);
}
