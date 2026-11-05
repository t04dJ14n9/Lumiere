/**
 * Template expansion shared by Templates, Daily Notes and later note
 * creators. Pure: no DOM, VS Code or Node APIs.
 */
import { formatWithPattern } from "./bases/value-methods";

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_TIME_FORMAT = "HH:mm";

export interface TemplateContext {
  /** The destination note's basename, without `.md`. */
  readonly title: string;
  readonly now: Date;
  /** Format of `{{date}}`; empty or absent means `YYYY-MM-DD`. */
  readonly dateFormat?: string;
  /** Format of `{{time}}`; empty or absent means `HH:mm`. */
  readonly timeFormat?: string;
}

const TOKEN = /\{\{(?:(date|time)(?::([^{}\n]+))?|(title))\}\}/g;

/**
 * Replaces `{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}` and
 * `{{time:FORMAT}}`. Anything else in braces is left as written.
 */
export function expandTemplate(text: string, context: TemplateContext): string {
  return text.replace(
    TOKEN,
    (_match, kind: string | undefined, format: string | undefined) => {
      if (!kind) {
        return context.title;
      }
      const configured =
        kind === "date"
          ? context.dateFormat || DEFAULT_DATE_FORMAT
          : context.timeFormat || DEFAULT_TIME_FORMAT;
      return formatLocalDate(context.now, format ?? configured);
    },
  );
}

/** Formats local wall-clock time with the tokens YYYY, MM, DD, HH, mm and ss. */
export function formatLocalDate(date: Date, pattern: string): string {
  // The shared formatter reads UTC fields; shift them to hold local time.
  const offset = date.getTimezoneOffset() * 60_000;
  return formatWithPattern(date.getTime() - offset, pattern);
}

const SUPPORTED_TOKENS = /YYYY|MM|DD|HH|mm|ss/g;

/**
 * True when every letter in the pattern belongs to a supported token, so the
 * formatted text means what the pattern says (Moment's `ddd` or `[literal]`
 * would come out as written).
 */
export function isSupportedDateFormat(pattern: string): boolean {
  if (pattern.trim() === "") {
    return false;
  }
  return !/[A-Za-z[\]]/.test(pattern.replace(SUPPORTED_TOKENS, ""));
}
