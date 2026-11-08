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

export function acceptAnnotationSave(sha256: string): void {
  if (current) {
    current = { ...current, sha256 };
  }
}
