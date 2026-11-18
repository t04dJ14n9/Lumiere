import { loadYaml } from "./load-yaml";
import type { headerParts } from "./header-parts";
import { frontmatter } from "./frontmatter";
import {
  blockItem,
  sameWritten,
  scalarValue,
  yamlValue,
  type PropertyChange,
} from "./yaml-value";

type Header = NonNullable<ReturnType<typeof headerParts>>;

/**
 * The edit that joins items to a block list (`- a` lines) by writing them
 * as new `- ` lines after its last item, so the list keeps its style and
 * its comments, which rewriting the whole value would lose. `undefined`
 * when `value` does not extend the list, the list is not one this can
 * append to (a flow list, an empty one, or items not on `- ` lines), or the
 * result would not read back as `value`.
 */
export function appendedListItems(options: {
  source: string;
  header: Header;
  key: string;
  node: unknown;
  value: unknown;
}): PropertyChange | undefined {
  const { source, header, key, node, value } = options;
  const { isSeq } = loadYaml();
  if (!isSeq(node) || node.flow || !Array.isArray(value)) {
    return undefined;
  }
  const items = node.items as { range?: [number, number, number] }[];
  const first = items[0]?.range;
  const last = items.at(-1)?.range;
  if (!first || !last || value.length <= items.length) {
    return undefined;
  }
  const { body, offset, eol } = header;
  const lineStart = body.lastIndexOf("\n", first[0] - 1) + 1;
  const marker = /^([ \t]*)-[ \t]+$/.exec(body.slice(lineStart, first[0]));
  if (!marker) {
    return undefined;
  }
  // A block item's range can end after its line break; the new line goes
  // at the end of the last line with its text (and any comment).
  const lastText = body.slice(0, last[1]).trimEnd().length;
  let at = body.indexOf("\n", lastText);
  at = at < 0 ? body.length : at;
  if (body[at - 1] === "\r") {
    at--;
  }
  const insert = value
    .slice(items.length)
    .map(
      (item) =>
        `${eol}${marker[1]}- ${scalarValue(item) ? blockItem(item) : yamlValue(item)}`,
    )
    .join("");
  const change = { from: offset + at, to: offset + at, insert };
  const after = source.slice(0, change.from) + insert + source.slice(change.to);
  return sameWritten(frontmatter(after)?.values?.[key], value)
    ? change
    : undefined;
}
