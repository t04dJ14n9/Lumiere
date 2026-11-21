import { isHtmlFile } from "../../shared/html-file";

/** What a call of the open command asks for. */
export interface HtmlViewerRequest {
  /** The HTML file's URI. */
  readonly uri: string;
  /** The vault the link is in: the file must be inside it. */
  readonly root: string;
  /** Where to open it: VS Code's view column, `-2` beside. */
  readonly column?: number;
}

const MAX_URI = 8192;

/**
 * The open command's arguments: `(uri, root, { viewColumn })`. Link
 * navigation calls it, but any caller may (the command is public), so what it
 * is given is checked, not assumed: two URIs, the first an HTML file, and a
 * column VS Code has.
 */
export function parseHtmlViewerRequest(
  args: readonly unknown[],
): HtmlViewerRequest | undefined {
  const [uri, root, options] = args;
  if (!isUri(uri) || !isUri(root) || !isHtmlFile(pathOf(uri))) {
    return undefined;
  }
  const column = (options as { viewColumn?: unknown } | undefined)?.viewColumn;
  if (column === undefined) {
    return { uri, root };
  }
  // -2 is `ViewColumn.Beside`, -1 `Active`, then the groups 1 to 9.
  return Number.isInteger(column) &&
    (column as number) >= -2 &&
    (column as number) <= 9
    ? { uri, root, column: column as number }
    : undefined;
}

function isUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.length > MAX_URI) {
    return false;
  }
  try {
    return new URL(value).protocol !== "";
  } catch {
    return false;
  }
}

function pathOf(uri: string): string {
  try {
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return "";
  }
}

/** The file's name, for the tab. */
export function viewerTitle(uri: string): string {
  const path = pathOf(uri);
  return path.split("/").at(-1) || path;
}
