import type { Tree } from "@lezer/common";

export interface Heading {
  from: number;
  to: number;
  end: number;
  level: number;
  label: string;
  key: string;
  scope: string;
}

/**
 * Plain text of a heading line the way markdown-it's inline parse used to:
 * keep text / inline-code / image alt content, drop other markup, then expand
 * wikilink aliases. Avoids loading markdown-it on the extension host.
 */
export function headingLabel(text: string): string {
  return stripInlineMarkup(text).replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_all, target: string, alias?: string) => alias ?? target,
  );
}

function stripInlineMarkup(text: string): string {
  let label = "";
  let index = 0;
  while (index < text.length) {
    const next = takeInline(text, index);
    label += next.text;
    index = next.index;
  }
  return label;
}

function takeInline(
  text: string,
  index: number,
): { text: string; index: number } {
  const image = takeDelimited({
    text,
    index,
    open: "![",
    mid: "]",
    beforeUrl: "(",
  });
  if (image) {
    return image;
  }
  const code = takeWrapped(text, index, "`");
  if (code) {
    return code;
  }
  const emphasis = takeEmphasis(text, index);
  if (emphasis) {
    return emphasis;
  }
  const link = takeDelimited({
    text,
    index,
    open: "[",
    mid: "]",
    beforeUrl: "(",
  });
  if (link) {
    return { text: stripInlineMarkup(link.text), index: link.index };
  }
  if (text[index] === "<") {
    const end = text.indexOf(">", index + 1);
    if (end >= 0) {
      return { text: "", index: end + 1 };
    }
  }
  if (text[index] === "\\" && index + 1 < text.length) {
    return { text: text[index + 1]!, index: index + 2 };
  }
  return { text: text[index]!, index: index + 1 };
}

function takeWrapped(
  text: string,
  index: number,
  marker: string,
): { text: string; index: number } | undefined {
  if (text[index] !== marker) {
    return undefined;
  }
  const close = text.indexOf(marker, index + 1);
  if (close < 0) {
    return undefined;
  }
  return { text: text.slice(index + 1, close), index: close + 1 };
}

function takeEmphasis(
  text: string,
  index: number,
): { text: string; index: number } | undefined {
  const marker = text[index];
  if (marker !== "*" && marker !== "_" && marker !== "~") {
    return undefined;
  }
  let length = 1;
  while (text[index + length] === marker) {
    length++;
  }
  const close = text.indexOf(marker.repeat(length), index + length);
  if (close < 0) {
    return undefined;
  }
  return {
    text: stripInlineMarkup(text.slice(index + length, close)),
    index: close + length,
  };
}

/** `![alt](url)` or `[label](url)` — returns the inner label/alt span. */
function takeDelimited(options: {
  text: string;
  index: number;
  open: string;
  mid: string;
  beforeUrl: string;
}): { text: string; index: number } | undefined {
  const { text, index, open, mid, beforeUrl } = options;
  if (!text.startsWith(open, index)) {
    return undefined;
  }
  const close = text.indexOf(mid, index + open.length);
  if (close < 0 || text[close + 1] !== beforeUrl) {
    return undefined;
  }
  const end = text.indexOf(")", close + 2);
  if (end < 0) {
    return undefined;
  }
  return {
    text: text.slice(index + open.length, close),
    index: end + 1,
  };
}

export function extractHeadings(source: string, tree: Tree): Heading[] {
  return headingsIn(tree, (from, to) => source.slice(from, to));
}

/**
 * The note's own headings, reading their text through `slice`, so an editor
 * can pass its document without joining it into one string. As in Obsidian,
 * only a note's own headings count: not one inside a list item, quote or
 * callout, so only the top-level blocks are visited.
 */
export function headingsIn(
  tree: Tree,
  slice: (from: number, to: number) => string,
): Heading[] {
  const result: Heading[] = [];
  const counts = new Map<string, number>();
  const scope = `${tree.topNode.from}:${tree.topNode.to}`;
  const cursor = tree.cursor();
  for (let more = cursor.firstChild(); more; more = cursor.nextSibling()) {
    const level = headingLevels.get(cursor.name);
    if (level === undefined) {
      continue;
    }
    const text = slice(cursor.from, cursor.to)
      .split("\n")[0]!
      .replace(/\r$/, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/\s+#+\s*$/, "");
    const label = headingLabel(text);
    const base = `${level}:${label}`;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    result.push({
      from: cursor.from,
      to: cursor.to,
      end: tree.topNode.to,
      level,
      label,
      key: `${base}:${count}`,
      scope,
    });
  }
  closeSections(result);
  return result;
}

const headingLevels = new Map(
  [1, 2, 3, 4, 5, 6].flatMap((level) => [
    [`ATXHeading${level}`, level],
    [`SetextHeading${level}`, level],
  ]),
);

/**
 * A heading's section ends before the next heading of the same or a higher
 * level. One pass with a stack of open sections, rather than a search ahead
 * from every heading (quadratic in a note of many headings).
 */
function closeSections(headings: Heading[]): void {
  const open: Heading[] = [];
  for (const heading of headings) {
    while (open.length && open[open.length - 1]!.level >= heading.level) {
      const closed = open.pop()!;
      closed.end = Math.max(closed.to, heading.from - 1);
    }
    open.push(heading);
  }
}
