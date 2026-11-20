import {
  formatLocationFragment,
  parseLocationFragment,
  splitFragmentDirective,
} from "./pdf-location";
import type { ViewRect } from "./geometry";
import type { TextFragmentQuery } from "./pdf-backlink-resolve";

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
 * decode every Lumiere link reader does gives the path back; `<`, `>` and `|`
 * are syntax to the Markdown editor's link parser.
 */
export function encodeLinkPath(path: string): string {
  return path.replace(
    LINK_PATH_UNSAFE,
    (char) => PARENTHESES[char] ?? encodeURIComponent(char),
  );
}

/**
 * The first text directive of `:~:text=…`, in the WICG form
 * `[prefix-,]textStart[,textEnd][,-suffix]`: the parts are split at the raw
 * `,` and `-` markers before decoding, so an encoded `%2C` or `%2D` is text.
 * A browser's "Copy link to highlight" writes `start,end` for a long passage.
 * Undefined when there is no text directive, or it is not well formed.
 */
export function decodeTextFragment(
  directive: string,
): TextFragmentQuery | undefined {
  const raw = directive.replace(/^#?/, "");
  if (!raw.startsWith(":~:")) {
    return undefined;
  }
  const text = raw
    .slice(":~:".length)
    .split("&")
    .find((part) => part.startsWith("text="));
  const parts = text?.slice("text=".length).split(",") ?? [];
  const prefix = parts[0]?.endsWith("-") ? parts.shift()!.slice(0, -1) : "";
  const suffix = parts.at(-1)?.startsWith("-") ? parts.pop()!.slice(1) : "";
  const [start, end, ...rest] = parts;
  if (!start || rest.length > 0 || end === "") {
    return undefined;
  }
  try {
    return {
      textStart: decodeURIComponent(start),
      ...(end === undefined ? {} : { textEnd: decodeURIComponent(end) }),
      ...(prefix ? { prefix: decodeURIComponent(prefix) } : {}),
      ...(suffix ? { suffix: decodeURIComponent(suffix) } : {}),
    };
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
} {
  const { location: pdfHalf, directive } = splitFragmentDirective(fragment);
  const location = parseLocationFragment(pdfHalf);
  const textFragment = directive ? decodeTextFragment(directive) : undefined;
  return {
    ...(location?.page ? { page: location.page } : {}),
    ...(location?.viewRect ? { viewRect: location.viewRect } : {}),
    ...(textFragment ? { textFragment } : {}),
  };
}
