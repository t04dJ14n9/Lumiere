/**
 * Clipboard text for a bridge envelope. Markdown matches the LLM Wiki
 * `@path#start-end` wording; PDF matches Lumiere PDF's `@path#page=N`
 * locator and quote. The structured envelope is separate and is not
 * appended here.
 */

/** The reference, a blank line, then the selection quoted line by line. */
export { notePayload as markdownHandoffText } from "@workshop/agents/handoff";

export interface PdfHandoffInput {
  readonly path: string;
  readonly page: number;
  readonly viewRect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Unused in clipboard text; kept so envelope callers need not change. */
  readonly sourceSha256?: string;
  readonly text: string;
}

/** One page's `@path#page=N` locator, a blank line, the quote, a newline: what Lumiere PDF copies. */
export function pdfHandoffText(input: PdfHandoffInput): string {
  const body = input.text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "");
  if (!body) {
    return `@${pdfTarget(input)}\n`;
  }
  const quoted = body
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `@${input.path}#page=${input.page}\n\n${quoted}\n`;
}

/** Durable PDF locator for envelopes: `#page=` and optional `&viewrect=`. */
export function pdfTarget(input: {
  readonly path: string;
  readonly page: number;
  readonly viewRect?: PdfHandoffInput["viewRect"];
}): string {
  const page = `${input.path}#page=${input.page}`;
  const rect = input.viewRect;
  if (!rect) {
    return page;
  }
  const box = [rect.x, rect.y, rect.width, rect.height].join(",");
  return `${page}&viewrect=${box}`;
}
