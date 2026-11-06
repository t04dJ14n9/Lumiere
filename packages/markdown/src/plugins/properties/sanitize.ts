import createDOMPurify from "dompurify";

// One sanitizer per window: creating one costs more than a sheet's markup.
let purifier: { window: Window; instance: ReturnType<typeof createDOMPurify> };

export function sanitize(html: string): string {
  if (purifier?.window !== window) {
    purifier = { window, instance: createDOMPurify(window) };
  }
  return purifier.instance.sanitize(html, {
    // Editable controls come from this sheet's template; values are escaped.
    ADD_ATTR: ["contenteditable"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc"],
  });
}
