import type { SyntaxNode } from "@lezer/common";

/** How many lists enclose a list item, minus one: 0 for a top-level item. */
export function listDepth(item: SyntaxNode): number {
  let depth = -1;
  for (let node: SyntaxNode | null = item; node; node = node.parent) {
    if (node.name === "BulletList" || node.name === "OrderedList") {
      depth++;
    }
  }
  return Math.max(0, depth);
}

/**
 * The hanging-indent width of an item's marker, as a CSS length: where the
 * item's text starts, as measured in Obsidian (23px for a bullet, 30px for
 * a number of any width, 27px for a task, at 16px).
 */
export function markerWidth(marker: string, isTask: boolean): string {
  if (isTask) {
    return "calc(1.75em - 1px)";
  }
  if (/^[-+*]$/.test(marker)) {
    return "calc(1.25em + 3px)";
  }
  return "calc(1.5em + 6px)";
}
