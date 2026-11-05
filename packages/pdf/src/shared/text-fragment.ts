import {
  formatLocationFragment,
  parseLocationFragment,
  splitFragmentDirective,
} from "./pdf-location";
import type { ViewRect } from "./geometry";
import { highlightIdOfFragment } from "./sidecar-format";

/** Encode one textStart value per WICG Text Fragments (dash/amp/comma). */
export function encodeTextFragment(text: string): string {
  const body = encodeURIComponent(text)
    .replace(/-/gu, "%2D")
    .replace(/'/gu, "%27");
  return `:~:text=${body}`;
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

export function formatPdfDeepLink(
  path: string,
  opts: { page: number; text?: string; viewRect?: ViewRect },
): string {
  const pdfPart = formatLocationFragment({
    page: opts.page,
    ...(opts.viewRect ? { viewRect: opts.viewRect } : {}),
  });
  const text = collapseWhitespace(opts.text ?? "");
  if (!text) {
    return `${path}#${pdfPart}`;
  }
  return `${path}#${pdfPart}#${encodeTextFragment(text)}`;
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
