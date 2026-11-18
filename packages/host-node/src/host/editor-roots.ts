/**
 * Which workspace roots an editor page may open from. The page's query is
 * same-origin with the embedder, so it is not trusted to widen a workspace
 * already registered: a folder that holds a registered workspace is refused.
 */
import { isInside } from "./paths";
import type { LumiereHost } from "./start";

/** A page's root, and whether the page named it or the note's folder stands in. */
export interface EditorRoot {
  /** The root's file URI. */
  readonly uri: string;
  /** No workspace was named (a note opened by absolute path): its folder stands in. */
  readonly isNoteFolder: boolean;
}

/** Whether a page may open from `root`, registering it when new. */
export type AcceptEditorRoot = (root: EditorRoot) => boolean;

/**
 * DSH adds no root of its own, so each session's workspace and each note's
 * own folder arrive here: an unseen folder is fine. A note opened by absolute
 * path arrives with no workspace, and its folder stands in until the
 * workspace that holds it arrives; refusing that workspace would lock the
 * session out until the host restarts. A named workspace is never widened.
 */
export function editorRoots(
  host: Pick<LumiereHost, "addRoot" | "workspaceRoots">,
): AcceptEditorRoot {
  // Note folders registered while no workspace held them.
  const standIns = new Set<string>();
  return ({ uri, isNoteFolder }) => {
    const key = uri.replace(/\/+$/, "");
    const registered = host.workspaceRoots();
    // Checked first: the app may register a vault that holds another vault.
    if (registered.some((root) => isInside(root, key))) {
      if (!isNoteFolder) {
        // A page named this folder as its workspace: it is one now.
        standIns.delete(key);
      }
      return true;
    }
    const named = registered.filter((root) => !standIns.has(root));
    if (named.some((root) => isInside(key, root))) {
      return false;
    }
    host.addRoot(uri);
    if (isNoteFolder) {
      standIns.add(key);
    }
    return true;
  };
}
