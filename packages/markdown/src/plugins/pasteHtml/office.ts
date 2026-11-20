import type TurndownService from "turndown";

/**
 * Rules for office suites, which say bold and italic in CSS rather than with
 * `<strong>` and `<em>`. Google Docs wraps a whole copy in
 * `<b style="font-weight:normal" id="docs-internal-guid-…">`.
 */
export function registerStyledTextRules(converter: TurndownService): void {
  converter.addRule("notBold", {
    filter: (node) =>
      /^(B|STRONG)$/.test(node.nodeName) && fontWeight(node) === "normal",
    replacement: (content) => content,
  });
  converter.addRule("styledText", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      ((isBoldSpan(node) && !insideBold(node)) || isItalicSpan(node)),
    replacement: (content, node) => {
      const bold = isBoldSpan(node) && !insideBold(node);
      const italic = isItalicSpan(node);
      return wrapped(wrapped(content, italic ? "_" : ""), bold ? "**" : "");
    },
  });
}

/**
 * Word writes a list as paragraphs styled `mso-list:l0 level1 lfo1`, each
 * with its bullet or number as text in an `mso-list:Ignore` span. They
 * become Markdown list items, nested lines four spaces in as Obsidian writes
 * them, and a different list starts after a blank line.
 */
export function registerWordListRules(converter: TurndownService): void {
  converter.addRule("wordListMarker", {
    filter: isWordListMarker,
    replacement: () => "",
  });
  converter.addRule("wordListItem", {
    filter: (node) => node.nodeName === "P" && wordList(node) !== undefined,
    replacement: wordListItem,
  });
}

function wordListItem(content: string, node: HTMLElement): string {
  const { list, level } = wordList(node)!;
  const markerNode = findDescendant(node, isWordListMarker);
  let text = content.trim();
  let marker = markerNode?.textContent?.trim() ?? "";
  if (!markerNode) {
    // Some copies leave the marker as plain text before the item's own
    // (`\s` includes the no-break spaces Word puts after it).
    const leading = /^((?:\\?\S){1,4})\s+/.exec(text);
    marker = leading?.[1]?.replace(/\\/g, "") ?? "";
    text = text.slice(leading?.[0].length ?? 0);
  }
  const number = /^(\d+)[.)]$/.exec(marker)?.[1];
  const previous = previousElement(node);
  const sameList = previous !== undefined && wordList(previous)?.list === list;
  const indent = "    ".repeat(Math.max(0, level - 1));
  return `${sameList ? "\n" : "\n\n"}${indent}${number ? `${number}.` : "-"} ${text}\n`;
}

function wordList(
  node: HTMLElement,
): { list: string; level: number } | undefined {
  const match = /mso-list\s*:\s*(l\d+)\s+level(\d+)/i.exec(style(node));
  return match ? { list: match[1]!, level: Number(match[2]) } : undefined;
}

function isWordListMarker(node: HTMLElement): boolean {
  return /mso-list\s*:\s*ignore/i.test(style(node));
}

function findDescendant(
  node: HTMLElement,
  matches: (node: HTMLElement) => boolean,
): HTMLElement | undefined {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1) {
      continue;
    }
    const element = child as HTMLElement;
    const found = matches(element) ? element : findDescendant(element, matches);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function previousElement(node: HTMLElement): HTMLElement | undefined {
  let sibling = node.previousSibling;
  while (sibling && sibling.nodeType !== 1) {
    sibling = sibling.previousSibling;
  }
  return (sibling as HTMLElement | null) ?? undefined;
}

function style(node: HTMLElement): string {
  return node.getAttribute("style") ?? "";
}

function fontWeight(node: HTMLElement): "bold" | "normal" | undefined {
  const weight = /font-weight\s*:\s*([\w]+)/i.exec(style(node))?.[1];
  if (!weight) {
    return undefined;
  }
  return /^(bold|bolder|[6-9]00)$/i.test(weight) ? "bold" : "normal";
}

function isBoldSpan(node: HTMLElement): boolean {
  return fontWeight(node) === "bold";
}

function isItalicSpan(node: HTMLElement): boolean {
  return /font-style\s*:\s*(italic|oblique)/i.test(style(node));
}

/** Within `<strong>`, `<b>` or a bold span: another `**` pair would end it. */
function insideBold(node: HTMLElement): boolean {
  for (
    let parent = node.parentNode as HTMLElement | null;
    parent?.getAttribute;
    parent = parent.parentNode as HTMLElement | null
  ) {
    const weight = fontWeight(parent);
    if (weight === "bold") {
      return true;
    }
    if (weight === undefined && /^(B|STRONG)$/.test(parent.nodeName)) {
      return true;
    }
  }
  return false;
}

/** `content` between markers, its edge spaces left outside them. */
function wrapped(content: string, marker: string): string {
  const text = content.trim();
  if (!marker || !text) {
    return content;
  }
  const leading = content.slice(0, content.length - content.trimStart().length);
  const trailing = content.slice(content.trimEnd().length);
  return `${leading}${marker}${text}${marker}${trailing}`;
}
