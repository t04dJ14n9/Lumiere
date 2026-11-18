import { hasInexactInteger } from "./properties/exact-numbers";
import { frontmatter, headerParts } from "./properties/frontmatter";
import { mergeProperties } from "./properties/merge";

export interface TemplateEdit {
  from: number;
  to: number;
  insert: string;
}

export interface TemplateInsertion {
  edits: TemplateEdit[];
  /** Where the caret goes afterwards: the end of the inserted body. */
  caret: number;
  /**
   * Whose properties are not valid YAML when the template's could not be
   * merged; only the body is inserted then. `undefined` when they merged
   * (or the template has none).
   */
  invalidProperties?: "note" | "template";
}

/**
 * The edits that insert an expanded template into a note, as Obsidian's
 * Templates plugin does: the template's properties join the note's
 * (existing values kept, missing ones added, lists joined), and only the
 * body goes in at the selection. A note without properties gets the
 * template's block at its top. Both texts use `\n` line breaks.
 */
export function templateInsertion(
  note: string,
  template: string,
  selection: { from: number; to: number },
): TemplateInsertion {
  const templateHeader = headerParts(template);
  const noteHeader = headerParts(note);
  if (!templateHeader) {
    return atSelection(belowHeader(note, noteHeader, selection), template, []);
  }
  const body = template.slice(templateHeader.end);
  const incoming = frontmatter(template)?.values;
  if (!incoming) {
    // Pasting the block would put a `---` line and broken YAML in the body.
    return {
      ...atSelection(belowHeader(note, noteHeader, selection), body, []),
      invalidProperties: "template",
    };
  }
  if (!noteHeader) {
    const block = withFinalBreak(
      template.slice(templateHeader.start, templateHeader.end),
    );
    if (selection.from === 0) {
      // One edit: two insertions at the same offset have no defined order.
      return atSelection(selection, block + body, []);
    }
    return atSelection(selection, body, [{ from: 0, to: 0, insert: block }]);
  }
  const target = belowHeader(note, noteHeader, selection);
  if (hasInexactInteger(templateHeader.body)) {
    // Merged, its long integers would be written rounded.
    return { ...atSelection(target, body, []), invalidProperties: "template" };
  }
  const changes = Object.keys(incoming).length
    ? mergeProperties(note, incoming, { keepExisting: true })
    : [];
  if (!changes) {
    return {
      ...atSelection(target, body, []),
      invalidProperties: "note",
    };
  }
  return atSelection(target, body, changes);
}

/**
 * Where the body goes: a caret inside the note's properties puts it just
 * below them, and the closing `---` of a note that ends there gets a line
 * break first, so the body does not run on from it.
 */
function belowHeader(
  note: string,
  header: ReturnType<typeof headerParts>,
  selection: { from: number; to: number },
): { from: number; to: number; prefix?: string } {
  if (!header || selection.from > header.end) {
    return selection;
  }
  const target =
    selection.from < header.end
      ? { from: header.end, to: Math.max(selection.to, header.end) }
      : selection;
  return note.slice(0, header.end).endsWith("\n")
    ? target
    : { ...target, prefix: "\n" };
}

function atSelection(
  selection: { from: number; to: number; prefix?: string },
  body: string,
  before: readonly TemplateEdit[],
): TemplateInsertion {
  const { prefix = "", ...range } = selection;
  const insert = prefix + body;
  const shift = before
    .filter((edit) => edit.to <= range.from)
    .reduce((sum, edit) => sum + edit.insert.length - (edit.to - edit.from), 0);
  return {
    edits: [...before, { ...range, insert }],
    caret: range.from + shift + insert.length,
  };
}

function withFinalBreak(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
