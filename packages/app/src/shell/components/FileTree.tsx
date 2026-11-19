/**
 * The open vault's files as folders and notes; a note opens in a tab.
 * Folders start closed, and the way to the shown note opens (folders.ts).
 * Only the rows in view are drawn (tree-rows.ts): a vault of tens of
 * thousands of files opens and scrolls as a small one does.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FileKind } from "../../shared/file-kind";
import type { FileEntry } from "../api";
import { useOpenFolders } from "../folders";
import { buildTree } from "../tree";
import {
  ROW_HEIGHT,
  rowWindow,
  scrollToShow,
  visibleRows,
  type TreeRow,
} from "../tree-rows";
import type { UiStateHandle } from "../ui-state";

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
}

export function FileTree({
  vault,
  files,
  partial = false,
  activePath,
  opens,
  ui,
  onOpen,
}: FileTreeProps) {
  const root = useMemo(() => buildTree(files), [files]);
  const folders = useOpenFolders(ui, vault, activePath);
  const rows = useMemo(
    () => visibleRows(root, folders.open),
    [root, folders.open],
  );
  const scroll = useScroll();
  useRevealRow(scroll, rows, activePath);
  const { start, end } = rowWindow({ count: rows.length, ...scroll.at });
  return (
    <>
      {partial && (
        <p className="file-tree-partial" role="status">
          This vault has more files than the {files.length.toLocaleString()}{" "}
          listed here; open others from Finder or a link.
        </p>
      )}
      <nav
        ref={scroll.ref}
        className="file-tree"
        aria-label="Files"
        onScroll={scroll.onScroll}
      >
        <div
          className="tree-rows"
          role="list"
          style={{ height: rows.length * ROW_HEIGHT }}
        >
          {rows.slice(start, end).map((row, index) => (
            <Row
              key={`${row.kind}:${row.path}`}
              row={row}
              top={(start + index) * ROW_HEIGHT}
              isShown={row.path === activePath}
              opens={opens}
              onOpen={onOpen}
              onToggle={folders.toggle}
            />
          ))}
        </div>
      </nav>
    </>
  );
}

function Row({
  row,
  top,
  isShown,
  opens,
  onOpen,
  onToggle,
}: Pick<FileTreeProps, "opens" | "onOpen"> & {
  readonly row: TreeRow;
  readonly top: number;
  readonly isShown: boolean;
  readonly onToggle: (path: string) => void;
}) {
  const style = { top, paddingLeft: 8 + row.depth * 12 };
  if (row.kind === "folder") {
    return (
      <button
        type="button"
        role="listitem"
        className="tree-row tree-folder"
        style={style}
        aria-expanded={row.isOpen}
        onClick={() => onToggle(row.path)}
      >
        {row.name}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="listitem"
      className="tree-row tree-file"
      style={style}
      data-kind={row.entry.kind}
      aria-current={isShown ? "page" : undefined}
      disabled={!opens.includes(row.entry.kind)}
      onClick={() => onOpen(row.path)}
    >
      {row.name}
    </button>
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
