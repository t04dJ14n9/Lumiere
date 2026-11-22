import { EditorView } from "@codemirror/view";
import type { StateEffect } from "@codemirror/state";
import type { ScrollHold } from "../editor/api";

/** CodeMirror's default margin between a line scrolled to the top and the edge. */
const DEFAULT_Y_MARGIN = 5;

/**
 * How many times to look for the sticky bar while a jump is held: a jump can
 * arrive before the feature that draws the bar has loaded, and the bar then
 * appears a few hundred ms later, over the line just jumped to. Each look
 * after the first is two frames on, so this is about a second and a half, the
 * time a held line takes to settle.
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
  /**
   * Runs each look. Defaults to the frame the jump scrolls in for the first
   * (`nextFrame`), and to double requestAnimationFrame (after sticky paints)
   * for the ones after it.
   */
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

/**
 * The first look: in the frame the jump scrolls in, after CodeMirror's
 * measuring (it asked for that frame when the jump was dispatched, before
 * this was asked), which has made the scroll and drawn the sticky bar for it,
 * and still before that frame is painted. A correction made then is the only
 * position the jump is ever painted at; made two frames on, the line would
 * be painted under the bar for those frames.
 */
function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    queueMicrotask(run);
    return;
  }
  requestAnimationFrame(run);
}

function defaultSchedule(run: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    queueMicrotask(() => queueMicrotask(run));
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

/** The margin a jump holds its line at, and the corrections made to it. */
class MarginCorrection {
  corrections = 0;
  /** Set when a correction would only undo the one before it. */
  isSettled = false;
  private previous: number | undefined;

  constructor(
    public assumed: number,
    private readonly rescroll: (yMargin: number) => void,
  ) {}

  correct(yMargin: number): void {
    let margin = yMargin;
    if (margin === this.previous) {
      this.isSettled = true;
      margin = Math.max(margin, this.assumed);
      if (margin === this.assumed) {
        return;
      }
    }
    this.previous = this.assumed;
    this.assumed = margin;
    this.corrections++;
    this.rescroll(margin);
  }
}

/**
 * Sticky often updates after the first scroll (empty → parent pin). Look for
 * it in the frame of the jump and correct with the updated height. A newer
 * navigate invalidates this correction via `isCurrent`. The bar can also
 * appear, or change height, after the first look, when its feature loads or
 * its line height settles late: with `keepWaiting` the look repeats, bounded,
 * and corrects when the height differs from what the jump last assumed.
 *
 * `initialHeight` is what the jump reserved above the line, and the line is
 * never moved above that. A bar shorter than it is the parent heading still
 * on screen, near the start of the note, and so not pinned: taking the room
 * back scrolls the parent away, which brings the bar over the line, and
 * putting it back brings the parent again, for ever. A correction that would
 * only undo the one before it ends the looking for the same reason, keeping
 * the taller margin, under which the line is never covered.
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
  const margin = new MarginCorrection(initialHeight, rescroll);
  const look = (
    remaining: number,
    scheduleLook: (run: () => void) => void,
  ): void => {
    scheduleLook(() => {
      if (!isCurrent()) {
        return;
      }
      correctScrollForStickyGrowth(
        margin.assumed,
        () => Math.max(initialHeight, measure()),
        (yMargin) => margin.correct(yMargin),
      );
      if (
        !margin.isSettled &&
        remaining > 0 &&
        margin.corrections < MAX_STICKY_CORRECTIONS &&
        keepWaiting()
      ) {
        look(remaining - 1, schedule);
      }
    });
  };
  look(STICKY_WAIT_ATTEMPTS, options.schedule ?? nextFrame);
}

export type ScrollToTopOptions = {
  /** Skip the sticky correction when a newer jump has already started. */
  isCurrent: () => boolean;
  /**
   * How tall the sticky bar will be once the line at `position` is the first
   * below it (`pinnedChromeHeight`). The first scroll leaves that much room
   * above the target, so the bar it draws has the rows it keeps, and the
   * correction has at most a few pixels to move. Defaults to no bar.
   */
  pinnedHeight?: (position: number) => number;
  /**
   * Holds the line at the top while the layout settles, when the editor can
   * (`EditorService.holdAtTop`). Without it the jump is CodeMirror's alone.
   */
  holdAtTop?: (position: number, yMargin: number) => ScrollHold;
};

/**
 * Jump a navigation target to the top of the viewport, below the sticky bar
 * it will have. The first scroll takes the bar's height from the target
 * (`pinnedHeight`: the ancestors it pins), never from the bar on screen: that
 * one belongs to the previous position, and its height skews start-of-note
 * clamps. Then correct for sticky chrome that differs from that, in the frame
 * of the jump and so before anything is painted: a row height that
 * CodeMirror re-measures with the jump, a bar that is not there yet (its
 * feature loads late), a jump that clamps at an end of the note.
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
  const stickyHeight = options.pinnedHeight?.(target.from) ?? 0;
  const yMargin = stickyHeight > 0 ? stickyHeight : DEFAULT_Y_MARGIN;
  const hold = options.holdAtTop?.(target.from, yMargin);
  view.dispatch({
    selection: {
      anchor: target.from,
      head: target.selectTo ?? target.from,
    },
    effects: [
      ...extras,
      EditorView.scrollIntoView(target.from, { y: "start", yMargin }),
    ],
  });
  scheduleStickyScrollCorrection(view, target.from, stickyHeight, {
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
