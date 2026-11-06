/**
 * Which PDF a Markdown link names, as the key the open viewer is looked up
 * by: a path inside a workspace folder with `/` separators, as `displayPath`
 * writes it.
 *
 * The reading is the one the Markdown editor opens the link by
 * (packages/markdown navigation), so an overlay paints on the PDF the click
 * would open: `./`, `../` and a bare name are relative to the note's folder;
 * a leading `/` is the vault root; any other foldered path (`papers/a.pdf`,
 * what Copy link writes) is the vault root first, else the note's folder.
 */

export interface PdfLinkKeys {
  /** In the note's workspace folder: where the link opens when that file exists. */
  pdfKey: string;
  /**
   * In the note's workspace folder: where a foldered path opens when `pdfKey`
   * is not a file. Whether it is, only the file system knows.
   */
  fallbackKey?: string;
  /**
   * An absolute path as written. `displayPath` gives a PDF outside every
   * workspace folder in full, so this is the key it is looked up by there.
   */
  externalKey?: string;
}

/** `pathPart` is the link's path, still percent-encoded, without `#…`. */
export function pdfKeysOfLinkPath(
  pathPart: string,
  notePath: string,
): PdfLinkKeys | undefined {
  if (/^file:/iu.test(pathPart)) {
    const path = fileUrlPath(pathPart);
    return withKeys(collapsePath(path), { externalKey: path });
  }
  // Decoded once, here: Copy link encodes `%`, so a second decode would turn
  // a file named `a%20b.pdf` into `a b.pdf`.
  const path = decodeLinkPath(pathPart).trim().replaceAll("\\", "/");
  const external = isAbsolutePath(path) ? { externalKey: path } : {};
  if (path.startsWith("/")) {
    return withKeys(collapsePath(path), external);
  }
  const noteRelative = collapsePath(joinPath(folderOf(notePath), path));
  if (isNoteRelative(path)) {
    return withKeys(noteRelative);
  }
  const vaultRoot = collapsePath(path);
  if (vaultRoot === undefined) {
    return undefined;
  }
  const fallback =
    noteRelative !== undefined && noteRelative !== vaultRoot
      ? { fallbackKey: noteRelative }
      : {};
  return { pdfKey: vaultRoot, ...fallback, ...external };
}

/**
 * A workspace-relative PDF path as `displayPath` writes it: `/` separators.
 * Never decoded: it is a real path, so a `%` in it is part of the name.
 */
export function normalizePdfKey(raw: string): string {
  return raw.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function withKeys(
  pdfKey: string | undefined,
  rest: Omit<PdfLinkKeys, "pdfKey"> = {},
): PdfLinkKeys | undefined {
  return pdfKey ? { pdfKey, ...rest } : undefined;
}

function isNoteRelative(path: string): boolean {
  return path.startsWith("./") || path.startsWith("../") || !path.includes("/");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-z]:\//iu.test(path);
}

function decodeLinkPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    // A stray `%` in a hand-written link is part of the name.
    return path;
  }
}

function fileUrlPath(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(
      /^\/([a-z]:\/)/iu,
      "$1",
    );
  } catch {
    return url.replace(/^file:\/\//iu, "");
  }
}

function folderOf(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(0, slash) : "";
}

function joinPath(folder: string, path: string): string {
  return folder ? `${folder}/${path}` : path;
}

/**
 * Collapse `.` and `..`; the result has no leading `/`. A path that climbs
 * out of the vault names nothing the editor would open ("Link escapes the
 * vault"), so it has no key.
 */
function collapsePath(path: string): string | undefined {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment !== "..") {
      out.push(segment);
    } else if (out.pop() === undefined) {
      return undefined;
    }
  }
  return out.length > 0 ? out.join("/") : undefined;
}
