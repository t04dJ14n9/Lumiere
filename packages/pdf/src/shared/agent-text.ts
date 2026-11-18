/**
 * The text that Copy Link for Agent puts on the clipboard: an `@` locator
 * per selected page, a blank line, the selection quoted with `> `, then a
 * newline, the way a selection reads in an agent chat. For example:
 *
 *     @papers/attention.pdf#page=3
 *
 *     > Scaled dot-product attention
 *
 * The locator is `@path#page=N`, or `@path#page=N&viewrect=…` for a region
 * when `regionsEnabled` is true. The quote already carries the words, so
 * the locator has no `#:~:text=`. Never PDF++ `selection=`, never RFC
 * `search=`. No Source: prefix, no file hash, no cite instruction, no
 * region image path (chat attachment / MCP can attach a snapshot separately).
 */
import { boundingRect, toViewRect, type ViewRect } from "./geometry";
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

/** `@path#page=N`: the page a selection or the reading page is on. */
function pageReference(
  source: PdfSource,
  page: number,
  viewRect?: ViewRect,
): string {
  return `@${formatPdfDeepLink(source.path, viewRect ? { page, viewRect } : { page })}`;
}

/** Copy Link for Agent with nothing selected: the reading page's locator. */
export function pageReferenceText(source: PdfSource, page: number): string {
  return `${pageReference(source, page)}\n`;
}

export function agentText(
  selection: PdfSelection,
  source: PdfSource,
  options: { regionsEnabled?: boolean } = {},
): string {
  const showRegion = selection.kind === "region" && options.regionsEnabled;
  const references = selectedPages(selection).map(({ page, rects }) =>
    pageReference(
      source,
      page,
      showRegion ? toViewRect(boundingRect(rects)) : undefined,
    ),
  );
  const quote = selection.text?.trim() ?? "";
  if (!quote) {
    return `${references.join("\n")}\n`;
  }
  return `${references.join("\n")}\n\n${blockquote(quote)}\n`;
}
