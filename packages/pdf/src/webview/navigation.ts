import {
  useStageState,
  type RevealOptions,
  type ScrollBehaviorKind,
} from "@embedpdf/react/stage";
import { useCallback, useEffect, useRef, useState } from "react";
import { fromViewRect, type PageRect } from "../shared/geometry";
import type { PdfLocation } from "../shared/pdf-location";
import type { ReadingPosition } from "../shared/reading-position";
import type { ScrollMode } from "../shared/view-settings";
import { nativeZoom } from "./reading-position";
import { NavigationIntent } from "../shared/navigation-intent";
import { useStageApi, type StageApi } from "./stage-capability";

/** A box flashed on a page after opening a location. */
export interface Highlight {
  page: number;
  rect: PageRect;
  /** Changes on every request, so the same box can flash again. */
  key: number;
}

/** Where a requested box lands, in percent of the viewport height. */
const BOX_POSITION_PERCENT = 20;

/**
 * The viewer's own top-left corner. A bare `start` alignment leaves the
 * Stage's `padding` between the corner and the point, so a place revealed
 * there would sit `padding` further in than the saved offsets and links say;
 * the Stage reads a fraction as that fraction of the whole viewer.
 */
const CORNER = { x: 0, y: 0 } as const;

/** A point on a page, as the zero-sized box `reveal` takes. */
function pointOn(
  left: number,
  top: number,
): NonNullable<RevealOptions["rect"]> {
  return { x: left, y: top, width: 0, height: 0 };
}

/**
 * Where the reader is (current page) and how to move: to a page, to a
 * location with a box, or one page forward/back.
 *
 * The Stage queues a move requested before its first layout and applies it in
 * that layout, so a location opened together with the PDF needs no waiting.
 */
export function useNavigation(scrollMode: ScrollMode, smooth: boolean) {
  const intent = useRef(new NavigationIntent()).current;
  const stage = useStageApi();
  // Renders again when the page or the zoom changes: the status reads the Stage.
  const { pageCount } = useStageState();
  const behavior: ScrollBehaviorKind =
    smooth && scrollMode === "continuous" ? "smooth" : "instant";
  const [highlight, setHighlight] = useState<Highlight>();
  const show = useCallback(
    (location: PdfLocation, top?: number, left = 0, instant = false): void => {
      const page = Math.min(Math.max(1, location.page), stage.getPageCount());
      const target = { location, page, top, left };
      moveTo(stage, target, instant ? "instant" : behavior);
      if (location.viewRect) {
        const rect = fromViewRect(location.viewRect);
        setHighlight({ page, rect, key: Date.now() });
      }
    },
    [stage, behavior],
  );
  useNavigationInterrupts(intent);
  const restore = useCallback(
    (position: ReadingPosition): void => {
      intent.advance();
      restoreView(stage, position);
    },
    [intent, stage],
  );
  return {
    intent,
    isReady: () => stage.listVisiblePages().length > 0,
    ...pageStatus(stage, pageCount),
    highlight,
    show,
    restore,
    reveal: (page: number, rect: PageRect, _deliberate = true): void =>
      revealBox(stage, page, rect, behavior),
    goToPage: (page: number, top?: number) => show({ page }, top),
    step: (delta: 1 | -1, keepPlace = false): void =>
      stepPage(stage, { delta, keepPlace, behavior }),
  };
}

/** The page shown, and whether there are pages (or spreads) before and after it. */
function pageStatus(stage: StageApi, pageCount: number) {
  // The page the reader went to, not the first of its spread: going to page
  // 4 in a spread of 3 and 4 shows 4.
  return {
    currentPage: stage.getCurrentPageIndex() + 1,
    pageCount,
    canGoBack: stage.canGoPrevious(),
    canGoForward: stage.canGoNext(),
  };
}

/**
 * Take a location to the Stage: its box near the top of the viewer, the page
 * from `top` points below its top (where a link or outline entry points), or
 * the page itself.
 */
function moveTo(
  api: StageApi,
  target: {
    location: PdfLocation;
    page: number;
    top: number | undefined;
    left: number;
  },
  behavior: ScrollBehaviorKind,
): void {
  const { page, top, left } = target;
  const box = target.location.viewRect;
  if (box) {
    api.reveal(page - 1, {
      rect: pointOn(box.left, box.top),
      align: { x: "start", y: BOX_POSITION_PERCENT / 100 },
      zoom: "keep",
      behavior,
    });
  } else if (top !== undefined || left !== 0) {
    api.reveal(page - 1, {
      rect: pointOn(left, top ?? 0),
      align: CORNER,
      zoom: "keep",
      behavior,
    });
  } else {
    api.goToPage(page - 1, { behavior });
  }
}

/**
 * Put a saved reading position back: the page and the point of it at the
 * corner, at the saved zoom. A number zoom goes in the same move; a fit mode
 * is switched to first, once the Stage has laid out (before that it is the
 * mode the Stage was registered with).
 */
function restoreView(api: StageApi, position: ReadingPosition): void {
  const zoom = nativeZoom(position.zoom);
  const laidOut = api.listVisiblePages().length > 0;
  if ("mode" in zoom && laidOut && api.getZoomMode() !== zoom.mode) {
    api.zoomTo(zoom);
  }
  api.reveal(Math.min(Math.max(1, position.page), api.getPageCount()) - 1, {
    rect: pointOn(position.left, position.top),
    align: CORNER,
    zoom: "level" in zoom ? { level: zoom.level } : "keep",
    behavior: "instant",
  });
}

/** Scroll a box (a search match) to the middle of the viewer, without flashing it. */
function revealBox(
  stage: StageApi,
  page: number,
  [left, top, right, bottom]: PageRect,
  behavior: ScrollBehaviorKind,
): void {
  stage.reveal(page - 1, {
    rect: { x: left, y: top, width: right - left, height: bottom - top },
    align: { x: "center", y: "center" },
    zoom: "keep",
    behavior,
  });
}

/**
 * One page (or spread) forward or back; with `keepPlace`, at the same place
 * in it: the point of the page at the viewer's corner is revealed at the
 * corner of the page turned to, at the same zoom.
 */
function stepPage(
  stage: StageApi,
  move: { delta: 1 | -1; keepPlace: boolean; behavior: ScrollBehaviorKind },
): void {
  const { delta, keepPlace, behavior } = move;
  if (!(delta > 0 ? stage.canGoNext() : stage.canGoPrevious())) {
    return;
  }
  const here = keepPlace ? stage.getCurrentDestination() : null;
  // Keeping the place moves the camera once, to the place: a turn that
  // animates first would then be cut short by the reveal.
  const how: ScrollBehaviorKind = keepPlace ? "instant" : behavior;
  if (delta > 0) {
    stage.nextPage({ behavior: how });
  } else {
    stage.previousPage({ behavior: how });
  }
  if (here?.kind === "xyz" && (here.x || here.y)) {
    stage.reveal(stage.getCurrentPageIndex(), {
      rect: pointOn(here.x ?? 0, here.y ?? 0),
      align: { x: "start", y: "start" },
      zoom: "keep",
      behavior: "instant",
    });
  }
}

/** Keys that move the reader through the PDF; other keys do not interrupt. */
const NAVIGATION_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Escape",
];

/** Elements whose keys belong to them, not to reading. */
const OWN_KEYS =
  'input, textarea, select, [contenteditable], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [role="combobox"], .view-menu, .side-panel';

const INTERRUPTING_EVENTS = ["wheel", "pointerdown", "touchstart", "keydown"];

/**
 * The reader's own input ends whatever navigation is in flight: reading
 * input (scrolling the pages, arrow keys) interrupts it as reader movement,
 * anything else (the toolbar, the search field) just supersedes it.
 */
function useNavigationInterrupts(intent: NavigationIntent): void {
  useEffect(() => {
    const interrupt = (event: Event): void => {
      if (
        event instanceof KeyboardEvent &&
        !NAVIGATION_KEYS.includes(event.key)
      ) {
        return;
      }
      if (isReadingInput(event)) {
        intent.interrupt();
      } else {
        intent.advance();
      }
    };
    for (const name of INTERRUPTING_EVENTS) {
      document.addEventListener(name, interrupt, {
        capture: true,
        passive: true,
      });
    }
    return () => {
      intent.advance();
      for (const name of INTERRUPTING_EVENTS) {
        document.removeEventListener(name, interrupt, true);
      }
    };
  }, [intent]);
}

function isReadingInput(event: Event): boolean {
  const target = event.target instanceof Element ? event.target : undefined;
  if (!(event instanceof KeyboardEvent)) {
    return Boolean(target?.closest(".viewport"));
  }
  const modified =
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  return event.key !== "Escape" && !modified && !target?.closest(OWN_KEYS);
}

export type Navigation = ReturnType<typeof useNavigation>;
