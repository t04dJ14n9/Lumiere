import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * A line's quotes and indentation, then its list marker (`- `, `1. `) and
 * task box: Obsidian's list-line pattern, which wants a space after the
 * marker.
 */
export const LIST_LINE = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/u;

/** How a line takes part in a list, for moving list items. */
interface LineShape {
  blank: boolean;
  isItem: boolean;
  /** Indentation levels after the quotes: tabs or runs of four spaces. */
  indent: number;
  /** How many `>` lead the line. */
  quotes: number;
  /** The width of the whitespace after the quotes, a tab four wide. */
  columns: number;
  /** The quotes and indentation. */
  prefix: string;
}

/** A list item with the lines under it, from its marker line. */
export interface ListBlock {
  fromLine: number;
  toLine: number;
  indent: number;
  quotes: number;
  columns: number;
}

/** What is next to a list item, going up or down. */
export type Neighbour =
  | { kind: "sibling" | "shallower"; block: ListBlock }
  | { kind: "paragraph" | "none" };

/** Blocks whose lines are never list items, whatever they start with. */
const NOT_LISTS = new Set([
  "FencedCode",
  "CodeBlock",
  "MathBlock",
  "Frontmatter",
]);

function inNonListBlock(state: EditorState, from: number, to: number) {
  let found = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (found || NOT_LISTS.has(node.name)) {
        found = true;
        return false;
      }
      return undefined;
    },
  });
  return found;
}

/** Leading tabs or runs of four spaces in `text`, and what follows them. */
function indentLevels(text: string): { levels: number; rest: string } {
  let levels = 0;
  let rest = text;
  for (;;) {
    if (rest.startsWith("\t")) {
      rest = rest.slice(1);
    } else if (rest.startsWith("    ")) {
      rest = rest.slice(4);
    } else {
      return { levels, rest };
    }
    levels++;
  }
}

/** Indentation levels after the last `>` (and the one space after it). */
function indentOf(prefix: string): number {
  const quote = prefix.lastIndexOf(">");
  if (quote < 0) {
    return indentLevels(prefix).levels;
  }
  const first = indentLevels(prefix.slice(quote + 1));
  const rest = first.rest.startsWith(" ") ? first.rest.slice(1) : first.rest;
  return first.levels + indentLevels(rest).levels;
}

/** The whitespace width after `levels` quotes of `prefix`, a tab four wide. */
function columnsAfter(prefix: string, levels: number): number {
  let rest = prefix;
  for (let level = 0; level < levels; level++) {
    rest = rest.slice(rest.indexOf(">") + 1).replace(/^ /u, "");
  }
  const space = /^[ \t]*/u.exec(rest)![0];
  let width = 0;
  for (const char of space) {
    width = char === "\t" ? width + 4 - (width % 4) : width + 1;
  }
  return width;
}

function shapeOf(state: EditorState, number: number): LineShape {
  const line = state.doc.line(number);
  if (/^[\s>]*$/u.test(line.text)) {
    return {
      blank: true,
      isItem: false,
      indent: 0,
      quotes: 0,
      columns: 0,
      prefix: "",
    };
  }
  const [markup, prefix = "", marker] = LIST_LINE.exec(line.text)!;
  const quotes = prefix.split(">").length - 1;
  return {
    blank: false,
    isItem:
      !!marker && !inNonListBlock(state, line.from, line.from + markup.length),
    indent: indentOf(prefix),
    quotes,
    columns: columnsAfter(prefix, quotes),
    prefix,
  };
}

/** Whether `line` sits under the item that starts `block`. */
function isUnder(line: LineShape, block: ListBlock): boolean {
  if (line.quotes === block.quotes) {
    return line.isItem
      ? line.indent > block.indent
      : line.columns > block.columns;
  }
  return (
    line.quotes > block.quotes &&
    columnsAfter(line.prefix, block.quotes) > block.columns
  );
}

/**
 * The list item on line `number` with the lines under it (blank lines
 * between them included), or undefined when the line is no list item.
 */
export function listBlockAt(
  state: EditorState,
  number: number,
): ListBlock | undefined {
  if (number < 1 || number > state.doc.lines) {
    return undefined;
  }
  const shape = shapeOf(state, number);
  if (!shape.isItem) {
    return undefined;
  }
  const { indent, quotes, columns } = shape;
  const block = { fromLine: number, toLine: number, indent, quotes, columns };
  for (let n = number + 1; n <= state.doc.lines; n++) {
    const next = shapeOf(state, n);
    if (next.blank) {
      continue;
    }
    if (!isUnder(next, block)) {
      break;
    }
    block.toLine = n;
  }
  return block;
}

/**
 * What `block` meets going from line `start` by `step` (1 or -1), past
 * blank lines, lines under it and indented text: another item at its level
 * (a sibling), a shallower item, a paragraph line, or nothing it can move
 * past (an item in other quotes, or the note's edge).
 */
export function neighbourOf(
  state: EditorState,
  start: number,
  step: 1 | -1,
  block: ListBlock,
): Neighbour {
  const edge = step < 0 ? 0 : state.doc.lines + 1;
  for (let n = start; n !== edge; n += step) {
    const shape = shapeOf(state, n);
    if (shape.blank || isUnder(shape, block)) {
      continue;
    }
    if (shape.isItem && shape.quotes === block.quotes) {
      const kind = shape.indent === block.indent ? "sibling" : "shallower";
      return { kind, block: listBlockAt(state, n)! };
    }
    const isIndentedText =
      !shape.isItem &&
      shape.quotes >= block.quotes &&
      columnsAfter(shape.prefix, block.quotes) > 0;
    if (!isIndentedText) {
      return { kind: shape.isItem ? "none" : "paragraph" };
    }
  }
  return { kind: start === edge ? "none" : "paragraph" };
}
