import {
  decodeScalarText,
  encodeScalarText,
  frontmatterScalars,
  type FrontmatterScalar,
} from "../../markdown/metadata/frontmatter";

/** A link to rewrite in a note, by source offsets. */
export interface LinkRewrite {
  from: number;
  to: number;
  /**
   * The link's new text from its current text, both as the note means them:
   * inside a quoted property value, unescaped.
   */
  rewrite(original: string): string;
}

export interface OffsetEdit {
  from: number;
  to: number;
  insert: string;
}

/** A link inside one property value, before and after the rewrite. */
interface ScalarChange extends OffsetEdit {
  original: string;
  replacement: string;
}

/**
 * Edits that rewrite links without breaking the note's YAML. A link in the
 * body is replaced as it is. A link in a property value is escaped for the
 * value's quoting (`'` doubled in single quotes, `"` and `\` escaped in
 * double quotes). When the value's style cannot hold the new text (a plain
 * value that would read as a comment or a mapping), the whole value is
 * written double-quoted instead. A value whose text cannot be located after
 * decoding (an unusual multi-line value) is left as it is rather than
 * risking the frontmatter.
 */
export function linkRewriteEdits(
  text: string,
  rewrites: readonly LinkRewrite[],
): OffsetEdit[] {
  if (!rewrites.length) {
    return [];
  }
  const scalars = frontmatterScalars(text);
  const edits: OffsetEdit[] = [];
  const byScalar = new Map<FrontmatterScalar, LinkRewrite[]>();
  for (const rewrite of rewrites) {
    const scalar = scalars.find(
      (candidate) =>
        candidate.from <= rewrite.from && rewrite.to <= candidate.to,
    );
    if (!scalar) {
      edits.push({
        from: rewrite.from,
        to: rewrite.to,
        insert: rewrite.rewrite(text.slice(rewrite.from, rewrite.to)),
      });
      continue;
    }
    const group = byScalar.get(scalar) ?? [];
    group.push(rewrite);
    byScalar.set(scalar, group);
  }
  for (const [scalar, group] of byScalar) {
    edits.push(...scalarEdits(text, scalar, group));
  }
  return edits;
}

function scalarEdits(
  text: string,
  scalar: FrontmatterScalar,
  rewrites: readonly LinkRewrite[],
): OffsetEdit[] {
  const changes: ScalarChange[] = [...rewrites]
    .sort((a, b) => a.from - b.from)
    .map((rewrite) => {
      const original = decodeScalarText(
        text.slice(rewrite.from, rewrite.to),
        scalar.style,
      );
      const replacement = rewrite.rewrite(original);
      return {
        from: rewrite.from,
        to: rewrite.to,
        original,
        replacement,
        insert: encodeScalarText(replacement, scalar.style),
      };
    });
  const value = replacedValue(scalar.value, changes);
  if (value === undefined) {
    return [];
  }
  if (readsAs(applyEdits(text, changes), scalar.from, value)) {
    return changes.map(({ from, to, insert }) => ({ from, to, insert }));
  }
  // A JSON string is a valid YAML double-quoted scalar.
  return [{ from: scalar.from, to: scalar.to, insert: JSON.stringify(value) }];
}

/** The scalar's value with each change applied, in order. */
function replacedValue(
  value: string,
  changes: readonly ScalarChange[],
): string | undefined {
  let result = "";
  let cursor = 0;
  for (const change of changes) {
    const at = value.indexOf(change.original, cursor);
    if (at < 0) {
      return undefined;
    }
    result += value.slice(cursor, at) + change.replacement;
    cursor = at + change.original.length;
  }
  return result + value.slice(cursor);
}

/** Whether the frontmatter still parses, with `value` at offset `from`. */
function readsAs(text: string, from: number, value: string): boolean {
  return frontmatterScalars(text).some(
    (scalar) => scalar.from === from && scalar.value === value,
  );
}

function applyEdits(text: string, edits: readonly OffsetEdit[]): string {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce(
      (result, edit) =>
        result.slice(0, edit.from) + edit.insert + result.slice(edit.to),
      text,
    );
}

/** The zero-based line and column of an offset in `text`. */
export function pointAt(
  text: string,
  offset: number,
): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return { line, col: offset - (before.lastIndexOf("\n") + 1) };
}
