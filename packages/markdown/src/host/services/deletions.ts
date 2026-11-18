import * as vscode from "vscode";
import type { AfterDelete, HostDocuments } from "../../shared/host";

/**
 * VS Code's `onWillDeleteFiles`, paired with the `onDidDeleteFiles` that ends
 * the same deletion. VS Code fires both only for deletions it does itself (the
 * Explorer, a workspace edit); another program deleting a file is seen only by
 * the file watchers.
 */
export const onWillDelete: HostDocuments["onWillDelete"] = (listener) => {
  const pending = new Map<string, AfterDelete>();
  const planned = vscode.workspace.onWillDeleteFiles((event) => {
    const uris = event.files.map((uri) => uri.toString());
    // Held to the end of the plan: VS Code deletes once its participants answer.
    event.waitUntil(
      Promise.resolve(listener(uris)).then((after) => {
        // A deletion that then fails never reports it, so its entry waits here
        // until the same files are deleted again, or this listener stops.
        if (after) {
          pending.set(deletionKey(uris), after);
        }
      }),
    );
  });
  const done = vscode.workspace.onDidDeleteFiles((event) => {
    const key = deletionKey(event.files.map((uri) => uri.toString()));
    const after = pending.get(key);
    pending.delete(key);
    if (after) {
      void Promise.resolve()
        .then(after)
        .catch((error: unknown) => {
          console.error("Lumiere: after-delete step failed", error);
        });
    }
  });
  return () => {
    planned.dispose();
    done.dispose();
    pending.clear();
  };
};

/** The same deletion by the same files, whatever order VS Code lists them in. */
function deletionKey(uris: readonly string[]): string {
  return [...uris].sort().join("\n");
}
