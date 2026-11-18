import type { Context } from "@workshop/core";
import type { SourceRead } from "../../attachments";
import {
  relativeFilePath,
  walksSymbolicLink,
} from "../../shared/workspace-path";

type Services = Pick<Context, "workspace" | "vaults">;

/**
 * The `readFile` for a `file:` source that the note's page named. The page is
 * untrusted, so it may read only inside a workspace folder or the note's
 * vault, with symbolic links resolved: a link there could lead anywhere on
 * the disk. The check is made here rather than left to the host's own `read`,
 * which VS Code's does not contain.
 */
export function containedReader(
  services: Services,
  noteUri: string,
): SourceRead {
  return async (uri) => {
    try {
      const inside = await containingRoot(services, noteUri, uri);
      if (!inside || (await leavesThroughLink(services, inside, uri))) {
        return undefined;
      }
      return await services.workspace.read(uri);
    } catch {
      // A file that is not there, or that the host refuses.
      return undefined;
    }
  };
}

interface Inside {
  readonly root: string;
  readonly relative: string;
}

async function containingRoot(
  { workspace, vaults }: Services,
  noteUri: string,
  uri: string,
): Promise<Inside | undefined> {
  // An encoded slash could name a different file to the host than to this check.
  if (/%(?:2f|5c)/iu.test(uri)) {
    return undefined;
  }
  const vault = await vaults.locate(noteUri);
  const roots = [
    ...workspace.folders(),
    ...(vault ? [vault.vault.index.root] : []),
  ];
  for (const root of roots) {
    const relative = relativeFilePath(uri, root);
    if (relative !== undefined) {
      return { root, relative };
    }
  }
  return undefined;
}

/** Whether a symbolic link on the way, resolved where the host can, ends outside the root. */
async function leavesThroughLink(
  { workspace }: Services,
  { root, relative }: Inside,
  uri: string,
): Promise<boolean> {
  if (workspace.realContains) {
    return !(await workspace.realContains(root, uri));
  }
  return walksSymbolicLink(relative, root, (link) =>
    workspace.files.isSymbolicLink(link),
  );
}
