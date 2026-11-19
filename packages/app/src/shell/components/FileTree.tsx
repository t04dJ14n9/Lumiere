/**
 * The open vault's files as folders and notes; a note opens in a tab.
 * Folders start closed, and the way to the shown note opens (folders.ts).
 * Only the rows in view are drawn (tree-rows.ts): a vault of tens of
 * thousands of files opens and scrolls as a small one does. As in VS
 * Code's Explorer, notes and folders are made, renamed and deleted from
 * the right-click menu and the buttons above, and moved by dragging them
 * onto a folder (tree-editing.ts).
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
} from "react";
import type { FileKind } from "../../shared/file-kind";
import type { FileEntry } from "../api";
import { useOpenFolders } from "../folders";
import type { TabsAction } from "../tabs";
import { buildTree } from "../tree";
import { useTreeEditing, type TreeEditing } from "../tree-editing";
import {
  ROW_HEIGHT,
  rowWindow,
  scrollToShow,
  visibleRows,
  type TreeRow,
} from "../tree-rows";
import type { UiStateHandle } from "../ui-state";
import { DeletePrompt, TreeMenu } from "./TreeMenu";
import { dropHandlers, TreeRowItem } from "./TreeRowItem";

export interface FileTreeProps {
  readonly vault: string;
  readonly files: readonly FileEntry[];
  /** The vault holds more files than are listed: the tree says so. */
  readonly partial?: boolean;
  readonly activePath: string | undefined;
  /** The kinds of file that open in a tab; the others are listed greyed. */
  readonly opens: readonly FileKind[];
  /** The saved layout, which keeps the open folders. */
  readonly ui: UiStateHandle;
  readonly onOpen: (path: string) => void;
  readonly dispatch: Dispatch<TabsAction>;
  /** List the vault's files again (they were changed here). */
  readonly refreshFiles: () => void;
  readonly report: (work: Promise<unknown>) => void;
}

export function FileTree(props: FileTreeProps) {
  const { vault, files, partial = false, activePath, ui } = props;
  const folders = useOpenFolders(ui, vault, activePath);
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const edit = useTreeEditing({ ...props, paths, folders });
  const root = useMemo(() => buildTree(files, edit.made), [files, edit.made]);
  const rows = useMemo(
    () => visibleRows(root, folders.open),
    [root, folders.open],
  );
  const scroll = useScroll();
  useRevealRow(scroll, rows, activePath);
  const { start, end } = rowWindow({ count: rows.length, ...scroll.at });
  const handlers = {
    ...edit.handlers,
    opens: props.opens,
    onOpen: props.onOpen,
    onToggle: folders.toggle,
  };
  return (
    <>
      <TreeTop edit={edit} partial={partial ? files.length : undefined} />
      <nav
        ref={scroll.ref}
        className="file-tree"
        aria-label="Files"
        onScroll={scroll.onScroll}
        onContextMenu={(event) => {
          event.preventDefault();
          edit.openMenu(undefined, { x: event.clientX, y: event.clientY });
        }}
        {...dropHandlers("", handlers)}
      >
        <div
          className="tree-rows"
          role="list"
          style={{ height: rows.length * ROW_HEIGHT }}
        >
          {rows.slice(start, end).map((row, index) => (
            <TreeRowItem
              key={`${row.kind}:${row.path}`}
              row={row}
              top={(start + index) * ROW_HEIGHT}
              isShown={row.path === activePath}
              isRenaming={row.path === edit.renaming}
              handlers={handlers}
            />
          ))}
        </div>
      </nav>
      <TreeOverlays edit={edit} />
    </>
  );
}

/** New Note and New Folder for the vault, and a word when the list is cut short. */
function TreeTop({
  edit,
  partial,
}: {
  readonly edit: TreeEditing;
  /** How many files are listed, when the vault holds more. */
  readonly partial: number | undefined;
}) {
  return (
    <>
      <div className="file-tree-actions">
        <button type="button" onClick={() => edit.actions.createNote("")}>
          New Note
        </button>
        <button type="button" onClick={() => edit.newFolder("")}>
          New Folder
        </button>
      </div>
      {partial !== undefined && (
        <p className="file-tree-partial" role="status">
          This vault has more files than the {partial.toLocaleString()} listed
          here; open others from Finder or a link.
        </p>
      )}
    </>
  );
}

/** The right-click menu, and the question before deleting for good. */
function TreeOverlays({ edit }: { readonly edit: TreeEditing }) {
  return (
    <>
      {edit.menu && (
        <TreeMenu
          at={edit.menu}
          items={edit.menuItems}
          onClose={edit.closeMenu}
        />
      )}
      <DeletePrompt
        path={edit.actions.confirming}
        onAnswer={edit.actions.answer}
      />
    </>
  );
}

interface Scroll {
  readonly ref: React.RefObject<HTMLElement | null>;
  readonly at: { readonly scrollTop: number; readonly viewport: number };
  onScroll(): void;
}

/** How far the list is scrolled and how tall it shows, kept as it changes. */
function useScroll(): Scroll {
  const ref = useRef<HTMLElement>(null);
  const [at, setAt] = useState({ scrollTop: 0, viewport: 0 });
  const measure = () => {
    const element = ref.current;
    if (element) {
      setAt({ scrollTop: element.scrollTop, viewport: element.clientHeight });
    }
  };
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, at, onScroll: measure };
}

/**
 * The shown note scrolls into view when it becomes shown or appears (its
 * folders opened, the list read), but not when other folders open or close.
 */
function useRevealRow(
  scroll: Scroll,
  rows: readonly TreeRow[],
  activePath: string | undefined,
): void {
  const index = rows.findIndex((row) => row.path === activePath);
  // Read when the note is shown or appears, not each time rows move.
  const latest = useRef(index);
  latest.current = index;
  const isListed = index >= 0;
  const { ref } = scroll;
  useEffect(() => {
    const element = ref.current;
    if (!element || !isListed) {
      return;
    }
    // The rows start below the list's padding.
    const offset =
      (element.firstElementChild as HTMLElement | null)?.offsetTop ?? 0;
    const target = scrollToShow(latest.current, {
      scrollTop: element.scrollTop - offset,
      viewport: element.clientHeight,
    });
    if (target !== undefined) {
      element.scrollTop = target + offset;
    }
  }, [activePath, isListed, ref]);
}
