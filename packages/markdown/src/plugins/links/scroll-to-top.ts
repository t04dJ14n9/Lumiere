import { EditorView } from "@codemirror/view";
import type { StateEffect } from "@codemirror/state";
import type { ScrollHold } from "../editor/api";

/** CodeMirror's default margin between a line scrolled to the top and the edge. */
const DEFAULT_Y_MARGIN = 5;

/**
 * How many times to look for the sticky bar while a jump is held: a jump can
 * arrive before the feature that draws the bar has loaded, and the bar then
 * appears a few hundred ms later, over the line just jumped to. Each look is
 * two frames on, so this is about a second and a half, the time a held line
 * takes to settle.
 */
const STICKY_WAIT_ATTEMPTS = 45;

/** How often the held line moves for the bar, so a bar that flips cannot loop. */
const MAX_STICKY_CORRECTIONS = 3;

/**
 * Height of the sticky-heading pin overlay inside the editor, if visible.
 * Same `.mw-sticky-scroll` selector the sticky overlay uses; do not import stickyScroll internals.
 */
export function stickyChromeHeight(root: ParentNode): number {
  const sticky = root.querySelector(".mw-sticky-scroll");
  if (!sticky) {
    return 0;
  }
  // Match sticky pin clicks: visible HTMLElement height only.
  if (typeof HTMLElement !== "undefined" && !(sticky instanceof HTMLElement)) {
    return 0;
  }
  const el = sticky as HTMLElement;
  if (el.hidden) {
    return 0;
  }
  return el.getBoundingClientRect().height;
}

/**
 * Re-scroll once when sticky height after paint differs from the first jump's
 * yMargin (empty → pin, pin grew/shrank, or pin cleared). Unchanged → skip.
 */
export function correctScrollForStickyGrowth(
  initialHeight: number,
  measure: () => number,
  rescroll: (yMargin: number) => void,
): void {
  const next = measure();
  if (next !== initialHeight) {
    rescroll(next);
  }
}

export type StickyScrollCorrectionOptions = {
  measure?: () => number;
  /** Defaults to double requestAnimationFrame (after sticky paints). */
  schedule?: (run: () => void) => void;
  /** Skip the correction when a newer jump has already started. */
  isCurrent?: () => boolean;
  /** Scroll to the position below the pins. Defaults to a plain scroll. */
  rescroll?: (yMargin: number) => void;
  /**
   * While it returns true, look again (up to `STICKY_WAIT_ATTEMPTS` looks, and
   * `MAX_STICKY_CORRECTIONS` corrections) for the bar to differ from what the
   * jump last assumed. It returns false once nothing is left to protect, such
   * as when the reader has taken over the scroll. Without it the bar is
   * looked for once.
   */
  keepWaiting?: () => boolean;
};

function defaultSchedule(run: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    queueMicrotask(() => queueMicrotask(run));
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

/**
 * Sticky often updates after the first scroll (empty → parent pin). Schedule a
 * single correction with the updated height. A newer navigate invalidates this
 * correction via `isCurrent`. The bar can also appear, or change height, after
 * the first look, when its feature loads or its line height settles late: with
 * `keepWaiting` the look repeats, bounded, and corrects when the height
 * differs from what the jump last assumed.
 */
export function scheduleStickyScrollCorrection(
  view: EditorView,
  position: number,
  initialHeight: number,
  options: StickyScrollCorrectionOptions = {},
): void {
  const measure = options.measure ?? (() => stickyChromeHeight(view.dom));
  const schedule = options.schedule ?? defaultSchedule;
  const isCurrent = options.isCurrent ?? (() => true);
  const rescroll =
    options.rescroll ??
    ((yMargin: number) => {
      view.dispatch({
        effects: EditorView.scrollIntoView(position, {
          y: "start",
          yMargin,
        }),
      });
    });
  const keepWaiting = options.keepWaiting ?? (() => false);
  let assumed = initialHeight;
  let corrections = 0;
  const look = (remaining: number): void => {
    schedule(() => {
      if (!isCurrent()) {
        return;
      }
      correctScrollForStickyGrowth(assumed, measure, (yMargin) => {
        assumed = yMargin;
        corrections++;
        rescroll(yMargin);
      });
      if (
        remaining > 0 &&
        corrections < MAX_STICKY_CORRECTIONS &&
        keepWaiting()
      ) {
        look(remaining - 1);
      }
    });
  };
  look(STICKY_WAIT_ATTEMPTS);
}

export type ScrollToTopOptions = {
  /** Skip the sticky correction when a newer jump has already started. */
  isCurrent: () => boolean;
  /**
   * Holds the line at the top while the layout settles, when the editor can
   * (`EditorService.holdAtTop`). Without it the jump is CodeMirror's alone.
   */
  holdAtTop?: (position: number, yMargin: number) => ScrollHold;
};

/**
 * Jump a navigation target to the top of the viewport, then correct once for
 * sticky chrome that appears after paint. Do not apply sticky height on the
 * first scroll: leftover pin height from the previous position skews
 * start-of-note clamps.
 *
 * Features loaded after the jump (line numbers, tables, callouts, the sticky
 * bar itself) change the heights above the target, so with `holdAtTop` the
 * target is held at the top until the layout has settled, and the sticky
 * correction moves that hold: a plain re-scroll would end it.
 */
export function scrollTargetToTop(
  view: EditorView,
  target: { from: number; to: number; selectTo?: number },
  extras: readonly StateEffect<unknown>[],
  options: ScrollToTopOptions,
): void {
  const hold = options.holdAtTop?.(target.from, DEFAULT_Y_MARGIN);
  view.dispatch({
    selection: {
      anchor: target.from,
      head: target.selectTo ?? target.from,
    },
    effects: [
      ...extras,
      EditorView.scrollIntoView(target.from, { y: "start" }),
    ],
  });
  scheduleStickyScrollCorrection(view, target.from, 0, {
    isCurrent: options.isCurrent,
    ...(hold
      ? {
          rescroll: (yMargin: number) => {
            hold.move(yMargin);
          },
          keepWaiting: () => hold.isHeld(),
        }
      : {}),
  });
}
