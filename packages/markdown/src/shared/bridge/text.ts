/**
 * Clipboard text for a bridge envelope. Markdown matches the LLM Wiki
 * `@path#start-end` wording; PDF matches Lumia PDF's Quote-first clipboard
 * (Chrome `#page=` / `#:~:text=`). The structured envelope is separate and
 * is not appended here.
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

/** Quote-first one-page link, the form Lumia PDF copies. */
export function pdfHandoffText(input: PdfHandoffInput): string {
  const body = input.text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "");
  const slash = Math.max(
    input.path.lastIndexOf("/"),
    input.path.lastIndexOf("\\"),
  );
  const basename = slash >= 0 ? input.path.slice(slash + 1) : input.path;
  const label = `${basename} · p.${input.page}`;
  const target = body
    ? `${input.path}#page=${input.page}#${encodeTextFragment(body)}`
    : pdfTarget(input);
  const link = `[${label}](${target})`;
  if (!body) {
    return link;
  }
  const quoted = body
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `${quoted}\n>\n> ${link}`;
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

/** Encode one textStart value per WICG Text Fragments (dash/amp/comma). */
function encodeTextFragment(text: string): string {
  const body = encodeURIComponent(text)
    .replace(/-/gu, "%2D")
    .replace(/'/gu, "%27");
  return `:~:text=${body}`;
}
