import type { BlockInfo, EditorView } from "@codemirror/view";

/*
 * Layout reads the selection layer (selection-layer.ts) makes about lines
 * and rendered blocks.
 */

/**
 * Line padding up to this much stays inside the selection, so the bands of
 * neighbouring lines (list items have about a pixel each) still touch.
 */
const PADDING_SLACK = 2;

/**
 * The space a line keeps around its text (the gap above a heading), which
 * the selection leaves untinted.
 */
export function spacing(line: HTMLElement): { top: number; bottom: number } {
  const style = getComputedStyle(line);
  const trim = (value: string): number => {
    const pixels = parseFloat(value) || 0;
    return pixels > PADDING_SLACK ? pixels : 0;
  };
  return { top: trim(style.paddingTop), bottom: trim(style.paddingBottom) };
}

export /** Whether an element draws a box of its own: a fill, a border or a shadow. */
function paintsBox(style: CSSStyleDeclaration): boolean {
  const fill = style.backgroundColor;
  return (
    (fill !== "" && fill !== "transparent" && !/rgba\(.*,\s*0\)$/.test(fill)) ||
    style.backgroundImage !== "none" ||
    parseFloat(style.borderTopWidth) > 0 ||
    parseFloat(style.borderLeftWidth) > 0 ||
    style.boxShadow !== "none"
  );
}

export /** The top-level DOM of a rendered block, if it is drawn. */
function widgetElement(view: EditorView, block: BlockInfo): Element | null {
  const at = view.domAtPos(block.from);
  // Before a widget, the position is a child offset in the content itself.
  let node: Node | null =
    at.node === view.contentDOM
      ? (at.node.childNodes[at.offset] ?? null)
      : at.node;
  while (node && node.parentNode !== view.contentDOM) {
    node = node.parentNode;
  }
  return node instanceof Element ? node : null;
}
