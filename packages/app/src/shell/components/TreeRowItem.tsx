/**
 * One row of the file tree (FileTree.tsx): a folder that opens and closes,
 * or a file that opens in a tab; either can be dragged onto a folder to
 * move it, renamed in place, or right-clicked for the tree's menu.
 */
import { useState, type DragEvent } from "react";
import type { FileKind } from "../../shared/file-kind";
import { DRAGGED_PATH, dropTarget } from "../tree-edits";
import type { TreeRow } from "../tree-rows";

export interface RowHandlers {
  readonly opens: readonly FileKind[];
  onOpen(path: string): void;
  onToggle(path: string): void;
  onMenu(row: TreeRow, at: { x: number; y: number }): void;
  /** `path` dropped on `folder` ("" is the vault): it moves there. */
  onDrop(path: string, folder: string): void;
  onRename(path: string, name: string | undefined): void;
}

export interface TreeRowItemProps {
  readonly row: TreeRow;
  readonly top: number;
  readonly isShown: boolean;
  readonly isRenaming: boolean;
  readonly handlers: RowHandlers;
}

export function TreeRowItem({
  row,
  top,
  isShown,
  isRenaming,
  handlers,
}: TreeRowItemProps) {
  const style = { top, paddingLeft: 8 + row.depth * 12 };
  if (isRenaming) {
    return <RenameInput row={row} style={style} handlers={handlers} />;
  }
  const common = {
    type: "button" as const,
    role: "listitem",
    style,
    draggable: true,
    onDragStart: (event: DragEvent) =>
      event.dataTransfer.setData(DRAGGED_PATH, row.path),
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      handlers.onMenu(row, { x: event.clientX, y: event.clientY });
    },
  };
  if (row.kind === "folder") {
    return (
      <button
        {...common}
        {...dropHandlers(row.path, handlers)}
        className="tree-row tree-folder"
        aria-expanded={row.isOpen}
        onClick={() => handlers.onToggle(row.path)}
      >
        {row.name}
      </button>
    );
  }
  return (
    <button
      {...common}
      className="tree-row tree-file"
      data-kind={row.entry.kind}
      aria-current={isShown ? "page" : undefined}
      disabled={!handlers.opens.includes(row.entry.kind)}
      onClick={() => handlers.onOpen(row.path)}
    >
      {row.name}
    </button>
  );
}

/**
 * What a folder (or the vault's empty space below the rows) does with a
 * dragged row: takes it when it may go there (tree-edits.ts `dropTarget`).
 * The dragged path is readable only on drop, so a drag over is accepted
 * whenever it carries one; the drop checks.
 */
export function dropHandlers(
  folder: string,
  handlers: Pick<RowHandlers, "onDrop">,
) {
  return {
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer.types.includes(DRAGGED_PATH)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }
    },
    onDrop: (event: DragEvent) => {
      const path = event.dataTransfer.getData(DRAGGED_PATH);
      event.preventDefault();
      event.stopPropagation();
      if (path && dropTarget(path, folder) !== undefined) {
        handlers.onDrop(path, folder);
      }
    },
  };
}

/** The row's name, typed over: Enter or leaving it renames, Escape keeps it. */
function RenameInput({
  row,
  style,
  handlers,
}: {
  readonly row: TreeRow;
  readonly style: React.CSSProperties;
  readonly handlers: Pick<RowHandlers, "onRename">;
}) {
  const [name, setName] = useState(row.name);
  const [isDone, setDone] = useState(false);
  const finish = (value: string | undefined) => {
    if (!isDone) {
      setDone(true);
      handlers.onRename(row.path, value);
    }
  };
  return (
    <input
      className="tree-row tree-rename"
      style={style}
      aria-label={`Rename ${row.name}`}
      value={name}
      autoFocus
      onFocus={(event) => selectStem(event.currentTarget)}
      onChange={(event) => setName(event.currentTarget.value)}
      onBlur={() => finish(name)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          finish(name);
        } else if (event.key === "Escape") {
          finish(undefined);
        }
      }}
    />
  );
}

/** Select the name without its extension, as Finder and VS Code do. */
function selectStem(input: HTMLInputElement): void {
  const dot = input.value.lastIndexOf(".");
  input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
}
