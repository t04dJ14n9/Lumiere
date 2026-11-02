import { Prec } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { EdgeScroll, visibleBounds } from "../../webview/ui/edge-scroll";
import { editorSettings } from "./settings";

/**
 * How long the extra motion takes to reach full speed after the pointer
 * enters the trigger zone. Selecting on the last visible line puts the
 * pointer in the zone for a moment; full speed at once moved the note under
 * it (a jump of several pixels away from any edge the reader meant).
 */
export const EXTRA_SPEED_RAMP_MS = 250;

/** CodeMirror's trigger zone at the scroller's top and bottom edges (px). */
const DRAG_SCROLL_MARGIN = 6;

/**
 * How close to an edge the last move must be to count as leaving through it:
 * a quick hand moves 25 to 50 px between two events, never hundreds.
 */
export const EXIT_REACH_PX = 64;

/** How long the pointer may be silent before it counts as gone past an edge. */
export const EXIT_SILENCE_MS = 80;

/**
 * How far past the edge a pointer gone out of the window is treated as being:
 * CodeMirror scrolls faster the further out the pointer is.
 */
export const EXIT_OVERSHOOT_PX = 16;

/** A pointer sample: where it was, when, and how fast it moved down (px/ms). */
export interface PointerSample {
  x: number;
  y: number;
  time: number;
  velocityY: number;
}

/**
 * Which edge a pointer that has fallen silent most likely left through.
 *
 * In VS Code the note is a webview: once the pointer leaves it during a drag,
 * the page receives no events at all, not even the mouseup. CodeMirror's edge
 * scrolling needs to see the pointer past the edge, so a drag carried out of
 * the note did not scroll unless its last event happened to land in the 6 px
 * zone. A pointer still moving sends an event every frame; one that was
 * near an edge and heading for it fast enough to cross it within
 * `EXIT_SILENCE_MS`, and then goes silent, has crossed it.
 */
export function exitedEdge(
  last: PointerSample,
  bounds: { top: number; bottom: number },
): "top" | "bottom" | undefined {
  const reach = last.velocityY * EXIT_SILENCE_MS;
  if (reach > 0 && couldLeave(bounds.bottom - last.y, reach)) {
    return "bottom";
  }
  if (reach < 0 && couldLeave(last.y - bounds.top, -reach)) {
    return "top";
  }
  return undefined;
}

/**
 * Whether a pointer `distance` px from an edge, heading for it with `reach`
 * px to go, left: near the edge, but not in CodeMirror's own zone, where
 * CodeMirror already scrolls by itself (and keeps doing so if it left).
 */
function couldLeave(distance: number, reach: number): boolean {
  return (
    distance > DRAG_SCROLL_MARGIN &&
    distance <= EXIT_REACH_PX &&
    reach >= distance
  );
}

/** The share of the extra speed after `dwell` ms in the trigger zone. */
export function extraSpeedRamp(dwell: number): number {
  return Math.min(1, Math.max(0, dwell) / EXTRA_SPEED_RAMP_MS);
}

/**
 * Extra velocity in px/ms above CodeMirror's built-in selection scrolling.
 * Match its 6 px trigger zone and (8 + 0.7 * overshoot) px per 50 ms curve,
 * so a multiplier of 1 needs no extra motion and deeper drags still accelerate.
 */
export function additionalDragVelocity(
  position: number,
  from: number,
  to: number,
  speed: number,
): number {
  if (to <= from) {
    return 0;
  }
  if (position <= from + DRAG_SCROLL_MARGIN) {
    return (-(8 + 0.7 * Math.max(0, from - position)) / 50) * (speed - 1);
  }
  if (position >= to - DRAG_SCROLL_MARGIN) {
    return ((8 + 0.7 * Math.max(0, position - to)) / 50) * (speed - 1);
  }
  return 0;
}

/** Adds scroll motion while CodeMirror retains ownership of the mouse selection. */
export class SelectionDragScroll {
  private events?: AbortController;
  private scrolling?: EdgeScroll;
  private last?: PointerSample;
  /** When the pointer entered the trigger zone; undefined outside it. */
  private zoneSince?: number;
  private silence?: ReturnType<typeof setTimeout>;
  /** The move this class sent for a pointer gone past an edge. */
  private synthetic?: MouseEvent;

  constructor(
    private readonly view: EditorView,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(event: MouseEvent): void {
    this.stop();
    if (event.button !== 0) {
      return;
    }
    const { view } = this;
    this.events = new AbortController();
    // CodeMirror's own 50 ms scroll timer still extends the selection from
    // its last mouse event, even when the pointer stops moving. Supplement
    // scrolling only: replacing its selection logic loses word/line drags,
    // Shift/Mod selections and atomic-range handling.
    this.scrolling = new EdgeScroll(view.scrollDOM, view.contentDOM, () => {}, {
      velocity: (position, from, to) =>
        additionalDragVelocity(
          position,
          from,
          to,
          view.state.facet(editorSettings).dragScrollSpeed,
        ) *
        extraSpeedRamp(
          this.zoneSince === undefined ? 0 : this.now() - this.zoneSince,
        ),
    });
    this.registerGestureEvents(this.events.signal);
  }

  /** Track the pointer: how fast it moves, and whether it is in the zone. */
  private onMove(event: MouseEvent): void {
    if (event === this.synthetic) {
      return;
    }
    const time = this.now();
    const previous = this.last;
    const elapsed = previous ? Math.max(1, time - previous.time) : 0;
    this.last = {
      x: event.clientX,
      y: event.clientY,
      time,
      velocityY: previous ? (event.clientY - previous.y) / elapsed : 0,
    };
    const { top, bottom } = visibleBounds(this.view.scrollDOM);
    const inZone =
      event.clientY <= top + DRAG_SCROLL_MARGIN ||
      event.clientY >= bottom - DRAG_SCROLL_MARGIN;
    if (!inZone) {
      delete this.zoneSince;
    } else if (this.zoneSince === undefined) {
      this.zoneSince = time;
    }
    clearTimeout(this.silence);
    this.silence = setTimeout(() => this.onSilence(), EXIT_SILENCE_MS);
  }

  /**
   * The pointer went quiet. If it was heading out of the note, carry on as if
   * CodeMirror could see it just past that edge: its own timer then scrolls
   * and extends the selection, and the extra motion runs at full speed.
   */
  private onSilence(): void {
    const last = this.last;
    if (!last || !this.events) {
      return;
    }
    const bounds = visibleBounds(this.view.scrollDOM);
    const edge = exitedEdge(last, bounds);
    if (!edge) {
      return;
    }
    const y =
      edge === "bottom"
        ? bounds.bottom + EXIT_OVERSHOOT_PX
        : bounds.top - EXIT_OVERSHOOT_PX;
    this.zoneSince = this.now() - EXTRA_SPEED_RAMP_MS;
    this.synthetic = new MouseEvent("mousemove", {
      clientX: last.x,
      clientY: y,
      buttons: 1,
      bubbles: true,
    });
    this.scrolling?.move({ x: last.x, y });
    this.view.dom.ownerDocument.dispatchEvent(this.synthetic);
  }

  private registerGestureEvents(signal: AbortSignal): void {
    const doc = this.view.dom.ownerDocument;
    doc.addEventListener(
      "mousemove",
      (event) => {
        // Match CodeMirror's cancellation on a released button; otherwise its
        // selection timer could end while our scroller keeps moving the note.
        if ((event.buttons & 1) === 0) {
          this.stop();
          return;
        }
        this.onMove(event);
        this.scrolling?.move({ x: event.clientX, y: event.clientY });
      },
      { signal },
    );
    const stop = (): void => this.stop();
    for (const target of [doc, doc.defaultView]) {
      for (const type of ["mouseup", "pointerup", "pointercancel"]) {
        target?.addEventListener(type, stop, { capture: true, signal });
      }
    }
    doc.defaultView?.addEventListener("blur", stop, { signal });
    // Moving selected text uses native drag-and-drop, not selection extension.
    doc.addEventListener("dragstart", stop, { capture: true, signal });
  }

  update(update: ViewUpdate): void {
    if (update.transactions.some((tr) => tr.isUserEvent("input.type"))) {
      this.stop();
    }
  }

  private stop(): void {
    clearTimeout(this.silence);
    delete this.last;
    delete this.zoneSince;
    delete this.synthetic;
    this.events?.abort();
    delete this.events;
    this.scrolling?.destroy();
    delete this.scrolling;
  }

  destroy(): void {
    this.stop();
  }
}

const scrolling = ViewPlugin.define((view) => new SelectionDragScroll(view));

export const selectionDragScroll = [
  scrolling,
  Prec.highest(
    EditorView.mouseSelectionStyle.of((view, event) => {
      view.plugin(scrolling)?.start(event);
      // Observe only gestures CodeMirror accepts, including custom styles;
      // returning null lets it choose the normal selection style.
      return null;
    }),
  ),
];
