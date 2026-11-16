/**
 * Which load of the PDF the viewer has. Each `load` message carries a number
 * (1, 2, 3…); a message about another number, or one that arrives while new
 * bytes are on their way, is about bytes the viewer no longer shows.
 */
export class ViewerLoads {
  /** The number of the last `load` sent; 0 before the first. */
  current = 0;
  /** New bytes are being read for the viewer. */
  loading = false;
  /** Counts loads begun: only the newest may end the loading state. */
  private attempts = 0;

  /** A load starts reading the file; returns its attempt for `abandon`. */
  begin(): number {
    this.loading = true;
    return ++this.attempts;
  }

  /** The number the bytes about to be sent go under. */
  next(): number {
    return ++this.current;
  }

  /** The viewer has been sent the new bytes. */
  finished(): void {
    this.loading = false;
  }

  /**
   * The read of `attempt` gave no bytes. A newer load ends the loading
   * itself; a failed read sent nothing, so the viewer still has the current
   * load's bytes and goes on with them. Returns whether it does.
   */
  abandon(attempt: number): boolean {
    if (attempt !== this.attempts || this.current === 0) {
      return false;
    }
    this.loading = false;
    return true;
  }

  /** Whether a message is about the bytes the viewer shows now. */
  isCurrent(load: number): boolean {
    return !this.loading && load === this.current;
  }
}
