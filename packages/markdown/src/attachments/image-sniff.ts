/**
 * Which image a download is, read from its first bytes, for a server that
 * sends no `Content-Type` or only `application/octet-stream`.
 */

const text = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);

/** The extension of the image these bytes are, or undefined when they are no image we know. */
export function sniffImageExtension(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "jpg";
  }
  if (/^GIF8[79]a$/u.test(text(bytes, 0, 6))) {
    return "gif";
  }
  if (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 12) === "WEBP") {
    return "webp";
  }
  if (text(bytes, 4, 8) === "ftyp" && /^avi[fs]$/u.test(text(bytes, 8, 12))) {
    return "avif";
  }
  if (text(bytes, 0, 2) === "BM" && bytes.length > 14) {
    return "bmp";
  }
  return isSvg(bytes) ? "svg" : undefined;
}

/**
 * An SVG is text: an `<svg` element after at most a prolog, in the first
 * kilobyte. The decoder drops a byte-order mark.
 */
function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?<svg[\s>]/iu.test(
    head,
  );
}
