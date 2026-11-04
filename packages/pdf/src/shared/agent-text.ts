/**
 * The text that Copy Link for Agent puts on the clipboard: a Quote-first
 * Markdown block with Chrome Text Fragment deep links. For example:
 *
 *     > Scaled dot-product attention
 *     >
 *     > [attention.pdf · p.3](papers/attention.pdf#page=3#:~:text=Scaled%20dot%2Dproduct%20attention)
 *
 * Href is `path#page=N` plus optional `#:~:text=…` (Chrome), or
 * `path#page=N&viewrect=…` when regions are enabled. Never `#hl-`, never
 * PDF++ `selection=`, never RFC `search=`. No Source: prefix, no file hash,
 * no cite instruction, no Markdown escapes in the label.
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

/** Last path segment of a workspace path or file URL path. */
function fileBasename(path: string): string {
  const cleaned = path.replace(/\\/gu, "/");
  const noQuery = cleaned.split(/[?#]/u, 1)[0] ?? cleaned;
  const slash = noQuery.lastIndexOf("/");
  return slash >= 0 ? noQuery.slice(slash + 1) : noQuery;
}

export function pageLinkText(source: PdfSource, page: number): string {
  const name = fileBasename(source.path);
  return `[${name} · p.${page}](${formatPdfDeepLink(source.path, { page })})`;
}

export function agentText(
  selection: PdfSelection,
  source: PdfSource,
  options: { regionsEnabled?: boolean } = {},
): string {
  const regionsEnabled = options.regionsEnabled === true;
  const name = fileBasename(source.path);
  const pages = selectedPages(selection);
  const quote = selection.text?.trim() ?? "";
  const links = pages.map(({ page, rects }) => {
    const label = `${name} · p.${page}`;
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
