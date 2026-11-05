/**
 * How long after a click on an outline row the jump it made is left alone:
 * long enough for a double-click's second click and the editor's reply.
 */
export const OUTLINE_JUMP_MS = 1000;

/** A heading a click in the outline opened, and whether the caret got there. */
interface OutlineJump {
  id: string;
  until: number;
  landed: boolean;
}

/**
 * The time after a click on an outline row while the view leaves the tree
 * alone: the row is already selected, and the accordion's collapse would
 * move rows under the pointer, so the second click of a double-click landed
 * on another heading (and jumped there). `Report` is a scroll report held
 * back meanwhile.
 */
export class OutlineJumpWindow<Report> {
  private jump: OutlineJump | undefined;
  private held: Report | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** `release` gets the last report held back once the window closes. */
  constructor(private readonly release: (report: Report) => void) {}

  /**
   * A click opened the heading whose row is `id`. The editor first reports its
   * caret from before the click, as it takes focus, so that is left alone
   * too, until the caret moves on from the heading.
   */
  start(id: string | undefined): void {
    // Whatever was held belongs to the previous click.
    this.dropHeld();
    this.jump =
      id === undefined
        ? undefined
        : { id, until: Date.now() + OUTLINE_JUMP_MS, landed: false };
  }

  /**
   * After a click the editor puts the heading at the top, so the top of the
   * viewport is often a different heading: scroll follow is held for the
   * whole window so that report cannot yank selection off the clicked row.
   * Returns whether the report was held. The last one held is released when
   * the window closes: the webview counted it as sent, so dropping it would
   * leave the outline on the clicked row until the top line changed again.
   */
  holdReading(report: Report): boolean {
    const jump = this.jump;
    if (!jump) {
      return false;
    }
    const left = jump.until - Date.now();
    if (left < 0) {
      this.jump = undefined;
      this.dropHeld();
      return false;
    }
    this.held = report;
    // One timer for the window; later reports only replace the one held.
    this.timer ??= setTimeout(() => this.close(), left + 1);
    return true;
  }

  /** A caret move or a refresh is newer than any report held back. */
  dropHeld(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.held = undefined;
  }

  /**
   * Whether the caret at row `id` is still where a click put it, or on its
   * way. `undefined` is a caret above the first heading.
   */
  isCaretOnJump(id: string | undefined): boolean {
    const jump = this.jump;
    if (!jump || Date.now() > jump.until) {
      this.jump = undefined;
      return false;
    }
    if (id === jump.id) {
      jump.landed = true;
      return true;
    }
    if (jump.landed) {
      // The caret moved on from the heading the click opened.
      this.jump = undefined;
      return false;
    }
    // The caret from before the click, reported before the jump landed.
    return true;
  }

  dispose(): void {
    this.jump = undefined;
    this.dropHeld();
  }

  private close(): void {
    const held = this.held;
    this.jump = undefined;
    this.dropHeld();
    if (held !== undefined) {
      this.release(held);
    }
  }
}
