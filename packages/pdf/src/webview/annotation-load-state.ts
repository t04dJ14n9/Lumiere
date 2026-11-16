/**
 * Load number + content hash the host last delivered, and the text of the
 * annotation file kept for those bytes; annotation saves use these.
 */
let current: { load: number; sha256: string; annotations?: string } | undefined;

export function rememberAnnotationLoad(
  load: number,
  sha256: string,
  annotations?: string,
): void {
  current = {
    load,
    sha256,
    ...(annotations === undefined ? {} : { annotations }),
  };
}

export function annotationLoadState():
  { load: number; sha256: string; annotations?: string } | undefined {
  return current;
}

function acceptAnnotationSave(sha256: string): void {
  if (current) {
    current = { ...current, sha256 };
  }
}

/** What the host said of a write into the PDF (`annotationSaveResult`). */
export interface SaveResult {
  load?: number;
  write?: number;
  ok?: boolean;
  sha256?: string;
  reason?: string;
}

/**
 * How a write into the PDF ended, for the write that asked; a written file's
 * hash is now the one annotations are filed under. Undefined when nothing is
 * settled yet (a conflict: Keep mine answers for the same write later), or
 * when the result is for an earlier load: its bytes are not the ones shown,
 * and its hash must not replace theirs.
 */
export function settlePdfWrite(
  result: SaveResult,
): { write: number; ok: boolean } | undefined {
  if (result.write === undefined || result.load !== current?.load) {
    return undefined;
  }
  if (result.ok === true && typeof result.sha256 === "string") {
    acceptAnnotationSave(result.sha256);
    return { write: result.write, ok: true };
  }
  return result.ok === false && result.reason === "error"
    ? { write: result.write, ok: false }
    : undefined;
}
