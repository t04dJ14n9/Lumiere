import { EditorView } from "@codemirror/view";
import type { StateEffect } from "@codemirror/state";

/**
 * Height of the sticky-heading pin overlay inside the editor, if visible.
 * Same DOM query sticky pin clicks use; do not import stickyScroll internals.
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
 * single correction with the updated height; never loop. A newer navigate
 * invalidates this correction via `isCurrent`.
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
  schedule(() => {
    if (!isCurrent()) {
      return;
    }
    correctScrollForStickyGrowth(initialHeight, measure, (yMargin) => {
      view.dispatch({
        effects: EditorView.scrollIntoView(position, {
          y: "start",
          yMargin,
        }),
      });
    });
  });
}

/**
 * Jump a navigation target to the top of the viewport, then correct once for
 * sticky chrome that appears after paint. Do not apply sticky height on the
 * first scroll: leftover pin height from the previous position skews
 * start-of-note clamps.
 */
export function scrollTargetToTop(
  view: EditorView,
  target: { from: number; to: number; selectTo?: number },
  extras: readonly StateEffect<unknown>[],
  isCurrent: () => boolean,
): void {
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
  scheduleStickyScrollCorrection(view, target.from, 0, { isCurrent });
}
