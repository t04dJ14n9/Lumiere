import type { FileEvent } from "./api";

/**
 * File events that arrive while the first listing runs. The listing may
 * predate such an event, so each one waits and is applied after the listing,
 * in arrival order; events after `release` are applied as they come.
 */
export class HeldFileEvents {
  /** Undefined once released: from then on events are applied as they come. */
  private held: FileEvent[] | undefined = [];
  private isDiscarded = false;

  constructor(private readonly apply: (event: FileEvent) => void) {}

  receive(event: FileEvent): void {
    if (this.isDiscarded) {
      return;
    }
    if (this.held) {
      this.held.push(event);
      return;
    }
    this.apply(event);
  }

  /** Forgets what is held and drops every later event: a disposed indexer applies nothing. */
  discard(): void {
    this.isDiscarded = true;
    this.held = undefined;
  }

  /** Applies what was held. Idempotent: a second call applies nothing. */
  release(): void {
    const held = this.held ?? [];
    this.held = undefined;
    for (const event of held) {
      this.apply(event);
    }
  }
}
