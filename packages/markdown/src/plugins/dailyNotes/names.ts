import { DEFAULT_DATE_FORMAT, formatLocalDate } from "../../markdown/templates";
import { safeRelative } from "../../shared/workspace-path";

export interface DailyNoteSettings {
  readonly folder: string;
  readonly dateFormat: string;
  readonly template: string;
}

/** The folder as a vault path: "" is the vault root, undefined escapes it. */
function dailyFolder(setting: string): string | undefined {
  const trimmed = setting.trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "" : safeRelative(trimmed);
}

/** `folder/format(date).md`, or undefined when it would leave the vault. */
export function dailyNotePath(
  settings: DailyNoteSettings,
  date: Date,
): string | undefined {
  const folder = dailyFolder(settings.folder);
  if (folder === undefined) {
    return undefined;
  }
  const name = formatLocalDate(date, formatOf(settings));
  return safeRelative(folder ? `${folder}/${name}.md` : `${name}.md`);
}

/** The template's vault path; Obsidian stores it without `.md`. */
export function dailyTemplatePath(setting: string): string | undefined {
  const path = safeRelative(setting.trim().replace(/^\/+/, ""));
  if (!path) {
    return undefined;
  }
  return /\.md$/i.test(path) ? path : `${path}.md`;
}

const TOKENS = /YYYY|MM|DD|HH|mm|ss/g;
const KEY_ORDER = ["YYYY", "MM", "DD", "HH", "mm", "ss"] as const;

/**
 * A key that sorts daily notes by date, or undefined when `path` is not a
 * daily note. Every token is fixed-width digits, so the format is matched
 * as a pattern rather than parsed as a date.
 */
export function dailyNoteKey(
  path: string,
  settings: DailyNoteSettings,
): string | undefined {
  const folder = dailyFolder(settings.folder);
  const prefix = folder ? `${folder}/` : "";
  if (
    folder === undefined ||
    !path.startsWith(prefix) ||
    !path.endsWith(".md")
  ) {
    return undefined;
  }
  const format = formatOf(settings);
  const tokens = [...format.matchAll(TOKENS)].map((match) => match[0]);
  const literals = format.split(TOKENS).map(escapeRegExp);
  const source = literals
    .map((literal, index) => {
      const token = tokens[index];
      if (!token) {
        return literal;
      }
      return `${literal}${token === "YYYY" ? "(\\d{4})" : "(\\d{2})"}`;
    })
    .join("");
  const match = new RegExp(`^${source}$`).exec(path.slice(prefix.length, -3));
  if (!match) {
    return undefined;
  }
  return KEY_ORDER.map((token) => {
    const at = tokens.indexOf(token);
    return at < 0 ? "0".repeat(token.length) : match[at + 1];
  }).join("");
}

/** The nearest daily note before (-1) or after (1) `reference`, by date. */
export function adjacentDailyNote(
  paths: readonly string[],
  settings: DailyNoteSettings,
  reference: string,
  direction: -1 | 1,
): string | undefined {
  let best: { path: string; key: string } | undefined;
  for (const path of paths) {
    const key = dailyNoteKey(path, settings);
    if (key === undefined) {
      continue;
    }
    const isBeyond = direction < 0 ? key < reference : key > reference;
    const isCloser = !best || (direction < 0 ? key > best.key : key < best.key);
    if (isBeyond && isCloser) {
      best = { path, key };
    }
  }
  return best?.path;
}

function formatOf(settings: DailyNoteSettings): string {
  return settings.dateFormat.trim() || DEFAULT_DATE_FORMAT;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
