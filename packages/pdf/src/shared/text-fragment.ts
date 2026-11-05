import {
  formatLocationFragment,
  parseLocationFragment,
  splitFragmentDirective,
} from "./pdf-location";
import type { ViewRect } from "./geometry";
import { highlightIdOfFragment } from "./sidecar-format";

/**
 * Encode one textStart value per WICG Text Fragments: `-` (the prefix and
 * suffix marker), `&` and `,` (directive separators) are percent-encoded.
 * `encodeURIComponent` already does `&` and `,`; it leaves `( ) ! ' *` alone,
 * and a `)` would end the Markdown link the directive sits in
 * (`[p. 3](a.pdf#…)`), so those are encoded too.
 */
export function encodeTextFragment(text: string): string {
  const body = encodeURIComponent(text).replace(
    /[-!'()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `:~:text=${body}`;
}

/** What `encodeLinkPath` cannot leave as typed. */
const LINK_PATH_UNSAFE = /[%#()<>|\s\p{Cc}]/gu;
/** `encodeURIComponent` leaves parentheses alone. */
const PARENTHESES: Record<string, string> = { "(": "%28", ")": "%29" };

/**
 * A file path as the path of a Markdown link destination, written bare
 * (`[a.pdf · p.3](papers/my%20paper.pdf#page=3)`: the handoff format has no
 * angle brackets, packages/agents/docs/agent-handoff-format.md). A space ends
 * a CommonMark destination, and `(`/`)` end it for readers that stop at the
 * first `)`; `#` would start the fragment. `%` is encoded so that the one
 * decode every Lumia link reader does gives the path back; `<`, `>` and `|`
 * are syntax to the Markdown editor's link parser.
 */
export function encodeLinkPath(path: string): string {
  return path.replace(
    LINK_PATH_UNSAFE,
    (char) => PARENTHESES[char] ?? encodeURIComponent(char),
  );
}

export function decodeTextFragment(
  directive: string,
):
  | { textStart: string; textEnd?: string; prefix?: string; suffix?: string }
  | undefined {
  const raw = directive.replace(/^#?/, "");
  if (!raw.startsWith(":~:text=")) {
    return undefined;
  }
  const value = raw.slice(":~:text=".length);
  if (!value) {
    return undefined;
  }
  // v1: single textStart only (prefix-/textEnd/,-suffix deferred).
  try {
    const textStart = decodeURIComponent(value);
    return textStart ? { textStart } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A selection that spans PDF lines holds line breaks, which would encode as
 * `%0A`. Readers refuse control characters in a link (native-links
 * `localFragment`), so a multi-line quote would never open.
 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * A Markdown link destination for `path` at a page: `path#page=N`, then
 * `#:~:text=…` for a quote or `&viewrect=…` for a box.
 */
export function formatPdfDeepLink(
  path: string,
  opts: { page: number; text?: string; viewRect?: ViewRect },
): string {
  const pdfPart = formatLocationFragment({
    page: opts.page,
    ...(opts.viewRect ? { viewRect: opts.viewRect } : {}),
  });
  const target = encodeLinkPath(path);
  const text = collapseWhitespace(opts.text ?? "");
  if (!text) {
    return `${target}#${pdfPart}`;
  }
  return `${target}#${pdfPart}#${encodeTextFragment(text)}`;
}

export function parsePdfDeepLinkFragment(fragment: string): {
  page?: number;
  viewRect?: ViewRect;
  textFragment?: ReturnType<typeof decodeTextFragment>;
  highlightId?: string;
} {
  const { location: pdfHalf, directive } = splitFragmentDirective(fragment);
  const location = parseLocationFragment(pdfHalf);
  const highlightId = highlightIdOfFragment(pdfHalf);
  const textFragment = directive ? decodeTextFragment(directive) : undefined;
  return {
    ...(location?.page ? { page: location.page } : {}),
    ...(location?.viewRect ? { viewRect: location.viewRect } : {}),
    ...(textFragment ? { textFragment } : {}),
    ...(highlightId ? { highlightId } : {}),
  };
}
