import { useEffect, useState, type RefObject } from "react";
import {
  WheelGesture,
  wheelPixels,
  wheelTarget,
} from "../shared/smooth-motion";
import {
  resolveSmoothScrolling,
  type ScrollDirection,
  type ScrollMode,
} from "../shared/view-settings";
import { LockedWheel } from "./axis-locked-wheel";
import { scrollsNoteCard } from "./note-card-target";
import { useStageApi, type StageApi } from "./stage-capability";

export function useSmoothMotion(enabled: boolean | null): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = (): void => setReduced(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  return resolveSmoothScrolling(enabled, false, reduced);
}

/**
 * Animate discrete wheels only, and turn them sideways in horizontal reading
 * (or with Shift). The Stage scrolls pixel input (a trackpad) as it comes,
 * so that is left to it, except that a gesture that is nearly straight is
 * locked to its axis (`axis-locked-wheel.ts`): the Stage is given only its
 * movement along it. Paged scrolling has its own wheel (`paged-wheel.ts`).
 *
 * The listener sits on the viewer around the Stage and takes the events it
 * handles first (capture phase), so the Stage's own wheel handler never sees
 * them.
 */
export function useSmoothWheel(
  container: RefObject<HTMLElement | null>,
  smooth: boolean,
  direction: ScrollDirection,
  mode: ScrollMode,
): void {
  const stage = useStageApi();
  useEffect(() => {
    const element = container.current;
    if (!element || mode === "paged") {
      return;
    }
    const wheel = new SmoothWheel(stage, { smooth, direction });
    element.addEventListener("wheel", wheel.onWheel, {
      passive: false,
      capture: true,
    });
    for (const type of INTERRUPTING_INPUT) {
      element.addEventListener(type, wheel.interrupt, { capture: true });
    }
    const stopListening = stage.onMotionEnded(wheel.settled);
    return () => {
      wheel.interrupt();
      stopListening();
      element.removeEventListener("wheel", wheel.onWheel, { capture: true });
      for (const type of INTERRUPTING_INPUT) {
        element.removeEventListener(type, wheel.interrupt, { capture: true });
      }
    };
  }, [container, stage, smooth, direction, mode]);
}

/** Input that stops a wheel animation where it is. */
const INTERRUPTING_INPUT = ["pointerdown", "touchstart", "keydown"];

/** A mouse wheel's notches over one Stage, animated or stepped. */
class SmoothWheel {
  private readonly gesture = new WheelGesture();
  private readonly locked = new LockedWheel();
  /** Where the animation in progress is headed, along `horizontal`'s axis. */
  private target = 0;
  private horizontal = false;
  private animating = false;

  constructor(
    private readonly stage: StageApi,
    private readonly options: { smooth: boolean; direction: ScrollDirection },
  ) {}

  /** The Stage's animation ended where it was going. */
  readonly settled = (): void => {
    this.animating = false;
  };

  /** Stop an animation of this wheel's where it is. */
  readonly interrupt = (): void => {
    if (this.animating) {
      this.animating = false;
      this.stage.stopMotion();
    }
  };

  readonly onWheel = (event: WheelEvent): void => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest(".viewport") ||
      // A note card sits in the Stage's overlay and scrolls itself.
      scrollsNoteCard(event)
    ) {
      return;
    }
    const { smooth, direction } = this.options;
    const horizontal = event.shiftKey || direction === "horizontal";
    const discrete =
      this.gesture.discrete(event, event.timeStamp) &&
      !event.ctrlKey &&
      !event.metaKey;
    if (!discrete || (!smooth && !horizontal)) {
      this.animating = false;
      this.panLocked(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.step(event, horizontal);
  };

  /**
   * Pan by only the part of a pixel wheel along its locked axis, as the
   * Stage's own handler would pan by all of it, and keep the event from it.
   */
  private panLocked(event: WheelEvent): void {
    const kept = this.locked.along(event);
    if (
      kept === null ||
      !event.cancelable ||
      !this.stage.wheelBy(-kept.dx, -kept.dy, event.timeStamp)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** Move one notch further along the axis, adding to a move in progress. */
  private step(event: WheelEvent, horizontal: boolean): void {
    const { stage } = this;
    const view = stage.getScrollMetrics();
    const from = horizontal ? view.scrollLeft : view.scrollTop;
    const room = horizontal
      ? view.scrollWidth - view.clientWidth
      : view.scrollHeight - view.clientHeight;
    const continuing =
      this.animating && this.horizontal === horizontal && stage.isMoving();
    this.horizontal = horizontal;
    this.target = wheelTarget(
      from,
      continuing ? this.target : from,
      wheelPixels(
        event.deltaY,
        event.deltaMode,
        horizontal ? view.clientWidth : view.clientHeight,
      ),
      { min: 0, max: Math.max(0, room) },
    );
    const behavior = this.options.smooth ? "smooth" : "instant";
    this.animating = this.options.smooth;
    stage.scrollTo(
      horizontal
        ? { left: this.target, behavior }
        : { top: this.target, behavior },
    );
  }
}
