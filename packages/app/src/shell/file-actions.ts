/**
 * What the file tree does to the vault (WindowBackend.files), and what the
 * window does after: the list is read again, a new note opens, the tabs of
 * a deleted file close (those of a moved one follow the host's `renamed`
 * event, opening.ts). Deleting goes to the system's trash; where the host
 * has none, the reader is asked first (`confirming`).
 */
import { useCallback, useMemo, useState, type Dispatch } from "react";
import { backend } from "./backend";
import type { TabsAction } from "./tabs";
import {
  childPath,
  freeName,
  nameOf,
  nameProblem,
  parentOf,
  takenPaths,
} from "./tree-edits";

export interface FileActions {
  /** A new note in `folder`, opened in a tab. */
  createNote(folder: string): void;
  /** A new folder in `folder`; its path, for the reader to name it. */
  createFolder(folder: string): Promise<string | undefined>;
  /** Give `path` the name typed for it. */
  rename(path: string, name: string): void;
  /** Move `path` to `target`, a path in another folder. */
  move(path: string, target: string): void;
  remove(path: string): void;
  /** A file or folder the host could not put in a trash, waiting for the reader. */
  readonly confirming: string | undefined;
  answer(deleteForGood: boolean): void;
}

export interface FileActionsOptions {
  readonly vault: string;
  readonly paths: readonly string[];
  readonly dispatch: Dispatch<TabsAction>;
  readonly refreshFiles: () => void;
  readonly report: (work: Promise<unknown>) => void;
}

export function useFileActions(options: FileActionsOptions): FileActions {
  const { vault, paths, dispatch, refreshFiles, report } = options;
  const files = backend().files;
  const done = useCallback(
    (work: Promise<unknown>) => report(work.finally(refreshFiles)),
    [refreshFiles, report],
  );
  const move = useCallback(
    (path: string, target: string) =>
      done(files.rename(vault, path, target).then(reportLinksLeft)),
    [done, files, vault],
  );
  const deletion = useDelete({ vault, dispatch, done });
  const create = useCreate({ vault, paths, dispatch, done });
  return useMemo(
    () => ({
      ...create,
      rename: (path: string, name: string) => {
        const problem = nameProblem(name);
        if (problem) {
          report(Promise.reject(new Error(problem)));
        } else if (name !== nameOf(path)) {
          move(path, childPath(parentOf(path), name));
        }
      },
      move,
      ...deletion,
    }),
    [create, move, deletion, report],
  );
}

/**
 * To the trash; where the host has none, the reader is asked first, and
 * only then is it deleted for good. The tabs of what went close.
 */
function useDelete({
  vault,
  dispatch,
  done,
}: {
  readonly vault: string;
  readonly dispatch: Dispatch<TabsAction>;
  readonly done: (work: Promise<unknown>) => void;
}): Pick<FileActions, "remove" | "confirming" | "answer"> {
  const [confirming, setConfirming] = useState<string>();
  const remove = useCallback(
    (path: string, permanently: boolean) =>
      done(
        backend()
          .files.remove(vault, path, { permanently })
          .then((result) => {
            if (result.deleted) {
              dispatch({ type: "removed", vault, path });
            } else {
              setConfirming(path);
            }
          }),
      ),
    [done, dispatch, vault],
  );
  return useMemo(
    () => ({
      remove: (path: string) => remove(path, false),
      confirming,
      answer: (deleteForGood: boolean) => {
        setConfirming(undefined);
        if (deleteForGood && confirming !== undefined) {
          remove(confirming, true);
        }
      },
    }),
    [remove, confirming],
  );
}

/** New notes and folders, each at the first free `Untitled` name. */
function useCreate({
  vault,
  paths,
  dispatch,
  done,
}: {
  readonly vault: string;
  readonly paths: readonly string[];
  readonly dispatch: Dispatch<TabsAction>;
  readonly done: (work: Promise<unknown>) => void;
}): Pick<FileActions, "createNote" | "createFolder"> {
  const taken = useMemo(() => takenPaths(paths), [paths]);
  return useMemo(
    () => ({
      createNote: (folder: string) => {
        const path = freeName(taken, folder, { extension: ".md" });
        done(
          backend()
            .files.createNote(vault, path)
            .then(() => dispatch({ type: "open", vault, path })),
        );
      },
      createFolder: async (folder: string) => {
        const path = freeName(taken, folder, {});
        try {
          await backend().files.createFolder(vault, path);
        } catch (error) {
          done(Promise.reject(error));
          return undefined;
        }
        return path;
      },
    }),
    [taken, vault, dispatch, done],
  );
}

function reportLinksLeft(left: readonly string[]): void {
  if (left.length > 0) {
    throw new Error(
      `Links in ${left.join(", ")} were not updated: those notes changed while the links were being found. Check them.`,
    );
  }
}
