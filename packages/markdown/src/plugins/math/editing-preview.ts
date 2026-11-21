import type { Text } from "@codemirror/state";
import {
  MarkdownInline,
  type InlineClick,
} from "../../webview/ui/inline-widget";
import { unquotedBlock } from "../../markdown/quoted-block";
import {
  findMatchTouches,
  hasEditorFocus,
  type InlineContext,
} from "../livePreview/api";
import type { RenderService } from "../render/api";
import { delimiters, mathBlockRange, mathBody } from "./source";
import { markMathSource } from "./source-marks";

/**
 * Where a revealed `$$` formula is typeset again while it is edited, as in
 * Obsidian 1.15.0: nowhere when it is unclosed; as a block under the closing
 * line when the opening `$$` starts its line and the closing one ends its
 * line; otherwise inline, just after the closing `$$`.
 *
 * Quote markers before the opening `$$` count as the start of the line:
 * Lumiere renders quoted display math as a block (Obsidian renders it
 * inline in the quote, and so places its preview inline too).
 */
export type PreviewPlacement = "block" | "inline" | "none";

export function previewPlacement(
  doc: Text,
  formula: { from: number; to: number },
  isClosed: boolean,
): PreviewPlacement {
  if (!isClosed) {
    return "none";
  }
  const before = doc.sliceString(doc.lineAt(formula.from).from, formula.from);
  const after = doc.sliceString(formula.to, doc.lineAt(formula.to).to);
  return /^[\s>]*$/.test(before) && !after.trim() ? "block" : "inline";
}

/**
 * The end of a display formula's closing `$$`, as an offset into the
 * source of its block, or -1 when it is unclosed. As the parser does, a
 * formula that does not close on its opening line closes at the first `$$`
 * of a later line; text after it there is a paragraph of its own.
 */
export function closingEnd(source: string): number {
  const firstBreak = source.indexOf("\n");
  const at = source.indexOf("$$", firstBreak < 0 ? 2 : firstBreak);
  return at < 0 ? -1 : at + 2;
}

/** Where the preview of a display block's formula goes. */
export function blockPreviewPlacement(
  doc: Text,
  block: { from: number; source: string },
): PreviewPlacement {
  const end = closingEnd(block.source);
  return previewPlacement(
    doc,
    { from: block.from, to: block.from + end },
    end >= 0,
  );
}

/**
 * The preview sits just after the formula's closing `$$`, so the formula a
 * click on it selects (without its `$$`, as a click on a rendered formula
 * does) lies before it.
 */
const SELECT_FORMULA_BEFORE: InlineClick = {
  select(source) {
    const body = mathBody(source);
    return { from: body.from - source.length, to: body.to - source.length };
  },
};

/** As in Obsidian, a click on a formula selects it without its `$`. */
const SELECT_FORMULA: InlineClick = { select: mathBody };

/**
 * Inline math, and the revealed source of display math. A `$$` formula
 * reveals only while the editor has focus, and then is typeset again after
 * its source (the block renderer draws the preview below a block); `$…$`
 * reveals whenever the selection touches it and has no preview.
 */
export function decorateMath(
  cx: InlineContext,
  node: { name: string; from: number; to: number },
  render: RenderService,
): void {
  const { state } = cx;
  const isDisplay = node.name === "MathBlock";
  const isDoubleDollar =
    isDisplay || state.sliceDoc(node.from, node.from + 2) === "$$";
  if (!isDoubleDollar) {
    if (cx.revealed(node.from, node.to)) {
      markMathSource(cx, node);
    } else {
      cx.replace(node.from, node.to, inlineFormula(cx, node, render));
    }
    return;
  }
  // A display block reveals over all it replaces: the text after its
  // closing `$$` too (`mathBlockRange`), as the block renderer does.
  const to = isDisplay ? mathBlockRange(node, state.doc).to : node.to;
  const isRevealed =
    (hasEditorFocus(state) && cx.revealed(node.from, to)) ||
    findMatchTouches(state, node.from, to);
  if (isRevealed) {
    markMathSource(cx, node);
    addInlinePreview(cx, node, render);
  } else if (!isDisplay) {
    cx.replace(node.from, node.to, inlineFormula(cx, node, render));
  }
}

function inlineFormula(
  cx: InlineContext,
  node: { from: number; to: number },
  render: RenderService,
): MarkdownInline {
  const source = cx.state.sliceDoc(node.from, node.to);
  return new MarkdownInline(source, render, SELECT_FORMULA);
}

/**
 * The inline preview of a revealed `$$` formula, after its closing `$$`.
 * Not for a formula whose later lines carry quote markers: the preview's
 * click maps offsets in the text it renders onto the note.
 */
function addInlinePreview(
  cx: InlineContext,
  node: { from: number; to: number },
  render: RenderService,
): void {
  const { state, visible } = cx;
  // A node across two visible ranges is decorated twice; preview it once.
  if (visible && (node.to < visible.from || node.to > visible.to)) {
    return;
  }
  const doc = state.doc;
  const isClosed = isClosedFormula(doc, node);
  if (previewPlacement(doc, node, isClosed) !== "inline") {
    return;
  }
  const source = doc.sliceString(node.from, node.to);
  const linePrefix = doc.sliceString(doc.lineAt(node.from).from, node.from);
  if (unquotedBlock(source, linePrefix) !== source) {
    return;
  }
  cx.widgetAfter(
    node.to,
    new MarkdownInline(source, render, SELECT_FORMULA_BEFORE),
  );
}

/**
 * Whether a formula ends with its closing delimiter. Read from its ends
 * only: an unclosed `$$` reaches to the end of the note.
 */
function isClosedFormula(doc: Text, node: { from: number; to: number }) {
  const head = doc.sliceString(node.from, Math.min(node.to, node.from + 2));
  const tail = doc.sliceString(
    Math.max(node.from + head.length, node.to - 2),
    node.to,
  );
  return delimiters(head + tail).closed;
}
