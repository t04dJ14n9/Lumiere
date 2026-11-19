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
