import type { RenderPass, Fence } from "../render/api";
import type { QueryClient, SearchUpdate } from "./client";
import type { SearchResponse } from "./protocol";
import { SEARCH_RESULT_LIMIT, SEARCH_SKIP_LIMIT } from "./limits";
import { t } from "@workshop/l10n";

/** Open a vault path from a search result (match line carries an offset). */
export type OpenSearchResult = (target: {
  path: string;
  offset?: number;
  side?: boolean;
}) => void;

/** Each rendered block owns one subscription, including manual refresh and teardown. */
export function bindSearchBlock(input: {
  fence: Fence;
  pass: RenderPass;
  client: Pick<QueryClient, "watch">;
  source: string;
  open?: OpenSearchResult;
}): () => void {
  const { fence, pass, client, source, open } = input;
  const document = fence.element.ownerDocument;
  fence.element.classList.add("embedded-search", "internal-query");
  const header = document.createElement("div");
  header.className = "search-header internal-query-header";
  const code = document.createElement("code");
  code.className = "internal-query-header-title";
  code.textContent = fence.source.trim();
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = t("Refresh");
  refresh.setAttribute("aria-label", t("Refresh search results"));
  header.append(code, refresh);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const results = document.createElement("ul");
  results.className = "search-result-container";
  results.setAttribute("aria-label", t("Search results"));
  fence.element.replaceChildren(header, status, results);
  let stop: (() => void) | undefined;
  let live = true;
  const render = resultsView({ status, results }, open);
  const start = () => {
    stop?.();
    stop = client.watch(fence.source, source, (update) => {
      if (!live) {
        return;
      }
      render(update);
      pass.measure();
    });
  };
  refresh.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    start();
  };
  start();
  return () => {
    live = false;
    stop?.();
    refresh.onclick = null;
    refresh.disabled = true;
  };
}

/**
 * Shows a block's search: streamed matches are appended, so a search with
 * n hits paints n rows while it runs; its final, sorted set replaces them.
 */
function resultsView(
  elements: { status: HTMLElement; results: HTMLElement },
  open?: OpenSearchResult,
): (update: SearchUpdate) => void {
  const { status, results } = elements;
  let shown = 0;
  const show = (matches: SearchResponse["results"]) => {
    results.replaceChildren();
    paintMatches(results, matches, open);
    shown = matches.length;
  };
  return (update) => {
    if (update.loading && "refreshing" in update) {
      // The rows and their count stay until the new result replaces them.
      return;
    }
    if (update.loading && "added" in update) {
      paintMatches(results, update.added, open);
      shown += update.added.length;
      status.textContent =
        shown === 0
          ? t("Searching…")
          : statusLine(
              t("Searching… {0} so far", shown),
              unreadableNote(update.unreadable),
            );
    } else if (update.loading) {
      show([]);
      status.textContent = t("Searching…");
    } else if (update.error) {
      show(update.results ?? []);
      status.textContent = statusLine(
        t("Search failed: {0}", update.error),
        shown > 0 ? t("showing {0} found before it", shown) : "",
      );
    } else {
      show(update.results ?? []);
      status.textContent = statusLine(
        shown === 1 ? t("{0} result", shown) : t("{0} results", shown),
        unreadableNote(update.unreadable),
        skippedNote(update.skipped),
        truncatedNote(update.truncated),
        tooSlowNote(update.tooSlow),
      );
    }
  };
}

/** A status line: its parts that are not empty, set apart by " · ". */
function statusLine(...parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

function unreadableNote(unreadable: number | undefined): string {
  return unreadable ? t("{0} files could not be searched", unreadable) : "";
}

function skippedNote(skipped: readonly string[] | undefined): string {
  return skipped?.length
    ? t("skipped, evaluation too slow: {0}", skipped.join(", "))
    : "";
}
function truncatedNote(truncated: boolean | undefined): string {
  return truncated
    ? t(
        "stopped at {0} matching files; the rest were not searched",
        SEARCH_RESULT_LIMIT,
      )
    : "";
}
function tooSlowNote(tooSlow: boolean | undefined): string {
  return tooSlow
    ? t(
        "stopped after {0} files took too long; the rest were not searched",
        SEARCH_SKIP_LIMIT,
      )
    : "";
}
function paintMatches(
  results: HTMLElement,
  matches: SearchResponse["results"],
  open?: OpenSearchResult,
): void {
  const doc = results.ownerDocument;
  for (const result of matches) {
    const item = doc.createElement("li");
    item.className = "search-result-file-title";
    const link = doc.createElement("a");
    link.href = result.href;
    link.textContent = result.path;
    if (open) {
      wireSearchOpen(link, { path: result.path }, open);
    }
    item.append(link);
    const lines = result.matches ?? [];
    if (lines.length > 0) {
      const nest = doc.createElement("div");
      nest.className = "search-result-file-matches";
      for (const line of lines) {
        const row = doc.createElement("div");
        row.className = "search-result-file-match";
        row.setAttribute("data-offset", String(line.offset));
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.setAttribute("aria-label", t("Open {0} at match", result.path));
        paintMatchText(row, line);
        if (open) {
          wireSearchOpen(row, { path: result.path, offset: line.offset }, open);
        }
        nest.append(row);
      }
      item.append(nest);
    }
    results.append(item);
  }
}

function wireSearchOpen(
  node: HTMLElement,
  target: { path: string; offset?: number },
  open: OpenSearchResult,
): void {
  const go = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const side =
      ("metaKey" in event || "ctrlKey" in event) &&
      Boolean((event.metaKey || event.ctrlKey) && event.altKey);
    open({ ...target, ...(side ? { side: true } : {}) });
  };
  node.onclick = go;
  node.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      go(event);
    }
  };
}
function paintMatchText(
  row: HTMLElement,
  line: NonNullable<SearchResponse["results"][number]["matches"]>[number],
): void {
  const mark = line.mark;
  if (
    !mark ||
    mark.from < 0 ||
    mark.to <= mark.from ||
    mark.to > line.text.length
  ) {
    row.textContent = line.text;
    return;
  }
  const doc = row.ownerDocument;
  if (mark.from > 0) {
    row.append(doc.createTextNode(line.text.slice(0, mark.from)));
  }
  const span = doc.createElement("span");
  span.className = "search-result-file-matched-text";
  span.textContent = line.text.slice(mark.from, mark.to);
  row.append(span);
  if (mark.to < line.text.length) {
    row.append(doc.createTextNode(line.text.slice(mark.to)));
  }
}

/** Test helper: paint results into a detached list. */
export function paintSearchMatchesForTest(
  results: HTMLElement,
  matches: SearchResponse["results"],
  open?: OpenSearchResult,
): void {
  paintMatches(results, matches, open);
}
