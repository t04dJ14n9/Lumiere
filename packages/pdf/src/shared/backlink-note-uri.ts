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
 * workspace schemes, URIs outside a folder, encoded separators, and paths
 * the index does not scan (only `.md` and `.markdown` notes).
 */
export function isTrustedBacklinkNoteUri(parts: BacklinkNoteUriParts): boolean {
  if (/%(?:2f|5c)/i.test(parts.noteUri)) {
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
