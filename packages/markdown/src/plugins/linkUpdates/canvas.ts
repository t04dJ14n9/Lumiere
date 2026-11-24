import type { TextEdit } from "../../shared/host/documents";
import { rewriteLinks, type RewriteContext } from "./rewrite";
import {
  headingLinkEdits,
  namesRenamedHeading,
  type RenamedHeading,
} from "./heading-rename";

type Edit = ReturnType<typeof rewriteLinks>[number];
type Resolve = Parameters<typeof headingLinkEdits>[3];

/** A canvas node as JSON Canvas stores it; only these fields matter here. */
interface CanvasNode {
  type?: unknown;
  file?: unknown;
  subpath?: unknown;
  text?: unknown;
}

/**
 * A `.canvas` file's text after a rename, or `undefined` when nothing in it
 * changes. File nodes hold a vault path (`"file": "notes/Old.md"`), which
 * follows the renamed file; text nodes hold Markdown, whose links are
 * rewritten as a note's are, from the canvas's own path. The file is written
 * back as Obsidian writes canvases, `JSON.stringify` with the file's own
 * indentation (a tab when it has none), so a canvas Obsidian saved keeps its
 * form. A file that is not a JSON Canvas object is left alone.
 */
export function rewriteCanvas(
  text: string,
  canvasPath: string,
  context: RewriteContext,
): string | undefined {
  return rewriteNodes(text, (node) => {
    let isChanged = false;
    if (typeof node.file === "string" && context.renames.has(node.file)) {
      node.file = context.renames.get(node.file);
      isChanged = true;
    }
    if (node.type === "text" && typeof node.text === "string") {
      const rewritten = applyEdits(
        node.text,
        rewriteLinks(node.text, canvasPath, context),
      );
      if (rewritten !== node.text) {
        node.text = rewritten;
        isChanged = true;
      }
    }
    return isChanged;
  });
}

/**
 * A canvas's text after a note's heading is renamed: a text node's links to
 * the heading are rewritten as a note's are, and a file node that names the
 * heading (`"subpath": "#Old"` on the note) takes the new name. Undefined when
 * nothing changes, or when the file is not a JSON Canvas object.
 */
export function rewriteCanvasHeading(
  text: string,
  canvasPath: string,
  renamed: RenamedHeading,
  resolve: Resolve,
): string | undefined {
  return rewriteNodes(text, (node) => {
    let isChanged = false;
    if (
      node.type === "file" &&
      node.file === renamed.path &&
      typeof node.subpath === "string" &&
      node.subpath.startsWith("#") &&
      namesRenamedHeading(renamed, node.subpath.slice(1))
    ) {
      node.subpath = `#${renamed.subpath}`;
      isChanged = true;
    }
    if (node.type === "text" && typeof node.text === "string") {
      const rewritten = applyTextEdits(
        node.text,
        headingLinkEdits(node.text, canvasPath, renamed, resolve),
      );
      if (rewritten !== node.text) {
        node.text = rewritten;
        isChanged = true;
      }
    }
    return isChanged;
  });
}

/**
 * Parses a canvas, applies `change` to each node, and writes it back when a
 * node changed. Undefined for text that is not a canvas, or that nothing
 * changed in.
 */
function rewriteNodes(
  text: string,
  change: (node: CanvasNode) => boolean,
): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  const nodes = (data as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) {
    return undefined;
  }
  let isChanged = false;
  for (const node of nodes as CanvasNode[]) {
    if (!node || typeof node !== "object") {
      continue;
    }
    isChanged = change(node) || isChanged;
  }
  if (!isChanged) {
    return undefined;
  }
  const ending = text.endsWith("\n") ? "\n" : "";
  return JSON.stringify(data, null, indentOf(text)) + ending;
}

/**
 * The indentation of the first indented line, a tab for an indented file
 * without one, and none for a file on one line.
 */
function indentOf(text: string): string | undefined {
  if (!text.trimEnd().includes("\n")) {
    return undefined;
  }
  return /\n([ \t]+)\S/.exec(text)?.[1] ?? "\t";
}

/** Applies offset edits, as a heading rename makes them, to a node's text. */
function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.from) + edit.insert + result.slice(edit.to),
      text,
    );
}

function applyEdits(text: string, edits: readonly Edit[]): string {
  const lines = text.split("\n");
  const offset = (point: { line: number; col: number }) =>
    lines.slice(0, point.line).reduce((sum, line) => sum + line.length + 1, 0) +
    point.col;
  return [...edits]
    .sort((a, b) => offset(b.start) - offset(a.start))
    .reduce(
      (result, edit) =>
        result.slice(0, offset(edit.start)) +
        edit.text +
        result.slice(offset(edit.end)),
      text,
    );
}

/** One edit replacing the whole of `text` with `next`. */
export function wholeTextEdit(text: string, next: string): Edit {
  const lines = text.split("\n");
  return {
    start: { line: 0, col: 0 },
    end: { line: lines.length - 1, col: lines.at(-1)!.length },
    text: next,
  };
}
