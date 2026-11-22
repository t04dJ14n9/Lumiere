export interface WikiTarget {
  target: string;
  label: string;
  width?: number;
  height?: number;
}
export function wikiTarget(raw: string): WikiTarget {
  const [target = "", ...labels] = raw.replace(/\\\|/g, "|").split("|");
  const label = labels.join("|");
  const size = /^(\d+)(?:x(\d+))?$/.exec(label);
  return {
    target: target.trim(),
    label: label || target,
    ...(size
      ? {
          width: Number(size[1]),
          ...(size[2] ? { height: Number(size[2]) } : {}),
        }
      : {}),
  };
}
export function headingId(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

/** Same HTML escapes as markdown-it's `utils.escapeHtml`. */
export const escape = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Same entity decode as markdown-it's `utils.unescapeAll` for common entities. */
export function decodeMarkdownText(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_all, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_all, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/**
 * Resolve a Markdown link destination without pulling markdown-it into the
 * host metadata path. Angle-bracket destinations and backslash escapes match
 * CommonMark; spaces become %20 like markdown-it's normalizeLink.
 */
export function linkDestination(raw: string): string {
  const value =
    raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  return decodeMarkdownText(value)
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
    .replace(/ /g, "%20");
}

export const attr = (
  name: string,
  value: string | number | undefined,
): string => (value === undefined ? "" : ` ${name}="${escape(String(value))}"`);

/** With the `u` flag a valid pair is one code point: only lone halves match. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;

/**
 * Source text for a `data-*` attribute. encodeURIComponent throws on a lone
 * surrogate, which an editor can hold (half of a pasted emoji); it becomes
 * U+FFFD here instead of failing the whole note's render.
 */
export function encodeDataValue(text: string): string {
  return encodeURIComponent(text.replace(LONE_SURROGATE, "�"));
}

/**
 * The text of an `encodeDataValue` attribute. Raw HTML in a note can carry
 * the same `data-*` attributes with any value, so a malformed escape is
 * taken as written rather than thrown: one block must not stop the others.
 */
export function decodeDataValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

interface Found {
  from: number;
  at: number;
}

/**
 * `source.indexOf(needle, from)` for the many `from`s one inline run asks,
 * remembering the last answer: no `needle` starts in `[found.from, found.at)`,
 * so it still holds for a later `from` up to `at` (or for every later one
 * when there is no `needle`). Without it a run of `[[` with no `]]` after it
 * scans the rest of the text once per bracket, which is quadratic.
 */
export function rememberedIndexOf(
  needle: string,
): (state: { src: string }, from: number) => number {
  const last = new WeakMap<object, Found>();
  return (state, from) => {
    const found = last.get(state);
    if (found && from >= found.from && (found.at < 0 || from <= found.at)) {
      return found.at;
    }
    const at = state.src.indexOf(needle, from);
    last.set(state, { from, at });
    return at;
  };
}
