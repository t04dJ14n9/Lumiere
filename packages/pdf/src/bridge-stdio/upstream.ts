/**
 * The shim's connection to the bridge it chose. A bridge lives as long as
 * its VS Code window's extension host: closing or reloading the window
 * stops it, and a reloaded window starts a new one on another port with
 * another token. The shim outlives both (the agent keeps it running), so a
 * connection that finds nothing listening any more is dropped, and the
 * message goes to the bridge chosen afresh.
 */
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** One connection to a bridge. */
export interface BridgeLink {
  send(message: JSONRPCMessage): Promise<void>;
}

export class Upstream<Link extends BridgeLink> {
  private link: Promise<Link> | undefined;

  /** `open` chooses a bridge and connects to it; it rejects when none fits. */
  constructor(private readonly open: () => Promise<Link>) {}

  async send(message: JSONRPCMessage): Promise<void> {
    const wasOpen = this.link !== undefined;
    try {
      await this.sendOnce(message);
    } catch (error) {
      // Refused: no bridge got the message, so sending it again cannot
      // do it twice. Only once, and only over a connection that worked
      // before: a bridge just chosen that refuses is an answer.
      if (!wasOpen || !isRefused(error)) {
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
    const opening = (this.link ??= this.open());
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

/** Whether nothing listens where the request went (fetch's ECONNREFUSED). */
export function isRefused(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  return cause?.code === "ECONNREFUSED";
}
