const pending = new Map<string, Set<() => NativeOpenRange | undefined>>();

export interface NativeOpenRange {
  at: number;
  to?: number;
  /** 0-based native visible top line to restore in Live Preview. */
  topLine?: number;
}

function key(uri: string, column: number): string {
  return `${uri}\0${column}`;
}

/** A Search match has both ends. A caret, including one at offset 0, does not. */
export function isNativeSelectionOpen(uri: string, column: number): boolean {
  return [...(pending.get(key(uri, column)) ?? [])].some((read) => {
    const range = read();
    return range?.to !== undefined && range.at !== undefined;
  });
}

/** Whether this open carries a top-line viewport pin (skip centering reveals). */
export function hasTopLineOpen(uri: string, column: number): boolean {
  return [...(pending.get(key(uri, column)) ?? [])].some(
    (read) => read()?.topLine !== undefined,
  );
}

/**
 * The range being transferred into this custom panel, while its open is in
 * flight. Captured onto the panel at resolve: the webview's ready call can
 * land after this open returns.
 */
export function nativeOpeningSelection(
  uri: string,
  column: number,
): { anchor: number; head: number; topLine?: number } | undefined {
  for (const read of pending.get(key(uri, column)) ?? []) {
    const range = read();
    if (!range) {
      continue;
    }
    const top = range.topLine !== undefined ? { topLine: range.topLine } : {};
    if (range.to !== undefined && range.to > range.at) {
      return { anchor: range.at, head: range.to, ...top };
    }
    if (range.topLine !== undefined) {
      return { anchor: range.at, head: range.at, ...top };
    }
  }
  return undefined;
}

export function openRange(request: {
  at: number | undefined;
  to: number | undefined;
  topLine?: number | undefined;
}): NativeOpenRange | undefined {
  if (request.at === undefined) {
    return undefined;
  }
  return {
    at: request.at,
    ...(request.to !== undefined ? { to: request.to } : {}),
    ...(request.topLine !== undefined ? { topLine: request.topLine } : {}),
  };
}

/** Keep the native Search range's origin visible through the awaited openWith. */
export async function withNativeSelectionOpen<T>(
  uri: string,
  column: number,
  range: () => NativeOpenRange | undefined,
  open: () => PromiseLike<T>,
): Promise<T> {
  const id = key(uri, column);
  const openings = pending.get(id) ?? new Set();
  openings.add(range);
  pending.set(id, openings);
  try {
    return await open();
  } finally {
    openings.delete(range);
    if (openings.size === 0) {
      pending.delete(id);
    }
  }
}
