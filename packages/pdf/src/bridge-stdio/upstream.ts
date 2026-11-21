/**
 * The shim's connection to the bridge it chose. A bridge lives as long as
 * its VS Code window's extension host: closing or reloading the window
 * stops it, and a reloaded window starts a new one on another port with
 * another token. The shim outlives both (the agent keeps it running), so a
 * call whose bridge has gone is sent to the bridge chosen afresh.
 */
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** One connection to a bridge. */
export interface BridgeLink {
  send(message: JSONRPCMessage): Promise<void>;
}

export interface UpstreamOptions<Link> {
  /** Choose a bridge and connect to it; rejects when none fits. */
  open(): Promise<Link>;
  /**
   * Whether the bridge behind `link` is gone: its window removed its
   * discovery file, or its process no longer exists.
   */
  isGone(link: Link): boolean;
}

export class Upstream<Link extends BridgeLink> {
  private link: Promise<Link> | undefined;

  constructor(private readonly options: UpstreamOptions<Link>) {}

  async send(message: JSONRPCMessage): Promise<void> {
    const current = this.link;
    try {
      await this.sendOnce(message);
    } catch (error) {
      // Only a call that got no answer, over a connection that had worked,
      // to a bridge that is gone: its window closed or reloaded, and
      // whatever the call did there went with it. A bridge just chosen
      // that fails is an answer, and so is any error a live bridge gave.
      if (
        !current ||
        !isTransportFailure(error) ||
        !this.options.isGone(await current)
      ) {
        throw error;
      }
      await this.sendOnce(message);
    }
  }

  /** Forget `link` (it closed or failed); a later message chooses again. */
  drop(link: Link): void {
    void this.link?.then((current) => {
      if (current === link) {
        this.link = undefined;
      }
    });
  }

  private async sendOnce(message: JSONRPCMessage): Promise<void> {
    // One connection for messages that arrive together, not one each.
    const opening = (this.link ??= this.options.open());
    try {
      await (await opening).send(message);
    } catch (error) {
      if (this.link === opening) {
        this.link = undefined;
      }
      throw error;
    }
  }
}

/**
 * Whether the request failed below HTTP: fetch's "fetch failed", with the
 * socket's error as its cause (refused, or cut as the process ended). An
 * HTTP error status is the bridge's answer, and is no TypeError.
 */
export function isTransportFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error as { cause?: unknown }).cause !== undefined
  );
}
