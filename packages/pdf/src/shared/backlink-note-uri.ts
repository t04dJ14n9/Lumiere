import { isMarkdownPath } from "./markdown-scan";

/**
 * Host-side trust check for `openBacklinkNote` from the untrusted PDF webview.
 * Pure so unit tests cover the allow-list without VS Code.
 */

/** Schemes VS Code uses for workspace files (local, virtual, remote). */
const WORKSPACE_FILE_SCHEMES = new Set(["file", "vscode-vfs", "vscode-remote"]);

export type BacklinkNoteUriParts = {
  /** Raw `noteUri` string from the viewer (before / after parse). */
  noteUri: string;
  scheme: string;
  /** URI path (e.g. `/vault/notes/a.md`). */
  path: string;
  /** `vscode.workspace.getWorkspaceFolder(uri)` is defined. */
  inWorkspace: boolean;
};

/**
 * Whether the host may open this note for a backlink click. Rejects non-
 * workspace schemes, URIs outside a folder, encoded separators, `.` and
 * `..` segments, and paths the index does not scan (only `.md` and
 * `.markdown` notes). VS Code's `Uri` keeps a `..` as written and
 * `getWorkspaceFolder` compares path prefixes, so `/work/../etc/a.md`
 * would pass as inside `/work`; the index never produces such a URI.
 */
export function isTrustedBacklinkNoteUri(parts: BacklinkNoteUriParts): boolean {
  if (/%(?:2f|5c)/i.test(parts.noteUri)) {
    return false;
  }
  if (hasDotSegment(parts.path) || hasDotSegment(decoded(parts.noteUri))) {
    return false;
  }
  if (!WORKSPACE_FILE_SCHEMES.has(parts.scheme)) {
    return false;
  }
  if (!parts.inWorkspace) {
    return false;
  }
  return isMarkdownPath(parts.path);
}

function hasDotSegment(path: string): boolean {
  return path.split(/[/\\]/u).some((part) => part === "." || part === "..");
}

/** The URI with its percent-escapes undone (`%2e%2e` is `..`); as it is when malformed. */
function decoded(uri: string): string {
  try {
    return decodeURIComponent(uri);
  } catch {
    return uri;
  }
}
