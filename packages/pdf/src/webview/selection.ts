import type { PageRef } from "@embedpdf/engine";
import { RenderToken } from "@embedpdf/plugin-render/contract";
import {
  SelectionToken,
  type SelectionCapability,
  type TextRange,
} from "@embedpdf/plugin-selection/contract";
import { useDocuments, useOptionalCapability } from "@embedpdf/react/runtime";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { PageRect } from "../shared/geometry";
import { copiedText, type RegionSelection } from "../shared/selection";
import { isEditableTarget } from "./editable-target";
import { postToHost, reportToHost } from "./host";
import { followMenuContext } from "./menu-context";
import { readRegionDetails } from "./region-details";
import { onRegionEnd, type RegionEnd } from "./region-drag";
import { useTextAccess } from "./text-access";

/** Report a mark as the selection, or `undefined` to drop it. */
export type SetAnnotationRegion = (next: RegionSelection | undefined) => void;

/** What the tracker needs from the open document. */
export interface SelectionSource {
  /** The 1-based page a page identity is at; undefined for a page the document lacks. */
  pageNumberOf(page: PageRef): number | undefined;
  /** The text inside a region of a 1-based page, and a snapshot of it. */
  readDetails(
    page: number,
    rect: PageRect,
  ): ReturnType<typeof readRegionDetails>;
}

/**
 * Keep the extension informed of what is selected: text, selected with
 * EmbedPDF's text selection, or a region dragged over empty page space.
 * A region is reported at once, then again with the text inside it and a
 * PNG snapshot once they are read. Copy Link for Agent then hands over whatever was
 * reported last, waiting for a region's details if they are still coming.
 */
export function useSelectionReporting(
  /** A context menu opens: whether it is on a mark (`mark-menu.ts`). */
  menuOnMark?: (event: MouseEvent) => boolean,
) {
  const selection = useOptionalCapability(SelectionToken);
  const render = useOptionalCapability(RenderToken);
  const text = useTextAccess();
  const documents = useDocuments();
  const [region, setRegion] = useState<RegionSelection>();
  const tracker = useRef<SelectionTracker | undefined>(undefined);
  tracker.current ??= new SelectionTracker(setRegion);
  const state = tracker.current;
  const extra = useRef(menuOnMark);
  extra.current = menuOnMark;
  const source = useMemo<SelectionSource>(
    () => ({
      pageNumberOf: (page) => {
        const index = documents.getPageIndex(page);
        return index < 0 ? undefined : index + 1;
      },
      readDetails: (page, rect) => {
        const ref = documents.getPage(page - 1)?.ref;
        return ref
          ? readRegionDetails({ text, render }, ref, rect)
          : Promise.resolve({ text: "" });
      },
    }),
    [documents, text, render],
  );
  useEffect(
    () => (selection ? state.follow(selection, source) : undefined),
    [state, selection, source],
  );
  useCopiedText(state);
  useSelectionMenuContext(state, selection, extra);
  /** Report the selection now: the extension asks before Copy Link for Agent. */
  const reportNow = useCallback((): void => {
    void state.reportSelection(selection);
  }, [state, selection]);
  const copyLinkForAgent = useCallback(async (): Promise<void> => {
    await state.reportSelection(selection);
    postToHost({ type: "copyLinkForAgent" });
  }, [state, selection]);
  /** Clear whatever is selected, text or region (Escape). */
  const clear = useCallback((): void => {
    if (state.region) {
      // Escape always clears the host region (user asked to clear), including
      // the mark a context menu was opened on.
      state.changeRegion(undefined);
    }
    // Reported to the extension by the selection change handler.
    selection?.clear();
  }, [state, selection]);
  const setAnnotationRegion = useCallback(
    (next: RegionSelection | undefined): void => {
      state.setAnnotationRegion(next);
    },
    [state],
  );
  return { region, clear, copyLinkForAgent, reportNow, setAnnotationRegion };
}

function useSelectionMenuContext(
  state: SelectionTracker,
  selection: SelectionCapability | null,
  extra: MutableRefObject<((event: MouseEvent) => boolean) | undefined>,
): void {
  useEffect(
    () =>
      followMenuContext(document, (event) => {
        const hasTextSelection = Boolean(selection?.hasSelection());
        // Selected text wins: the menu marks it, wherever it was opened.
        const hasAnnotationSelection =
          !hasTextSelection && Boolean(extra.current?.(event));
        const hasSelection =
          Boolean(state.region) || hasTextSelection || hasAnnotationSelection;
        return { hasSelection, hasTextSelection, hasAnnotationSelection };
      }),
    [state, selection, extra],
  );
}

/** What is selected, as last reported to the extension. */
export class SelectionTracker {
  region: RegionSelection | undefined;
  /** The selected text, for Cmd/Ctrl+C. */
  selectedText: string | undefined;
  /** The region's details being read, if any. */
  private regionDetails: Promise<void> | undefined;
  /** The open document, while `follow` is on. */
  private source: SelectionSource | undefined;
  /**
   * True while `region` is the mark a context menu was opened on
   * (`setAnnotationRegion`). An empty click or a cancelled region must not
   * clear it; `mark-menu.ts` clears it.
   */
  private annotationOwned = false;

  constructor(
    private readonly setRegion: (region: RegionSelection | undefined) => void,
  ) {}

  changeRegion(next: RegionSelection | undefined): void {
    if (!next) {
      this.annotationOwned = false;
    }
    this.region = next;
    this.setRegion(next);
    reportToHost({ selection: { selection: next ?? null } });
  }

  /**
   * The mark a context menu was opened on uses the same region channel as
   * dragged regions, so Copy Link for Agent hands it over and textCleared /
   * reportSelection / ensureSelection stay consistent.
   */
  setAnnotationRegion(next: RegionSelection | undefined): void {
    this.annotationOwned = next !== undefined;
    this.changeRegion(next);
    this.regionDetails =
      next && this.source ? this.readDetails(this.source, next) : undefined;
  }

  /** Follow EmbedPDF's selection events and Lumiere's region gestures; returns how to stop. */
  follow(selection: SelectionCapability, source: SelectionSource): () => void {
    this.source = source;
    if (!selection.hasSelection()) {
      // Each document starts with nothing selected, which the extension is
      // told (it may still hold the last document's selection). EmbedPDF 2
      // said so itself, with a selection change as the document opened.
      this.textCleared();
    }
    const stops = [
      // A gesture that ends with a selection: never a programmatic one.
      selection.onCommitted(() => this.textSelected(selection)),
      selection.onCleared(() => this.textCleared()),
      onRegionEnd((end) => this.regionEnded(end)),
    ];
    return () => {
      this.source = undefined;
      stops.forEach((stop) => stop());
    };
  }

  /**
   * Make sure the extension has the selection before Copy Link for Agent. A
   * text selection is reported when the drag ends, after an asynchronous text
   * read; a click right after the drag could beat that report, so the text is
   * re-read and reported first. A region waits for its text and snapshot.
   * Nothing selected is reported too: the extension waits for an answer
   * before copying a page-only link. Messages arrive in order.
   */
  async reportSelection(
    selection: SelectionCapability | null | undefined,
  ): Promise<void> {
    if (selection?.hasSelection()) {
      await reportText(selection, this.source);
    } else if (this.region) {
      await this.regionDetails;
    } else {
      reportToHost({ selection: { selection: null } });
    }
  }

  private textSelected(selection: SelectionCapability): void {
    const selected = rangeKey(selection.getRange());
    if (!selected) {
      return;
    }
    this.annotationOwned = false;
    this.region = undefined;
    this.setRegion(undefined);
    void reportText(selection, this.source).then((text) => {
      // A newer selection's read may have finished first.
      if (rangeKey(selection.getRange()) === selected) {
        this.selectedText = text;
      }
    });
  }

  private textCleared(): void {
    this.selectedText = undefined;
    if (!this.region) {
      reportToHost({ selection: { selection: null } });
    }
  }

  private regionEnded(end: RegionEnd): void {
    if (end.kind === "click") {
      // A click clears a dragged region, as it did without the tool.
      if (this.region && !this.annotationOwned) {
        this.changeRegion(undefined);
      }
      return;
    }
    const page = this.source?.pageNumberOf(end.page);
    if (!this.source || page === undefined) {
      return;
    }
    const region: RegionSelection = { kind: "region", page, rect: end.rect };
    this.annotationOwned = false;
    this.changeRegion(region);
    this.regionDetails = this.readDetails(this.source, region);
  }

  /** Report the region again with its text and snapshot, unless replaced meanwhile. */
  private readDetails(
    source: SelectionSource,
    region: RegionSelection,
  ): Promise<void> {
    return source.readDetails(region.page, region.rect).then(
      ({ text, image }) => {
        if (this.region !== region) {
          return;
        }
        const detailed: RegionSelection = {
          ...region,
          ...(text ? { text } : {}),
        };
        this.region = detailed;
        this.setRegion(detailed);
        reportToHost({
          selection: { selection: detailed, ...(image ? { image } : {}) },
        });
      },
      () => undefined,
    );
  }
}

/**
 * The text selection is drawn by EmbedPDF, not the browser, so answer the
 * copy command (Cmd/Ctrl+C) with the selected text ourselves.
 */
function useCopiedText(state: SelectionTracker): void {
  useEffect(() => {
    const onCopy = (event: ClipboardEvent): void => {
      const text = state.selectedText;
      if (!text || !event.clipboardData || isEditableTarget(event.target)) {
        return;
      }
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [state]);
}

export type SelectionReporting = ReturnType<typeof useSelectionReporting>;

/**
 * Which selection this is: its first and last character. The selection's
 * objects are made again whenever a page's geometry arrives, so they say
 * nothing about whether the selection itself changed.
 */
function rangeKey(range: TextRange | null): string | undefined {
  return range
    ? `${range.start.page.objectNumber}:${range.start.index}-${range.end.page.objectNumber}:${range.end.index}`
    : undefined;
}

/**
 * Read the selected text and its line boxes, report them (on one line), and
 * return the text as Cmd/Ctrl+C copies it (`copiedText`). The engine reads asynchronously, slowly while it renders pages, so
 * a selection cleared or replaced meanwhile is not reported. A PDF that
 * forbids copying has no text to report.
 */
async function reportText(
  selection: SelectionCapability,
  source: SelectionSource | undefined,
): Promise<string | undefined> {
  const selected = rangeKey(selection.getRange());
  if (!selected || !source) {
    return undefined;
  }
  let lines: string;
  try {
    lines = await selection.readText();
  } catch {
    return undefined;
  }
  if (rangeKey(selection.getRange()) !== selected) {
    return undefined;
  }
  const text = lines.replace(/\s+/gu, " ").trim();
  const pages = selection.getSnapshot().pages.flatMap(({ page, segments }) => {
    const number = source.pageNumberOf(page);
    return number === undefined || segments.length === 0
      ? []
      : [{ page: number, rects: segments.map(({ rect }) => toPageRect(rect)) }];
  });
  if (text && pages.length > 0) {
    reportToHost({ selection: { selection: { kind: "text", text, pages } } });
  }
  return text ? copiedText(lines) : undefined;
}

function toPageRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): PageRect {
  return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
}
