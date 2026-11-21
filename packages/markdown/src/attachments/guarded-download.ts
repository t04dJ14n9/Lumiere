/**
 * The limits on downloading a URL a note names: a time limit, a size limit,
 * and no way into this machine or its network, however the server redirects.
 * The editor host fetches these on the user's behalf, so a link in a note
 * must not make it wait forever, fill the disk, or ask a service that is
 * only reachable from here.
 */
import { isBlockedDestination } from "./private-address";

export interface DownloadLimits {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxRedirects: number;
}

export const DOWNLOAD_LIMITS: DownloadLimits = {
  timeoutMs: 30_000,
  maxBytes: 50 * 1024 * 1024,
  maxRedirects: 5,
};

interface BodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(): Promise<unknown>;
}

/** What a download needs of a response; a `fetch` Response has all of it. */
export interface SourceResponse {
  readonly ok: boolean;
  readonly status?: number;
  /** `opaqueredirect` where a browser hides a redirect it was told not to follow. */
  readonly type?: string;
  readonly url?: string;
  readonly headers: { get(name: string): string | null };
  readonly body?: { getReader(): BodyReader } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface SourceRequest {
  readonly redirect: "manual" | "follow";
  readonly signal: AbortSignal;
}

export type SourceFetch = (
  url: string,
  init?: SourceRequest,
) => Promise<SourceResponse>;

/**
 * Run `run` for at most `timeoutMs`: its signal aborts the request and the
 * body read when time runs out, and the wait ends then even for a `fetch`
 * that ignores the signal.
 */
export async function withinTimeLimit<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The download timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
    // Also frees the connection of a body that was never read.
    controller.abort();
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function refuseBlocked(url: string): void {
  if (isBlockedDestination(url)) {
    throw new Error("A private address is not downloaded");
  }
}

/** Where a redirect leads, or undefined when the response is the answer. */
function redirectTarget(
  response: SourceResponse,
  from: string,
): string | undefined {
  const location = response.headers.get("location");
  if (!REDIRECTS.has(response.status ?? 0) || !location) {
    return undefined;
  }
  const target = new URL(location, from);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("A redirect left the web");
  }
  return target.href;
}

/**
 * GET `url`, following redirects by hand so that every address, the first
 * and each hop, is checked before it is requested. Node's fetch (the editor
 * host) hands back the redirect itself. A browser's hides it
 * (`opaqueredirect`): the URL is then fetched once more for the browser to
 * follow, and only the address it ended at can be checked, after the fact;
 * the browser's own rules (CORS, private network access) stand in for the rest.
 */
export async function fetchFollowing(
  url: string,
  fetch: SourceFetch,
  { signal, maxRedirects }: { signal: AbortSignal; maxRedirects: number },
): Promise<SourceResponse> {
  let current = url;
  for (let hop = 0; ; hop++) {
    refuseBlocked(current);
    const response = await fetch(current, { redirect: "manual", signal });
    if (response.type === "opaqueredirect") {
      const landed = await fetch(current, { redirect: "follow", signal });
      if (landed.url) {
        refuseBlocked(landed.url);
      }
      return landed;
    }
    const next = redirectTarget(response, current);
    if (next === undefined) {
      return response;
    }
    if (hop >= maxRedirects) {
      throw new Error("Too many redirects");
    }
    current = next;
  }
}

function tooLarge(maxBytes: number): Error {
  return new Error(`The download is over ${maxBytes} bytes`);
}

/**
 * The body, at most `maxBytes` of it: refused by its declared length before
 * a byte is read, and cancelled where a stream crosses the limit, since the
 * declared length is missing or wrong more often than not.
 */
export async function readCapped(
  response: SourceResponse,
  maxBytes: number,
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    throw tooLarge(maxBytes);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw tooLarge(maxBytes);
    }
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
