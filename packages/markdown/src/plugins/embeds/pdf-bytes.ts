/**
 * The bytes of the PDFs that embeds show, fetched once per file however
 * many embeds show it: ten embeds of one 40 MB PDF made ten fetches and
 * held ten copies. An entry lives while an embed that asked for it does
 * (until its pass's `signal` aborts); the last one to go stops a fetch
 * still running. `forgetPdfBytes` drops them all when files change, so the
 * next embed fetches the file as it is now.
 */
interface Entry {
  readonly bytes: Promise<Uint8Array>;
  readonly controller: AbortController;
  users: number;
}

export type LoadPdfBytes = (
  url: string,
  signal: AbortSignal,
) => Promise<Uint8Array>;

const entries = new Map<string, Entry>();

async function fetchBytes(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** The file's bytes, shared with every other embed of the same `url`. */
export function sharedPdfBytes(
  url: string,
  signal: AbortSignal,
  load: LoadPdfBytes = fetchBytes,
): Promise<Uint8Array> {
  let entry = entries.get(url);
  if (!entry) {
    const controller = new AbortController();
    const created: Entry = {
      bytes: load(url, controller.signal),
      controller,
      users: 0,
    };
    // A failed fetch is not kept: the next embed tries again.
    created.bytes.catch(() => forget(url, created));
    entries.set(url, created);
    entry = created;
  }
  const held = entry;
  held.users++;
  const release = (): void => {
    held.users--;
    if (held.users === 0) {
      forget(url, held);
      held.controller.abort();
    }
  };
  if (signal.aborted) {
    release();
  } else {
    signal.addEventListener("abort", release, { once: true });
  }
  return held.bytes;
}

/** Files changed: embeds from now on fetch theirs again. */
export function forgetPdfBytes(): void {
  entries.clear();
}

function forget(url: string, entry: Entry): void {
  if (entries.get(url) === entry) {
    entries.delete(url);
  }
}
