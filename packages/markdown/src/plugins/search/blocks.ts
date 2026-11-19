import type { RenderPass, Fence } from "../render/api";
import type { QueryClient, SearchUpdate } from "./client";
import type { SearchResponse } from "./protocol";

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
  refresh.textContent = "Refresh";
  refresh.setAttribute("aria-label", "Refresh search results");
  header.append(code, refresh);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const results = document.createElement("ul");
  results.className = "search-result-container";
  results.setAttribute("aria-label", "Search results");
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
    if (update.loading && "added" in update) {
      paintMatches(results, update.added, open);
      shown += update.added.length;
      status.textContent =
        shown === 0
          ? "Searching…"
          : `Searching… ${shown} so far${unreadableNote(update.unreadable)}`;
    } else if (update.loading) {
      show([]);
      status.textContent = "Searching…";
    } else if (update.error) {
      show(update.results ?? []);
      const kept = shown > 0 ? ` · showing ${shown} found before it` : "";
      status.textContent = `Search failed: ${update.error}${kept}`;
    } else {
      show(update.results ?? []);
      status.textContent = `${shown} ${shown === 1 ? "result" : "results"}${unreadableNote(update.unreadable)}`;
    }
  };
}

function unreadableNote(unreadable: number | undefined): string {
  return unreadable ? ` · ${unreadable} files could not be searched` : "";
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
        row.setAttribute("aria-label", `Open ${result.path} at match`);
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
