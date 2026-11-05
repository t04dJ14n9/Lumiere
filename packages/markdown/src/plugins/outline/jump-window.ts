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
 * on another heading (and jumped there).
 */
export class OutlineJumpWindow {
  private jump: OutlineJump | undefined;

  /**
   * A click opened the heading whose row is `id`. The editor first reports its
   * caret from before the click, as it takes focus, so that is left alone
   * too, until the caret moves on from the heading.
   */
  start(id: string | undefined): void {
    this.jump =
      id === undefined
        ? undefined
        : { id, until: Date.now() + OUTLINE_JUMP_MS, landed: false };
  }

  /**
   * After a click the editor puts the heading at the top, so the top of the
   * viewport is often a different heading: scroll follow is held for the
   * whole window so that report cannot yank selection off the clicked row.
   */
  isHoldingReading(): boolean {
    const jump = this.jump;
    if (!jump) {
      return false;
    }
    if (Date.now() <= jump.until) {
      return true;
    }
    this.jump = undefined;
    return false;
  }

  /** Whether the caret at row `id` is still where a click put it, or on its way. */
  isCaretOnJump(id: string): boolean {
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
}
