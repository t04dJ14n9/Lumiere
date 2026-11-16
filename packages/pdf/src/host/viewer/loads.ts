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
  /** Counts loads begun: only the newest may send its bytes. */
  private attempts = 0;
  /** Loads begun and not yet sent or abandoned. */
  private inFlight = 0;
  /** Loads reading the annotation store for the bytes they will send. */
  private storeReads = 0;

  /** `resumed`: the viewer goes on with the bytes it has, as `abandon` decides. */
  constructor(private readonly resumed: () => void = () => undefined) {}

  /** A load starts reading the file; returns its attempt for `isNewest`. */
  begin(): number {
    this.loading = true;
    this.inFlight++;
    return ++this.attempts;
  }

  /** The number the bytes about to be sent go under. */
  next(): number {
    return ++this.current;
  }

  /** The viewer has been sent the new bytes; newer ones may still be on their way. */
  finished(): void {
    this.inFlight--;
    this.loading = this.inFlight > 0;
  }

  /**
   * Whether no load began after `attempt`. One that did read newer bytes,
   * or will: the older one must not send its own after them.
   */
  isNewest(attempt: number): boolean {
    return attempt === this.attempts;
  }

  /**
   * A load ends without sending bytes: its read failed, or a newer load
   * superseded it. Once no load is left on its way, the viewer goes on with
   * the bytes it has, the current load's. Returns whether it does: not while
   * another load is still on its way (whichever began first), nor before
   * any bytes were ever sent.
   */
  abandon(): boolean {
    this.inFlight--;
    if (this.current === 0 || this.inFlight > 0) {
      return false;
    }
    this.loading = false;
    this.resumed();
    return true;
  }

  /** A load reads the annotations kept for its bytes with `read`. */
  async readStore<T>(read: () => Promise<T>): Promise<T> {
    this.storeReads++;
    try {
      return await read();
    } finally {
      this.storeReads--;
    }
  }

  /**
   * Whether an annotation store save about `load` may be written. Unlike
   * other messages it is still taken while new bytes are read: it is filed
   * under the hash of the bytes it was made on, and dropping it loses the
   * change. Once a load reads the store, a save would come too late for it.
   */
  acceptsStoreSave(load: number): boolean {
    return load === this.current && this.storeReads === 0;
  }

  /** Whether a message is about the bytes the viewer shows now. */
  isCurrent(load: number): boolean {
    return !this.loading && load === this.current;
  }
}
