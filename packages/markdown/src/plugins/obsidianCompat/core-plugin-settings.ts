import { isSupportedDateFormat } from "../../markdown/templates";
import type { ObsidianOverrides } from "./api";
import { isRecord } from "./app-settings";

/** Lumia settings seeded from Obsidian's Templates and Daily notes files. */
export const CORE_PLUGIN_OVERRIDE_KEYS = [
  "templates.folder",
  "templates.dateFormat",
  "templates.timeFormat",
  "dailyNotes.folder",
  "dailyNotes.dateFormat",
  "dailyNotes.template",
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

/** `daily-notes.json`; absent or unusable values contribute nothing. */
export function mapDailyNotesSettings(value: unknown): ObsidianOverrides {
  const settings = object(value, "daily-notes.json");
  return defined({
    "dailyNotes.folder": text(settings.folder),
    "dailyNotes.dateFormat": dateFormat(settings.format),
    "dailyNotes.template": text(settings.template),
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
 * Moment formats Lumia cannot write would name daily notes differently from
 * the vault's existing ones, so only formats of supported tokens carry over.
 */
function dateFormat(value: unknown): string | undefined {
  return typeof value === "string" && isSupportedDateFormat(value)
    ? value
    : undefined;
}
