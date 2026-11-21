import type { Range } from "./image-anchor";

/**
 * Bounds on a second press counted as a double-click, beyond the browser's
 * own count (`detail`, from the platform's interval and distance): stale or
 * distant presses never open the inspector, whatever the platform says.
 */
const MAX_INTERVAL_MS = 800;
const MAX_DISTANCE_PX = 12;

interface Press {
  range: Range;
  x: number;
  y: number;
  time: number;
}

type PressEvent = Pick<
  MouseEvent,
  | "detail"
  | "button"
  | "clientX"
  | "clientY"
  | "timeStamp"
  | "target"
  | "shiftKey"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
>;

/** What a double press needs from the editor. */
export interface DoublePressEditor {
  /** The image embed selected now. */
  selected(): Range | null;
  /** Whether `target` is a drawing of the image of `range`. */
  isImageOf(target: EventTarget | null, range: Range): boolean;
  /** Opens the selected image's inspector; false when it has none. */
  inspect(): boolean;
}

/**
 * A double-click on an image opens its inspector, even when the image moved
 * between the two presses. The first press selects the image, so its
 * source shows once that press ends: an image in a line of text then moves
 * along its line by the source's width, and the second press lands on the
 * source instead (the browser's own `dblclick` goes to the text). A second
 * press of a double-click, close in time and place to a press that
 * selected an image still selected, opens that image's inspector. One that
 * lands on the image itself is left to the image's own `dblclick`.
 */
export class ImageDoublePress {
  private last: Press | undefined;

  constructor(private readonly editor: DoublePressEditor) {}

  /** Remembers a press that selected the image of `range`. */
  selected(event: PressEvent, range: Range): void {
    this.last = {
      range,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    };
  }

  /**
   * Whether `event` is such a second press, and opened the inspector; the
   * caller then keeps the press from the editor (it would select a word).
   */
  opensInspector(event: PressEvent): boolean {
    const last = this.last;
    this.last = undefined;
    if (!last || !isSecondPress(event, last)) {
      return false;
    }
    const selected = this.editor.selected();
    if (
      selected?.from !== last.range.from ||
      selected.to !== last.range.to ||
      this.editor.isImageOf(event.target, last.range)
    ) {
      return false;
    }
    return this.editor.inspect();
  }
}

function isSecondPress(event: PressEvent, last: Press): boolean {
  return (
    event.detail === 2 &&
    event.button === 0 &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    event.timeStamp - last.time <= MAX_INTERVAL_MS &&
    Math.hypot(event.clientX - last.x, event.clientY - last.y) <=
      MAX_DISTANCE_PX
  );
}
