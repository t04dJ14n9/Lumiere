import {
  positionFromView,
  type ReadingPosition,
} from "../../shared/reading-position";
import type { ViewState } from "../../shared/view-state";

/** How long the view stays still before its place is kept. */
const SAVE_DELAY_MS = 2000;

/**
 * Where one editor is reading, and keeping it: once reading stops for a
 * moment, and when the editor closes. Not only on close: a window that
 * crashes or is killed never closes its editors.
 */
export class PanelPosition {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    /** Where the PDF opens: the saved place, if any. */
    public current: ReadingPosition | undefined,
    private readonly save: (position: ReadingPosition) => void,
    private readonly delayMs = SAVE_DELAY_MS,
  ) {}

  /** The viewer reported its view. */
  viewed(view: ViewState): void {
    this.current = positionFromView(view);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), this.delayMs);
  }

  /** The editor closes: keep the place now. */
  dispose(): void {
    clearTimeout(this.timer);
    this.saveNow();
  }

  private saveNow(): void {
    if (this.current) {
      this.save(this.current);
    }
  }
}
