import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fixedOffsets, type ItemRange } from "../../shared/list-window";
import { treeKeyAction, type KeyRow } from "../../shared/tree-keys";
import { VirtualList, type RevealRequest } from "./virtual-list";

/** VS Code's list rows are 22 pixels high. */
export const ROW_HEIGHT = 22;
/** How far each level of a tree steps in, and the twistie's width (VS Code's tree). */
const INDENT = 8;

export interface TreeNode extends KeyRow {
  /** 1-based place among the rows beside it, and how many there are, for assistive technology. */
  position?: number;
  siblings?: number;
  /** What assistive technology calls the row, when its content does not say. */
  ariaLabel?: string;
}

export interface TreeProps<Row extends TreeNode> {
  /** A tree has twisties and indent guides; a list does not. */
  kind: "tree" | "list";
  label: string;
  rows: readonly Row[];
  /** The row that shows as selected: where Follow Cursor is, or what was last opened. */
  selectedId: string | undefined;
  /** A click, Enter or Space on a row. */
  onOpen: (row: Row) => void;
  onToggle?: (id: string, open: boolean) => void;
  renderRow: (row: Row) => React.ReactNode;
  /** Where each row starts, when they are not all 22 pixels high: `rows.length + 1` numbers. */
  offsets?: readonly number[];
  /** The rows on screen or close to it, when they change. */
  onRange?: (range: ItemRange) => void;
  className?: string;
  /** Scroll this row into view; a new object asks again. */
  reveal?: { id: string } | undefined;
  /** A key the list's owner handles itself (Delete on a bookmark): true when it did. */
  onKey?: (event: React.KeyboardEvent, row: Row | undefined) => boolean;
}

/**
 * VS Code's list and tree look and keys over rows of 22 pixels: hover,
 * selection and focus as `--vscode-list-*` draws them, twisties and indent
 * guides for a tree, and Up, Down, Home, End, Left, Right, Enter and Space
 * (`treeKeyAction`). The rows are whatever `renderRow` makes of them.
 */
export function Tree<Row extends TreeNode>(
  props: TreeProps<Row>,
): React.JSX.Element {
  const { rows, selectedId, kind } = props;
  const [focus, setFocus] = useState<string>();
  const fixed = useMemo(() => fixedOffsets(rows.length, ROW_HEIGHT), [rows]);
  const offsets = props.offsets ?? fixed;
  const shown = rows.find((row) => row.id === focus);
  const reveal = useReveal(rows, focus, props.reveal);
  const onKeyDown = useTreeKeys({ ...props, focus, setFocus });
  const renderItem = (index: number, style: React.CSSProperties) => {
    const row = rows[index]!;
    return (
      <TreeRow
        key={row.id}
        domId={rowDomId(props.label, row.id)}
        row={row}
        style={style}
        kind={kind}
        isSelected={row.id === selectedId}
        isFocused={row.id === focus}
        count={rows.length}
        onClick={() => {
          setFocus(row.id);
          props.onOpen(row);
        }}
        onToggle={props.onToggle}
      >
        {props.renderRow(row)}
      </TreeRow>
    );
  };
  return (
    <VirtualList
      className={`${kind === "tree" ? "sp-tree" : "sp-list"} ${props.className ?? ""}`}
      role={kind === "tree" ? "tree" : "listbox"}
      label={props.label}
      count={rows.length}
      offsets={offsets}
      focusedId={shown && rowDomId(props.label, shown.id)}
      reveal={reveal}
      onRange={props.onRange}
      renderItem={renderItem}
      onKeyDown={onKeyDown}
      onFocus={() => setFocus((now) => now ?? selectedId ?? rows[0]?.id)}
    />
  );
}

/**
 * The row to bring into view: the one a caller asks for, and the one the
 * keyboard moved to. Found among the rows as they are when the request is
 * made (an opened branch has its rows by then), not on every later change.
 */
function useReveal(
  rows: readonly TreeNode[],
  focus: string | undefined,
  asked: { id: string } | undefined,
): RevealRequest | undefined {
  const latest = useRef(rows);
  latest.current = rows;
  const [request, setRequest] = useState<{ id: string }>();
  useEffect(() => {
    if (asked) {
      setRequest(asked);
    }
  }, [asked]);
  useEffect(() => {
    if (focus !== undefined) {
      setRequest({ id: focus });
    }
  }, [focus]);
  return useMemo(() => {
    const index = latest.current.findIndex((row) => row.id === request?.id);
    return index < 0 ? undefined : { index };
  }, [request]);
}

function rowDomId(label: string, id: string): string {
  return `sp-${label.replace(/\W+/gu, "-")}-${id}`;
}

/** The keys of the tree: moves, folds, opening, and the caller's own. */
function useTreeKeys<Row extends TreeNode>(
  props: TreeProps<Row> & {
    focus: string | undefined;
    setFocus: (id: string) => void;
  },
) {
  const { rows, focus, setFocus, onOpen, onToggle, onKey } = props;
  return useCallback(
    (event: React.KeyboardEvent, pageItems: number): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const row = rows.find((candidate) => candidate.id === focus);
      if (onKey?.(event, row)) {
        event.preventDefault();
        return;
      }
      const action = treeKeyAction(event.key, rows, focus, pageItems);
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action.kind === "focus") {
        setFocus(action.id);
      } else if (action.kind === "open") {
        const target = rows.find((candidate) => candidate.id === action.id);
        if (target) {
          setFocus(target.id);
          onOpen(target);
        }
      } else {
        onToggle?.(action.id, action.kind === "expand");
      }
    },
    [rows, focus, setFocus, onOpen, onToggle, onKey],
  );
}

interface TreeRowProps<Row extends TreeNode> {
  domId: string;
  row: Row;
  style: React.CSSProperties;
  kind: "tree" | "list";
  isSelected: boolean;
  isFocused: boolean;
  count: number;
  onClick: () => void;
  onToggle: ((id: string, open: boolean) => void) | undefined;
  children: React.ReactNode;
}

function TreeRow<Row extends TreeNode>(
  props: TreeRowProps<Row>,
): React.JSX.Element {
  const { row, kind } = props;
  const isTree = kind === "tree";
  return (
    <div
      id={props.domId}
      className={`sp-row${props.isSelected ? " selected" : ""}${props.isFocused ? " focused" : ""}`}
      style={{ ...props.style, ...{ "--depth": isTree ? row.depth : 0 } }}
      aria-label={row.ariaLabel}
      role={isTree ? "treeitem" : "option"}
      aria-level={isTree ? row.depth + 1 : undefined}
      aria-expanded={isTree && row.expandable ? row.expanded : undefined}
      aria-selected={props.isSelected}
      aria-posinset={row.position}
      aria-setsize={row.siblings ?? props.count}
      onClick={props.onClick}
    >
      {isTree && <Guides depth={row.depth} />}
      {isTree && <Twistie row={row} onToggle={props.onToggle} />}
      {props.children}
    </div>
  );
}

/** One thin line at each level above the row, as VS Code draws indent guides. */
function Guides({ depth }: { depth: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          className="sp-guide"
          style={{ left: 6 + level * INDENT + INDENT }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

function Twistie<Row extends TreeNode>({
  row,
  onToggle,
}: {
  row: Row;
  onToggle: ((id: string, open: boolean) => void) | undefined;
}): React.JSX.Element {
  if (!row.expandable) {
    return <span className="sp-twistie" aria-hidden="true" />;
  }
  return (
    <span
      className={`sp-twistie codicon codicon-chevron-${row.expanded ? "down" : "right"}`}
      aria-hidden="true"
      onClick={(event) => {
        // A twistie folds the row; it does not open it.
        event.stopPropagation();
        onToggle?.(row.id, !row.expanded);
      }}
    />
  );
}
