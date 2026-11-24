import type { Disposer } from "@workshop/core";
import type { FileEvent, VaultFileSystem, VaultListing } from "./api";
import { HeldFileEvents } from "./held-events";

/**
 * The vault's file watch, started before the first listing. Events it reports
 * wait until the listing is in the index, and stopping it drops them, so a
 * watch that outlives its indexer applies nothing.
 */
export class ListingWatch {
  private readonly events: HeldFileEvents;
  private stop: Disposer | undefined;
  /** Set by stopAndDiscard: a watch started after it would outlive its indexer. */
  private isStopped = false;

  constructor(
    private readonly fs: VaultFileSystem,
    private readonly root: string,
    apply: (event: FileEvent) => void,
  ) {
    this.events = new HeldFileEvents(apply);
  }

  /** Starts the watch with the limit its folder events keep (`VaultFileSystem.watch`). */
  start(limit: number): void {
    if (this.isStopped) {
      return;
    }
    this.stop = this.fs.watch(
      this.root,
      (event) => this.events.receive(event),
      limit,
    );
  }

  /** The listing, or its failure: a failed listing leaves no index for events, so none is kept. */
  untilListed(listing: Promise<VaultListing>): Promise<VaultListing> {
    return listing.catch((error: unknown) => {
      this.stopAndDiscard();
      throw error;
    });
  }

  /** Applies what was held, in order; later events are applied as they come. */
  release(): void {
    this.events.release();
  }

  /** Stops the watch and drops what it held. Idempotent: a second call stops nothing. */
  stopAndDiscard(): void {
    this.isStopped = true;
    this.events.discard();
    const stop = this.stop;
    this.stop = undefined;
    void stop?.();
  }
}
