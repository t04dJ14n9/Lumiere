import type { ObsidianOverrides } from "./api";
import { isRecord } from "./app-settings";

/** Lumiere settings seeded from Obsidian's Templates file. */
export const CORE_PLUGIN_OVERRIDE_KEYS = [
  "templates.folder",
  "templates.dateFormat",
  "templates.timeFormat",
] as const;

/** `templates.json`; absent or unusable values contribute nothing. */
export function mapTemplatesSettings(value: unknown): ObsidianOverrides {
  const settings = object(value, "templates.json");
  return defined({
    "templates.folder": text(settings.folder),
    "templates.dateFormat": dateFormat(settings.dateFormat),
    "templates.timeFormat": dateFormat(settings.timeFormat),
  });
}

function object(value: unknown, file: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Obsidian ${file} must contain an object.`);
  }
  return value;
}
function defined(entries: Record<string, string | undefined>) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(entries).filter(([, item]) => item !== undefined),
    ),
  );
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
/**
 * Any Moment format carries over: Lumiere writes the common tokens, and
 * Insert Template names the ones it cannot write instead of this mapping
 * dropping the whole format silently.
 */
function dateFormat(value: unknown): string | undefined {
  return text(value);
}
