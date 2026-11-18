/**
 * Who may use the server: the window it was started for, and nothing else
 * on this machine. A page in any browser can send requests to a loopback
 * port, so every request passes three checks:
 * - the launch token, given once in the URL and then kept in an HttpOnly
 *   cookie (the URL is stripped by a redirect);
 * - the Host header names this server, which a DNS-rebinding page cannot;
 * - a request that has an Origin comes from this server's own origin.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { SHELL_KEY_HEADER } from "../shared/shell-key";

export const TOKEN_COOKIE = "lumiere_token";

export type Admission =
  | { readonly kind: "admit" }
  | { readonly kind: "reject"; readonly status: 401 | 403 }
  /** The token was in the URL: keep it in the cookie and drop it from the URL. */
  | {
      readonly kind: "redirect";
      readonly location: string;
      readonly cookie: string;
    };

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function admit(
  req: IncomingMessage,
  server: { readonly token: string; readonly port: number },
): Admission {
  const host = req.headers.host ?? "";
  if (!isOwnHost(host, server.port)) {
    return { kind: "reject", status: 403 };
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) {
    return { kind: "reject", status: 403 };
  }
  const url = new URL(req.url ?? "/", `http://${host}`);
  const given = url.searchParams.get("token");
  if (given !== null) {
    if (!sameSecret(given, server.token)) {
      return { kind: "reject", status: 401 };
    }
    url.searchParams.delete("token");
    return {
      kind: "redirect",
      location: url.pathname + url.search,
      cookie: `${TOKEN_COOKIE}=${server.token}; HttpOnly; SameSite=Strict; Path=/`,
    };
  }
  return sameSecret(readCookie(req, TOKEN_COOKIE), server.token)
    ? { kind: "admit" }
    : { kind: "reject", status: 401 };
}

/**
 * Whether a request to add a folder (a vault) comes from the window and not
 * from a page in it. Every page of a note or PDF is same-origin with the window
 * and carries the cookie, and what the server opens for reading and writing
 * is whatever its vaults hold, so a page must not be able to name a new one.
 * The window's own page is given `key` (see `mayReceiveShellKey`) and sends it
 * back; a page's script has no way to read it from a fetch or a frame.
 *
 * A request with no Origin and no fetch metadata is no page (a browser sends
 * an Origin with every POST): it is a process that holds the launch token, such
 * as the desktop app's own open request, and it passes.
 *
 * Limit: script that can open the window's page in a window of its own, and
 * read it, can still take the key. This bars the direct request, not that.
 */
export function fromShell(req: IncomingMessage, key: string): boolean {
  if (
    req.headers.origin === undefined &&
    req.headers["sec-fetch-site"] === undefined
  ) {
    return true;
  }
  const given = req.headers[SHELL_KEY_HEADER];
  return sameSecret(Array.isArray(given) ? given[0] : given, key);
}

/**
 * Whether a request for the window's page may be answered with the key: a load
 * of the page itself. A browser says what a request is for in `Sec-Fetch-Dest`
 * and a page's script cannot change it: a fetch is `empty`, a frame `iframe`.
 * A browser that sends none is let through; its page cannot be told from the
 * window's.
 */
export function mayReceiveShellKey(req: IncomingMessage): boolean {
  const destination = req.headers["sec-fetch-dest"];
  return destination === undefined || destination === "document";
}

/** The server's own names: the loopback address it listens on, by any spelling. */
function isOwnHost(host: string, port: number): boolean {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(
    host.toLowerCase(),
  );
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return value.join("=");
    }
  }
  return undefined;
}

function sameSecret(given: string | undefined, token: string): boolean {
  if (given === undefined) {
    return false;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
