/**
 * The text that Copy Link for Agent puts on the clipboard: a Quote-first
 * Markdown block with Chrome Text Fragment deep links. For example:
 *
 *     > Scaled dot-product attention
 *     >
 *     > [attention.pdf · p.3](papers/attention.pdf#page=3#:~:text=Scaled%20dot%2Dproduct%20attention)
 *
 * Href is `path#page=N` plus optional `#:~:text=…` (Chrome), or
 * `path#page=N&viewrect=…` when regions are enabled. Never PDF++
 * `selection=`, never RFC `search=`. No Source: prefix, no file hash, no cite
 * instruction. The label escapes only what would end it: `[` and `]`.
 *
 * A region uses the same Quote shape when it has readable text; viewrect is
 * emitted only when `regionsEnabled` is true. Region image paths are not
 * copied (chat attachment / MCP can still attach a snapshot separately).
 */
import { boundingRect, toViewRect } from "./geometry";
import { selectedPages, type PdfSelection } from "./selection";
import { formatPdfDeepLink } from "./text-fragment";

export interface PdfSource {
  /** Workspace-relative path, or an absolute path for files outside it. */
  path: string;
}

/** Quote every line with `> `, matching packages/agents note handoff. */
function blockquote(text: string): string {
  const lines = text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "").split("\n");
  return lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
}

/** Last path segment of a workspace or absolute file path. */
function fileBasename(path: string): string {
  const cleaned = path.replace(/\\/gu, "/");
  const slash = cleaned.lastIndexOf("/");
  return slash >= 0 ? cleaned.slice(slash + 1) : cleaned;
}

/**
 * A page link's label, `basename · p.N`. A `]` would end it early, and a line
 * break would leave the quote block, so the name's `[` and `]` are
 * backslash-escaped and its line breaks become spaces. A backslash cannot
 * occur: it is a path separator here.
 */
function pageLabel(path: string, page: number): string {
  const name = fileBasename(path)
    .replace(/\r\n?|\n/gu, " ")
    .replace(/[[\]]/gu, "\\$&");
  return `${name} · p.${page}`;
}

export function pageLinkText(source: PdfSource, page: number): string {
  const label = pageLabel(source.path, page);
  return `[${label}](${formatPdfDeepLink(source.path, { page })})`;
}

export function agentText(
  selection: PdfSelection,
  source: PdfSource,
  options: { regionsEnabled?: boolean } = {},
): string {
  const regionsEnabled = options.regionsEnabled === true;
  const pages = selectedPages(selection);
  const quote = selection.text?.trim() ?? "";
  const links = pages.map(({ page, rects }) => {
    const label = pageLabel(source.path, page);
    if (quote && selection.kind === "text") {
      return `[${label}](${formatPdfDeepLink(source.path, { page, text: quote })})`;
    }
    if (selection.kind === "region" && regionsEnabled) {
      return `[${label}](${formatPdfDeepLink(source.path, {
        page,
        viewRect: toViewRect(boundingRect(rects)),
      })})`;
    }
    if (quote) {
      return `[${label}](${formatPdfDeepLink(source.path, { page, text: quote })})`;
    }
    return `[${label}](${formatPdfDeepLink(source.path, { page })})`;
  });
  if (!quote) {
    return links.join("\n");
  }
  // Quote block, blank quoted line, then each link as a quoted Markdown line.
  return [blockquote(quote), ">", ...links.map((link) => `> ${link}`)].join(
    "\n",
  );
}
