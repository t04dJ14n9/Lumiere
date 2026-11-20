import type { Endpoint } from "../../shared/rpc/endpoint";
import type { GitDiff } from "./api";
import { protocol } from "./protocol";

type Status = ReturnType<GitDiff["status"]>;

/**
 * The note's git baseline as the host last sent it, with the host's name for
 * it. Every repository event makes the editor ask again; when the baseline is
 * still the one it has, the host says so instead of sending the text, and
 * there is nothing to recompute.
 */
export class BaselineSource {
  /** The baseline's text; undefined unless the last answer was `ok`. */
  text: string | undefined;
  label = "HEAD";
  /** What the last request returned; the gutter's status adds the size check. */
  status: Status = "loading";
  private identity: string | undefined;
  private request = 0;
  private live = true;

  constructor(
    private readonly host: {
      readonly rpc: Endpoint;
      readonly logger: { warn(message: string, error: unknown): void };
    },
    private readonly ref: "HEAD" | "index",
  ) {}

  stop(): void {
    this.live = false;
  }

  /**
   * Ask the host for the baseline. True when it changed (or failed): the
   * hunks need a recompute. False for an unchanged baseline and for an
   * answer a later request or `stop` overtook.
   */
  async refresh(): Promise<boolean> {
    const mine = ++this.request;
    const known = this.identity;
    try {
      const result = await this.host.rpc.call(protocol, "baseline", {
        ref: this.ref,
        ...(known === undefined ? {} : { known }),
      });
      if (mine !== this.request || !this.live) {
        return false;
      }
      if (result.status === "unchanged" && result.identity === known) {
        return false;
      }
      // An `unchanged` for another baseline would be a host bug: no text.
      this.status =
        result.status === "unchanged" ? "unavailable" : result.status;
      const ok = result.status === "ok";
      this.identity = ok ? result.identity : undefined;
      this.text = ok ? (result.text ?? "") : undefined;
      this.label = result.label ?? (this.ref === "HEAD" ? "HEAD" : "Index");
    } catch (error) {
      if (mine !== this.request || !this.live) {
        return false;
      }
      this.host.logger.warn("Git baseline unavailable", error);
      this.status = "unavailable";
      this.identity = undefined;
      this.text = undefined;
    }
    return true;
  }
}
