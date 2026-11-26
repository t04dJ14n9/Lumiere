import { BlockType, type BlockInfo, type EditorView } from "@codemirror/view";
import { paintsBox, spacing } from "./block-geometry";

/**
 * A text block's visual rows, measured from the browser's own layout. The
 * selection layer tints by these rows, and the caret takes the height of the
 * row it sits on, so the two always line up.
 */
export interface Row {
  top: number;
  bottom: number;
  /** Horizontal extents of all the line's content on this row. */
  content: { left: number; right: number }[];
}

/** A Range over `from`..`to`, or null when the DOM can't express it. */
export function domRange(
  view: EditorView,
  from: number,
  to: number,
): Range | null {
  const start = view.domAtPos(from);
  const end = view.domAtPos(to);
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range;
}

/** Marks a subtree that is not document text (a preview, tooltip, popover). */
export const SELECTION_IGNORE = "data-mw-selection-ignore";

/** Whether `element` lays out outside the line's text flow. */
export function outOfFlow(
  element: Element,
  cache: Map<Element, boolean>,
): boolean {
  let known = cache.get(element);
  if (known === undefined) {
    const style = getComputedStyle(element);
    known =
      element.hasAttribute(SELECTION_IGNORE) ||
      element.getAttribute("role") === "tooltip" ||
      style.position === "absolute" ||
      style.position === "fixed" ||
      style.display === "none";
    cache.set(element, known);
  }
  return known;
}

/** Replaced or rendered inline content measured as one box, never inside. */
export const ATOMIC_TAGS = new Set([
  "svg",
  "img",
  "canvas",
  "math",
  "video",
  "audio",
  "iframe",
  "object",
  "embed",
  "picture",
  "input",
  "button",
  "select",
  "textarea",
  "mjx-container",
]);

/**
 * Whether `element` is atomic inline content: a replaced element, a math
 * container (MathJax, KaTeX), or a widget (contenteditable=false). Its own
 * layout boxes stand for it; its internals (SVG paths, glyph groups, a
 * widget's parts) are drawing details, not document rows.
 */
function atomic(element: Element): boolean {
  return (
    ATOMIC_TAGS.has(element.localName) ||
    element.getAttribute("contenteditable") === "false" ||
    element.classList.contains("MathJax") ||
    element.classList.contains("katex")
  );
}

/**
 * An atom's layout boxes, less the inline padding of one that paints nothing
 * there: a list bullet pads its glyph out into the hanging indent, and that
 * empty space is not the bullet. A button or chip that fills its padding
 * keeps it.
 */
function atomRects(element: Element): DOMRect[] {
  const rects = [...element.getClientRects()];
  const style = getComputedStyle(element);
  const start = parseFloat(style.paddingInlineStart) || 0;
  const end = parseFloat(style.paddingInlineEnd) || 0;
  if (rects.length === 0 || (start === 0 && end === 0) || paintsBox(style)) {
    return rects;
  }
  // Padding is in CSS pixels; the rects are in zoomed client pixels.
  const width = element instanceof HTMLElement ? element.offsetWidth : 0;
  const scale = width > 0 ? element.getBoundingClientRect().width / width : 1;
  const rtl = style.direction === "rtl";
  const left = (rtl ? end : start) * scale;
  const right = (rtl ? start : end) * scale;
  return rects.map((rect, i) => {
    const inLeft = i === 0 ? left : 0;
    const inRight = i === rects.length - 1 ? right : 0;
    const width = Math.max(0, rect.width - inLeft - inRight);
    return new DOMRect(rect.left + inLeft, rect.top, width, rect.height);
  });
}

/**
 * Checks the range root and its ancestors up to the line: inside out-of-flow
 * content nothing counts (null); inside atomic content the outermost atom
 * stands for the range; otherwise undefined.
 */
function enclosingAtom(
  root: Node,
  cache: Map<Element, boolean>,
): Element | null | undefined {
  let atom: Element | undefined;
  for (
    let el: Element | null =
      root instanceof Element ? root : root.parentElement;
    el;
    el = el.parentElement
  ) {
    if (el.classList.contains("cm-line")) {
      break;
    }
    if (outOfFlow(el, cache)) {
      return null;
    }
    if (atomic(el)) {
      atom = el;
    }
  }
  return atom;
}

/**
 * The layout boxes of the document content in `range`: text nodes (clipped
 * to the range) and atomic inline content (one box per fragment of the
 * outer element), skipping any subtree that is out of flow (absolutely or
 * fixed positioned, hidden, a tooltip, or marked SELECTION_IGNORE). An open
 * footnote preview adds nothing; an inline formula adds its own box, not
 * its SVG's glyphs.
 */
export function flowRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const cache = new Map<Element, boolean>();
  const rects: DOMRect[] = [];
  const doc = root.ownerDocument ?? document;
  const enclosing = enclosingAtom(root, cache);
  if (enclosing !== undefined) {
    return enclosing ? atomRects(enclosing) : [];
  }
  const part = doc.createRange();
  const visit = (node: Node): void => {
    if (!range.intersectsNode(node)) {
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      part.setStart(
        node,
        node === range.startContainer ? range.startOffset : 0,
      );
      part.setEnd(
        node,
        node === range.endContainer ? range.endOffset : (node as Text).length,
      );
      rects.push(...part.getClientRects());
      return;
    }
    if (!(node instanceof Element)) {
      return;
    }
    if (node !== root) {
      if (outOfFlow(node, cache)) {
        return;
      }
      if (atomic(node)) {
        rects.push(...atomRects(node));
        return;
      }
    }
    if (!node.firstChild && node !== root) {
      rects.push(...node.getClientRects());
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  };
  visit(root);
  return rects;
}

/** The rendered .cm-line for a text block, if it is in the DOM. */
export function lineElement(
  view: EditorView,
  block: BlockInfo,
): HTMLElement | null {
  let node: Node | null = view.domAtPos(block.from).node;
  while (node && node !== view.contentDOM) {
    if (node instanceof HTMLElement && node.classList.contains("cm-line")) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

/**
 * The visual rows of a text block, measured from the browser's own layout:
 * the line's text boxes are grouped into rows by vertical overlap, and each
 * row's band runs from the midpoint of the gap above it to the midpoint of
 * the gap below (the block's edges for the first and last). Bands therefore
 * tile the line exactly whatever the font, size or line height, and a row
 * with a taller inline (a heading, a widget) gets its real height.
 */
export function visualRows(view: EditorView, block: BlockInfo): Row[] {
  // The line's own box, not the height map: CodeMirror's block heights can
  // still be estimates when the layer measures, which stretched the last
  // band past the line.
  const line = lineElement(view, block);
  const box = line?.getBoundingClientRect();
  const pad = line ? spacing(line) : { top: 0, bottom: 0 };
  const top = box ? box.top + pad.top : block.top + view.documentTop;
  const bottom = box ? box.bottom - pad.bottom : top + block.height;
  const range = domRange(view, block.from, block.to);
  const boxes = range ? flowRects(range).filter((r) => r.height > 0) : [];
  const rows: { top: number; bottom: number }[] = [];
  for (const box of boxes.sort((a, b) => a.top - b.top)) {
    const mid = (box.top + box.bottom) / 2;
    const row = rows.find((row) => mid >= row.top && mid <= row.bottom);
    if (row) {
      row.top = Math.min(row.top, box.top);
      row.bottom = Math.max(row.bottom, box.bottom);
    } else {
      rows.push({ top: box.top, bottom: box.bottom });
    }
  }
  if (rows.length === 0) {
    return [{ top, bottom, content: [] }];
  }
  rows.sort((a, b) => a.top - b.top);
  const bands: Row[] = rows.map((row, i) => ({
    top: i === 0 ? top : (rows[i - 1]!.bottom + row.top) / 2,
    bottom:
      i === rows.length - 1 ? bottom : (row.bottom + rows[i + 1]!.top) / 2,
    content: [],
  }));
  for (const box of boxes) {
    if (box.width > 0) {
      rowOf(bands, box).content.push({ left: box.left, right: box.right });
    }
  }
  return bands;
}

/** The row whose band holds a box's vertical centre. */
export function rowOf(rows: Row[], box: { top: number; bottom: number }): Row {
  const mid = (box.top + box.bottom) / 2;
  return (
    rows.find((row) => mid >= row.top && mid < row.bottom) ??
    (mid < rows[0]!.top ? rows[0]! : rows[rows.length - 1]!)
  );
}

/**
 * The selection's row band around `glyph` (the character at `pos`), in client
 * pixels: the line's box when the line is one row, else the visual row that
 * holds the glyph. A caret drawn in this band is exactly as tall as the tint
 * beside it, even on a line that inline code or a formula makes taller than
 * its line height. Null outside a rendered text line.
 */
export function rowBandAt(
  view: EditorView,
  pos: number,
  glyph: { top: number; bottom: number },
): { top: number; bottom: number } | null {
  const outer = view.lineBlockAt(pos);
  const parts = Array.isArray(outer.type) ? outer.type : [outer];
  const block = parts.find(
    (part) =>
      part.type === BlockType.Text && part.from <= pos && pos <= part.to,
  );
  const line = block && lineElement(view, block);
  if (!block || !line) {
    return null;
  }
  const box = line.getBoundingClientRect();
  const pad = spacing(line);
  const top = box.top + pad.top;
  const bottom = box.bottom - pad.bottom;
  // A line under two glyphs tall has one row: its box is the band, and the
  // caret need not measure the line's text on every move.
  if (bottom - top < 2 * (glyph.bottom - glyph.top)) {
    return { top, bottom };
  }
  return rowOf(visualRows(view, block), glyph);
}
