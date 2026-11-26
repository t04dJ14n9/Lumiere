import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { BlockType, RectangleMarker, layer } from "@codemirror/view";
import type { BlockInfo, EditorView, ViewUpdate } from "@codemirror/view";
import { caretModeOf } from "./caret-view";
import { tintedSpans, type Span } from "./cursor-cell";
import { paintsBox, widgetElement } from "./block-geometry";
import {
  ATOMIC_TAGS,
  domRange,
  flowRects,
  outOfFlow,
  rowOf,
  visualRows,
  type Row,
} from "./selection-rows";
import {
  listIndentEnd,
  shapeSelection,
  squareAtCarets,
  type CaretPoint,
} from "./selection-shape";

/**
 * Where a list line's tint starts. The text alone cannot tell a list item from
 * a `- x` line in a code block, whose indentation is real text and keeps its
 * tint, so the marker must be a parsed list marker.
 */
function listIndentOf(view: EditorView, block: BlockInfo): number {
  const indent = listIndentEnd(
    view.state.doc.sliceString(block.from, block.to),
  );
  if (indent === 0) {
    return 0;
  }
  const node = syntaxTree(view.state).resolveInner(block.from + indent, 1);
  return node.name === "ListMark" ? indent : 0;
}

/**
 * The selection drawn as Obsidian's native selection looks: on each line it
 * hugs the text, then a short stub (about a space) stands for the line break
 * it includes; an empty line gets a thin stub. There is no full-width band,
 * and a code block's background shows untinted around its code. Rendered
 * block widgets inside the selection are tinted whole.
 *
 * CodeMirror's own selection layer (drawSelection) stays for its hidden
 * native-selection handling, and is hidden in base.css. Its hide-native
 * pieces are not exported separately, so its marker pass (measure phase,
 * not profiled) still runs; this layer reads the shared geometry once per
 * update.
 */
const CLASS = "cm-selectionBackground";
/** An empty line's stub, as measured in Obsidian 1.14.4. */
const EMPTY_STUB = 4;

function base(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft,
    top: rect.top - view.scrollDOM.scrollTop,
  };
}

function breakStub(view: EditorView): number {
  return Math.max(EMPTY_STUB, Math.round(view.defaultCharacterWidth * 0.5));
}

interface Geometry {
  origin: { left: number; top: number };
  content: DOMRect;
}

/**
 * The text from `from` to `to` (inside one text block), one rectangle per
 * contiguous run on each visual row, as tall as that row. A wrapped line is
 * tinted only on its text, row by row; runs that the browser lays out apart
 * (bidirectional text) stay apart.
 */
function textMarkers(
  view: EditorView,
  rows: Row[],
  span: { from: number; to: number },
  { origin }: Geometry,
): RectangleMarker[] {
  const range = domRange(view, span.from, span.to);
  if (!range) {
    return [];
  }
  const runsByRow = new Map<Row, { left: number; right: number }[]>();
  for (const rect of flowRects(range)) {
    if (rect.width <= 0) {
      continue;
    }
    const row = rowOf(rows, rect);
    const list = runsByRow.get(row) ?? [];
    list.push({ left: rect.left, right: rect.right });
    runsByRow.set(row, list);
  }
  const out: RectangleMarker[] = [];
  for (const [row, list] of runsByRow) {
    list.sort((a, b) => a.left - b.left);
    const runs: { left: number; right: number }[] = [];
    for (const rect of list) {
      const last = runs[runs.length - 1];
      // Touching runs merge; so do runs separated only by empty space
      // (a checkbox's or code span's margin). Runs with other content of
      // the line between them (bidirectional text) stay apart.
      if (
        last &&
        (rect.left <= last.right + 1 ||
          !row.content.some(
            (box) => box.right > last.right + 0.5 && box.left < rect.left - 0.5,
          ))
      ) {
        last.right = Math.max(last.right, rect.right);
      } else {
        runs.push({ ...rect });
      }
    }
    for (const run of runs) {
      out.push(
        new RectangleMarker(
          CLASS,
          run.left - origin.left,
          row.top - origin.top,
          run.right - run.left,
          row.bottom - row.top,
        ),
      );
    }
  }
  return out;
}

/**
 * Where a rendered block shows something: the box of the first element on
 * the way down that paints one (a callout, a table's cells), or the text and
 * atomic content (a formula, an image) of elements that don't. Empty layout
 * space around them (a narrow table's row, a centred formula's margins) is
 * not part of it.
 */
function visibleBoxes(
  element: Element,
  cache: Map<Element, boolean>,
): DOMRect[] {
  if (outOfFlow(element, cache)) {
    return [];
  }
  const style = getComputedStyle(element);
  // Controls that show on hover (a table's add-row button) take no room.
  if (style.visibility === "hidden" || style.opacity === "0") {
    return [];
  }
  // The block itself is a widget (contenteditable=false), so only replaced
  // content and formulas count as one box here.
  const replaced =
    ATOMIC_TAGS.has(element.localName) ||
    element.classList.contains("MathJax") ||
    element.classList.contains("katex");
  if (replaced || paintsBox(style)) {
    return [...element.getClientRects()];
  }
  const boxes: DOMRect[] = [];
  const range = element.ownerDocument.createRange();
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child instanceof Element) {
      boxes.push(...visibleBoxes(child, cache));
    } else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      range.selectNodeContents(child);
      boxes.push(...range.getClientRects());
    }
  }
  return boxes.filter((box) => box.width > 0 && box.height > 0);
}

/** A rendered block in the selection, tinted where it shows something. */
function widgetMarker(
  view: EditorView,
  block: BlockInfo,
  { origin, content }: Geometry,
): RectangleMarker {
  const element = widgetElement(view, block);
  const boxes = element ? visibleBoxes(element, new Map()) : [];
  const top = block.top + view.documentTop;
  if (boxes.length === 0) {
    return new RectangleMarker(
      CLASS,
      content.left - origin.left,
      top - origin.top,
      content.width,
      block.height,
    );
  }
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.right));
  const upper = Math.min(...boxes.map((box) => box.top));
  const lower = Math.max(...boxes.map((box) => box.bottom));
  return new RectangleMarker(
    CLASS,
    left - origin.left,
    upper - origin.top,
    right - left,
    lower - upper,
  );
}

function blockMarkers(
  view: EditorView,
  range: Span,
  block: BlockInfo,
  geometry: Geometry,
): RectangleMarker[] {
  if (block.type !== BlockType.Text) {
    // A rendered block (table, HTML, math, embed) inside the selection.
    if (range.from > block.from || range.to < block.to) {
      return [];
    }
    return [widgetMarker(view, block, geometry)];
  }
  const { origin } = geometry;
  const markers: RectangleMarker[] = [];
  const rows = visualRows(view, block);
  const indent = listIndentOf(view, block);
  const from = Math.max(range.from, block.from + indent);
  const to = Math.min(range.to, block.to);
  if (to > from) {
    markers.push(...textMarkers(view, rows, { from, to }, geometry));
  }
  if (range.to > block.to && range.from <= block.to) {
    const end = view.coordsAtPos(block.to, -1) ?? view.coordsAtPos(block.to, 1);
    if (end) {
      const row = rowOf(rows, end);
      markers.push(
        new RectangleMarker(
          CLASS,
          end.left - origin.left,
          row.top - origin.top,
          block.length === 0 ? EMPTY_STUB : breakStub(view),
          row.bottom - row.top,
        ),
      );
    }
  }
  return markers;
}

export function selectionMarkers(view: EditorView): RectangleMarker[] {
  // A caret-only selection has no rectangles. Skip the content-box read so
  // scrolling does not force layout on every viewport update.
  if (view.state.selection.ranges.every((range) => range.empty)) {
    return [];
  }
  const geometry: Geometry = {
    origin: base(view),
    content: view.contentDOM.getBoundingClientRect(),
  };
  const visual = caretModeOf(view) === "visual";
  const out: RectangleMarker[] = [];
  for (const selected of view.state.selection.ranges) {
    for (const range of tintedSpans(view.state.doc, selected, visual)) {
      out.push(...spanMarkers(view, range, geometry));
    }
  }
  if (out.length === 0) {
    return out;
  }
  return roundedMarkers(out, caretPoints(view, geometry));
}

/**
 * Where each non-empty selection meets its caret. Outside Vim's visual mode
 * that is the head. In visual mode the block cursor covers the character at
 * the head and the tint stops at that character's edge, so both of its edges
 * count.
 */
function caretPoints(view: EditorView, geometry: Geometry): CaretPoint[] {
  const visual = caretModeOf(view) === "visual";
  const length = view.state.doc.length;
  const points: CaretPoint[] = [];
  for (const range of view.state.selection.ranges) {
    if (range.empty) {
      continue;
    }
    const at = visual
      ? [range.head - 1, range.head, range.head + 1]
      : [range.head];
    for (const pos of at) {
      const coords = pos >= 0 && pos <= length ? view.coordsAtPos(pos) : null;
      if (coords) {
        points.push({
          x: coords.left - geometry.origin.left,
          y: (coords.top + coords.bottom) / 2 - geometry.origin.top,
        });
      }
    }
  }
  return points;
}

/**
 * The markers joined and given rounded outer corners (selection-shape.ts),
 * square on the side where a caret meets them.
 */
function roundedMarkers(
  markers: RectangleMarker[],
  carets: CaretPoint[],
): RectangleMarker[] {
  const boxes = markers.map((marker) => ({
    left: marker.left,
    top: marker.top,
    width: marker.width ?? 0,
    height: marker.height,
  }));
  const shaped = squareAtCarets(shapeSelection(boxes), carets, 2);
  return shaped.map(
    (box) =>
      new RectangleMarker(
        [
          CLASS,
          ...box.square.map((corner) => `mw-selection-square-${corner}`),
        ].join(" "),
        box.left,
        box.top,
        box.width,
        box.height,
      ),
  );
}

function spanMarkers(
  view: EditorView,
  range: Span,
  geometry: Geometry,
): RectangleMarker[] {
  const out: RectangleMarker[] = [];
  for (const block of view.viewportLineBlocks) {
    if (block.to < range.from || block.from > range.to) {
      continue;
    }
    const parts = Array.isArray(block.type) ? block.type : [block];
    for (const part of parts) {
      if (part.to < range.from || part.from > range.to) {
        continue;
      }
      out.push(...blockMarkers(view, range, part, geometry));
    }
  }
  return out;
}

export const selectionLayer: Extension = layer({
  above: false,
  class: "mw-selection-layer",
  markers: selectionMarkers,
  update: (update: ViewUpdate) =>
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    update.geometryChanged,
});
