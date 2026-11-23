import createDOMPurify, { type Config } from "dompurify";

const purifiers = new WeakMap<
  Window & typeof globalThis,
  ReturnType<typeof createDOMPurify>
>();

function getPurifier(
  win: Window & typeof globalThis,
): ReturnType<typeof createDOMPurify> {
  let instance = purifiers.get(win);
  if (!instance) {
    instance = createDOMPurify(win);
    purifiers.set(win, instance);
  }
  return instance;
}

export interface SanitizeGraphicsOptions {
  /**
   * Trusted Mermaid diagrams (`htmlLabels: true`) render labels inside SVG
   * `<foreignObject>`. Without `HTML_INTEGRATION_POINTS` and tag allowlisting,
   * DOMPurify strips those labels and leaves empty diagram boxes.
   */
  allowForeignObject?: boolean;
}

const BASE_FORBID_TAGS = ["script", "iframe", "object", "embed", "form"];

export function graphicsSanitizerOptions(
  options: SanitizeGraphicsOptions = {},
): Config {
  if (options.allowForeignObject) {
    return {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_TAGS: ["mjx-container", "use", "foreignObject"],
      ADD_ATTR: ["xlink:href", "xmlns", "dominant-baseline"],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
      FORBID_TAGS: [...BASE_FORBID_TAGS],
    };
  }
  return {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ["mjx-container", "use"],
    ADD_ATTR: ["xlink:href"],
    FORBID_TAGS: [...BASE_FORBID_TAGS, "foreignObject"],
  };
}

/** Generated graphics are still untrusted: strip active content and event attributes. */
export function sanitizeGraphics(
  html: string,
  options: SanitizeGraphicsOptions = {},
): string {
  return getPurifier(window).sanitize(html, graphicsSanitizerOptions(options));
}
