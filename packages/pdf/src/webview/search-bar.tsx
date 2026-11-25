import {
  SearchToken,
  type SearchCapability,
  type SearchHit,
} from "@embedpdf/plugin-search/contract";
import { useSearchState } from "@embedpdf/react/search";
import { useOptionalCapability } from "@embedpdf/react/runtime";
import React, { useEffect, useRef, useState } from "react";
import type { Navigation } from "./navigation";
import { t } from "@workshop/l10n";

/** Wait this long after typing before searching the whole document. */
const SEARCH_DELAY_MS = 150;

/**
 * Find text in the PDF: Enter for the next match, Shift+Enter for the
 * previous. Each new `focusRequest` (Find pressed again) focuses the field
 * and selects its text, as in VS Code's own find widget.
 *
 * A new search starts at the first match on or after the current page, and
 * the viewer scrolls to each match it steps to.
 *
 * Every match is drawn by EmbedPDF's search layer; this bar drives the search
 * session and shows its count. The camera is moved twice per step, on
 * purpose (see `showHit`).
 */
export function SearchBar({
  navigation,
  focusRequest,
  onClose,
  onPreviewEnd,
}: {
  navigation: Navigation;
  focusRequest: number;
  onClose: () => void;
  onPreviewEnd: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const { state, step } = useDocumentSearch(query, navigation);
  useEffect(() => onPreviewEnd, [onPreviewEnd]);
  return (
    <div className="search-bar" role="search" aria-label={t("Find in PDF")}>
      <SearchField
        query={query}
        focusRequest={focusRequest}
        onQuery={(value) => {
          if (!value.trim()) {
            onPreviewEnd();
          }
          setQuery(value);
        }}
        onStep={step}
        onClose={onClose}
      />
      <span className="search-count" aria-live="polite">
        {query.trim() ? matchCount(state) : ""}
      </span>
      <SearchButton
        icon="arrow-up"
        label={t("Previous match")}
        keys="Shift+Enter"
        onClick={() => step(-1)}
      />
      <SearchButton
        icon="arrow-down"
        label={t("Next match")}
        keys="Enter"
        onClick={() => step(1)}
      />
      <button
        type="button"
        aria-label={t("Close search")}
        title={t("Close (Escape)")}
        onClick={onClose}
      >
        <i className="codicon codicon-close" aria-hidden="true" />
      </button>
    </div>
  );
}

/** The query field: Enter steps forward, Shift+Enter back, Escape closes. */
function SearchField(props: {
  query: string;
  focusRequest: number;
  onQuery: (query: string) => void;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [props.focusRequest]);
  return (
    <input
      type="search"
      aria-label={t("Find in PDF")}
      placeholder={t("Find")}
      ref={input}
      value={props.query}
      onChange={(event) => props.onQuery(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          props.onStep(event.shiftKey ? -1 : 1);
        } else if (event.key === "Escape") {
          props.onClose();
        }
      }}
    />
  );
}

function SearchButton(props: {
  icon: string;
  label: string;
  keys: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={`${props.label} (${props.keys})`}
      onClick={props.onClick}
    >
      <i className={`codicon codicon-${props.icon}`} aria-hidden="true" />
    </button>
  );
}

function matchCount(state: {
  status: string;
  hitCount: number;
  activeHitIndex: number;
}): string {
  if (state.status === "searching") {
    return "…";
  }
  return state.hitCount > 0
    ? t("{0} of {1}", state.activeHitIndex + 1, state.hitCount)
    : t("No results");
}

/**
 * Search the whole document a moment after `query` changes, starting at the
 * first match on or after the current page, and step through the matches.
 */
function useDocumentSearch(query: string, navigation: Navigation) {
  const search = useOptionalCapability(SearchToken);
  const state = useSearchState();
  // Read when results arrive, without starting a new search on every scroll.
  const latestNavigation = useRef(navigation);
  latestNavigation.current = navigation;
  useEffect(
    () =>
      search
        ? searchSoon(search, query, () => latestNavigation.current)
        : undefined,
    // Only a new query starts a new search.
    [search, query],
  );
  useEffect(() => () => search?.clear(), [search]);
  return {
    state,
    step(direction: 1 | -1): void {
      const count = search?.getHitCount() ?? 0;
      if (!search || count === 0) {
        return;
      }
      // Next after the last is the first, and the other way round.
      const index = (search.getActiveHitIndex() + direction + count) % count;
      showHit(latestNavigation.current, search, index, true);
    },
  };
}

/**
 * After a short pause, search the whole document and go to the first match
 * on or after the current page. Returns the cancellation; a newer navigation
 * also cancels it.
 */
function searchSoon(
  search: SearchCapability,
  query: string,
  navigation: () => Navigation,
): () => void {
  let cancelled = false;
  const intent = navigation().intent;
  const generation = intent.advance();
  const isCurrent = () => !cancelled && intent.owns(generation);
  const timer = window.setTimeout(() => {
    if (!isCurrent()) {
      return;
    }
    const text = query.trim();
    if (!text) {
      search.clear();
      return;
    }
    // From the first page, so the matches are in document order and "n of N"
    // counts from the top as the bar always has: EmbedPDF otherwise starts at
    // the page in view and wraps, which would number the matches from there.
    search.search({ text }, { from: 0 }).then(
      (result) => {
        if (!isCurrent() || result.status !== "complete") {
          return;
        }
        const fromPage = navigation().currentPage - 1;
        const index = Math.max(
          0,
          search.listHits().findIndex((hit) => hit.pageIndex >= fromPage),
        );
        showHit(navigation(), search, index, false);
      },
      // Refused (a PDF that forbids searching) or failed: the state says so.
      () => undefined,
    );
  }, SEARCH_DELAY_MS);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}

/**
 * Make a match the active one and bring it to the middle of the viewer.
 *
 * EmbedPDF's search always scrolls to the match it makes active, and has no
 * way to switch that off, while the viewer's own navigation owns what a move
 * means to the reader: Back returns from a step, and the move cancels what
 * the reader was heading for. So the navigation moves first, and EmbedPDF is
 * then asked for the very same place (centered, and gliding, so it never
 * cuts the navigation's own glide short): the viewer is already there, and
 * the second move has nowhere to go.
 */
function showHit(
  navigation: Navigation,
  search: SearchCapability,
  index: number,
  deliberate: boolean,
): void {
  const hit: SearchHit | undefined = search.listHits()[index];
  const box = hit?.bounds;
  if (hit && box) {
    navigation.reveal(
      hit.pageIndex + 1,
      [box.x, box.y, box.x + box.width, box.y + box.height],
      deliberate,
    );
  }
  search.goToHit(index, {
    align: { x: "center", y: "center" },
    behavior: "smooth",
  });
}
