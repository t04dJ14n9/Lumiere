/**
 * The file tree's editing state: the right-click menu, the row being
 * renamed, and the empty folders made in this window, which the vault's
 * listing (files only) does not name until something is put in them.
 */
import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { RowHandlers } from "./components/TreeRowItem";
import type { TreeMenuItem } from "./components/TreeMenu";
import { useFileActions, type FileActions } from "./file-actions";
import type { TabsAction } from "./tabs";
import {
  childPath,
  folderFor,
  nameOf,
  nameProblem,
  parentOf,
} from "./tree-edits";
import type { TreeRow } from "./tree-rows";
import type { OpenFolders } from "./tree-state";

export interface TreeEditing {
  readonly actions: FileActions;
  /** Empty folders made here, which the listing does not have. */
  readonly made: ReadonlySet<string>;
  readonly renaming: string | undefined;
  readonly menu: { readonly x: number; readonly y: number } | undefined;
  readonly menuItems: readonly TreeMenuItem[];
  closeMenu(): void;
  /** The menu for a row, or for the vault itself (`row` undefined). */
  openMenu(row: TreeRow | undefined, at: { x: number; y: number }): void;
  newFolder(folder: string): void;
  readonly handlers: Pick<RowHandlers, "onMenu" | "onDrop" | "onRename">;
}

export function useTreeEditing(options: {
  readonly vault: string;
  readonly paths: readonly string[];
  readonly folders: {
    readonly open: OpenFolders;
    toggle(path: string): void;
  };
  readonly dispatch: Dispatch<TabsAction>;
  readonly refreshFiles: () => void;
  readonly report: (work: Promise<unknown>) => void;
}): TreeEditing {
  const actions = useFileActions(options);
  const { folders } = options;
  const [made, setMade] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; row?: TreeRow }>();
  const newFolder = useNewFolder({ actions, folders, setMade, setRenaming });
  const onRename = useCallback(
    (path: string, name: string | undefined) => {
      setRenaming(undefined);
      if (name === undefined || name === nameOf(path)) {
        return;
      }
      // A name refused is reported by `rename`; the folder keeps its name.
      if (nameProblem(name) === undefined) {
        setMade((shown) =>
          renamedIn(shown, path, childPath(parentOf(path), name)),
        );
      }
      actions.rename(path, name);
    },
    [actions],
  );
  const menuItems = useMemo(
    () => itemsFor(menu?.row, { actions, newFolder, rename: setRenaming }),
    [menu, actions, newFolder],
  );
  return {
    actions,
    made,
    renaming,
    menu,
    menuItems,
    closeMenu: () => setMenu(undefined),
    openMenu: (row, at) => setMenu(row ? { ...at, row } : at),
    newFolder,
    handlers: {
      onMenu: (row, at) => setMenu({ ...at, row }),
      onDrop: (path, folder) => {
        setMade((shown) =>
          renamedIn(shown, path, childPath(folder, nameOf(path))),
        );
        actions.move(path, childPath(folder, nameOf(path)));
      },
      onRename,
    },
  };
}

/**
 * A new folder at the first free name, shown (its folder opened) though it
 * is empty, and named by the reader in its row.
 */
function useNewFolder({
  actions,
  folders,
  setMade,
  setRenaming,
}: {
  readonly actions: Pick<FileActions, "createFolder">;
  readonly folders: { readonly open: OpenFolders; toggle(path: string): void };
  readonly setMade: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly setRenaming: (path: string) => void;
}): (folder: string) => void {
  return useCallback(
    (folder: string) => {
      void actions.createFolder(folder).then((path) => {
        if (path === undefined) {
          return;
        }
        if (folder && !folders.open.has(folder)) {
          folders.toggle(folder);
        }
        setMade((shown) => new Set([...shown, path]));
        setRenaming(path);
      });
    },
    [actions, folders, setMade, setRenaming],
  );
}

/** The menu for a row, or for the vault's empty space. */
function itemsFor(
  row: TreeRow | undefined,
  {
    actions,
    newFolder,
    rename,
  }: {
    actions: FileActions;
    newFolder: (folder: string) => void;
    rename: (path: string) => void;
  },
): TreeMenuItem[] {
  const folder = row ? folderFor(row) : "";
  const items: TreeMenuItem[] = [
    { label: "New Note", run: () => actions.createNote(folder) },
    { label: "New Folder", run: () => newFolder(folder) },
  ];
  if (row) {
    items.push(
      { label: "Rename…", run: () => rename(row.path) },
      { label: "Delete", run: () => actions.remove(row.path) },
    );
  }
  return items;
}

/** The made folders, with `from` (or one in it) now at `to`. */
function renamedIn(
  made: ReadonlySet<string>,
  from: string,
  to: string,
): ReadonlySet<string> {
  return new Set(
    [...made].map((path) =>
      path === from || path.startsWith(`${from}/`)
        ? to + path.slice(from.length)
        : path,
    ),
  );
}
