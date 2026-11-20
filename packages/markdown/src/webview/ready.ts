import { protocol } from "../plugins/editor/protocol";
import { RpcError, type Endpoint } from "../shared/rpc/endpoint";

/** Tries before the page shows that the note could not open: 30 s in all. */
const READY_ATTEMPTS = 3;

/**
 * Ask the host for the note. A busy extension host (other extensions
 * activating, a slow file system) can take longer than one call's timeout,
 * and a page that gave up would stay an error until the tab is reopened, so
 * a timeout asks again. The host's work towards the answer is shared, not
 * restarted. Any other failure is final.
 */
export async function requestReady(
  rpc: Pick<Endpoint, "call">,
  attempts = READY_ATTEMPTS,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rpc.call(protocol, "ready", {});
    } catch (error) {
      const timedOut = error instanceof RpcError && error.code === "Timeout";
      if (!timedOut || attempt >= attempts) {
        throw error;
      }
    }
  }
}
