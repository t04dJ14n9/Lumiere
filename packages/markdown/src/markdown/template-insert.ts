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
   * False when the template has properties the note's could not take (the
   * note's frontmatter is not valid YAML); only the body is inserted then.
   */
  isMerged: boolean;
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
  const incoming = templateHeader && frontmatter(template)?.values;
  if (!templateHeader || !incoming) {
    return atSelection(selection, template, [], true);
  }
  const body = template.slice(templateHeader.end);
  const noteHeader = headerParts(note);
  if (!noteHeader) {
    const block = withFinalBreak(
      template.slice(templateHeader.start, templateHeader.end),
    );
    if (selection.from === 0) {
      // One edit: two insertions at the same offset have no defined order.
      return atSelection(selection, block + body, [], true);
    }
    return atSelection(
      selection,
      body,
      [{ from: 0, to: 0, insert: block }],
      true,
    );
  }
  // A caret inside the note's properties puts the body just below them.
  const target =
    selection.from < noteHeader.end
      ? { from: noteHeader.end, to: Math.max(selection.to, noteHeader.end) }
      : selection;
  const changes = Object.keys(incoming).length
    ? mergeProperties(note, incoming, { keepExisting: true })
    : [];
  if (!changes) {
    return atSelection(target, body, [], false);
  }
  return atSelection(target, body, changes, true);
}

function atSelection(
  selection: { from: number; to: number },
  body: string,
  before: readonly TemplateEdit[],
  isMerged: boolean,
): TemplateInsertion {
  const shift = before
    .filter((edit) => edit.to <= selection.from)
    .reduce((sum, edit) => sum + edit.insert.length - (edit.to - edit.from), 0);
  return {
    edits: [...before, { ...selection, insert: body }],
    caret: selection.from + shift + body.length,
    isMerged,
  };
}

function withFinalBreak(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
