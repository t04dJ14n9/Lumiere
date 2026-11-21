import { isHtmlFile } from "../../shared/html-file";

/**
 * Where an HTML embed's file is written, in the three syntaxes notes already
 * use for it. A note shows each as the same card (`html-embed.ts`), so only
 * the file matters here; a size written beside it (`|600x200`, `height: 300`)
 * is read past, and a note written for a community plugin that draws the page
 * in place still names its file.
 *
 *   ![[page.html#height=480|600x200]]     wikilink embed (Embed HTML)
 *   ![alt|600x200](/path/page.html)       Markdown image
 *   ```html-embed                         fenced block of the "HTML Embed",
 *   file: path/page.html                  "Local HTML Embed" and "HTML Widget
 *   height: 600                           Embed" plugins: `file:` or `path:`,
 *   ```                                   or the path alone on the first line
 */

/** The file an embed or Markdown image's source names, if it is an HTML file. */
export function htmlEmbedTarget(source: string): string | undefined {
  const target = wikiTarget(source) ?? markdownTarget(source);
  return target !== undefined && isHtmlFile(target) ? target : undefined;
}

function wikiTarget(source: string): string | undefined {
  const inner = /^!\[\[([^\]]*)\]\]$/u.exec(source)?.[1];
  // `\|` is a pipe inside a table cell, as `wikiTarget` reads it.
  return inner?.replace(/\\\|/gu, "|").split("|")[0]?.trim();
}

function markdownTarget(source: string): string | undefined {
  return /^!\[[^\]]*\]\(\s*<?([^)>\s]*)/u.exec(source)?.[1];
}

/** Whether a fenced block's first line opens an `html-embed` block. */
export function isHtmlEmbedFence(source: string): boolean {
  const first = source.split("\n", 1)[0] ?? "";
  return /^ {0,3}(?:`{3,}|~{3,})\s*html-embed\b/iu.test(first);
}

/**
 * The file an `html-embed` block names: `file:` or `path:`, else its first
 * line alone. Other keys (`height:`, `width:`) and further lines are ignored.
 */
export function parseHtmlEmbedBlock(content: string): string | undefined {
  let file: string | undefined;
  let line = 0;
  for (const raw of content.split("\n")) {
    const text = raw.trim();
    if (text === "") {
      continue;
    }
    const keyed = /^([A-Za-z]+)\s*:\s*(.*)$/u.exec(text);
    const key = keyed?.[1]?.toLowerCase();
    if (key === "file" || key === "path") {
      file ??= unquoted(keyed![2]!);
    } else if (line === 0 && key !== "height" && key !== "width") {
      // The path alone. A Windows path (`C:/x/a.html`) has a colon too.
      file ??= unquoted(text);
    }
    line += 1;
  }
  return file && isHtmlFile(file) ? file : undefined;
}

function unquoted(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/u, "$2");
}

/** The lines between a fenced block's fences, as markdown-it hands them over. */
export function fenceContent(source: string): string {
  const lines = source.split("\n");
  lines.shift();
  if (/^ {0,3}(?:`{3,}|~{3,})\s*$/u.test(lines.at(-1) ?? "")) {
    lines.pop();
  }
  return lines.join("\n");
}

/** The file an `html-embed` fenced block names, from its whole source. */
export function htmlEmbedBlockFile(source: string): string | undefined {
  return isHtmlEmbedFence(source)
    ? parseHtmlEmbedBlock(fenceContent(source))
    : undefined;
}

/** Whether a source is an HTML embed: a wikilink, a Markdown image or a block. */
export function embedsHtml(source: string): boolean {
  return (
    (isHtmlEmbedFence(source)
      ? htmlEmbedBlockFile(source)
      : htmlEmbedTarget(source)) !== undefined
  );
}
