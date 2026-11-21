import { useEffect, type RefObject } from "react";
import type { ScrollMode } from "../shared/view-settings";
import { LockedWheel } from "./axis-locked-wheel";
import { scrollsNoteCard } from "./note-card-target";
import { useStageApi, type StageApi } from "./stage-capability";

/**
 * In paged scrolling, hand every wheel to the Stage as a plain pan
 * (`panBy`), as EmbedPDF's own binding did before 3.2.
 *
 * The Stage turns the page when a stream of wheels pushes past the page's
 * edge, and only at an edge the stream began at, so a swipe that begins
 * inside the page reads down to its end and stops there. Through `panBy` a
 * stream is the wheels up to a pause. EmbedPDF 3.2's binding pans through
 * `wheelBy` instead, which also ends a stream wherever the wheel's speed
 * rises to two and a half times the slowest it has gone since it began to
 * slow (`plugin-stage/src/camera/coasting.ts`), to tell a new swipe from the
 * coasting of the last. A swipe's speed wobbles while the fingers speed it
 * up, and a dip early on followed by the rest of the speed-up reads as a new
 * push. When the swipe has reached the end of the page by then, that "new
 * push" begins at the edge, and the same swipe turns the page.
 *
 * A gesture that is nearly straight is locked to its axis
 * (`axis-locked-wheel.ts`): only its movement along it pans the page, so a
 * swipe down that drifts sideways neither slides the page nor reaches the
 * side edge that would turn it.
 *
 * Pinches and Ctrl/Cmd+wheel (zoom) and wheels over a note card are left
 * alone. The listener sits on the viewer around the Stage and takes the
 * events it handles first (capture phase), so the Stage's own wheel handler
 * never sees them.
 */
export function usePagedWheel(
  container: RefObject<HTMLElement | null>,
  mode: ScrollMode,
): void {
  const stage = useStageApi();
  useEffect(() => {
    const element = container.current;
    if (!element || mode !== "paged") {
      return;
    }
    const locked = new LockedWheel();
    const onWheel = (event: WheelEvent): void =>
      panPagedWheel(stage, event, locked);
    element.addEventListener("wheel", onWheel, {
      passive: false,
      capture: true,
    });
    return () =>
      element.removeEventListener("wheel", onWheel, { capture: true });
  }, [container, stage, mode]);
}

function panPagedWheel(
  stage: StageApi,
  event: WheelEvent,
  locked: LockedWheel,
): void {
  if (
    // The browser is already scrolling with this wheel's gesture.
    !event.cancelable ||
    event.ctrlKey ||
    event.metaKey ||
    !(event.target instanceof Element) ||
    !event.target.closest(".viewport") ||
    // A note card sits in the Stage's overlay and scrolls itself.
    scrollsNoteCard(event)
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const { dx, dy } = locked.along(event) ?? wheelDelta(event);
  stage.panBy(-dx, -dy);
}

/** Shift turns a vertical wheel sideways, as the Stage's binding does. */
function wheelDelta(event: WheelEvent): { dx: number; dy: number } {
  return event.shiftKey
    ? { dx: event.deltaY, dy: event.deltaX }
    : { dx: event.deltaX, dy: event.deltaY };
}
