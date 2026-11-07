import { loadYaml } from "./load-yaml";
import type { headerParts } from "./header-parts";
import { plainPropertyDates, type PropertyScalar } from "./values";

export interface PropertyChange {
  from: number;
  to: number;
  insert: string;
}

type Header = NonNullable<ReturnType<typeof headerParts>>;

/**
 * A string that opens like a document marker. yaml writes one at the root as a
 * block scalar, which a key or a list item cannot be, so it is quoted.
 */
const markerLike = (value: unknown): value is string =>
  typeof value === "string" && /^(?:---|\.\.\.)/.test(value);

export const yamlValue = (value: unknown): string =>
  markerLike(value)
    ? JSON.stringify(value)
    : loadYaml()
        .stringify(plainPropertyDates(value), {
          collectionStyle: "flow",
          flowCollectionPadding: false,
          lineWidth: 0,
          aliasDuplicateObjects: false,
          defaultKeyType: "PLAIN",
        })
        .trimEnd();

/** A block list item: quoted only where YAML needs it (a comma does not). */
const blockItem = (value: unknown): string =>
  markerLike(value)
    ? JSON.stringify(value)
    : loadYaml().stringify(value, { lineWidth: 0 }).trimEnd();

/** Whether a value is a list of scalars, which Obsidian writes as a block list. */
const isScalarList = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value) && value.every((item) => scalarValue(item));

/**
 * A property's value as the text after its `key:`, as Obsidian writes it: a
 * list of scalars as a block list two spaces in (an empty one as nothing at
 * all), anything else on the key's line.
 */
export function valueAfterKey(value: unknown, eol: string): string {
  if (isScalarList(value)) {
    return value.map((item) => `${eol}  - ${blockItem(item)}`).join("");
  }
  return ` ${yamlValue(value)}`;
}

/** Where the value of `node` may start: just after its key's colon. */
function afterColon(body: string, start: number): number | undefined {
  let at = start - 1;
  while (at >= 0 && /[ \t\r\n]/u.test(body[at]!)) {
    at--;
  }
  return body[at] === ":" ? at + 1 : undefined;
}

/** Property names stay plain unless YAML requires quoting. */
export const yamlKey = (key: string): string =>
  markerLike(key)
    ? JSON.stringify(key)
    : loadYaml()
        .stringify(key, {
          lineWidth: 0,
          defaultStringType: "PLAIN",
          defaultKeyType: "PLAIN",
        })
        .trimEnd();

/**
 * Whether a value reads back as the one written. An empty list is written as
 * a bare `key:`, as Obsidian writes it, which reads back as no value.
 */
export function sameWritten(after: unknown, written: unknown): boolean {
  const empty = Array.isArray(written) && written.length === 0;
  return (
    JSON.stringify(after) === JSON.stringify(written) ||
    (empty && (after === null || after === undefined))
  );
}

export const scalarValue = (value: unknown): value is PropertyScalar =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

/** Where a YAML `#` comment (outside quotes) begins before `pos` on the line, or -1. */
function commentStart(body: string, lineStart: number, pos: number): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = lineStart; i < pos; i++) {
    const ch = body[i]!;
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "#" && (i === lineStart || /[ \t]/.test(body[i - 1]!))) {
      return i;
    }
  }
  return -1;
}

const commentStartsBefore = (
  body: string,
  lineStart: number,
  pos: number,
): boolean => commentStart(body, lineStart, pos) >= 0;

/** Include a leading `&anchor` so replacement does not leave aliases retargeted. */
export function valueStart(
  body: string,
  start: number,
  anchor: string | null | undefined,
): number {
  if (!anchor) {
    return start;
  }
  const token = `&${anchor}`;
  // Prefer the last real anchor token at or before start; skip comment text.
  let at = -1;
  for (let from = 0; from <= start;) {
    const found = body.indexOf(token, from);
    if (found < 0 || found > start) {
      break;
    }
    const after = body[found + token.length];
    const whole = !after || !/[A-Za-z0-9_-]/.test(after);
    const lineStart = body.lastIndexOf("\n", found - 1) + 1;
    if (whole && !commentStartsBefore(body, lineStart, found)) {
      at = found;
    }
    from = found + 1;
  }
  return at >= 0 ? at : start;
}

/** `afterColon`, stepping back over comments between the colon and `start`. */
function afterColonPastComments(
  body: string,
  start: number,
): number | undefined {
  let at = start;
  while (at > 0) {
    const colon = afterColon(body, at);
    if (colon !== undefined) {
      return colon;
    }
    const end = body.slice(0, at).trimEnd().length;
    if (end === 0) {
      return undefined;
    }
    const hash = commentStart(body, body.lastIndexOf("\n", end - 1) + 1, end);
    if (hash < 0) {
      return undefined;
    }
    at = hash;
  }
  return undefined;
}

/**
 * A list under a key with a comment between the key and its items
 * (`tags: # note`, items flush left): the comment lines stay and the item
 * lines are rewritten in place, as a block list two spaces in.
 */
function commentedListChange(
  source: string,
  header: Header,
  range: readonly number[],
  value: readonly unknown[],
): PropertyChange | undefined {
  const { body, offset, eol } = header;
  const lineStart = body.lastIndexOf("\n", range[0]! - 1) + 1;
  if (
    afterColonPastComments(body, range[0]!) === undefined ||
    body.slice(lineStart, range[0]).trim() !== ""
  ) {
    return undefined;
  }
  const from = offset + lineStart;
  const to = offset + range[1]!;
  const items = valueAfterKey(value, eol).slice(eol.length);
  const ends = source.slice(from, to).endsWith("\n") ? eol : "";
  return { from, to, insert: items && items + ends };
}

/** A list of scalars written as Obsidian writes it, from just after `key:`. */
function blockListChange(
  source: string,
  header: Header,
  node: { range: readonly number[]; anchor?: string | null | undefined },
  value: unknown,
): PropertyChange | undefined {
  const colon = node.anchor
    ? undefined
    : afterColon(header.body, node.range[0]!);
  // A comment after the list stays where it is: the list keeps its style.
  const lineEnd = header.body.indexOf("\n", node.range[1]!);
  const rest = header.body.slice(
    node.range[1]!,
    lineEnd < 0 ? undefined : lineEnd,
  );
  if (!isScalarList(value) || rest.includes("#")) {
    return undefined;
  }
  if (colon === undefined) {
    return node.anchor
      ? undefined
      : commentedListChange(source, header, node.range, value);
  }
  const from = header.offset + colon;
  const to = header.offset + node.range[1]!;
  const ends = source.slice(from, to).endsWith("\n") ? header.eol : "";
  return { from, to, insert: valueAfterKey(value, header.eol) + ends };
}

/** Include a leading `!!tag` so edits drop the tag with the scalar value. */
function taggedScalarStart(
  body: string,
  start: number,
  range0: number,
  tag: string | null | undefined,
): number {
  if (!tag?.startsWith("tag:yaml.org,2002:")) {
    return start;
  }
  const token = `!!${tag.slice("tag:yaml.org,2002:".length)}`;
  // Prefer the last real tag token at or before the scalar; skip comment text.
  let at = -1;
  const searchFrom = Math.max(0, range0 - token.length - 16);
  for (let from = searchFrom; from < range0;) {
    const found = body.indexOf(token, from);
    if (found < 0 || found >= range0) {
      break;
    }
    const after = body[found + token.length];
    const whole = !after || !/[A-Za-z0-9_-]/.test(after);
    const lineStart = body.lastIndexOf("\n", found - 1) + 1;
    if (whole && !commentStartsBefore(body, lineStart, found)) {
      at = found;
    }
    from = found + 1;
  }
  return at >= 0 ? Math.min(start, at) : start;
}

export function setPropertyChange(
  source: string,
  header: Header,
  node: unknown,
  value: unknown,
): PropertyChange | undefined {
  if (!loadYaml().isNode(node) || !node.range) {
    return undefined;
  }
  const list = blockListChange(
    source,
    header,
    { range: node.range, anchor: node.anchor },
    value,
  );
  if (list) {
    return list;
  }
  // Complex sequences (list-of-maps) are replaced wholesale as YAML text.
  let insert = yamlValue(value);
  if (typeof value === "string" && /[\r\n]/.test(value)) {
    // Mid-line replacements cannot use a plain multiline scalar.
    insert = JSON.stringify(value);
  } else if (
    loadYaml().isScalar(node) &&
    typeof value === typeof node.value &&
    typeof value === "string"
  ) {
    if (node.type === "QUOTE_SINGLE") {
      insert = "'" + value.replaceAll("'", "''") + "'";
    } else if (node.type === "QUOTE_DOUBLE") {
      insert = JSON.stringify(value);
    }
  }
  const contentStart = loadYaml().isScalar(node)
    ? taggedScalarStart(
        header.body,
        valueStart(header.body, node.range[0], node.anchor),
        node.range[0],
        node.tag,
      )
    : valueStart(header.body, node.range[0], node.anchor);
  const from = header.offset + contentStart;
  const to = header.offset + node.range[1];
  if (source[from - 1] === ":") {
    insert = " " + insert;
  }
  if (source.slice(from, to).endsWith("\n")) {
    insert += header.eol;
  }
  return { from, to, insert };
}
