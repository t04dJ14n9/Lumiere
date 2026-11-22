/**
 * The PDF's outline as the side panel's tree: which rows show for the
 * branches that are open, and which are open while Follow Cursor keeps the
 * reading position's bookmark selected. The rule for that bookmark is the
 * Explorer's (`findActiveOutlineItem`, shared/outline.ts).
 */
import type { OutlineItem } from "./messages";

/** A row's name is its place in the tree: `2.0` is the first child of the third bookmark. */
export type OutlineRowId = string;

export interface OutlineRow {
  id: OutlineRowId;
  item: OutlineItem;
  /** 0 at the top. */
  depth: number;
  parentId?: OutlineRowId | undefined;
  expandable: boolean;
  expanded: boolean;
  /** 1-based place among the bookmarks beside it, and how many there are. */
  position: number;
  siblings: number;
}

/** The rows that show: every bookmark, and the children of the open ones. */
export function outlineRows(
  items: readonly OutlineItem[],
  expanded: ReadonlySet<OutlineRowId>,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const visit = (
    list: readonly OutlineItem[],
    parent: OutlineRowId | undefined,
    depth: number,
  ): void => {
    list.forEach((item, index) => {
      const id = parent === undefined ? `${index}` : `${parent}.${index}`;
      const isOpen = item.children.length > 0 && expanded.has(id);
      rows.push({
        id,
        item,
        depth,
        parentId: parent,
        expandable: item.children.length > 0,
        expanded: isOpen,
        position: index + 1,
        siblings: list.length,
      });
      if (isOpen) {
        visit(item.children, id, depth + 1);
      }
    });
  };
  visit(items, undefined, 0);
  return rows;
}

/** The row name of `target`, wherever it is in the tree (by identity), or undefined. */
export function outlineRowIdOf(
  items: readonly OutlineItem[],
  target: OutlineItem | undefined,
): OutlineRowId | undefined {
  if (!target) {
    return undefined;
  }
  const search = (
    list: readonly OutlineItem[],
    prefix: string,
  ): OutlineRowId | undefined => {
    for (const [index, item] of list.entries()) {
      const id = `${prefix}${index}`;
      if (item === target) {
        return id;
      }
      const inside = search(item.children, `${id}.`);
      if (inside !== undefined) {
        return inside;
      }
    }
    return undefined;
  };
  return search(items, "");
}

/** Every bookmark that has others under it: Expand All opens these. */
export function branchIds(items: readonly OutlineItem[]): Set<OutlineRowId> {
  const branches = new Set<OutlineRowId>();
  const visit = (list: readonly OutlineItem[], prefix: string): void => {
    list.forEach((item, index) => {
      const id = `${prefix}${index}`;
      if (item.children.length > 0) {
        branches.add(id);
        visit(item.children, `${id}.`);
      }
    });
  };
  visit(items, "");
  return branches;
}

/**
 * The branches Follow Cursor leaves open for `activeId`, as the Explorer's
 * outline does: the bookmark's parents and its own sub-bookmarks, every
 * other branch closed.
 */
export function followedBranches(
  items: readonly OutlineItem[],
  activeId: OutlineRowId | undefined,
): Set<OutlineRowId> {
  const open = new Set<OutlineRowId>();
  if (activeId === undefined) {
    return open;
  }
  const parts = activeId.split(".");
  for (let length = 1; length < parts.length; length += 1) {
    open.add(parts.slice(0, length).join("."));
  }
  const own = itemAt(items, parts);
  if (own && own.children.length > 0) {
    open.add(activeId);
  }
  return open;
}

function itemAt(
  items: readonly OutlineItem[],
  path: readonly string[],
): OutlineItem | undefined {
  let list = items;
  let found: OutlineItem | undefined;
  for (const part of path) {
    found = list[Number(part)];
    if (!found) {
      return undefined;
    }
    list = found.children;
  }
  return found;
}
