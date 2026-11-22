/**
 * What a click on an outline row does to Follow Cursor. A click goes to the
 * bookmark and selects its row; the reading position then moves, and
 * following it would close branches under the pointer, so a double-click's
 * second click would land on another row (the Explorer's outline waits the
 * same). The click wins until the reader moves on from where it landed:
 * not only for the moment the jump takes, but also where the jump cannot reach
 * the bookmark (a heading near the end of the PDF, which cannot scroll to the
 * top) or does not move at all (a heading that only groups others).
 */

/** How long after a click the position the jump is on its way to is left alone. */
export const CLICK_HOLD_MS = 1000;

/** What a reading position does to the tree. */
export type FollowStep =
  /** Look again in `ms`: the jump is still on its way. */
  | { kind: "wait"; ms: number }
  /** Leave the tree and the selection as the click made them. */
  | { kind: "stay" }
  /** Follow the position; the click, if there was one, is over. */
  | { kind: "follow" };

export class OutlineClickHold {
  private clicked: string | undefined;
  private heldUntil = 0;
  /** The bookmark of the position the click landed at, once it has. */
  private landed: { id: string | undefined } | undefined;

  /** The row clicked and not yet moved on from. */
  get clickedId(): string | undefined {
    return this.clicked;
  }

  click(id: string, now: number): void {
    this.clicked = id;
    this.heldUntil = now + CLICK_HOLD_MS;
    this.landed = undefined;
  }

  /** The reading position is at the bookmark `activeId` (none before the first). */
  step(activeId: string | undefined, now: number): FollowStep {
    if (this.clicked === undefined) {
      return { kind: "follow" };
    }
    if (now < this.heldUntil) {
      return { kind: "wait", ms: this.heldUntil - now };
    }
    if (!this.landed) {
      this.landed = { id: activeId };
      return { kind: "stay" };
    }
    if (this.landed.id === activeId) {
      return { kind: "stay" };
    }
    this.clicked = undefined;
    this.landed = undefined;
    return { kind: "follow" };
  }
}
