import { loadYaml } from "../../markdown/properties/load-yaml";
import { plainDocumentDates } from "../../markdown/properties/values";

/** Menu paste uses the injected plain clipboard; keyboard paste keeps its MIME payload. */
export function clipboardProperties(
  text: string,
): Record<string, unknown> | undefined {
  if (text.length > 1_000_000) {
    return undefined;
  }
  try {
    const document = loadYaml().parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) {
      return undefined;
    }
    // Timestamps become the wall-clock text the sheet shows, not a UTC Date.
    const values = plainDocumentDates(document);
    return values && typeof values === "object" && !Array.isArray(values)
      ? (values as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
