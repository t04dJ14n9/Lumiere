/**
 * The keyboard of the side panel's lists and trees, as VS Code's own: Up and
 * Down move, Home and End go to the ends, Right opens a branch and then steps
 * into it, Left closes it and then steps out, Enter and Space open the row.
 */

export interface KeyRow {
  id: string;
  depth: number;
  /** The row of the branch this one is in; missing at the top. */
  parentId?: string | undefined;
  expandable: boolean;
  expanded: boolean;
}

export type TreeKeyAction =
  | { kind: "focus"; id: string }
  | { kind: "expand" | "collapse" | "open"; id: string };

/**
 * What `key` does with the row `focusedId` (the first when none is focused
 * yet), or undefined when the key is not the tree's. `pageSize` is how many
 * rows a screenful holds.
 */
export function treeKeyAction(
  key: string,
  rows: readonly KeyRow[],
  focusedId: string | undefined,
  pageSize: number,
): TreeKeyAction | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const at = Math.max(
    0,
    rows.findIndex((row) => row.id === focusedId),
  );
  const row = rows[at]!;
  const moved = (index: number): TreeKeyAction => ({
    kind: "focus",
    id: rows[Math.min(rows.length - 1, Math.max(0, index))]!.id,
  });
  switch (key) {
    case "ArrowDown":
      return moved(focusedId === undefined ? 0 : at + 1);
    case "ArrowUp":
      return moved(focusedId === undefined ? 0 : at - 1);
    case "PageDown":
      return moved(at + Math.max(1, pageSize - 1));
    case "PageUp":
      return moved(at - Math.max(1, pageSize - 1));
    case "Home":
      return moved(0);
    case "End":
      return moved(rows.length - 1);
    case "ArrowRight":
      return stepIn(rows, at);
    case "ArrowLeft":
      return stepOut(row);
    case "Enter":
    case " ":
      return { kind: "open", id: row.id };
    default:
      return undefined;
  }
}

function stepIn(
  rows: readonly KeyRow[],
  at: number,
): TreeKeyAction | undefined {
  const row = rows[at]!;
  if (!row.expandable) {
    return undefined;
  }
  if (!row.expanded) {
    return { kind: "expand", id: row.id };
  }
  const child = rows[at + 1];
  return child && child.depth > row.depth
    ? { kind: "focus", id: child.id }
    : undefined;
}

function stepOut(row: KeyRow): TreeKeyAction | undefined {
  if (row.expandable && row.expanded) {
    return { kind: "collapse", id: row.id };
  }
  return row.parentId === undefined
    ? undefined
    : { kind: "focus", id: row.parentId };
}
